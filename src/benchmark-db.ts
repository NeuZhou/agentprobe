/**
 * Agent Benchmark Database — Store and compare benchmarks over time.
 *
 * Provides persistent storage for benchmark results with trend analysis,
 * run comparison, and dashboard reporting.
 */

import * as fs from 'fs';
import * as path from 'path';

// ===== Types =====

export interface BenchmarkResult {
  /** Unique run ID (auto-generated if omitted) */
  runId?: string;
  /** Test or suite name */
  testName: string;
  /** Timestamp (ISO string, auto-set if omitted) */
  timestamp?: string;
  /** Pass/fail */
  passed: boolean;
  /** Duration in ms */
  duration_ms: number;
  /** Token usage */
  tokens?: { input?: number; output?: number; total?: number };
  /** Estimated cost in USD */
  cost_usd?: number;
  /** Number of steps */
  steps?: number;
  /** Tool calls made */
  tools_called?: string[];
  /** Model used */
  model?: string;
  /** Arbitrary tags */
  tags?: string[];
  /** Custom metrics */
  metrics?: Record<string, number>;
}

export interface StoredBenchmark extends BenchmarkResult {
  runId: string;
  timestamp: string;
}

export interface TrendPoint {
  timestamp: string;
  runId: string;
  duration_ms: number;
  passed: boolean;
  tokens_total?: number;
  cost_usd?: number;
}

export interface TrendData {
  testName: string;
  points: TrendPoint[];
  avg_duration_ms: number;
  min_duration_ms: number;
  max_duration_ms: number;
  pass_rate: number;
  total_runs: number;
  trend_direction: 'improving' | 'degrading' | 'stable';
}

export interface ComparisonResult {
  run1: string;
  run2: string;
  tests: ComparisonEntry[];
  summary: {
    improved: number;
    degraded: number;
    unchanged: number;
    new_tests: number;
    removed_tests: number;
  };
}

export interface ComparisonEntry {
  testName: string;
  run1?: StoredBenchmark;
  run2?: StoredBenchmark;
  duration_change_ms?: number;
  duration_change_pct?: number;
  status_changed: boolean;
  verdict: 'improved' | 'degraded' | 'unchanged' | 'new' | 'removed';
}

export interface DashboardData {
  total_runs: number;
  total_tests: number;
  overall_pass_rate: number;
  avg_duration_ms: number;
  top_slowest: Array<{ testName: string; avg_duration_ms: number }>;
  top_flaky: Array<{ testName: string; pass_rate: number; runs: number }>;
  recent_runs: Array<{ runId: string; timestamp: string; passed: number; failed: number }>;
  cost_total_usd: number;
}

// ===== Implementation =====

interface DBData {
  version: number;
  benchmarks: StoredBenchmark[];
}

/**
 * Persistent benchmark database backed by a JSON file.
 */
