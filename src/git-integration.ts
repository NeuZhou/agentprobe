/**
 * Git Integration — tie tests to git commits, generate reports, and bisect regressions.
 *
 * @module git-integration
 */

import type { SuiteResult } from './types';

// ===== Types =====

export interface CommitTestResult {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  suiteResult?: SuiteResult;
  passed: number;
  failed: number;
  total: number;
  regressions: string[];
  fixes: string[];
}

export interface GitReport {
  commits: CommitTestResult[];
  trend: GitTrend;
  summary: string;
}

export interface GitTrend {
  totalTestsDelta: number;
  passRateDelta: number;
  regressionsIntroduced: number;
  regressionsFixed: number;
}

export interface BisectOptions {
  test: string;
  goodCommit: string;
  badCommit: string;
  maxSteps?: number;
}

export interface BisectResult {
  found: boolean;
  commit?: CommitTestResult;
  stepsSearched: number;
  searchPath: string[];
  expression: string;
}

export interface GitDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface GitDiff {
  fromRef: string;
  toRef: string;
  files: GitDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

// ===== Parsing helpers =====

/**
 * Parse a git log line into structured commit info.
 * Expected format: "hash|shortHash|author|date|message"
 */
export function parseCommitLine(line: string): Omit<CommitTestResult, 'passed' | 'failed' | 'total' | 'regressions' | 'fixes' | 'suiteResult'> | null {
  const parts = line.split('|');
  if (parts.length < 5) return null;
  return {
    hash: parts[0].trim(),
    shortHash: parts[1].trim(),
    author: parts[2].trim(),
    date: parts[3].trim(),
    message: parts.slice(4).join('|').trim(),
  };
}

/**
 * Parse git diff --stat output into structured file changes.
 */
export function parseDiffStat(diffOutput: string): GitDiffFile[] {
  const files: GitDiffFile[] = [];
  const lines = diffOutput.trim().split('\n');

  for (const line of lines) {
    // Match lines like: "src/foo.ts | 10 ++---"
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([+-]*)\s*$/);
    if (match) {
      const path = match[1].trim();
      const plusCount = (match[3].match(/\+/g) || []).length;
      const minusCount = (match[3].match(/-/g) || []).length;

      let status: GitDiffFile['status'] = 'modified';
      if (plusCount > 0 && minusCount === 0) status = 'added';
      if (minusCount > 0 && plusCount === 0) status = 'deleted';

      files.push({
        path,
        status,
        additions: plusCount,
        deletions: minusCount,
      });
    }
  }

  return files;
}

/**
 * Parse git diff --numstat output into structured file changes.
 */
export function parseNumstat(numstatOutput: string): GitDiffFile[] {
  const files: GitDiffFile[] = [];
  const lines = numstatOutput.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
    if (match) {
      const additions = match[1] === '-' ? 0 : parseInt(match[1], 10);
      const deletions = match[2] === '-' ? 0 : parseInt(match[2], 10);
      const path = match[3].trim();

      let status: GitDiffFile['status'] = 'modified';
      if (path.includes('=>')) status = 'renamed';

      files.push({ path, status, additions, deletions });
    }
  }

  return files;
}

// ===== Core logic =====

/**
 * Compare two suite results to find regressions and fixes.
 */
export function diffSuiteResults(
  previous: SuiteResult | undefined,
  current: SuiteResult,
): { regressions: string[]; fixes: string[] } {
  if (!previous) return { regressions: [], fixes: [] };

  const prevMap = new Map<string, boolean>();
  for (const r of previous.results) {
    prevMap.set(r.name, r.passed);
  }

  const regressions: string[] = [];
  const fixes: string[] = [];

  for (const r of current.results) {
    const prevPassed = prevMap.get(r.name);
    if (prevPassed === true && !r.passed) {
      regressions.push(r.name);
    } else if (prevPassed === false && r.passed) {
      fixes.push(r.name);
    }
  }

  return { regressions, fixes };
}

/**
 * Build a commit test result from a suite result and commit info.
 */
export function buildCommitResult(
  commit: { hash: string; shortHash: string; author: string; date: string; message: string },
  suiteResult: SuiteResult,
  previous?: SuiteResult,
): CommitTestResult {
  const { regressions, fixes } = diffSuiteResults(previous, suiteResult);
  return {
    ...commit,
    suiteResult,
    passed: suiteResult.passed,
    failed: suiteResult.failed,
    total: suiteResult.total,
    regressions,
    fixes,
  };
}

/**
 * Generate a git report from a list of commit results.
 */
export function generateGitReport(commits: CommitTestResult[]): GitReport {
  const trend = calculateTrend(commits);
  const summary = formatGitReport(commits, trend);
  return { commits, trend, summary };
}

/**
 * Calculate trend across commits.
 */
