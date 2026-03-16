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

// ===== AgentFingerprinter class (v3.5.0) =====

export interface DriftDimension {
  dimension: string;
  baseline: number;
  current: number;
  delta: number;
  severity: 'low' | 'medium' | 'high';
}

export interface DriftReport {
  drifted: boolean;
  overall: number; // 0-1 drift score
  dimensions: DriftDimension[];
  summary: string;
}

/**
 * Compare two fingerprints, returning 0-1 similarity.
 */
export function compareFingerprints(fp1: AgentFingerprint, fp2: AgentFingerprint): number {
  if (fp1.traceCount === 0 || fp2.traceCount === 0) return 0;

  // Tool similarity (Jaccard-like on tool names + cosine on percentages)
  const tools1 = new Map(fp1.tools.map(t => [t.name, t.percentage]));
  const tools2 = new Map(fp2.tools.map(t => [t.name, t.percentage]));
  const allTools = new Set([...tools1.keys(), ...tools2.keys()]);

  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;
  for (const tool of allTools) {
    const v1 = tools1.get(tool) || 0;
    const v2 = tools2.get(tool) || 0;
    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  }
  const toolSim = mag1 > 0 && mag2 > 0 ? dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2)) : 0;

  // Step count similarity
  const maxAvg = Math.max(fp1.avgSteps, fp2.avgSteps, 1);
  const stepSim = 1 - Math.abs(fp1.avgSteps - fp2.avgSteps) / maxAvg;

  // Cost similarity
  const maxCost = Math.max(fp1.avgCost, fp2.avgCost, 0.001);
  const costSim = 1 - Math.abs(fp1.avgCost - fp2.avgCost) / maxCost;

  // Error recovery similarity
  const recSim = 1 - (
    Math.abs(fp1.errorRecovery.retry - fp2.errorRecovery.retry) +
    Math.abs(fp1.errorRecovery.fallback - fp2.errorRecovery.fallback) +
    Math.abs(fp1.errorRecovery.giveUp - fp2.errorRecovery.giveUp)
  ) / 300;

  // Weighted average
  return Math.max(0, Math.min(1,
    toolSim * 0.4 + stepSim * 0.25 + costSim * 0.2 + recSim * 0.15
  ));
}

/**
 * Detect behavioral drift between a baseline fingerprint and current traces.
 */
export function detectDrift(
  baseline: AgentFingerprint,
  currentTraces: AgentTrace[],
  threshold = 0.2,
): DriftReport {
  const current = buildFingerprint(currentTraces);
  const similarity = compareFingerprints(baseline, current);
  const overall = 1 - similarity;

  const dimensions: DriftDimension[] = [];

  // Step count drift
  const stepDelta = baseline.avgSteps > 0
    ? Math.abs(current.avgSteps - baseline.avgSteps) / baseline.avgSteps
    : 0;
  dimensions.push({
    dimension: 'step_count',
    baseline: baseline.avgSteps,
    current: current.avgSteps,
    delta: stepDelta,
    severity: stepDelta > 0.5 ? 'high' : stepDelta > 0.2 ? 'medium' : 'low',
  });

  // Cost drift
  const costDelta = baseline.avgCost > 0
    ? Math.abs(current.avgCost - baseline.avgCost) / baseline.avgCost
    : 0;
  dimensions.push({
    dimension: 'cost',
    baseline: baseline.avgCost,
    current: current.avgCost,
    delta: costDelta,
    severity: costDelta > 0.5 ? 'high' : costDelta > 0.2 ? 'medium' : 'low',
  });

  // Tool usage drift
  const baseTools = new Set(baseline.tools.map(t => t.name));
  const curTools = new Set(current.tools.map(t => t.name));
  const newTools = [...curTools].filter(t => !baseTools.has(t));
  const removedTools = [...baseTools].filter(t => !curTools.has(t));
  const toolDelta = (newTools.length + removedTools.length) / Math.max(baseTools.size, 1);
  dimensions.push({
    dimension: 'tool_usage',
    baseline: baseTools.size,
    current: curTools.size,
    delta: toolDelta,
    severity: toolDelta > 0.5 ? 'high' : toolDelta > 0.2 ? 'medium' : 'low',
  });

  const drifted = overall > threshold;
  const summaryParts: string[] = [];
  if (drifted) {
    summaryParts.push(`Drift detected (score: ${(overall * 100).toFixed(1)}%)`);
    for (const d of dimensions.filter(d => d.severity !== 'low')) {
      summaryParts.push(`  ${d.dimension}: ${d.severity} (${(d.delta * 100).toFixed(1)}% change)`);
    }
    if (newTools.length > 0) summaryParts.push(`  New tools: ${newTools.join(', ')}`);
    if (removedTools.length > 0) summaryParts.push(`  Removed tools: ${removedTools.join(', ')}`);
  } else {
    summaryParts.push(`No significant drift (score: ${(overall * 100).toFixed(1)}%)`);
  }

  return { drifted, overall, dimensions, summary: summaryParts.join('\n') };
}

export class AgentFingerprinter {
  createFingerprint(traces: AgentTrace[]): AgentFingerprint {
    return buildFingerprint(traces);
  }

  compare(fp1: AgentFingerprint, fp2: AgentFingerprint): number {
    return compareFingerprints(fp1, fp2);
  }

  detectDrift(baseline: AgentFingerprint, current: AgentTrace[]): DriftReport {
    return detectDrift(baseline, current);
  }
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