export class BenchmarkDB {
  private dbPath: string;
  private data: DBData;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.join(process.cwd(), '.agentprobe', 'benchmarks.json');
    this.data = this.load();
  }

  private load(): DBData {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        return JSON.parse(raw) as DBData;
      }
    } catch {
      // corrupted — start fresh
    }
    return { version: 1, benchmarks: [] };
  }

  private save(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  /** Record a benchmark result. */
  record(benchmark: BenchmarkResult): StoredBenchmark {
    const stored: StoredBenchmark = {
      ...benchmark,
      runId: benchmark.runId ?? generateRunId(),
      timestamp: benchmark.timestamp ?? new Date().toISOString(),
    };
    this.data.benchmarks.push(stored);
    this.save();
    return stored;
  }

  /** Record multiple results at once. */
  recordBatch(benchmarks: BenchmarkResult[]): StoredBenchmark[] {
    const runId = generateRunId();
    const ts = new Date().toISOString();
    const stored = benchmarks.map(b => ({
      ...b,
      runId: b.runId ?? runId,
      timestamp: b.timestamp ?? ts,
    }));
    this.data.benchmarks.push(...stored);
    this.save();
    return stored;
  }

  /** Get trend data for a specific test over the last N days. */
  trend(testName: string, days: number = 30): TrendData {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const entries = this.data.benchmarks.filter(
      b => b.testName === testName && b.timestamp >= cutoff,
    );

    const points: TrendPoint[] = entries.map(e => ({
      timestamp: e.timestamp,
      runId: e.runId,
      duration_ms: e.duration_ms,
      passed: e.passed,
      tokens_total: e.tokens?.total,
      cost_usd: e.cost_usd,
    }));

    const durations = entries.map(e => e.duration_ms);
    const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const passCount = entries.filter(e => e.passed).length;

    // Trend direction: compare first half vs second half average duration
    let trend_direction: 'improving' | 'degrading' | 'stable' = 'stable';
    if (durations.length >= 4) {
      const mid = Math.floor(durations.length / 2);
      const firstHalf = durations.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const secondHalf = durations.slice(mid).reduce((a, b) => a + b, 0) / (durations.length - mid);
      const changePct = (secondHalf - firstHalf) / (firstHalf || 1);
      if (changePct < -0.1) trend_direction = 'improving';
      else if (changePct > 0.1) trend_direction = 'degrading';
    }

    return {
      testName,
      points,
      avg_duration_ms: Math.round(avg),
      min_duration_ms: durations.length > 0 ? Math.min(...durations) : 0,
      max_duration_ms: durations.length > 0 ? Math.max(...durations) : 0,
      pass_rate: entries.length > 0 ? passCount / entries.length : 0,
      total_runs: entries.length,
      trend_direction,
    };
  }

  /** Compare two runs by runId. */
  compare(run1: string, run2: string): ComparisonResult {
    const r1 = this.data.benchmarks.filter(b => b.runId === run1);
    const r2 = this.data.benchmarks.filter(b => b.runId === run2);

    const r1Map = new Map(r1.map(b => [b.testName, b]));
    const r2Map = new Map(r2.map(b => [b.testName, b]));

    const allTests = new Set([...r1Map.keys(), ...r2Map.keys()]);
    const tests: ComparisonEntry[] = [];
    let improved = 0, degraded = 0, unchanged = 0, new_tests = 0, removed_tests = 0;

    for (const testName of allTests) {
      const b1 = r1Map.get(testName);
      const b2 = r2Map.get(testName);

      let verdict: ComparisonEntry['verdict'] = 'unchanged';
      let duration_change_ms: number | undefined;
      let duration_change_pct: number | undefined;
      let status_changed = false;

      if (!b1) {
        verdict = 'new';
        new_tests++;
      } else if (!b2) {
        verdict = 'removed';
        removed_tests++;
      } else {
        status_changed = b1.passed !== b2.passed;
        duration_change_ms = b2.duration_ms - b1.duration_ms;
        duration_change_pct = b1.duration_ms > 0
          ? (duration_change_ms / b1.duration_ms) * 100
          : 0;

        if ((!b1.passed && b2.passed) || (duration_change_pct < -10)) {
          verdict = 'improved';
          improved++;
        } else if ((b1.passed && !b2.passed) || (duration_change_pct > 10)) {
          verdict = 'degraded';
          degraded++;
        } else {
          unchanged++;
        }
      }

      tests.push({ testName, run1: b1, run2: b2, duration_change_ms, duration_change_pct, status_changed, verdict });
    }

    return { run1, run2, tests, summary: { improved, degraded, unchanged, new_tests, removed_tests } };
  }

  /** Generate dashboard data. */
  report(): DashboardData {
    const all = this.data.benchmarks;
    const testNames = [...new Set(all.map(b => b.testName))];

    // Overall
    const passCount = all.filter(b => b.passed).length;
    const avgDur = all.length > 0 ? all.reduce((s, b) => s + b.duration_ms, 0) / all.length : 0;
    const costTotal = all.reduce((s, b) => s + (b.cost_usd ?? 0), 0);

    // Slowest tests by average duration
    const byTest = new Map<string, number[]>();
    for (const b of all) {
      if (!byTest.has(b.testName)) byTest.set(b.testName, []);
      byTest.get(b.testName)!.push(b.duration_ms);
    }
    const top_slowest = [...byTest.entries()]
      .map(([testName, ds]) => ({ testName, avg_duration_ms: Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) }))
      .sort((a, b) => b.avg_duration_ms - a.avg_duration_ms)
      .slice(0, 10);

    // Flaky tests
    const top_flaky: DashboardData['top_flaky'] = [];
    for (const name of testNames) {
      const entries = all.filter(b => b.testName === name);
      if (entries.length >= 3) {
        const passRate = entries.filter(e => e.passed).length / entries.length;
        if (passRate > 0 && passRate < 1) {
          top_flaky.push({ testName: name, pass_rate: passRate, runs: entries.length });
        }
      }
    }
    top_flaky.sort((a, b) => a.pass_rate - b.pass_rate);

    // Recent runs
    const runMap = new Map<string, { timestamp: string; passed: number; failed: number }>();
    for (const b of all) {
      if (!runMap.has(b.runId)) runMap.set(b.runId, { timestamp: b.timestamp, passed: 0, failed: 0 });
      const entry = runMap.get(b.runId)!;
      if (b.passed) entry.passed++; else entry.failed++;
    }
    const recent_runs = [...runMap.entries()]
      .map(([runId, data]) => ({ runId, ...data }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 20);

    return {
      total_runs: runMap.size,
      total_tests: testNames.length,
      overall_pass_rate: all.length > 0 ? passCount / all.length : 0,
      avg_duration_ms: Math.round(avgDur),
      top_slowest,
      top_flaky: top_flaky.slice(0, 10),
      recent_runs,
      cost_total_usd: Math.round(costTotal * 10000) / 10000,
    };
  }

  /** Get all stored benchmarks. */
  getAll(): StoredBenchmark[] {
    return [...this.data.benchmarks];
  }

  /** Get benchmarks for a specific run. */
  getRun(runId: string): StoredBenchmark[] {
    return this.data.benchmarks.filter(b => b.runId === runId);
  }

  /** List all unique run IDs. */
  listRuns(): string[] {
    return [...new Set(this.data.benchmarks.map(b => b.runId))];
  }

  /** Clear all data. */
  clear(): void {
    this.data = { version: 1, benchmarks: [] };
    this.save();
  }
}

