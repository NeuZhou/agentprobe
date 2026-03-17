/**
 * Agent Profiler - Analyze agent behavior patterns from traces.
 *
 * Goes beyond performance profiling to analyze decision style,
 * tool preferences, error handling, cost patterns, and latency distribution.
 */

import type { AgentTrace } from './types';
import { calculateCost } from './cost';

export interface BehaviorProfile {
  decisionStyle: {
    label: string; // 'deliberate' | 'impulsive' | 'balanced'
    avgThinkingSteps: number;
    thinkBeforeActRatio: number;
  };
  toolPreference: {
    ranked: Array<{ tool: string; usagePercent: number; count: number }>;
    diversity: number; // 0-1, how evenly distributed tool usage is
  };
  errorHandling: {
    retryRate: number;
    giveUpRate: number;
    recoveryRate: number;
    totalErrors: number;
  };
  costPattern: {
    label: string; // 'front-loaded' | 'back-loaded' | 'even'
    firstHalfPercent: number;
    totalCost: number;
  };
  latencyPattern: {
    label: string; // 'fast' | 'slow' | 'bimodal' | 'variable'
    clusters: Array<{ label: string; rangeMs: [number, number]; count: number }>;
    avgMs: number;
    medianMs: number;
  };
  conversationDepth: {
    avgSteps: number;
    maxSteps: number;
    minSteps: number;
  };
}

/**
 * Classify decision style based on thinking-to-action ratio.
 */
function classifyDecisionStyle(thinkRatio: number): string {
  if (thinkRatio > 0.5) return 'deliberate';
  if (thinkRatio < 0.2) return 'impulsive';
  return 'balanced';
}

/**
 * Classify cost distribution pattern.
 */
function classifyCostPattern(firstHalfPct: number): string {
  if (firstHalfPct > 65) return 'front-loaded';
  if (firstHalfPct < 35) return 'back-loaded';
  return 'even';
}

/**
 * Classify latency distribution.
 */
function classifyLatencyPattern(durations: number[]): {
  label: string;
  clusters: Array<{ label: string; rangeMs: [number, number]; count: number }>;
} {
  if (durations.length === 0) return { label: 'none', clusters: [] };

  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const fast = sorted.filter(d => d < median * 0.5);
  const slow = sorted.filter(d => d > median * 1.5);

  const clusters: Array<{ label: string; rangeMs: [number, number]; count: number }> = [];

  if (fast.length > 0) {
    clusters.push({ label: 'fast', rangeMs: [fast[0], fast[fast.length - 1]], count: fast.length });
  }

  const mid = sorted.filter(d => d >= median * 0.5 && d <= median * 1.5);
  if (mid.length > 0) {
    clusters.push({ label: 'normal', rangeMs: [mid[0], mid[mid.length - 1]], count: mid.length });
  }

  if (slow.length > 0) {
    clusters.push({ label: 'slow', rangeMs: [slow[0], slow[slow.length - 1]], count: slow.length });
  }

  // Bimodal if both fast and slow have significant populations
  if (fast.length > sorted.length * 0.2 && slow.length > sorted.length * 0.2) {
    return { label: 'bimodal', clusters };
  }

  const cv = computeCV(durations);
  if (cv > 0.8) return { label: 'variable', clusters };
  if (median < 1000) return { label: 'fast', clusters };
  if (median > 3000) return { label: 'slow', clusters };
  return { label: 'moderate', clusters };
}

