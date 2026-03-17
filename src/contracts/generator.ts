/**
 * Contract Generator — Auto-generate contracts from "golden" traces
 *
 * Infers patterns: which tools are always called, output format, timing bounds, etc.
 */

import type { AgentTrace } from '../types';
import type { AgentContract, BehaviorRule, SafetyRule, OutputContract } from './schema';

interface ToolStats {
  name: string;
  count: number;
  traces: number; // how many traces include this tool
  totalCalls: number;
  maxCalls: number;
  minCalls: number;
}

/**
 * Auto-generate a contract from a set of golden traces.
 * Infers behavioral patterns, timing bounds, tool usage, and safety rules.
 */
export function generateContract(
  traces: AgentTrace[],
  options?: {
    name?: string;
    version?: string;
    timingBuffer?: number; // multiplier for timing bounds (default 1.5)
    strictness?: 'strict' | 'normal' | 'relaxed';
  },
): AgentContract {
  if (traces.length === 0) {
    return { name: options?.name ?? 'generated-contract', version: options?.version ?? '1.0' };
  }

  const name = options?.name ?? 'generated-contract';
  const version = options?.version ?? '1.0';
  const buffer = options?.timingBuffer ?? 1.5;
  const strictness = options?.strictness ?? 'normal';
  const n = traces.length;

  // Analyze tool usage
  const toolStats = analyzeToolUsage(traces);
  const alwaysCalled = toolStats.filter(t => t.traces === n).map(t => t.name);
  // neverCalled detection reserved for future use

  // Analyze timing
  const durations = traces.map(t => t.steps.reduce((s, step) => s + (step.duration_ms ?? 0), 0));
  const maxDuration = Math.max(...durations);
  const stepCounts = traces.map(t => t.steps.length);
  const maxSteps = Math.max(...stepCounts);
  const toolCallCounts = traces.map(t => t.steps.filter(s => s.type === 'tool_call').length);
  const maxToolCalls = Math.max(...toolCallCounts);

  // Build behavior rules
  const behaviorRules: BehaviorRule[] = [];

  if (alwaysCalled.length > 0) {
    behaviorRules.push({ always_calls: alwaysCalled });
  }

  behaviorRules.push({
    max_response_time_ms: Math.ceil(maxDuration * buffer),
    max_steps: Math.ceil(maxSteps * buffer),
    max_tool_calls: Math.ceil(maxToolCalls * buffer),
  });

  // Infer tool ordering (if consistent)
  const ordering = inferToolOrdering(traces);
  if (ordering.length >= 2) {
    behaviorRules.push({ tool_sequence: ordering });
  }

  // Analyze safety
  const safetyRules: SafetyRule[] = [];
  const hasPII = traces.some(t =>
    t.steps.some(s => s.type === 'output' && /\b\d{3}-\d{2}-\d{4}\b/.test(s.data.content ?? ''))
  );
  if (!hasPII) {
    safetyRules.push({ no_pii_in_output: true });
  }

  // Analyze output format
  const output = inferOutputContract(traces);

  // Strictness adjustments
  if (strictness === 'strict') {
    // In strict mode, all observed tools become the allowed set
    const allTools = new Set(toolStats.map(t => t.name));
    safetyRules.push({ allowed_tools_only: [...allTools] });
  }

  const contract: AgentContract = {
    name,
    version,
    description: `Auto-generated from ${n} golden traces`,
    behavior: { rules: behaviorRules },
    safety: safetyRules.length > 0 ? { rules: safetyRules } : undefined,
    output: output ?? undefined,
  };

  return contract;
}

function analyzeToolUsage(traces: AgentTrace[]): ToolStats[] {
  const statsMap = new Map<string, ToolStats>();

  for (const trace of traces) {
    const toolsInTrace = new Map<string, number>();
    for (const step of trace.steps) {
      if (step.type === 'tool_call') {
        const name = step.data.tool_name ?? '';
        toolsInTrace.set(name, (toolsInTrace.get(name) ?? 0) + 1);
      }
    }
    for (const [name, count] of toolsInTrace) {
      const existing = statsMap.get(name);
      if (existing) {
        existing.traces++;
        existing.totalCalls += count;
        existing.maxCalls = Math.max(existing.maxCalls, count);
        existing.minCalls = Math.min(existing.minCalls, count);
      } else {
        statsMap.set(name, { name, count, traces: 1, totalCalls: count, maxCalls: count, minCalls: count });
      }
    }
  }

  return [...statsMap.values()];
}

function inferToolOrdering(traces: AgentTrace[]): string[] {
  if (traces.length < 2) return [];

  // Get tool sequences from each trace
  const sequences = traces.map(t =>
    t.steps.filter(s => s.type === 'tool_call').map(s => s.data.tool_name ?? '')
  );

  // Find common prefix ordering
  const first = [...new Set(sequences[0])]; // unique tools in order
  const consistent: string[] = [];

  for (const tool of first) {
    const allHave = sequences.every(seq => seq.includes(tool));
    if (!allHave) continue;

    // Check it always appears after the previous consistent tools
    const isOrdered = sequences.every(seq => {
      const idx = seq.indexOf(tool);
      return consistent.every(prev => {
        const prevIdx = seq.indexOf(prev);
        return prevIdx <= idx;
      });
    });

    if (isOrdered) consistent.push(tool);
  }

  return consistent;
}

function inferOutputContract(traces: AgentTrace[]): OutputContract | null {
  const outputs = traces.flatMap(t =>
    t.steps.filter(s => s.type === 'output').map(s => s.data.content ?? '')
  );

  if (outputs.length === 0) return null;

  // Check if all outputs are valid JSON
  let allJson = true;
  const parsedOutputs: any[] = [];
  for (const o of outputs) {
    if (!o.trim()) continue;
    try {
      parsedOutputs.push(JSON.parse(o));
    } catch {
      allJson = false;
      break;
    }
  }

  if (allJson && parsedOutputs.length > 0) {
    // Infer required fields from JSON outputs
    const allKeys = parsedOutputs.filter(o => typeof o === 'object' && o !== null).map(o => new Set(Object.keys(o)));
    if (allKeys.length > 0) {
      const commonKeys = [...allKeys[0]].filter(k => allKeys.every(s => s.has(k)));
      return {
        format: 'json',
        schema: {
          type: 'object',
          required: commonKeys.length > 0 ? commonKeys : undefined,
        },
      };
    }
  }

  return null;
}
