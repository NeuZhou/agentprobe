/**
 * Performance Profiler - Detailed latency breakdown for agent traces.
 *
 * Breaks down: LLM calls vs tool execution vs total.
 * Computes P50/P95/P99 percentiles. Identifies bottlenecks.
 *
 * Re-exports enhanced profiling from behavior-profiler plus
 * additional detailed breakdown utilities.
 */

import type { AgentTrace } from './types';

export { profilePerformance, formatPerformanceProfile } from './behavior-profiler';
export type { PerformanceProfile } from './behavior-profiler';

export interface DetailedLatencyBreakdown {
  llm: { total_ms: number; pct: number; count: number };
  tool: { total_ms: number; pct: number; count: number };
  overhead: { total_ms: number; pct: number };
  total_ms: number;
}

export interface PercentileSet {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computePercentileSet(values: number[]): PercentileSet {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / sorted.length),
  };
}

/**
 * Compute detailed latency breakdown across traces.
 */
export function detailedLatencyBreakdown(traces: AgentTrace[]): DetailedLatencyBreakdown {
  let llmTotal = 0, toolTotal = 0, totalMs = 0;
  let llmCount = 0, toolCount = 0;

  for (const trace of traces) {
    for (const step of trace.steps) {
      const dur = step.duration_ms ?? 0;
      totalMs += dur;
      if (step.type === 'llm_call') { llmTotal += dur; llmCount++; }
      if (step.type === 'tool_call') { toolTotal += dur; toolCount++; }
    }
  }

  const overhead = Math.max(0, totalMs - llmTotal - toolTotal);

  return {
    llm: { total_ms: llmTotal, pct: totalMs > 0 ? (llmTotal / totalMs) * 100 : 0, count: llmCount },
    tool: { total_ms: toolTotal, pct: totalMs > 0 ? (toolTotal / totalMs) * 100 : 0, count: toolCount },
    overhead: { total_ms: overhead, pct: totalMs > 0 ? (overhead / totalMs) * 100 : 0 },
    total_ms: totalMs,
  };
}

/**
 * Compute percentile stats for all step durations.
 */
export function stepPercentiles(traces: AgentTrace[]): PercentileSet {
  const durations: number[] = [];
  for (const trace of traces) {
    for (const step of trace.steps) {
      if (step.duration_ms != null) durations.push(step.duration_ms);
    }
  }
  return computePercentileSet(durations);
}

/**
 * Identify the slowest tool (bottleneck) from traces.
 */
export function identifyBottleneck(traces: AgentTrace[]): { tool: string; totalMs: number; pctOfTotal: number } | null {
  const toolTimes: Record<string, number> = {};
  let totalMs = 0;

  for (const trace of traces) {
    for (const step of trace.steps) {
      const dur = step.duration_ms ?? 0;
      totalMs += dur;
      if (step.type === 'tool_call' && step.data.tool_name) {
        toolTimes[step.data.tool_name] = (toolTimes[step.data.tool_name] ?? 0) + dur;
      }
    }
  }

  let maxTool = '', maxTime = 0;
  for (const [tool, time] of Object.entries(toolTimes)) {
    if (time > maxTime) { maxTool = tool; maxTime = time; }
  }

  if (!maxTool) return null;
  return { tool: maxTool, totalMs: maxTime, pctOfTotal: totalMs > 0 ? (maxTime / totalMs) * 100 : 0 };
}

/**
 * Format detailed breakdown for console.
 */
export function formatDetailedBreakdown(breakdown: DetailedLatencyBreakdown): string {
  const lines = [
    '⏱️  Detailed Latency Breakdown',
    '═'.repeat(40),
    `  LLM calls:   ${breakdown.llm.total_ms}ms (${breakdown.llm.pct.toFixed(1)}%) [${breakdown.llm.count} calls]`,
    `  Tool exec:   ${breakdown.tool.total_ms}ms (${breakdown.tool.pct.toFixed(1)}%) [${breakdown.tool.count} calls]`,
    `  Overhead:    ${breakdown.overhead.total_ms}ms (${breakdown.overhead.pct.toFixed(1)}%)`,
    `  Total:       ${breakdown.total_ms}ms`,
    '',
  ];
  return lines.join('\n');
}