function computeCV(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Profile agent behavior across multiple traces.
 */
export function profileBehavior(traces: AgentTrace[]): BehaviorProfile {
  let thinkingSteps = 0;
  let actionSteps = 0;
  const toolCounts: Record<string, number> = {};
  let totalToolCalls = 0;
  let errors = 0;
  let retries = 0;
  let recoveries = 0;
  const allDurations: number[] = [];
  let totalCost = 0;
  const stepCosts: number[] = [];

  for (const trace of traces) {
    const cost = calculateCost(trace);
    totalCost += cost.total_cost;

    let prevWasError = false;
    const halfIdx = Math.floor(trace.steps.length / 2);

    for (let i = 0; i < trace.steps.length; i++) {
      const step = trace.steps[i];
      const dur = step.duration_ms ?? 0;
      allDurations.push(dur);

      if (step.type === 'thought') {
        thinkingSteps++;
      }

      if (step.type === 'tool_call') {
        actionSteps++;
        totalToolCalls++;
        const name = step.data.tool_name ?? 'unknown';
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;
      }

      if (step.type === 'tool_result') {
        const result = String(step.data.tool_result ?? '');
        if (result.includes('error') || result.includes('Error') || result.includes('failed')) {
          errors++;
          prevWasError = true;
        } else if (prevWasError) {
          recoveries++;
          prevWasError = false;
        }
      }

      // Detect retries (same tool called consecutively)
      if (step.type === 'tool_call' && i > 0) {
        const prev = trace.steps[i - 1];
        if (prev.type === 'tool_result' && prevWasError) {
          retries++;
        }
      }

      // Track cost by half
      if (step.data.tokens) {
        const stepCost = (step.data.tokens.input ?? 0) * 0.00001 + (step.data.tokens.output ?? 0) * 0.00003;
        if (i <= halfIdx) stepCosts.push(stepCost);
      }
    }
  }

  // Tool preference
  const totalActions = Math.max(totalToolCalls, 1);
  const ranked = Object.entries(toolCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([tool, count]) => ({
      tool,
      usagePercent: Math.round((count / totalActions) * 100),
      count,
    }));

  // Tool diversity (Shannon entropy normalized)
  const toolProbs = Object.values(toolCounts).map(c => c / totalActions);
  const entropy = -toolProbs.reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0);
  const maxEntropy = Math.log2(Math.max(Object.keys(toolCounts).length, 1));
  const diversity = maxEntropy > 0 ? entropy / maxEntropy : 0;

  const thinkRatio = (thinkingSteps + actionSteps) > 0
    ? thinkingSteps / (thinkingSteps + actionSteps) : 0;

  const firstHalfCost = stepCosts.reduce((a, b) => a + b, 0);
  const firstHalfPct = totalCost > 0 ? (firstHalfCost / totalCost) * 100 : 50;

  const latencyInfo = classifyLatencyPattern(allDurations);
  const sorted = [...allDurations].sort((a, b) => a - b);

  const stepsPerTrace = traces.map(t => t.steps.length);

  return {
    decisionStyle: {
      label: classifyDecisionStyle(thinkRatio),
      avgThinkingSteps: traces.length > 0 ? Math.round((thinkingSteps / traces.length) * 10) / 10 : 0,
      thinkBeforeActRatio: Math.round(thinkRatio * 100) / 100,
    },
    toolPreference: {
      ranked,
      diversity: Math.round(diversity * 100) / 100,
    },
    errorHandling: {
      retryRate: errors > 0 ? Math.round((retries / errors) * 100) : 0,
      giveUpRate: errors > 0 ? Math.round(((errors - recoveries) / errors) * 100) : 0,
      recoveryRate: errors > 0 ? Math.round((recoveries / errors) * 100) : 0,
      totalErrors: errors,
    },
    costPattern: {
      label: classifyCostPattern(firstHalfPct),
      firstHalfPercent: Math.round(firstHalfPct),
      totalCost,
    },
    latencyPattern: {
      label: latencyInfo.label,
      clusters: latencyInfo.clusters,
      avgMs: allDurations.length > 0 ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length) : 0,
      medianMs: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0,
    },
    conversationDepth: {
      avgSteps: stepsPerTrace.length > 0 ? Math.round(stepsPerTrace.reduce((a, b) => a + b, 0) / stepsPerTrace.length * 10) / 10 : 0,
      maxSteps: stepsPerTrace.length > 0 ? Math.max(...stepsPerTrace) : 0,
      minSteps: stepsPerTrace.length > 0 ? Math.min(...stepsPerTrace) : 0,
    },
  };
}

/**
 * Format behavior profile for terminal display.
 */
export function formatBehaviorProfile(profile: BehaviorProfile): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('🧠 Agent Behavior Profile');
  lines.push('═'.repeat(60));

  // Decision style
  const ds = profile.decisionStyle;
  lines.push(`  Decision style: ${ds.label} (avg ${ds.avgThinkingSteps} thinking steps before action)`);

  // Tool preference
  const tp = profile.toolPreference;
  if (tp.ranked.length > 0) {
    lines.push(`  Tool preference: ${tp.ranked.slice(0, 5).map(t => `${t.tool} (${t.usagePercent}%)`).join(', ')}`);
    lines.push(`  Tool diversity: ${tp.diversity} (${tp.diversity > 0.7 ? 'varied' : tp.diversity > 0.4 ? 'moderate' : 'concentrated'})`);
  }

  // Error handling
  const eh = profile.errorHandling;
  if (eh.totalErrors > 0) {
    lines.push(`  Error handling: retries on failure (${eh.retryRate}%), gives up (${eh.giveUpRate}%)`);
  } else {
    lines.push('  Error handling: no errors encountered');
  }

  // Cost pattern
  const cp = profile.costPattern;
  lines.push(`  Cost pattern: ${cp.label} (${cp.firstHalfPercent}% cost in first half)`);

  // Latency pattern
  const lp = profile.latencyPattern;
  lines.push(`  Latency pattern: ${lp.label} (avg: ${lp.avgMs}ms, median: ${lp.medianMs}ms)`);
  for (const cluster of lp.clusters) {
    lines.push(`    ${cluster.label}: ${cluster.rangeMs[0]}-${cluster.rangeMs[1]}ms (${cluster.count} steps)`);
  }

  // Depth
  const cd = profile.conversationDepth;
  lines.push(`  Conversation depth: avg ${cd.avgSteps} steps (min: ${cd.minSteps}, max: ${cd.maxSteps})`);

  lines.push('');
  return lines.join('\n');
}

