import type { AgentTrace } from './types';
import { calculateCost } from './cost';
import chalk from 'chalk';

export interface TraceStats {
  traceCount: number;
  totalSteps: number;
  totalTokens: number;
  totalCost: number;
  avgDuration: number;
  toolUsage: Map<string, number>;
  traces: Array<{
    id: string;
    steps: number;
    tokens: number;
    cost: number;
    duration: number;
  }>;
}

export interface DetailedStats extends TraceStats {
  models: Map<string, number>;
  avgSteps: number;
  stdSteps: number;
  avgTokens: number;
  stdTokens: number;
  avgCost: number;
  stdCost: number;
  failureRate: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
}

function std(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function computeStats(traces: AgentTrace[]): TraceStats {
  const toolUsage = new Map<string, number>();
  const traceDetails: TraceStats['traces'] = [];

  let totalSteps = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let totalDuration = 0;

  for (const trace of traces) {
    const steps = trace.steps.length;
    const tokens = trace.steps.reduce((sum, s) => {
      const t = s.data.tokens;
      return sum + (t?.input ?? 0) + (t?.output ?? 0);
    }, 0);
    const cost = calculateCost(trace);
    const duration = trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);

    totalSteps += steps;
    totalTokens += tokens;
    totalCost += cost.total_cost;
    totalDuration += duration;

    for (const s of trace.steps) {
      if (s.type === 'tool_call' && s.data.tool_name) {
        toolUsage.set(s.data.tool_name, (toolUsage.get(s.data.tool_name) ?? 0) + 1);
      }
    }

    traceDetails.push({
      id: trace.id,
      steps,
      tokens,
      cost: cost.total_cost,
      duration,
    });
  }

  return {
    traceCount: traces.length,
    totalSteps,
    totalTokens,
    totalCost,
    avgDuration: traces.length > 0 ? totalDuration / traces.length : 0,
    toolUsage,
    traces: traceDetails,
  };
}

/**
 * Compute detailed statistics with standard deviations, percentiles, model breakdown.
 */
export function computeDetailedStats(traces: AgentTrace[]): DetailedStats {
  const base = computeStats(traces);
  const n = traces.length;

  // Model usage
  const models = new Map<string, number>();
  let failedTraces = 0;

  for (const trace of traces) {
    for (const step of trace.steps) {
      if (step.data.model) {
        models.set(step.data.model, (models.get(step.data.model) ?? 0) + 1);
      }
    }
    // Heuristic: trace "failed" if last step is an error-like output
    const lastStep = trace.steps[trace.steps.length - 1];
    if (lastStep?.data.content?.toLowerCase().includes('error')) {
      failedTraces++;
    }
  }

  const stepsArr = base.traces.map((t) => t.steps);
  const tokensArr = base.traces.map((t) => t.tokens);
  const costArr = base.traces.map((t) => t.cost);
  const durArr = base.traces.map((t) => t.duration).sort((a, b) => a - b);

  const avgSteps = n > 0 ? stepsArr.reduce((a, b) => a + b, 0) / n : 0;
  const avgTokens = n > 0 ? tokensArr.reduce((a, b) => a + b, 0) / n : 0;
  const avgCost = n > 0 ? costArr.reduce((a, b) => a + b, 0) / n : 0;

  return {
    ...base,
    models,
    avgSteps,
    stdSteps: std(stepsArr, avgSteps),
    avgTokens,
    stdTokens: std(tokensArr, avgTokens),
    avgCost,
    stdCost: std(costArr, avgCost),
    failureRate: n > 0 ? failedTraces / n : 0,
    p50Latency: percentile(durArr, 50) / 1000,
    p95Latency: percentile(durArr, 95) / 1000,
    p99Latency: percentile(durArr, 99) / 1000,
  };
}

export function formatStats(stats: TraceStats): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`\n📊 Trace Statistics (${stats.traceCount} traces)`));
  lines.push(`  Total steps:     ${stats.totalSteps}`);
  lines.push(
    `  Total tokens:    ${stats.totalTokens.toLocaleString()}${stats.traceCount > 0 ? ` (avg ${Math.round(stats.totalTokens / stats.traceCount)}/trace)` : ''}`,
  );
  lines.push(`  Total cost:      $${stats.totalCost.toFixed(4)}`);
  lines.push(`  Avg duration:    ${(stats.avgDuration / 1000).toFixed(1)}s`);

  if (stats.toolUsage.size > 0) {
    const tools = [...stats.toolUsage.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}(${count})`)
      .join(', ');
    lines.push(`  Tools used:      ${tools}`);
  }

  if (stats.traces.length > 1) {
    const mostExpensive = stats.traces.reduce((a, b) => (a.cost > b.cost ? a : b));
    const slowest = stats.traces.reduce((a, b) => (a.duration > b.duration ? a : b));
    lines.push(`  Most expensive:  ${mostExpensive.id} ($${mostExpensive.cost.toFixed(4)})`);
    lines.push(`  Slowest:         ${slowest.id} (${(slowest.duration / 1000).toFixed(1)}s)`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format detailed statistics with model breakdown, σ, percentiles.
 */
export function formatDetailedStats(stats: DetailedStats): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`\n📊 Trace Statistics (${stats.traceCount} traces)\n`));

  // Model breakdown
  if (stats.models.size > 0) {
    const totalModelCalls = [...stats.models.values()].reduce((a, b) => a + b, 0);
    const modelStr = [...stats.models.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([m, c]) => `${m} (${Math.round((c / totalModelCalls) * 100)}%)`)
      .join(', ');
    lines.push(`  Models:          ${modelStr}`);
  }

  lines.push(`  Avg steps:       ${stats.avgSteps.toFixed(1)} (σ=${stats.stdSteps.toFixed(1)})`);
  lines.push(`  Avg tokens:      ${Math.round(stats.avgTokens).toLocaleString()} (σ=${Math.round(stats.stdTokens).toLocaleString()})`);
  lines.push(`  Avg cost:        $${stats.avgCost.toFixed(3)} (σ=$${stats.stdCost.toFixed(3)})`);

  // Tool usage with percentages
  if (stats.toolUsage.size > 0) {
    const n = stats.traceCount;
    const tools = [...stats.toolUsage.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} (${Math.round((count / n) * 100)}%)`)
      .join(', ');
    lines.push(`  Tool usage:      ${tools}`);
  }

  lines.push(`  Failure rate:    ${(stats.failureRate * 100).toFixed(1)}%`);
  lines.push(`  P50 latency:     ${stats.p50Latency.toFixed(1)}s`);
  lines.push(`  P95 latency:     ${stats.p95Latency.toFixed(1)}s`);
  lines.push(`  P99 latency:     ${stats.p99Latency.toFixed(1)}s`);

  lines.push('');
  return lines.join('\n');
}
