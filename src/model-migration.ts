/**
 * Model Migration Testing — Run tests across model configs and compare results
 * @module
 */

import type { TestCase, TestResult, SuiteResult } from './types';

export interface ModelEndpoint {
  adapter: string;
  model: string;
  endpoint?: string;
  apiKey?: string;
}

export interface MigrationConfig {
  from: ModelEndpoint;
  to: ModelEndpoint;
  tests: TestCase[];
}

export interface MigrationTestResult {
  testName: string;
  fromPassed: boolean;
  toPassed: boolean;
  behaviorChanged: boolean;
  fromDurationMs: number;
  toDurationMs: number;
  fromCostUsd: number;
  toCostUsd: number;
  fromSteps: number;
  toSteps: number;
}

export interface MigrationReport {
  from: ModelEndpoint;
  to: ModelEndpoint;
  totalTests: number;
  behaviorChanges: number;
  newFailures: number;
  newPasses: number;
  costDiff: number;
  latencyDiff: number;
  qualityScore: number; // 0-100
  results: MigrationTestResult[];
  summary: string;
}

/**
 * Compare two suite results as a migration report.
 */
export function compareMigrationResults(
  from: ModelEndpoint,
  to: ModelEndpoint,
  fromResults: SuiteResult,
  toResults: SuiteResult,
): MigrationReport {
  const results: MigrationTestResult[] = [];

  let behaviorChanges = 0;
  let newFailures = 0;
  let newPasses = 0;
  let totalFromCost = 0;
  let totalToCost = 0;
  let totalFromDuration = 0;
  let totalToDuration = 0;

  for (const fromTest of fromResults.results) {
    const toTest = toResults.results.find(t => t.name === fromTest.name);
    if (!toTest) continue;

    const fromSteps = fromTest.trace?.steps.length ?? 0;
    const toSteps = toTest.trace?.steps.length ?? 0;
    const fromCost = estimateCost(fromTest);
    const toCost = estimateCost(toTest);
    const behaviorChanged = fromTest.passed !== toTest.passed || Math.abs(fromSteps - toSteps) > Math.max(fromSteps * 0.5, 2);

    if (behaviorChanged) behaviorChanges++;
    if (fromTest.passed && !toTest.passed) newFailures++;
    if (!fromTest.passed && toTest.passed) newPasses++;

    totalFromCost += fromCost;
    totalToCost += toCost;
    totalFromDuration += fromTest.duration_ms;
    totalToDuration += toTest.duration_ms;

    results.push({
      testName: fromTest.name,
      fromPassed: fromTest.passed,
      toPassed: toTest.passed,
      behaviorChanged,
      fromDurationMs: fromTest.duration_ms,
      toDurationMs: toTest.duration_ms,
      fromCostUsd: fromCost,
      toCostUsd: toCost,
      fromSteps,
      toSteps,
    });
  }

  const total = results.length;
  const matchingBehavior = total - behaviorChanges;
  const qualityScore = total > 0 ? Math.round((matchingBehavior / total) * 100) : 100;

  const costDiff = totalToCost - totalFromCost;
  const latencyDiff = totalToDuration - totalFromDuration;

  const summary = buildMigrationSummary(from, to, total, behaviorChanges, newFailures, newPasses, costDiff, latencyDiff, qualityScore);

  return {
    from, to, totalTests: total, behaviorChanges, newFailures, newPasses,
    costDiff, latencyDiff, qualityScore, results, summary,
  };
}

/**
 * Estimate cost from a test result (simple token-based heuristic).
 */
function estimateCost(result: TestResult): number {
  if (!result.trace) return 0;
  let tokens = 0;
  for (const step of result.trace.steps) {
    tokens += (step.data.tokens?.input ?? 0) + (step.data.tokens?.output ?? 0);
  }
  return tokens * 0.00001; // rough estimate
}

function buildMigrationSummary(
  from: ModelEndpoint, to: ModelEndpoint,
  total: number, behaviorChanges: number, newFailures: number, newPasses: number,
  costDiff: number, latencyDiff: number, qualityScore: number,
): string {
  const lines: string[] = [];
  lines.push(`Migration: ${from.adapter}/${from.model} → ${to.adapter}/${to.model}`);
  lines.push(`Tests: ${total} | Behavior changes: ${behaviorChanges} | Quality: ${qualityScore}%`);
  if (newFailures > 0) lines.push(`⚠️  New failures: ${newFailures}`);
  if (newPasses > 0) lines.push(`🎉 New passes: ${newPasses}`);
  lines.push(`Cost diff: ${costDiff >= 0 ? '+' : ''}$${costDiff.toFixed(4)}`);
  lines.push(`Latency diff: ${latencyDiff >= 0 ? '+' : ''}${latencyDiff}ms`);
  return lines.join('\n');
}

/**
 * Format a migration report as Markdown (for PR comments).
 */
export function formatMigrationReport(report: MigrationReport): string {
  const lines: string[] = [];
  lines.push('## 🔄 Model Migration Report');
  lines.push('');
  lines.push(`**From:** \`${report.from.adapter}/${report.from.model}\``);
  lines.push(`**To:** \`${report.to.adapter}/${report.to.model}\``);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Tests | ${report.totalTests} |`);
  lines.push(`| Quality Score | ${report.qualityScore}% |`);
  lines.push(`| Behavior Changes | ${report.behaviorChanges} |`);
  lines.push(`| New Failures | ${report.newFailures} |`);
  lines.push(`| New Passes | ${report.newPasses} |`);
  lines.push(`| Cost Diff | $${report.costDiff.toFixed(4)} |`);
  lines.push(`| Latency Diff | ${report.latencyDiff}ms |`);

  if (report.results.some(r => r.behaviorChanged)) {
    lines.push('');
    lines.push('### Changed Tests');
    for (const r of report.results.filter(r => r.behaviorChanged)) {
      const status = r.toPassed ? '✅' : '❌';
      lines.push(`- ${status} \`${r.testName}\`: ${r.fromSteps} → ${r.toSteps} steps, ${r.fromDurationMs}ms → ${r.toDurationMs}ms`);
    }
  }

  return lines.join('\n');
}