// ===== v2.9.0 - Detailed Performance Profiler =====

export interface PerformanceProfile {
  phases: Array<{
    name: string;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    count: number;
  }>;
  total: { avg: number; p50: number; p95: number; p99: number };
  bottleneck: { tool: string; pctOfTotal: number } | null;
  suggestions: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Build detailed performance profile from traces.
 */
export function profilePerformance(traces: AgentTrace[]): PerformanceProfile {
  const llmLatencies: number[] = [];
  const toolLatencies: number[] = [];
  const toolBreakdown = new Map<string, number[]>();
  const totalLatencies: number[] = [];

  for (const trace of traces) {
    let traceTotal = 0;
    for (const step of trace.steps) {
      const lat = step.duration_ms ?? 0;
      if (lat <= 0) continue;
      traceTotal += lat;

      if (step.type === 'llm_call' || step.type === 'output') {
        llmLatencies.push(lat);
      } else if (step.type === 'tool_call') {
        toolLatencies.push(lat);
        const name = step.data.tool_name ?? 'unknown';
        if (!toolBreakdown.has(name)) toolBreakdown.set(name, []);
        toolBreakdown.get(name)!.push(lat);
      }
    }
    if (traceTotal > 0) totalLatencies.push(traceTotal);
  }

  const makePhase = (name: string, values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const avg = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    return { name, avg, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), count: sorted.length };
  };

  const phases = [
    makePhase('LLM calls', llmLatencies),
    makePhase('Tool exec', toolLatencies),
  ];

  const totalSorted = [...totalLatencies].sort((a, b) => a - b);
  const totalAvg = totalSorted.length > 0 ? totalSorted.reduce((a, b) => a + b, 0) / totalSorted.length : 0;
  const total = { avg: totalAvg, p50: percentile(totalSorted, 50), p95: percentile(totalSorted, 95), p99: percentile(totalSorted, 99) };

  // Find bottleneck tool
  let bottleneck: { tool: string; pctOfTotal: number } | null = null;
  const totalToolTime = toolLatencies.reduce((a, b) => a + b, 0);
  if (totalToolTime > 0) {
    let maxTool = '';
    let maxTime = 0;
    for (const [name, lats] of toolBreakdown) {
      const sum = lats.reduce((a, b) => a + b, 0);
      if (sum > maxTime) { maxTime = sum; maxTool = name; }
    }
    if (maxTool) {
      const totalAllTime = llmLatencies.reduce((a, b) => a + b, 0) + totalToolTime;
      bottleneck = { tool: maxTool, pctOfTotal: totalAllTime > 0 ? (maxTime / totalAllTime) * 100 : 0 };
    }
  }

  const suggestions: string[] = [];
  if (bottleneck && bottleneck.pctOfTotal > 40) {
    suggestions.push(`Tool "${bottleneck.tool}" accounts for ${bottleneck.pctOfTotal.toFixed(0)}% of latency. Consider caching or optimizing.`);
  }
  if (phases[0].p95 > 5000) {
    suggestions.push('LLM P95 latency >5s. Consider shorter prompts or faster models.');
  }
  if (phases[1].p95 > 3000) {
    suggestions.push('Tool P95 latency >3s. Check for slow external APIs.');
  }

  return { phases, total, bottleneck, suggestions };
}

/**
 * Format performance profile for console.
 */
export function formatPerformanceProfile(profile: PerformanceProfile): string {
  const fmt = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
  const lines = [
    '⏱️  Performance Profile',
    '═'.repeat(55),
    '',
    `${'Phase'.padEnd(14)} ${'Avg'.padStart(8)} ${'P50'.padStart(8)} ${'P95'.padStart(8)} ${'P99'.padStart(8)}`,
    '─'.repeat(55),
  ];

  for (const p of profile.phases) {
    if (p.count === 0) continue;
    lines.push(`${p.name.padEnd(14)} ${fmt(p.avg).padStart(8)} ${fmt(p.p50).padStart(8)} ${fmt(p.p95).padStart(8)} ${fmt(p.p99).padStart(8)}`);
  }
  lines.push('─'.repeat(55));
  lines.push(`${'Total'.padEnd(14)} ${fmt(profile.total.avg).padStart(8)} ${fmt(profile.total.p50).padStart(8)} ${fmt(profile.total.p95).padStart(8)} ${fmt(profile.total.p99).padStart(8)}`);
  lines.push('');

  if (profile.bottleneck) {
    lines.push(`Bottleneck: Tool "${profile.bottleneck.tool}" accounts for ${profile.bottleneck.pctOfTotal.toFixed(0)}% of latency`);
  }
  for (const s of profile.suggestions) {
    lines.push(`💡 ${s}`);
  }

  lines.push('');
  return lines.join('\n');
}
