import type { SuiteResult } from './types';

export interface FlakyResult {
  testName: string;
  runs: number;
  passed: number;
  failed: number;
  passRate: number;
  status: 'stable' | 'flaky' | 'broken';
  errors: string[];
  durations: number[];
}

export interface FlakySuiteResult {
  totalRuns: number;
  results: FlakyResult[];
  stable: number;
  flaky: number;
  broken: number;
}

/**
 * Analyze a set of suite results from multiple runs to detect flaky tests.
 */
export function detectFlaky(runs: SuiteResult[]): FlakySuiteResult {
  if (runs.length === 0) {
    return { totalRuns: 0, results: [], stable: 0, flaky: 0, broken: 0 };
  }

  // Collect all test names across runs
  const testNames = new Set<string>();
  for (const run of runs) {
    for (const r of run.results) {
      testNames.add(r.name);
    }
  }

  const results: FlakyResult[] = [];

  for (const name of testNames) {
    let passed = 0;
    let failed = 0;
    const errors: string[] = [];
    const durations: number[] = [];

    for (const run of runs) {
      const test = run.results.find((r) => r.name === name);
      if (!test) {
        failed++;
        continue;
      }
      if (test.passed) {
        passed++;
      } else {
        failed++;
        if (test.error) errors.push(test.error);
      }
      durations.push(test.duration_ms);
    }

    const total = passed + failed;
    const passRate = total > 0 ? passed / total : 0;
    let status: FlakyResult['status'];
    if (passRate === 1) status = 'stable';
    else if (passRate === 0) status = 'broken';
    else status = 'flaky';

    results.push({
      testName: name,
      runs: total,
      passed,
      failed,
      passRate,
      status,
      errors: [...new Set(errors)],
      durations,
    });
  }

  return {
    totalRuns: runs.length,
    results,
    stable: results.filter((r) => r.status === 'stable').length,
    flaky: results.filter((r) => r.status === 'flaky').length,
    broken: results.filter((r) => r.status === 'broken').length,
  };
}

/**
 * Format flaky detection results for display.
 */
export function formatFlaky(result: FlakySuiteResult): string {
  const lines: string[] = [];
  lines.push(`\n🔄 Flaky Test Detection (${result.totalRuns} runs)\n`);

  for (const r of result.results) {
    const icon = r.status === 'stable' ? '✓' : r.status === 'flaky' ? '⚠' : '✗';
    const pct = Math.round(r.passRate * 100);
    const label =
      r.status === 'stable'
        ? 'stable'
        : r.status === 'flaky'
          ? `FLAKY - ${pct}%`
          : 'broken';
    lines.push(`  ${icon} ${r.testName}: ${r.passed}/${r.runs} passed (${label})`);
  }

  lines.push('');
  lines.push(`  Summary: ${result.stable} stable, ${result.flaky} flaky, ${result.broken} broken`);
  lines.push('');
  return lines.join('\n');
}
