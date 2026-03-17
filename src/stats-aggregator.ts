/**
 * Stats Aggregator — Aggregate statistics across test suite runs.
 *
 * Provides pass rates, duration analytics, and identifies slowest/failing tests.
 */

import type { SuiteResult, TestResult } from './types';

export interface AggregateStats {
  suiteCount: number;
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  passRate: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  slowestTests: Array<{ name: string; duration_ms: number }>;
  failedTests: string[];
}

/**
 * Aggregate statistics from multiple suite results.
 */
export function aggregateResults(suites: SuiteResult[]): AggregateStats {
  if (suites.length === 0) {
    return {
      suiteCount: 0,
      totalTests: 0,
      totalPassed: 0,
      totalFailed: 0,
      passRate: 1,
      totalDuration: 0,
      avgDuration: 0,
      minDuration: 0,
      maxDuration: 0,
      slowestTests: [],
      failedTests: [],
    };
  }

  const allResults: TestResult[] = suites.flatMap((s) => s.results);
  const totalTests = allResults.length;
  const totalPassed = allResults.filter((r) => r.passed).length;
  const totalFailed = totalTests - totalPassed;
  const passRate = totalTests === 0 ? 1 : totalPassed / totalTests;
  const totalDuration = suites.reduce((sum, s) => sum + s.duration_ms, 0);

  const durations = allResults.map((r) => r.duration_ms);
  const avgDuration = totalTests > 0 ? durations.reduce((a, b) => a + b, 0) / totalTests : 0;
  const minDuration = totalTests > 0 ? Math.min(...durations) : 0;
  const maxDuration = totalTests > 0 ? Math.max(...durations) : 0;

  const slowestTests = [...allResults]
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 5)
    .map((r) => ({ name: r.name, duration_ms: r.duration_ms }));

  const failedTests = allResults.filter((r) => !r.passed).map((r) => r.name);

  return {
    suiteCount: suites.length,
    totalTests,
    totalPassed,
    totalFailed,
    passRate,
    totalDuration,
    avgDuration,
    minDuration,
    maxDuration,
    slowestTests,
    failedTests,
  };
}
