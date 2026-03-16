/**
 * Performance Regression Detection — v4.9.0 Enhanced
 *
 * SQLite-backed metric tracking with configurable thresholds for
 * latency, cost, and token regressions.
 */

import * as fs from 'fs';
import chalk from 'chalk';
import type { SuiteResult } from './types';

// ===== Types =====

export interface PerfMetrics {
  latency_ms: number;
  cost_usd?: number;
  tokens?: number;
  tool_calls?: number;
  custom?: Record<string, number>;
}

export interface ThresholdConfig {
  latency_percent?: number;   // default 10
  cost_percent?: number;      // default 20
  token_percent?: number;     // default 15
  custom?: Record<string, number>;
}

export interface PerfRecord {
  suite: string;
  timestamp: string;
  metrics: PerfMetrics;
  tags?: string[];
}

export interface PerfComparison {
  suite: string;
  baseline: PerfRecord;
  current: PerfRecord;
  regressions: PerfAlert[];
  improvements: PerfAlert[];
  unchanged: string[];
}

export interface PerfAlert {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  deltaPercent: number;
  threshold: number;
  message: string;
}

export interface PerfChange {
  name: string;
  status: 'regression' | 'improvement' | 'unchanged' | 'new' | 'removed';
  baselineDuration?: number;
  currentDuration?: number;
  delta_ms?: number;
  deltaPercent?: number;
}

export interface PerfRegressionResult {
  changes: PerfChange[];
  regressions: number;
  improvements: number;
  unchanged: number;
  newTests: number;
  removedTests: number;
  thresholdMs: number;
  thresholdPercent: number;
}

export interface PerfCheckOptions {
  thresholdMs?: number;
  thresholdPercent?: number;
}

const DEFAULT_THRESHOLDS: Required<Pick<ThresholdConfig, 'latency_percent' | 'cost_percent' | 'token_percent'>> = {
  latency_percent: 10,
  cost_percent: 20,
  token_percent: 15,
};

// ===== PerfRegressionTracker (SQLite-backed) =====

export class PerfRegressionTracker {
  private dbPath: string;
  private records: Map<string, PerfRecord[]> = new Map();
  private thresholds: ThresholdConfig;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.thresholds = { ...DEFAULT_THRESHOLDS };
    this._load();
  }

  private _load(): void {
    if (fs.existsSync(this.dbPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
        for (const [suite, records] of Object.entries(data)) {
          this.records.set(suite, records as PerfRecord[]);
        }
      } catch { /* empty or corrupt — start fresh */ }
    }
  }

  private _save(): void {
    const obj: Record<string, PerfRecord[]> = {};
    for (const [k, v] of this.records) obj[k] = v;
    fs.writeFileSync(this.dbPath, JSON.stringify(obj, null, 2));
  }

  record(suite: string, metrics: PerfMetrics): void {
    const entry: PerfRecord = {
      suite,
      timestamp: new Date().toISOString(),
      metrics,
    };
    const list = this.records.get(suite) ?? [];
    list.push(entry);
    this.records.set(suite, list);
    this._save();
  }

  compare(suite: string, baseline?: string): PerfComparison {
    const list = this.records.get(suite) ?? [];
    if (list.length < 2) {
      throw new Error(`Need at least 2 records for suite "${suite}" to compare`);
    }
    const current = list[list.length - 1];
    let base: PerfRecord;
    if (baseline) {
      base = list.find(r => r.timestamp === baseline) ?? list[list.length - 2];
    } else {
      base = list[list.length - 2];
    }
    return this._compareRecords(suite, base, current);
  }

  private _compareRecords(suite: string, baseline: PerfRecord, current: PerfRecord): PerfComparison {
    const regressions: PerfAlert[] = [];
    const improvements: PerfAlert[] = [];
    const unchanged: string[] = [];

    const checks: Array<{ metric: string; base: number; curr: number; threshold: number }> = [
      { metric: 'latency_ms', base: baseline.metrics.latency_ms, curr: current.metrics.latency_ms, threshold: this.thresholds.latency_percent ?? DEFAULT_THRESHOLDS.latency_percent },
    ];
    if (baseline.metrics.cost_usd !== undefined && current.metrics.cost_usd !== undefined) {
      checks.push({ metric: 'cost_usd', base: baseline.metrics.cost_usd, curr: current.metrics.cost_usd, threshold: this.thresholds.cost_percent ?? DEFAULT_THRESHOLDS.cost_percent });
    }
    if (baseline.metrics.tokens !== undefined && current.metrics.tokens !== undefined) {
      checks.push({ metric: 'tokens', base: baseline.metrics.tokens, curr: current.metrics.tokens, threshold: this.thresholds.token_percent ?? DEFAULT_THRESHOLDS.token_percent });
    }

    for (const { metric, base, curr, threshold } of checks) {
      const delta = curr - base;
      const pct = base > 0 ? (delta / base) * 100 : 0;
      if (pct > threshold) {
        regressions.push({
          metric, baseline: base, current: curr, delta, deltaPercent: Math.round(pct), threshold,
          message: `⚠️ ${capitalize(metric)} regression: ${metric === 'latency_ms' ? `${base}ms → ${curr}ms` : `${base} → ${curr}`} (+${Math.round(pct)}%)`,
        });
      } else if (pct < -threshold) {
        improvements.push({
          metric, baseline: base, current: curr, delta, deltaPercent: Math.round(pct), threshold,
          message: `✅ ${capitalize(metric)} improvement: ${base} → ${curr} (${Math.round(pct)}%)`,
        });
      } else {
        unchanged.push(metric);
      }
    }

    return { suite, baseline, current, regressions, improvements, unchanged };
  }

  generateReport(): string {
    const lines: string[] = [chalk.bold('📊 Performance Report'), ''];
    for (const suite of this.records.keys()) {
      const list = this.records.get(suite)!;
      if (list.length < 2) {
        lines.push(`  ${suite}: only ${list.length} record(s), need ≥2 to compare`);
        continue;
      }
      const comp = this.compare(suite);
      lines.push(chalk.bold(`  Suite: ${suite}`));
      for (const r of comp.regressions) lines.push(chalk.red(`    ${r.message}`));
      for (const i of comp.improvements) lines.push(chalk.green(`    ${i.message}`));
      if (comp.unchanged.length) lines.push(chalk.gray(`    Unchanged: ${comp.unchanged.join(', ')}`));
      lines.push('');
    }
    return lines.join('\n');
  }

  setThresholds(config: ThresholdConfig): void {
    this.thresholds = { ...this.thresholds, ...config };
  }

  getRecords(suite: string): PerfRecord[] {
    return this.records.get(suite) ?? [];
  }

  listSuites(): string[] {
    return [...this.records.keys()];
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

// ===== Legacy functions (backward compatible) =====

export function loadPerfReport(filePath: string): SuiteResult {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return raw.suite || raw;
}

export function buildDurationMap(suite: SuiteResult): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of suite.results) {
    map.set(r.name, r.duration_ms);
  }
  return map;
}