/** Format a benchmark comparison for display. */
export function formatComparison(result: ComparisonResult): string {
  const lines: string[] = [];
  lines.push(`\nBenchmark Comparison: ${result.run1} vs ${result.run2}`);
  lines.push('='.repeat(50));

  for (const entry of result.tests) {
    const icon = { improved: '🟢', degraded: '🔴', unchanged: '⚪', new: '🆕', removed: '🗑️' }[entry.verdict];
    let detail = '';
    if (entry.duration_change_ms !== undefined) {
      const sign = entry.duration_change_ms >= 0 ? '+' : '';
      detail = ` (${sign}${entry.duration_change_ms}ms / ${sign}${entry.duration_change_pct?.toFixed(1)}%)`;
    }
    lines.push(`${icon} ${entry.testName}${detail}`);
  }

  const s = result.summary;
  lines.push(`\n${s.improved} improved, ${s.degraded} degraded, ${s.unchanged} unchanged, ${s.new_tests} new, ${s.removed_tests} removed`);
  return lines.join('\n');
}

/** Format dashboard data for console display. */
export function formatDashboard(data: DashboardData): string {
  const lines: string[] = [];
  lines.push('\n📊 AgentProbe Benchmark Dashboard');
  lines.push('='.repeat(40));
  lines.push(`Runs: ${data.total_runs} | Tests: ${data.total_tests} | Pass Rate: ${(data.overall_pass_rate * 100).toFixed(1)}%`);
  lines.push(`Avg Duration: ${data.avg_duration_ms}ms | Total Cost: $${data.cost_total_usd}`);

  if (data.top_slowest.length > 0) {
    lines.push('\n🐌 Slowest Tests:');
    for (const t of data.top_slowest.slice(0, 5)) {
      lines.push(`   ${t.testName}: ${t.avg_duration_ms}ms avg`);
    }
  }

  if (data.top_flaky.length > 0) {
    lines.push('\n🎰 Flaky Tests:');
    for (const t of data.top_flaky.slice(0, 5)) {
      lines.push(`   ${t.testName}: ${(t.pass_rate * 100).toFixed(0)}% pass rate (${t.runs} runs)`);
    }
  }

  return lines.join('\n');
}

function generateRunId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').substring(0, 14);
  const rand = Math.random().toString(36).substring(2, 8);
  return `run-${ts}-${rand}`;
}
