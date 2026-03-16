/**
 * Regression Detector — Compare two report directories and detect regressions.
 *
 * Compares baseline vs current run reports across latency, pass rate, cost,
 * and token usage dimensions. Identifies both regressions and improvements.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SuiteResult } from './types';

// ===== Types =====

export interface ReportSnapshot {
  suite_name: string;
  timestamp: string;
  tests: TestSnapshot[];
}

export interface TestSnapshot {
  name: string;
  passed: boolean;
  duration_ms: number;
  cost_usd: number;
  total_tokens: number;
  pass_rate: number; // 0-1, from multiple runs
  attempts: number;
}

export interface RegressionChange {
  test: string;
  dimension: 'latency' | 'pass_rate' | 'cost' | 'tokens';
  severity: 'critical' | 'warning' | 'info';
  direction: 'regression' | 'improvement';
  baseline_value: number;
  current_value: number;
  change_percent: number;
  message: string;
}

export interface RegressionReport {
  baseline_label: string;
  current_label: string;
  regressions: RegressionChange[];
  improvements: RegressionChange[];
  unchanged: string[];
  summary: {
    total_tests: number;
    regressed: number;
    improved: number;
    unchanged: number;
  };
}

// ===== Thresholds =====

export interface RegressionThresholds {
  latency_warning_pct: number;    // default 50
  latency_critical_pct: number;   // default 100
  pass_rate_warning_drop: number; // default 10 (percentage points)
  pass_rate_critical_drop: number;// default 20
  cost_warning_pct: number;       // default 50
  cost_critical_pct: number;      // default 100
  token_warning_pct: number;      // default 50
  token_critical_pct: number;     // default 100
}

export const DEFAULT_THRESHOLDS: RegressionThresholds = {
  latency_warning_pct: 50,
  latency_critical_pct: 100,
  pass_rate_warning_drop: 10,
  pass_rate_critical_drop: 20,
  cost_warning_pct: 50,
  cost_critical_pct: 100,
  token_warning_pct: 50,
  token_critical_pct: 100,
};

// ===== Snapshot Creation =====

export function createSnapshot(result: SuiteResult, _label?: string): ReportSnapshot {
  return {
    suite_name: result.name,
    timestamp: new Date().toISOString(),
    tests: result.results.map(r => ({
      name: r.name,
      passed: r.passed,
      duration_ms: r.duration_ms,
      cost_usd: 0, // filled from trace if available
      total_tokens: 0,
      pass_rate: r.passed ? 1 : 0,
      attempts: r.attempts ?? 1,
    })),
  };
}

export function loadSnapshot(filePath: string): ReportSnapshot {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function saveSnapshot(snapshot: ReportSnapshot, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
}

// ===== Comparison =====

export function compareSnapshots(
  baseline: ReportSnapshot,
  current: ReportSnapshot,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): RegressionReport {
  const regressions: RegressionChange[] = [];
  const improvements: RegressionChange[] = [];
  const unchanged: string[] = [];

  const baselineMap = new Map(baseline.tests.map(t => [t.name, t]));

  for (const curr of current.tests) {
    const base = baselineMap.get(curr.name);
    if (!base) continue; // new test, skip

    let hasChange = false;

    // Latency check
    if (base.duration_ms > 0) {
      const pctChange = ((curr.duration_ms - base.duration_ms) / base.duration_ms) * 100;
      if (pctChange > thresholds.latency_critical_pct) {
        regressions.push({
          test: curr.name, dimension: 'latency', severity: 'critical',
          direction: 'regression', baseline_value: base.duration_ms,
          current_value: curr.duration_ms, change_percent: pctChange,
          message: `latency +${pctChange.toFixed(0)}% (was ${base.duration_ms}ms, now ${curr.duration_ms}ms)`,
        });
        hasChange = true;
      } else if (pctChange > thresholds.latency_warning_pct) {
        regressions.push({
          test: curr.name, dimension: 'latency', severity: 'warning',
          direction: 'regression', baseline_value: base.duration_ms,
          current_value: curr.duration_ms, change_percent: pctChange,
          message: `latency +${pctChange.toFixed(0)}% (was ${base.duration_ms}ms, now ${curr.duration_ms}ms)`,
        });
        hasChange = true;
      } else if (pctChange < -thresholds.latency_warning_pct) {
        improvements.push({
          test: curr.name, dimension: 'latency', severity: 'info',
          direction: 'improvement', baseline_value: base.duration_ms,
          current_value: curr.duration_ms, change_percent: pctChange,
          message: `latency ${pctChange.toFixed(0)}% (was ${base.duration_ms}ms, now ${curr.duration_ms}ms)`,
        });
        hasChange = true;
      }
    }

    // Pass rate check
    const passRateDrop = (base.pass_rate - curr.pass_rate) * 100;
    if (passRateDrop >= thresholds.pass_rate_critical_drop) {
      regressions.push({
        test: curr.name, dimension: 'pass_rate', severity: 'critical',
        direction: 'regression', baseline_value: base.pass_rate * 100,
        current_value: curr.pass_rate * 100, change_percent: -passRateDrop,
        message: `pass rate ${(base.pass_rate * 100).toFixed(0)}% → ${(curr.pass_rate * 100).toFixed(0)}%`,
      });
      hasChange = true;
    } else if (passRateDrop >= thresholds.pass_rate_warning_drop) {
      regressions.push({
        test: curr.name, dimension: 'pass_rate', severity: 'warning',
        direction: 'regression', baseline_value: base.pass_rate * 100,
        current_value: curr.pass_rate * 100, change_percent: -passRateDrop,
        message: `pass rate ${(base.pass_rate * 100).toFixed(0)}% → ${(curr.pass_rate * 100).toFixed(0)}%`,
      });
      hasChange = true;
    } else if (passRateDrop < -thresholds.pass_rate_warning_drop) {
      improvements.push({
        test: curr.name, dimension: 'pass_rate', severity: 'info',
        direction: 'improvement', baseline_value: base.pass_rate * 100,
        current_value: curr.pass_rate * 100, change_percent: -passRateDrop,
        message: `pass rate ${(base.pass_rate * 100).toFixed(0)}% → ${(curr.pass_rate * 100).toFixed(0)}%`,
      });
      hasChange = true;
    }

    // Cost check
    if (base.cost_usd > 0) {
      const costPct = ((curr.cost_usd - base.cost_usd) / base.cost_usd) * 100;
      if (costPct > thresholds.cost_critical_pct) {
        regressions.push({
          test: curr.name, dimension: 'cost', severity: 'critical',
          direction: 'regression', baseline_value: base.cost_usd,
          current_value: curr.cost_usd, change_percent: costPct,
          message: `cost +${costPct.toFixed(0)}% ($${base.cost_usd.toFixed(4)} → $${curr.cost_usd.toFixed(4)})`,
        });
        hasChange = true;
      } else if (costPct < -thresholds.cost_warning_pct) {
        improvements.push({
          test: curr.name, dimension: 'cost', severity: 'info',
          direction: 'improvement', baseline_value: base.cost_usd,
          current_value: curr.cost_usd, change_percent: costPct,
          message: `cost ${costPct.toFixed(0)}% ($${base.cost_usd.toFixed(4)} → $${curr.cost_usd.toFixed(4)})`,
        });
        hasChange = true;
      }
    }

    if (!hasChange) unchanged.push(curr.name);
  }

  return {
    baseline_label: baseline.suite_name,
    current_label: current.suite_name,
    regressions,
    improvements,
    unchanged,
    summary: {
      total_tests: current.tests.length,
      regressed: new Set(regressions.map(r => r.test)).size,
      improved: new Set(improvements.map(r => r.test)).size,
      unchanged: unchanged.length,
    },
  };
}

// ===== Formatting =====

export function formatRegressionReport(report: RegressionReport): string {
  const lines: string[] = [
    '',
    `  📊 Regression Report: ${report.baseline_label} → ${report.current_label}`,
  ];

  if (report.regressions.length > 0) {
    lines.push('');
    lines.push('  ⚠️  Regressions detected:');
    for (const r of report.regressions) {
      const icon = r.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`     ${icon} ${r.test}: ${r.message}`);
    }
  }

  if (report.improvements.length > 0) {
    lines.push('');
    lines.push('  ✅ Improvements:');
    for (const imp of report.improvements) {
      lines.push(`     🟢 ${imp.test}: ${imp.message}`);
    }
  }

  lines.push('');
  lines.push(`  Summary: ${report.summary.regressed} regressed, ${report.summary.improved} improved, ${report.summary.unchanged} unchanged`);

  return lines.join('\n');
}