export function detectPerfChanges(
  baseline: SuiteResult,
  current: SuiteResult,
  options: PerfCheckOptions = {},
): PerfRegressionResult {
  const thresholdMs = options.thresholdMs ?? 100;
  const thresholdPercent = options.thresholdPercent ?? 20;

  const baseMap = buildDurationMap(baseline);
  const currMap = buildDurationMap(current);
  const changes: PerfChange[] = [];
  let regressions = 0, improvements = 0, unchanged = 0, newTests = 0, removedTests = 0;

  for (const [name, currDur] of currMap) {
    const baseDur = baseMap.get(name);
    if (baseDur === undefined) {
      changes.push({ name, status: 'new', currentDuration: currDur });
      newTests++;
      continue;
    }
    const delta = currDur - baseDur;
    const pct = baseDur > 0 ? Math.round((delta / baseDur) * 100) : 0;

    if (delta > thresholdMs && pct > thresholdPercent) {
      changes.push({ name, status: 'regression', baselineDuration: baseDur, currentDuration: currDur, delta_ms: delta, deltaPercent: pct });
      regressions++;
    } else if (delta < -thresholdMs && pct < -thresholdPercent) {
      changes.push({ name, status: 'improvement', baselineDuration: baseDur, currentDuration: currDur, delta_ms: delta, deltaPercent: pct });
      improvements++;
    } else {
      changes.push({ name, status: 'unchanged', baselineDuration: baseDur, currentDuration: currDur, delta_ms: delta, deltaPercent: pct });
      unchanged++;
    }
  }

  for (const name of baseMap.keys()) {
    if (!currMap.has(name)) {
      changes.push({ name, status: 'removed', baselineDuration: baseMap.get(name) });
      removedTests++;
    }
  }

  return { changes, regressions, improvements, unchanged, newTests, removedTests, thresholdMs, thresholdPercent };
}

export function formatPerfChanges(result: PerfRegressionResult): string {
  const lines: string[] = [chalk.bold('Performance Changes:'), ''];
  const order = { regression: 0, improvement: 1, new: 2, removed: 3, unchanged: 4 };
  const sorted = [...result.changes].sort((a, b) => order[a.status] - order[b.status]);

  for (const c of sorted) {
    switch (c.status) {
      case 'regression':
        lines.push(chalk.red(`  ⚠ ${c.name}: +${c.delta_ms}ms (was ${c.baselineDuration}ms, now ${c.currentDuration}ms) — REGRESSION`));
        break;
      case 'improvement':
        lines.push(chalk.green(`  ✓ ${c.name}: ${c.delta_ms}ms (was ${c.baselineDuration}ms, now ${c.currentDuration}ms) — IMPROVEMENT`));
        break;
      case 'unchanged':
        lines.push(chalk.gray(`  ✓ ${c.name}: unchanged (${c.baselineDuration}ms ± ${Math.abs(c.delta_ms || 0)}ms)`));
        break;
      case 'new':
        lines.push(chalk.blue(`  + ${c.name}: new test (${c.currentDuration}ms)`));
        break;
      case 'removed':
        lines.push(chalk.yellow(`  - ${c.name}: removed (was ${c.baselineDuration}ms)`));
        break;
    }
  }

  lines.push('');
  lines.push(`Summary: ${chalk.red(`${result.regressions} regressions`)} | ${chalk.green(`${result.improvements} improvements`)} | ${result.unchanged} unchanged | ${result.newTests} new | ${result.removedTests} removed`);

  return lines.join('\n');
}
