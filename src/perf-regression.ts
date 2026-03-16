/**
 * Performance Regression Detection - compare baseline vs current report.
 *
 * Detects regressions, improvements, and unchanged tests based on duration.
 */

import * as fs from 'fs';
import chalk from 'chalk';
import type { SuiteResult } from './types';

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
  /** Absolute threshold in ms to consider a regression. Default: 100 */
  thresholdMs?: number;
  /** Percentage threshold to consider a regression. Default: 20 */
  thresholdPercent?: number;
}

/**
 * Load a suite result from a JSON report file.
 */
export function loadPerfReport(filePath: string): SuiteResult {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return raw.suite || raw;
}

/**
 * Build a map of test name → avg duration from suite results.
 */
export function buildDurationMap(suite: SuiteResult): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of suite.results) {
    map.set(r.name, r.duration_ms);
  }
  return map;
}

/**
 * Detect performance changes between baseline and current.
 */
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

  // Check current tests against baseline
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

  // Check for removed tests
  for (const name of baseMap.keys()) {
    if (!currMap.has(name)) {
      changes.push({ name, status: 'removed', baselineDuration: baseMap.get(name) });
      removedTests++;
    }
  }

  return { changes, regressions, improvements, unchanged, newTests, removedTests, thresholdMs, thresholdPercent };
}

/**
 * Format perf regression results for console output.
 */
export function formatPerfChanges(result: PerfRegressionResult): string {
  const lines: string[] = [chalk.bold('Performance Changes:'), ''];

  // Sort: regressions first, then improvements, then unchanged
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
