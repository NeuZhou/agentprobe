/**
 * Regression Detector — Compare current test results against a baseline file.
 *
 * Baseline format: { testId: { status, latency, toolCalls } }
 *
 * Detects:
 *   - New failures (was passing, now failing)
 *   - Fixed tests (was failing, now passing)
 *   - Performance regressions (latency increase > threshold)
 *   - Tool call changes (different tools called)
 *
 * @module regression/detector
 */

import * as fs from 'fs';
import type { SuiteResult, TestResult } from '../types';

// ── Baseline types ──

export interface BaselineTestEntry {
  status: 'passed' | 'failed' | 'skipped';
  latency: number;
  toolCalls: string[];
}

export interface BaselineFile {
  [testId: string]: BaselineTestEntry;
}

// ── Diff types ──

export type RegressionType =
  | 'new_failure'
  | 'fixed'
  | 'latency_regression'
  | 'latency_improvement'
  | 'tool_calls_changed'
  | 'new_test';

export interface RegressionItem {
  testId: string;
  type: RegressionType;
  message: string;
  baseline?: any;
  current?: any;
}

export interface RegressionReport {
  regressions: RegressionItem[];
  newFailures: number;
  fixes: number;
  perfRegressions: number;
  newTests: number;
  hasRegressions: boolean;
}

// ── Config ──

export interface DetectorOptions {
  /** Percentage threshold for latency regression (default: 50 = 50%) */
  latencyThresholdPercent?: number;
  /** Absolute threshold in ms for latency regression (default: 200) */
  latencyThresholdMs?: number;
}

const DEFAULT_OPTIONS: Required<DetectorOptions> = {
  latencyThresholdPercent: 50,
  latencyThresholdMs: 200,
};

// ── Core functions ──

/**
 * Extract tool calls from a test result's trace.
 */
function extractToolCalls(test: TestResult): string[] {
  if (!test.trace?.steps) return [];
  return test.trace.steps
    .filter((s) => s.type === 'tool_call' && s.data.tool_name)
    .map((s) => s.data.tool_name!);
}

/**
 * Build a baseline from suite results.
 */
export function buildBaseline(result: SuiteResult): BaselineFile {
  const baseline: BaselineFile = {};
  for (const test of result.results) {
    const testId = test.name;
    baseline[testId] = {
      status: test.skipped ? 'skipped' : test.passed ? 'passed' : 'failed',
      latency: test.duration_ms,
      toolCalls: extractToolCalls(test),
    };
  }
  return baseline;
}

/**
 * Save a baseline to a JSON file.
 */
export function saveBaselineFile(result: SuiteResult, filePath: string): void {
  const baseline = buildBaseline(result);
  const dir = require('path').dirname(filePath);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2));
}

/**
 * Load a baseline from a JSON file.
 */
export function loadBaselineFile(filePath: string): BaselineFile | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Compare current results against a baseline and detect regressions.
 */
export function detectRegressionsDiff(
  result: SuiteResult,
  baseline: BaselineFile,
  options?: DetectorOptions,
): RegressionReport {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const items: RegressionItem[] = [];

  for (const test of result.results) {
    const testId = test.name;
    const base = baseline[testId];

    if (!base) {
      items.push({
        testId,
        type: 'new_test',
        message: `New test: ${test.passed ? 'passed' : 'failed'}`,
        current: test.passed ? 'passed' : 'failed',
      });
      continue;
    }

    const currentStatus = test.skipped ? 'skipped' : test.passed ? 'passed' : 'failed';

    // Pass → Fail
    if (base.status === 'passed' && currentStatus === 'failed') {
      items.push({
        testId,
        type: 'new_failure',
        message: 'Was passing, now failing',
        baseline: 'passed',
        current: 'failed',
      });
    }

    // Fail → Pass
    if (base.status === 'failed' && currentStatus === 'passed') {
      items.push({
        testId,
        type: 'fixed',
        message: 'Was failing, now passing',
        baseline: 'failed',
        current: 'passed',
      });
    }

    // Latency regression
    if (base.latency > 0 && test.duration_ms > 0) {
      const increase = test.duration_ms - base.latency;
      const pctIncrease = (increase / base.latency) * 100;

      if (
        increase > opts.latencyThresholdMs &&
        pctIncrease > opts.latencyThresholdPercent
      ) {
        items.push({
          testId,
          type: 'latency_regression',
          message: `Latency increased from ${base.latency}ms to ${test.duration_ms}ms (+${pctIncrease.toFixed(0)}%)`,
          baseline: base.latency,
          current: test.duration_ms,
        });
      }
    }

    // Tool call changes
    const currentTools = extractToolCalls(test);
    const baseTools = base.toolCalls ?? [];
    const addedTools = currentTools.filter((t) => !baseTools.includes(t));
    const removedTools = baseTools.filter((t) => !currentTools.includes(t));
    if (addedTools.length > 0 || removedTools.length > 0) {
      const parts: string[] = [];
      if (addedTools.length) parts.push(`added: ${addedTools.join(', ')}`);
      if (removedTools.length) parts.push(`removed: ${removedTools.join(', ')}`);
      items.push({
        testId,
        type: 'tool_calls_changed',
        message: `Tool calls changed (${parts.join('; ')})`,
        baseline: baseTools,
        current: currentTools,
      });
    }
  }

  const newFailures = items.filter((i) => i.type === 'new_failure').length;
  const fixes = items.filter((i) => i.type === 'fixed').length;
  const perfRegressions = items.filter((i) => i.type === 'latency_regression').length;
  const newTests = items.filter((i) => i.type === 'new_test').length;

  return {
    regressions: items,
    newFailures,
    fixes,
    perfRegressions,
    newTests,
    hasRegressions: newFailures > 0 || perfRegressions > 0,
  };
}

/**
 * Format regression report for console output.
 */
export function formatRegressionReport(report: RegressionReport): string {
  if (report.regressions.length === 0) {
    return '  ✅ No regressions detected against baseline';
  }

  const lines: string[] = ['', '  📊 Regression Report:'];

  if (report.newFailures > 0) {
    lines.push(`     ❌ ${report.newFailures} new failure(s)`);
  }
  if (report.fixes > 0) {
    lines.push(`     ✅ ${report.fixes} fix(es)`);
  }
  if (report.perfRegressions > 0) {
    lines.push(`     🐢 ${report.perfRegressions} performance regression(s)`);
  }
  if (report.newTests > 0) {
    lines.push(`     🆕 ${report.newTests} new test(s)`);
  }

  lines.push('');

  for (const item of report.regressions) {
    const icon =
      item.type === 'new_failure'
        ? '❌'
        : item.type === 'fixed'
          ? '✅'
          : item.type === 'latency_regression'
            ? '🐢'
            : item.type === 'new_test'
              ? '🆕'
              : 'ℹ️';
    lines.push(`     ${icon} ${item.testId}: ${item.message}`);
  }

  if (report.hasRegressions) {
    lines.push('');
    lines.push('  ⚠️  Regressions detected — CI should fail');
  }

  return lines.join('\n');
}
