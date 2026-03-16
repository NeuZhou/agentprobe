/**
 * Regression Detection — Smart regression detection with flaky test handling,
 * fix suggestions, and PR comment generation.
 * @module
 */

import * as fs from 'fs';
import type { SuiteResult } from './types';
import {
  saveBaseline,
  loadBaseline,
  detectRegressions,
  formatRegressions,
} from './regression';
import type { Baseline, BaselineEntry, Regression } from './regression';

export { saveBaseline, loadBaseline, detectRegressions, formatRegressions };
export type { Baseline, BaselineEntry, Regression };

// ── Snapshot-based regression detection ──

export interface SnapshotTestEntry {
  name: string;
  passed: boolean;
  duration_ms: number;
  cost_usd: number;
  total_tokens: number;
  pass_rate: number;
  attempts: number;
}

export interface ReportSnapshot {
  suite_name: string;
  timestamp: string;
  tests: SnapshotTestEntry[];
}

export interface RegressionThresholds {
  latency_percent: number;
  cost_percent: number;
  pass_rate_drop: number;
}

export const DEFAULT_THRESHOLDS: RegressionThresholds = {
  latency_percent: 50,
  cost_percent: 50,
  pass_rate_drop: 0.1,
};

export interface SnapshotChange {
  test: string;
  dimension: 'latency' | 'cost' | 'pass_rate';
  severity: 'critical' | 'warning' | 'info';
  direction: 'regression' | 'improvement';
  baseline_value: number;
  current_value: number;
  change_percent: number;
  message: string;
}

export interface ComparisonReport {
  baseline_label: string;
  current_label: string;
  regressions: SnapshotChange[];
  improvements: SnapshotChange[];
  unchanged: string[];
  summary: { total_tests: number; regressed: number; improved: number; unchanged: number };
}

export function createSnapshot(suite: SuiteResult): ReportSnapshot {
  return {
    suite_name: suite.name || '',
    timestamp: new Date().toISOString(),
    tests: suite.results.map(r => ({
      name: r.name,
      passed: r.passed,
      duration_ms: r.duration_ms ?? 0,
      cost_usd: (r as any).cost_usd ?? 0,
      total_tokens: (r as any).total_tokens ?? 0,
      pass_rate: r.passed ? 1 : 0,
      attempts: 1,
    })),
  };
}

export function saveSnapshot(snap: ReportSnapshot, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(snap, null, 2));
}

