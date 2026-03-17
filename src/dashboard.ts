/**
 * Test Dashboard CLI — Terminal UI for AgentProbe test results.
 * Renders a rich dashboard with test results, coverage, cost breakdown, and trend sparklines.
 */

import type { SuiteResult, TestResult } from './types';

// ── Sparkline helpers ──────────────────────────────────────────────

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

/**
 * Generate a sparkline string from numeric data points.
 */
export function sparkline(data: number[]): string {
  if (data.length === 0) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  return data.map((v) => SPARK_CHARS[Math.round(((v - min) / range) * (SPARK_CHARS.length - 1))]).join('');
}

// ── Data models ────────────────────────────────────────────────────

export interface DashboardData {
  results: {
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
    total: number;
  };
  coverage: {
    tools: number;
    prompts: number;
    security: number;
  };
  cost: {
    totalUsd: number;
    avgPerTest: number;
    mostExpensive: { name: string; costUsd: number } | null;
  };
  trend: number[];
  duration_ms: number;
}

export interface DashboardOptions {
  width?: number;
  color?: boolean;
  compact?: boolean;
}

// ── Extract dashboard data from suite results ──────────────────────

/**
 * Aggregate multiple suite results into DashboardData.
 */
export function collectDashboardData(
  suites: SuiteResult[],
  opts?: { coverageTools?: string[]; declaredTools?: string[]; history?: number[] },
): DashboardData {
  let passed = 0;
  let failed = 0;
  let flaky = 0;
  let skipped = 0;
  let totalCost = 0;
  let totalDuration = 0;
  let mostExpensive: { name: string; costUsd: number } | null = null;

  const toolsSeen = new Set<string>();
  const promptsSeen = new Set<string>();
  let securityTests = 0;
  let securityPassed = 0;

  for (const suite of suites) {
    totalDuration += suite.duration_ms;
    for (const r of suite.results) {
      if (r.skipped) {
        skipped++;
        continue;
      }
      if (r.passed) {
        passed++;
      } else {
        failed++;
      }
      // Flaky = passed after retries
      if (r.attempts && r.attempts > 1 && r.passed) {
        flaky++;
        passed--; // don't double-count
      }

      // Cost from trace
      const cost = estimateTestCost(r);
      totalCost += cost;
      if (!mostExpensive || cost > mostExpensive.costUsd) {
        mostExpensive = { name: r.name, costUsd: cost };
      }

      // Tools coverage
      if (r.trace) {
        for (const step of r.trace.steps) {
          if (step.type === 'tool_call' && step.data.tool_name) {
            toolsSeen.add(step.data.tool_name);
          }
          if (step.type === 'llm_call') promptsSeen.add(r.name);
        }
      }

      // Security coverage
      if (r.tags?.includes('security')) {
        securityTests++;
        if (r.passed) securityPassed++;
      }
    }
  }

  const total = passed + failed + flaky + skipped;
  const declaredCount = opts?.declaredTools?.length || toolsSeen.size || 1;
  const toolsCoverage = Math.min(100, Math.round((toolsSeen.size / declaredCount) * 100));

  return {
    results: { passed, failed, flaky, skipped, total },
    coverage: {
      tools: toolsCoverage,
      prompts: total > 0 ? Math.round((promptsSeen.size / total) * 100) : 0,
      security: securityTests > 0 ? Math.round((securityPassed / securityTests) * 100) : 0,
    },
    cost: {
      totalUsd: totalCost,
      avgPerTest: total > 0 ? totalCost / total : 0,
      mostExpensive,
    },
    trend: opts?.history ?? [],
    duration_ms: totalDuration,
  };
}

/**
 * Estimate cost of a single test from its trace token usage.
 */
export function estimateTestCost(result: TestResult): number {
  if (!result.trace) return 0;
  let tokens = 0;
  for (const step of result.trace.steps) {
    tokens += (step.data.tokens?.input ?? 0) + (step.data.tokens?.output ?? 0);
  }
  // Rough cost: $0.01 per 1K tokens (blended estimate)
  return (tokens / 1000) * 0.01;
}

// ── Box-drawing renderer ───────────────────────────────────────────

function pad(s: string, len: number): string {
  const visible = stripAnsi(s);
  return s + ' '.repeat(Math.max(0, len - visible.length));
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Render the full terminal dashboard.
 */
export function renderDashboard(data: DashboardData, opts?: DashboardOptions): string {
  const w = opts?.width ?? 58;
  const leftW = Math.floor(w * 0.55);
  const rightW = w - leftW - 1; // 1 for middle border

  const lines: string[] = [];

  // Top border
  lines.push(`┌${'─'.repeat(leftW)}─ Test Results ──┬${'─'.repeat(rightW)}─ Coverage ──┐`);

  // Row 1: pass / fail  |  Tools
  const passStr = `  ✅ ${data.results.passed} pass  ❌ ${data.results.failed} fail`;
  const toolsStr = `  Tools: ${data.coverage.tools}%`;
  lines.push(`│${pad(passStr, leftW)}│${pad(toolsStr, rightW)}│`);

  // Row 2: flaky / skip  |  Prompts
  const flakyStr = `  ⚠️  ${data.results.flaky} flaky  ⏭️ ${data.results.skipped} skip`;
  const promptsStr = `  Prompts: ${data.coverage.prompts}%`;
  lines.push(`│${pad(flakyStr, leftW)}│${pad(promptsStr, rightW)}│`);

  // Mid border
  const secStr = `  Security: ${data.coverage.security}%`;
  lines.push(`├${'─'.repeat(leftW)}─ Cost Breakdown ┤${pad(secStr, rightW)}│`);

  // Row 3: total cost
  const totalStr = `  Total: $${data.cost.totalUsd.toFixed(2)}`;
  lines.push(`│${pad(totalStr, leftW)}│${' '.repeat(rightW)}│`);

  // Row 4: avg cost  |  Trend header
  const avgStr = `  Avg: $${data.cost.avgPerTest.toFixed(4)}/test`;
  const trendHeader = `─ Trend ─────────`;
  lines.push(`│${pad(avgStr, leftW)}├${trendHeader}${'─'.repeat(Math.max(0, rightW - trendHeader.length))}┤`);

  // Row 5: most expensive  |  sparkline
  const expName = data.cost.mostExpensive?.name ?? 'n/a';
  const expStr = `  Most expensive: ${expName.length > 12 ? expName.slice(0, 12) + '…' : expName}`;
  const spark = data.trend.length > 0 ? `  ${sparkline(data.trend)} pass` : '  (no history)';
  lines.push(`│${pad(expStr, leftW)}│${pad(spark, rightW)}│`);

  // Bottom border
  lines.push(`└${'─'.repeat(leftW)}${'─'.repeat(1)}${'─'.repeat(16)}┴${'─'.repeat(rightW)}${'─'.repeat(12)}┘`);

  // Duration
  const sec = (data.duration_ms / 1000).toFixed(1);
  lines.push(`  ⏱  ${sec}s  |  ${data.results.total} tests`);

  return lines.join('\n');
}

/**
 * Render a compact single-line summary for CI output.
 */
export function renderCompactDashboard(data: DashboardData): string {
  const { passed, failed, flaky, skipped } = data.results;
  const sec = (data.duration_ms / 1000).toFixed(1);
  return `✅ ${passed} ❌ ${failed} ⚠️ ${flaky} ⏭️ ${skipped} | $${data.cost.totalUsd.toFixed(2)} | ${sec}s`;
}