export function calculateTrend(commits: CommitTestResult[]): GitTrend {
  if (commits.length < 2) {
    return {
      totalTestsDelta: 0,
      passRateDelta: 0,
      regressionsIntroduced: 0,
      regressionsFixed: 0,
    };
  }

  const first = commits[0];
  const last = commits[commits.length - 1];
  const firstRate = first.total > 0 ? first.passed / first.total : 0;
  const lastRate = last.total > 0 ? last.passed / last.total : 0;

  let totalRegressions = 0;
  let totalFixes = 0;
  for (const c of commits) {
    totalRegressions += c.regressions.length;
    totalFixes += c.fixes.length;
  }

  return {
    totalTestsDelta: last.total - first.total,
    passRateDelta: lastRate - firstRate,
    regressionsIntroduced: totalRegressions,
    regressionsFixed: totalFixes,
  };
}

/**
 * Format a git report into human-readable text.
 */
export function formatGitReport(commits: CommitTestResult[], trend: GitTrend): string {
  const lines: string[] = [];
  lines.push('\n📊 Git Test Report\n');

  for (const c of commits) {
    const status = c.failed === 0 ? '✅' : '❌';
    lines.push(`  ${status} Commit ${c.shortHash}: ${c.passed} pass, ${c.failed} fail`);
    if (c.message) lines.push(`     ${c.message}`);
    if (c.regressions.length > 0) {
      lines.push(`     ⚠️  Regressions: ${c.regressions.join(', ')}`);
    }
    if (c.fixes.length > 0) {
      lines.push(`     🔧 Fixes: ${c.fixes.join(', ')}`);
    }
  }

  lines.push(`\n  Trend: ${trend.totalTestsDelta >= 0 ? '+' : ''}${trend.totalTestsDelta} tests`);
  lines.push(`  Pass rate delta: ${(trend.passRateDelta * 100).toFixed(1)}%`);
  lines.push(`  Regressions: ${trend.regressionsIntroduced} introduced, ${trend.regressionsFixed} fixed`);
  lines.push('');

  return lines.join('\n');
}

// ===== Bisect =====

/**
 * Parse a bisect test expression, e.g. "search accuracy > 0.8".
 * Returns a function that evaluates against a SuiteResult.
 */
export function parseBisectExpression(expr: string): (result: SuiteResult) => boolean {
  // Pattern: "metric_name op value"
  const match = expr.match(/^(\w[\w\s]*?)\s*(>|<|>=|<=|==|!=)\s*([0-9.]+)$/);
  if (!match) {
    // Default: treat as pass/fail — all tests pass
    return (result) => result.failed === 0;
  }

  const metricName = match[1].trim().toLowerCase();
  const op = match[2];
  const threshold = parseFloat(match[3]);

  return (result: SuiteResult) => {
    let value: number;

    if (metricName === 'pass rate' || metricName === 'pass_rate') {
      value = result.total > 0 ? result.passed / result.total : 0;
    } else if (metricName === 'passed') {
      value = result.passed;
    } else if (metricName === 'failed') {
      value = result.failed;
    } else if (metricName === 'total') {
      value = result.total;
    } else if (metricName.includes('accuracy')) {
      // Look for accuracy in test names
      value = result.total > 0 ? result.passed / result.total : 0;
    } else {
      value = result.total > 0 ? result.passed / result.total : 0;
    }

    switch (op) {
      case '>': return value > threshold;
      case '<': return value < threshold;
      case '>=': return value >= threshold;
      case '<=': return value <= threshold;
      case '==': return value === threshold;
      case '!=': return value !== threshold;
      default: return false;
    }
  };
}

/**
 * Simulate a bisect search over a list of commit results.
 * Returns the first commit where the test expression fails.
 */
export function bisectSearch(
  commits: CommitTestResult[],
  expression: string,
): BisectResult {
  const evaluate = parseBisectExpression(expression);
  const searchPath: string[] = [];

  if (commits.length === 0) {
    return { found: false, stepsSearched: 0, searchPath, expression };
  }

  // Binary search: find first commit where test fails
  let lo = 0;
  let hi = commits.length - 1;
  let steps = 0;
  let result: CommitTestResult | undefined;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    steps++;
    const commit = commits[mid];
    searchPath.push(commit.shortHash);

    if (!commit.suiteResult) {
      // No result — skip
      hi = mid - 1;
      continue;
    }

    const passes = evaluate(commit.suiteResult);
    if (passes) {
      lo = mid + 1;
    } else {
      result = commit;
      hi = mid - 1;
    }
  }

  return {
    found: !!result,
    commit: result,
    stepsSearched: steps,
    searchPath,
    expression,
  };
}

/**
 * Format bisect result.
 */
export function formatBisectResult(result: BisectResult): string {
  const lines: string[] = [];
  lines.push('\n🔍 Git Bisect Result\n');
  lines.push(`  Expression: "${result.expression}"`);
  lines.push(`  Steps searched: ${result.stepsSearched}`);
  lines.push(`  Search path: ${result.searchPath.join(' → ')}`);

  if (result.found && result.commit) {
    lines.push(`\n  🎯 First failing commit: ${result.commit.shortHash}`);
    lines.push(`     Author: ${result.commit.author}`);
    lines.push(`     Date: ${result.commit.date}`);
    lines.push(`     Message: ${result.commit.message}`);
  } else {
    lines.push('\n  ✅ No failing commit found in range.');
  }

  lines.push('');
  return lines.join('\n');
}