export function loadSnapshot(filePath: string): ReportSnapshot {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function compareSnapshots(
  baseline: ReportSnapshot,
  current: ReportSnapshot,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): ComparisonReport {
  const regressions: SnapshotChange[] = [];
  const improvements: SnapshotChange[] = [];
  const unchanged: string[] = [];

  for (const ct of current.tests) {
    const bt = baseline.tests.find(b => b.name === ct.name);
    if (!bt) continue; // new test, skip

    let changed = false;

    // latency check
    if (bt.duration_ms > 0) {
      const pct = ((ct.duration_ms - bt.duration_ms) / bt.duration_ms) * 100;
      if (pct > thresholds.latency_percent) {
        regressions.push({ test: ct.name, dimension: 'latency', severity: 'critical', direction: 'regression', baseline_value: bt.duration_ms, current_value: ct.duration_ms, change_percent: Math.round(pct), message: `latency +${Math.round(pct)}%` });
        changed = true;
      } else if (pct < -thresholds.latency_percent) {
        improvements.push({ test: ct.name, dimension: 'latency', severity: 'info', direction: 'improvement', baseline_value: bt.duration_ms, current_value: ct.duration_ms, change_percent: Math.round(pct), message: `latency ${Math.round(pct)}%` });
        changed = true;
      }
    }

    // cost check
    if (bt.cost_usd > 0) {
      const pct = ((ct.cost_usd - bt.cost_usd) / bt.cost_usd) * 100;
      if (pct > thresholds.cost_percent) {
        regressions.push({ test: ct.name, dimension: 'cost', severity: 'warning', direction: 'regression', baseline_value: bt.cost_usd, current_value: ct.cost_usd, change_percent: Math.round(pct), message: `cost +${Math.round(pct)}%` });
        changed = true;
      } else if (pct < -thresholds.cost_percent) {
        improvements.push({ test: ct.name, dimension: 'cost', severity: 'info', direction: 'improvement', baseline_value: bt.cost_usd, current_value: ct.cost_usd, change_percent: Math.round(pct), message: `cost ${Math.round(pct)}%` });
        changed = true;
      }
    }

    // pass rate check
    const prDrop = bt.pass_rate - ct.pass_rate;
    if (prDrop > thresholds.pass_rate_drop) {
      regressions.push({ test: ct.name, dimension: 'pass_rate', severity: 'critical', direction: 'regression', baseline_value: bt.pass_rate, current_value: ct.pass_rate, change_percent: Math.round(-prDrop * 100), message: `pass_rate dropped ${Math.round(prDrop * 100)}%` });
      changed = true;
    } else if (prDrop < -thresholds.pass_rate_drop) {
      improvements.push({ test: ct.name, dimension: 'pass_rate', severity: 'info', direction: 'improvement', baseline_value: bt.pass_rate, current_value: ct.pass_rate, change_percent: Math.round(-prDrop * 100), message: `pass_rate improved ${Math.round(-prDrop * 100)}%` });
      changed = true;
    }

    if (!changed) unchanged.push(ct.name);
  }

  return {
    baseline_label: baseline.suite_name,
    current_label: current.suite_name,
    regressions,
    improvements,
    unchanged,
    summary: { total_tests: current.tests.length, regressed: regressions.length, improved: improvements.length, unchanged: unchanged.length },
  };
}

export function formatRegressionReport(report: ComparisonReport): string {
  const lines: string[] = [];
  if (report.regressions.length > 0) {
    lines.push('⚠️ Regressions detected');
    for (const r of report.regressions) lines.push(`  - ${r.test}: ${r.message}`);
  }
  if (report.improvements.length > 0) {
    lines.push('🎉 Improvements');
    for (const i of report.improvements) lines.push(`  - ${i.test}: ${i.message}`);
  }
  if (report.unchanged.length > 0) {
    lines.push(`✅ ${report.unchanged.length} test(s) unchanged`);
  }
  if (lines.length === 0) lines.push('No changes detected.');
  return lines.join('\n');
}

export interface TestResults {
  suite: SuiteResult;
}

export interface DetectorRegressionReport {
  regressions: Regression[];
  newFailures: string[];
  flippedTests: string[];
  perfDegradations: Regression[];
  ignoredFlaky: string[];
  summary: string;
}

export interface Suggestion {
  test: string;
  regression: Regression;
  suggestion: string;
}

/**
 * Detect if a test is likely flaky based on history.
 */
export function isFlakyTest(name: string, flakyList: string[]): boolean {
  return flakyList.includes(name);
}

/**
 * Full regression detection with flaky filtering.
 */
export class RegressionDetector {
  private baseline: Baseline;
  private flakyTests: string[];

  constructor(baseline: Baseline, flakyTests: string[] = []) {
    this.baseline = baseline;
    this.flakyTests = flakyTests;
  }

  detect(current: SuiteResult): DetectorRegressionReport {
    const raw = detectRegressions(current, this.baseline);

    const ignoredFlaky: string[] = [];
    const filtered: Regression[] = [];

    for (const r of raw) {
      if (this.flakyTests.includes(r.test)) {
        ignoredFlaky.push(r.test);
      } else {
        filtered.push(r);
      }
    }

    const newFailures = filtered
      .filter(r => r.type === 'pass_fail')
      .map(r => r.test);

    const flippedTests: string[] = [];
    for (const t of current.results) {
      const base = this.baseline.tests.find(b => b.name === t.name);
      if (base && !base.passed && t.passed) {
        flippedTests.push(t.name);
      }
    }

    const perfDegradations = filtered.filter(r =>
      r.type === 'steps' || r.type === 'cost' || r.type === 'duration'
    );

    const summary = this.buildSummary(filtered, newFailures, flippedTests, perfDegradations, ignoredFlaky);

    return { regressions: filtered, newFailures, flippedTests, perfDegradations, ignoredFlaky, summary };
  }

  suggestFixes(regressions: Regression[]): Suggestion[] {
    return regressions.map(r => ({
      test: r.test,
      regression: r,
      suggestion: this.suggestForRegression(r),
    }));
  }

  generatePRComment(report: DetectorRegressionReport): string {
    const lines: string[] = [];
    lines.push('## 🔍 AgentProbe Regression Report');
    lines.push('');

    if (report.regressions.length === 0) {
      lines.push('✅ **No regressions detected.** All tests match or improve on baseline.');
      if (report.flippedTests.length > 0) {
        lines.push('');
        lines.push(`🎉 **Improvements:** ${report.flippedTests.join(', ')} now passing!`);
      }
      return lines.join('\n');
    }

    lines.push(`⚠️ **${report.regressions.length} regression(s) detected**`);
    lines.push('');

    if (report.newFailures.length > 0) {
      lines.push('### ❌ New Failures');
      for (const f of report.newFailures) lines.push(`- \`${f}\``);
      lines.push('');
    }

    if (report.perfDegradations.length > 0) {
      lines.push('### 📉 Performance Degradations');
      for (const p of report.perfDegradations) lines.push(`- \`${p.test}\`: ${p.message}`);
      lines.push('');
    }

    if (report.flippedTests.length > 0) {
      lines.push('### 🎉 Improvements');
      for (const f of report.flippedTests) lines.push(`- \`${f}\` now passing`);
      lines.push('');
    }

    if (report.ignoredFlaky.length > 0) {
      lines.push(`> ℹ️ Ignored ${report.ignoredFlaky.length} known flaky test(s): ${report.ignoredFlaky.join(', ')}`);
    }

    return lines.join('\n');
  }

  private suggestForRegression(r: Regression): string {
    switch (r.type) {
      case 'pass_fail':
        return `Test "${r.test}" started failing. Check recent prompt or model changes.`;
      case 'steps':
        return `Step count increased for "${r.test}". The agent may be looping or using extra tool calls.`;
      case 'cost':
        return `Cost increased for "${r.test}". Check if the model was upgraded or token usage increased.`;
      case 'duration':
        return `Duration increased for "${r.test}". May indicate slower model or network issues.`;
      default:
        return `Investigate "${r.test}" for unexpected changes.`;
    }
  }

  private buildSummary(
    regressions: Regression[],
    newFailures: string[],
    flippedTests: string[],
    perfDegradations: Regression[],
    ignoredFlaky: string[],
  ): string {
    const parts: string[] = [];
    parts.push(`${regressions.length} regression(s)`);
    if (newFailures.length) parts.push(`${newFailures.length} new failure(s)`);
    if (flippedTests.length) parts.push(`${flippedTests.length} improvement(s)`);
    if (perfDegradations.length) parts.push(`${perfDegradations.length} perf degradation(s)`);
    if (ignoredFlaky.length) parts.push(`${ignoredFlaky.length} flaky ignored`);
    return parts.join(', ');
  }
}

// Type aliases for lib.ts compatibility
export type TestSnapshot = SnapshotTestEntry;
export type RegressionChange = SnapshotChange;
export type { ComparisonReport as RegressionReport };
