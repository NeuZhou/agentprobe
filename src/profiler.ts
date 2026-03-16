/**
 * Performance profiler for agent traces.
 *
 * Analyzes traces to compute latency percentiles, token efficiency,
 * cost estimates, and bottleneck identification.
 */

import type { AgentTrace } from './types';
import { calculateCost } from './cost';

export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface ToolProfile {
  name: string;
  count: number;
  total_ms: number;
  pct_of_total: number;
  latency: PercentileStats;
}

export interface ProfileResult {
  trace_count: number;
  total_steps: number;
  llm_latency: PercentileStats;
  tool_latency: PercentileStats;
  tool_breakdown: ToolProfile[];
  token_efficiency: number;
  cost_per_query: number;
  total_cost: number;
  bottleneck: { name: string; pct: number } | null;
  total_duration_ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computePercentiles(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    avg: Math.round(sum / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: sorted.length,
  };
}

/**
 * Profile one or more traces and return performance stats.
 */
export function profile(traces: AgentTrace[]): ProfileResult {
  const llmDurations: number[] = [];
  const toolDurations: number[] = [];
  const toolByName: Record<string, number[]> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalDurationMs = 0;
  let totalCost = 0;

  for (const trace of traces) {
    const cost = calculateCost(trace);
    totalCost += cost.total_cost;

    for (const step of trace.steps) {
      const dur = step.duration_ms ?? 0;
      totalDurationMs += dur;

      if (step.type === 'llm_call') {
        llmDurations.push(dur);
        totalInputTokens += step.data.tokens?.input ?? 0;
        totalOutputTokens += step.data.tokens?.output ?? 0;
      }

      if (step.type === 'tool_call') {
        toolDurations.push(dur);
        const name = step.data.tool_name ?? 'unknown';
        if (!toolByName[name]) toolByName[name] = [];
        toolByName[name].push(dur);
      }
    }
  }

  const toolBreakdown: ToolProfile[] = Object.entries(toolByName)
    .map(([name, durations]) => ({
      name,
      count: durations.length,
      total_ms: durations.reduce((a, b) => a + b, 0),
      pct_of_total: totalDurationMs > 0
        ? (durations.reduce((a, b) => a + b, 0) / totalDurationMs) * 100
        : 0,
      latency: computePercentiles(durations),
    }))
    .sort((a, b) => b.total_ms - a.total_ms);

  const bottleneck = toolBreakdown.length > 0
    ? { name: toolBreakdown[0].name, pct: toolBreakdown[0].pct_of_total }
    : null;

  const totalTokens = totalInputTokens + totalOutputTokens;
  const tokenEfficiency = totalTokens > 0 ? totalOutputTokens / totalTokens : 0;

  return {
    trace_count: traces.length,
    total_steps: traces.reduce((sum, t) => sum + t.steps.length, 0),
    llm_latency: computePercentiles(llmDurations),
    tool_latency: computePercentiles(toolDurations),
    tool_breakdown: toolBreakdown,
    token_efficiency: Math.round(tokenEfficiency * 100) / 100,
    cost_per_query: traces.length > 0 ? totalCost / traces.length : 0,
    total_cost: totalCost,
    bottleneck,
    total_duration_ms: totalDurationMs,
  };
}

/**
 * Format profile result for terminal display.
 */
export function formatProfile(result: ProfileResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('🔍 Performance Profile');
  lines.push(`   Traces analyzed: ${result.trace_count} (${result.total_steps} total steps)`);
  lines.push('');
  lines.push(`   Avg LLM latency:    ${result.llm_latency.p50}ms (p50), ${result.llm_latency.p95}ms (p95), ${result.llm_latency.p99}ms (p99)`);
  lines.push(`   Avg tool latency:   ${result.tool_latency.p50}ms (p50), ${result.tool_latency.p95}ms (p95), ${result.tool_latency.p99}ms (p99)`);
  lines.push(`   Token efficiency:   ${result.token_efficiency} (output tokens / total tokens)`);
  lines.push(`   Cost per query:     $${result.cost_per_query.toFixed(4)}`);
  lines.push(`   Total cost:         $${result.total_cost.toFixed(4)}`);

  if (result.bottleneck) {
    lines.push(`   Bottleneck:         ${result.bottleneck.name} tool (${result.bottleneck.pct.toFixed(0)}% of total time)`);
  }

  if (result.tool_breakdown.length > 0) {
    lines.push('');
    lines.push('   Tool Breakdown:');
    for (const tool of result.tool_breakdown) {
      lines.push(`     ${tool.name}: ${tool.count} calls, ${tool.total_ms}ms total (${tool.pct_of_total.toFixed(1)}%), p50=${tool.latency.p50}ms`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
