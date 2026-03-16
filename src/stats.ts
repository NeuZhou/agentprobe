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
