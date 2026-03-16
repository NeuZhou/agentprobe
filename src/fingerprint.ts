/**
 * Agent Fingerprinting - Create behavioral fingerprints from traces
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace } from './types';
import chalk from 'chalk';

export interface ToolUsage {
  name: string;
  count: number;
  percentage: number;
}

export interface ErrorRecovery {
  retry: number;
  fallback: number;
  giveUp: number;
}

export interface AgentFingerprint {
  traceCount: number;
  tools: ToolUsage[];
  avgSteps: number;
  stdDevSteps: number;
  decisionPattern: string[];
  errorRecovery: ErrorRecovery;
  avgCost: number;
  stdDevCost: number;
}

/**
 * Analyze traces to build a behavioral fingerprint.
 */
export function buildFingerprint(traces: AgentTrace[]): AgentFingerprint {
  if (traces.length === 0) {
    return {
      traceCount: 0,
      tools: [],
      avgSteps: 0,
      stdDevSteps: 0,
      decisionPattern: [],
      errorRecovery: { retry: 0, fallback: 0, giveUp: 0 },
      avgCost: 0,
      stdDevCost: 0,
    };
  }

  // Tool usage
  const toolCounts: Record<string, number> = {};
  let totalToolCalls = 0;
  const stepCounts: number[] = [];
  const costs: number[] = [];

  // Error recovery tracking
  let retries = 0;
  let fallbacks = 0;
  let giveUps = 0;
  let totalErrors = 0;

  // Decision pattern tracking
  const patterns: string[][] = [];

  for (const trace of traces) {
    stepCounts.push(trace.steps.length);

    let traceCost = 0;
    const pattern: string[] = [];
    let lastToolFailed = false;

    for (const step of trace.steps) {
      // Track pattern
      if (step.type === 'thought') pattern.push('Think');
      else if (step.type === 'tool_call') {
        const toolName = step.data.tool_name || 'unknown';
        pattern.push(toolName.charAt(0).toUpperCase() + toolName.slice(1));
        toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
        totalToolCalls++;
      } else if (step.type === 'output') pattern.push('Respond');
      else if (step.type === 'llm_call') pattern.push('Analyze');

      // Track cost from tokens
      if (step.data.tokens) {
        const inputTokens = step.data.tokens.input || 0;
        const outputTokens = step.data.tokens.output || 0;
        traceCost += (inputTokens * 0.00001 + outputTokens * 0.00003); // rough estimate
      }

      // Track error recovery
      if (step.type === 'tool_result' && step.data.tool_result?.error) {
        totalErrors++;
        lastToolFailed = true;
      } else if (lastToolFailed) {
        if (step.type === 'tool_call' && step.data.tool_name === trace.steps[trace.steps.indexOf(step) - 2]?.data?.tool_name) {
          retries++;
        } else if (step.type === 'tool_call') {
          fallbacks++;
        } else if (step.type === 'output') {
          giveUps++;
        }
        lastToolFailed = false;
      }
    }

    costs.push(traceCost);
    patterns.push(pattern);
  }

  // Compute tool usage percentages
  const tools: ToolUsage[] = Object.entries(toolCounts)
    .map(([name, count]) => ({
      name,
      count,
      percentage: traces.length > 0 ? (count / traces.length) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Average steps with std dev
  const avgSteps = stepCounts.reduce((s, v) => s + v, 0) / stepCounts.length;
  const stdDevSteps = Math.sqrt(
    stepCounts.reduce((s, v) => s + (v - avgSteps) ** 2, 0) / stepCounts.length,
  );

  // Average cost with std dev
  const avgCost = costs.reduce((s, v) => s + v, 0) / costs.length;
  const stdDevCost = Math.sqrt(
    costs.reduce((s, v) => s + (v - avgCost) ** 2, 0) / costs.length,
  );

  // Most common decision pattern (deduplicate consecutive same steps)
  const deduped = patterns.map(p => {
    const result: string[] = [];
    for (const step of p) {
      if (result[result.length - 1] !== step) result.push(step);
    }
    return result;
  });
  const patternStr = deduped.map(p => p.join(' → '));
  const patternFreq: Record<string, number> = {};
  for (const p of patternStr) {
    patternFreq[p] = (patternFreq[p] || 0) + 1;
  }
  const topPattern = Object.entries(patternFreq)
    .sort((a, b) => b[1] - a[1])[0]?.[0]?.split(' → ') || [];

  // Error recovery rates
  const totalRecovery = retries + fallbacks + giveUps || 1;
  const errorRecovery: ErrorRecovery = {
    retry: Math.round((retries / totalRecovery) * 100),
    fallback: Math.round((fallbacks / totalRecovery) * 100),
    giveUp: Math.round((giveUps / totalRecovery) * 100),
  };

  return {
    traceCount: traces.length,
    tools,
    avgSteps,
    stdDevSteps,
    decisionPattern: topPattern,
    errorRecovery,
    avgCost,
    stdDevCost,
  };
}

/**
 * Load all traces from a directory.
 */
export function loadTraces(dir: string): AgentTrace[] {
  const traces: AgentTrace[] = [];
  if (!fs.existsSync(dir)) return traces;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      if (data.id && data.steps) {
        traces.push(data as AgentTrace);
      }
    } catch { /* skip invalid files */ }
  }
  return traces;
}

/**
 * Format fingerprint for console display.
 */
export function formatFingerprint(fp: AgentFingerprint): string {
  const lines: string[] = [];
  lines.push(chalk.bold('\n🔍 Agent Fingerprint\n'));
  lines.push(`  Traces analyzed: ${fp.traceCount}`);
  lines.push('  Tools: ' + fp.tools.map(t => `${t.name}(${t.percentage.toFixed(0)}%)`).join(', '));
  lines.push(`  Avg steps: ${fp.avgSteps.toFixed(1)} ± ${fp.stdDevSteps.toFixed(1)}`);
  lines.push(`  Decision pattern: ${fp.decisionPattern.join(' → ')}`);
  lines.push(`  Error recovery: retry(${fp.errorRecovery.retry}%), fallback(${fp.errorRecovery.fallback}%), give-up(${fp.errorRecovery.giveUp}%)`);
  lines.push(`  Cost profile: $${fp.avgCost.toFixed(2)} ± $${fp.stdDevCost.toFixed(2)} per query`);
  return lines.join('\n');
}
