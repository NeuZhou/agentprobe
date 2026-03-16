import type { TestResult } from './types';

export interface FlakyTestReport {
  name: string;
  status: 'stable' | 'flaky' | 'broken';
  passRate: number;
  passCount: number;
  totalRuns: number;
  pattern?: string;
  suggestion?: string;
  durations_ms: number[];
}

export interface FlakyDetectorConfig {
  runs: number;
  flakyThreshold?: number;  // below 100% but above 0%
}

/**
 * Analyze a single test result set to detect flakiness patterns.
 */
export function analyzeFlakiness(
  testName: string,
  results: TestResult[],
): FlakyTestReport {
  const passCount = results.filter(r => r.passed).length;
  const passRate = results.length > 0 ? passCount / results.length : 0;
  const durations = results.map(r => r.duration_ms);

  let status: FlakyTestReport['status'];
  if (passRate === 1) status = 'stable';
  else if (passRate === 0) status = 'broken';
  else status = 'flaky';

  const report: FlakyTestReport = {
    name: testName,
    status,
    passRate,
    passCount,
    totalRuns: results.length,
    durations_ms: durations,
  };

  if (status === 'flaky') {
    // Detect patterns
    const failedResults = results.filter(r => !r.passed);
    const timeoutFailures = failedResults.filter(r =>
      r.error?.toLowerCase().includes('timeout') ||
      r.error?.toLowerCase().includes('timed out'),
    );

    if (timeoutFailures.length > failedResults.length / 2) {
      report.pattern = 'intermittent timeout';
      const maxDuration = Math.max(...durations);
      report.suggestion = `increase timeout to ${Math.ceil(maxDuration * 1.5)}ms`;
    } else {
      const durationVariance = calculateVariance(durations);
      if (durationVariance > 1000000) {
        report.pattern = 'high duration variance — likely timing-dependent';
        report.suggestion = 'add tolerance for timing or use fuzzy match';
      } else {
        report.pattern = 'non-deterministic output';
        report.suggestion = 'use fuzzy match or increase output_length tolerance';
      }
    }
  }

  return report;
}

/**
 * Detect flaky tests by running analysis on multiple result sets.
 */
export function detectFlakyTests(
  testResultSets: Map<string, TestResult[]>,
  _config?: FlakyDetectorConfig,
): FlakyTestReport[] {
  const reports: FlakyTestReport[] = [];

  for (const [name, results] of testResultSets) {
    const report = analyzeFlakiness(name, results);
    reports.push(report);
  }

  return reports.sort((a, b) => a.passRate - b.passRate);
}

/**
 * Format flaky test report for console output.
 */
export function formatFlakyReport(reports: FlakyTestReport[]): string {
  const lines: string[] = ['🔍 Flaky Test Report', ''];
  const flaky = reports.filter(r => r.status === 'flaky');
  const broken = reports.filter(r => r.status === 'broken');
  const stable = reports.filter(r => r.status === 'stable');

  if (broken.length > 0) {
    lines.push(`❌ Broken tests (0% pass rate): ${broken.length}`);
    for (const r of broken) {
      lines.push(`  ${r.name}: BROKEN (passes ${r.passCount}/${r.totalRuns})`);
    }
    lines.push('');
  }

  if (flaky.length > 0) {
    lines.push(`⚠️  Flaky tests: ${flaky.length}`);
    for (const r of flaky) {
      const pct = Math.round(r.passRate * 100);
      lines.push(`  ${r.name}: FLAKY (passes ${r.passCount}/${r.totalRuns} = ${pct}%)`);
      if (r.pattern) lines.push(`    Pattern: ${r.pattern}`);
      if (r.suggestion) lines.push(`    Suggestion: ${r.suggestion}`);
    }
    lines.push('');
  }

  lines.push(`✅ Stable tests: ${stable.length}/${reports.length}`);

  return lines.join('\n');
}

function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}
