/**
 * Diff Reporter — Compare two test run JSON reports side-by-side.
 *
 * Shows: new passes, new failures, regressions, improvements.
 */

import type { SuiteResult, TestResult } from '../types';

export interface RunDiff {
  newPasses: string[];
  newFailures: string[];
  regressions: string[];
  improvements: string[];
  unchanged: string[];
  summary: {
    oldTotal: number;
    newTotal: number;
    oldPassed: number;
    newPassed: number;
    oldFailed: number;
    newFailed: number;
  };
}

/**
 * Compare two suite results to find regressions and improvements.
 */
export function diffRuns(oldRun: SuiteResult, newRun: SuiteResult): RunDiff {
  const oldMap = new Map<string, TestResult>();
  for (const r of oldRun.results) {
    oldMap.set(r.name, r);
  }

  const newMap = new Map<string, TestResult>();
  for (const r of newRun.results) {
    newMap.set(r.name, r);
  }

  const newPasses: string[] = [];
  const newFailures: string[] = [];
  const regressions: string[] = [];
  const improvements: string[] = [];
  const unchanged: string[] = [];

  // Check new run results
  for (const [name, newResult] of newMap) {
    const oldResult = oldMap.get(name);
    if (!oldResult) {
      // New test
      if (newResult.passed) {
        newPasses.push(name);
      } else {
        newFailures.push(name);
      }
    } else {
      if (oldResult.passed && !newResult.passed) {
        regressions.push(name);
      } else if (!oldResult.passed && newResult.passed) {
        improvements.push(name);
      } else {
        unchanged.push(name);
      }
    }
  }

  return {
    newPasses,
    newFailures,
    regressions,
    improvements,
    unchanged,
    summary: {
      oldTotal: oldRun.total,
      newTotal: newRun.total,
      oldPassed: oldRun.passed,
      newPassed: newRun.passed,
      oldFailed: oldRun.failed,
      newFailed: newRun.failed,
    },
  };
}

/**
 * Format a run diff for terminal display.
 */
export function formatRunDiff(diff: RunDiff): string {
  const lines: string[] = [];

  lines.push('📊 Test Run Comparison');
  lines.push('');
  lines.push(
    `  Old: ${diff.summary.oldPassed}/${diff.summary.oldTotal} passed` +
    `  →  New: ${diff.summary.newPassed}/${diff.summary.newTotal} passed`,
  );
  lines.push('');

  if (diff.regressions.length > 0) {
    lines.push(`  🔴 Regressions (${diff.regressions.length}):`);
    for (const name of diff.regressions) {
      lines.push(`     ✗ ${name} (was passing, now failing)`);
    }
  }

  if (diff.improvements.length > 0) {
    lines.push(`  🟢 Improvements (${diff.improvements.length}):`);
    for (const name of diff.improvements) {
      lines.push(`     ✓ ${name} (was failing, now passing)`);
    }
  }

  if (diff.newPasses.length > 0) {
    lines.push(`  🆕 New passes (${diff.newPasses.length}):`);
    for (const name of diff.newPasses) {
      lines.push(`     + ${name}`);
    }
  }

  if (diff.newFailures.length > 0) {
    lines.push(`  ⚠️  New failures (${diff.newFailures.length}):`);
    for (const name of diff.newFailures) {
      lines.push(`     - ${name}`);
    }
  }

  if (diff.regressions.length === 0 && diff.newFailures.length === 0) {
    lines.push('  ✅ No regressions detected');
  }

  return lines.join('\n');
}
