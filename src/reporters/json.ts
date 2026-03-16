/**
 * JSON Reporter — Structured JSON test report with metadata.
 * @since 4.5.0
 */

import type { SuiteResult } from '../types';
import { calculateCost } from '../cost';

export interface JSONReport {
  version: string;
  timestamp: string;
  suite: {
    name: string;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
    duration_ms: number;
    totalCost: number;
  };
  tests: JSONTestEntry[];
  summary: {
    slowest: { name: string; duration_ms: number } | null;
    mostTokens: { name: string; tokens: number } | null;
    totalTokens: number;
    totalAssertions: number;
    failedAssertions: number;
  };
}

export interface JSONTestEntry {
  name: string;
  passed: boolean;
  skipped: boolean;
  duration_ms: number;
  tags: string[];
  assertions: {
    name: string;
    passed: boolean;
    expected?: any;
    actual?: any;
    message?: string;
  }[];
  error?: string;
  tokens?: { input: number; output: number };
  cost?: number;
  steps?: number;
}

/**
 * Generate a structured JSON report from suite results.
 */
export function reportJSON(result: SuiteResult): string {
  const skipped = result.results.filter(r => r.skipped).length;
  const passRate = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;

  let totalTokens = 0;
  let totalAssertions = 0;
  let failedAssertions = 0;
  let slowest: { name: string; duration_ms: number } | null = null;
  let mostTokens: { name: string; tokens: number } | null = null;

  const tests: JSONTestEntry[] = result.results.map(test => {
    totalAssertions += test.assertions.length;
    failedAssertions += test.assertions.filter(a => !a.passed).length;

    if (!slowest || test.duration_ms > slowest.duration_ms) {
      slowest = { name: test.name, duration_ms: test.duration_ms };
    }

    let tokens: { input: number; output: number } | undefined;
    let cost: number | undefined;
    let steps: number | undefined;

    if (test.trace) {
      const inp = test.trace.steps.reduce((s, st) => s + (st.data.tokens?.input ?? 0), 0);
      const out = test.trace.steps.reduce((s, st) => s + (st.data.tokens?.output ?? 0), 0);
      tokens = { input: inp, output: out };
      totalTokens += inp + out;

      if (!mostTokens || (inp + out) > mostTokens.tokens) {
        mostTokens = { name: test.name, tokens: inp + out };
      }

      const costInfo = calculateCost(test.trace);
      cost = costInfo.total_cost;
      steps = test.trace.steps.length;
    }

    return {
      name: test.name,
      passed: test.passed,
      skipped: test.skipped ?? false,
      duration_ms: test.duration_ms,
      tags: test.tags ?? [],
      assertions: test.assertions.map(a => ({
        name: a.name,
        passed: a.passed,
        ...(a.expected !== undefined ? { expected: a.expected } : {}),
        ...(a.actual !== undefined ? { actual: a.actual } : {}),
        ...(a.message ? { message: a.message } : {}),
      })),
      ...(test.error ? { error: test.error } : {}),
      ...(tokens ? { tokens } : {}),
      ...(cost !== undefined ? { cost } : {}),
      ...(steps !== undefined ? { steps } : {}),
    };
  });

  const totalCost = tests.reduce((s, t) => s + (t.cost ?? 0), 0);

  const report: JSONReport = {
    version: '4.5.0',
    timestamp: new Date().toISOString(),
    suite: {
      name: result.name,
      total: result.total,
      passed: result.passed,
      failed: result.failed,
      skipped,
      passRate,
      duration_ms: result.duration_ms,
      totalCost,
    },
    tests,
    summary: {
      slowest,
      mostTokens,
      totalTokens,
      totalAssertions,
      failedAssertions,
    },
  };

  return JSON.stringify(report, null, 2);
}
