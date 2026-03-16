/**
 * Enhanced Coverage Report - Detailed analysis of test coverage.
 *
 * Covers: tool coverage, assertion type coverage, scenario coverage, trends.
 */

import type { SuiteResult, TestCase } from './types';

export interface ToolCoverageDetail {
  totalTools: number;
  calledTools: string[];
  uncalledTools: string[];
  coveragePercent: number;
  callCounts: Record<string, number>;
  argCombinations: Record<string, string[]>;
}

export interface AssertionTypeCoverage {
  usedTypes: string[];
  unusedTypes: string[];
  coveragePercent: number;
  typeCounts: Record<string, number>;
}

export type ScenarioType = 'happy_path' | 'error' | 'edge_case' | 'security' | 'performance' | 'unknown';

export interface ScenarioCoverage {
  scenarios: Record<ScenarioType, number>;
  total: number;
  coveragePercent: number;
  missingScenarios: ScenarioType[];
}

export interface CoverageTrendPoint {
  timestamp: string;
  toolCoverage: number;
  assertionCoverage: number;
  scenarioCoverage: number;
  testCount: number;
}

export interface DetailedCoverageReport {
  toolCoverage: ToolCoverageDetail;
  assertionCoverage: AssertionTypeCoverage;
  scenarioCoverage: ScenarioCoverage;
  overallScore: number;
}

const ALL_ASSERTION_TYPES = [
  'tool_called', 'tool_not_called', 'output_contains', 'output_not_contains',
  'output_matches', 'max_steps', 'max_tokens', 'max_duration_ms',
  'tool_args_match', 'tool_sequence', 'snapshot', 'max_cost_usd',
  'custom', 'judge', 'judge_rubric', 'not', 'all_of', 'any_of', 'none_of',
  'chain', 'custom_assertions',
];

const ALL_SCENARIO_TYPES: ScenarioType[] = [
  'happy_path', 'error', 'edge_case', 'security', 'performance',
];

/**
 * Analyze tool coverage from suite results.
 */
export function analyzeToolCoverage(result: SuiteResult, declaredTools?: string[]): ToolCoverageDetail {
  const callCounts: Record<string, number> = {};
  const argCombinations: Record<string, Set<string>> = {};

  for (const test of result.results) {
    if (!test.trace) continue;
    for (const step of test.trace.steps) {
      if (step.type !== 'tool_call' || !step.data.tool_name) continue;
      const name = step.data.tool_name;
      callCounts[name] = (callCounts[name] ?? 0) + 1;
      if (!argCombinations[name]) argCombinations[name] = new Set();
      const argKeys = Object.keys(step.data.tool_args ?? {}).sort().join(',');
      argCombinations[name].add(argKeys);
    }
  }

  const calledTools = Object.keys(callCounts).sort();
  const allTools = declaredTools
    ? [...new Set([...declaredTools, ...calledTools])].sort()
    : calledTools;
  const uncalledTools = allTools.filter(t => !callCounts[t]);
  const coveragePercent = allTools.length > 0 ? Math.round((calledTools.length / allTools.length) * 100) : 100;

  return {
    totalTools: allTools.length,
    calledTools,
    uncalledTools,
    coveragePercent,
    callCounts,
    argCombinations: Object.fromEntries(
      Object.entries(argCombinations).map(([k, v]) => [k, [...v]])
    ),
  };
}

/**
 * Analyze which assertion types are used in test cases.
 */
export function analyzeAssertionCoverage(tests: TestCase[]): AssertionTypeCoverage {
  const typeCounts: Record<string, number> = {};

  for (const test of tests) {
    if (!test.expect) continue;
    for (const key of ALL_ASSERTION_TYPES) {
      if ((test.expect as any)[key] !== undefined) {
        typeCounts[key] = (typeCounts[key] ?? 0) + 1;
      }
    }
  }

  const usedTypes = Object.keys(typeCounts).sort();
  const unusedTypes = ALL_ASSERTION_TYPES.filter(t => !typeCounts[t]);
  const coveragePercent = Math.round((usedTypes.length / ALL_ASSERTION_TYPES.length) * 100);

  return { usedTypes, unusedTypes, coveragePercent, typeCounts };
}

/**
 * Classify tests into scenario types based on tags, name, and content.
 */
export function classifyScenario(test: TestCase): ScenarioType {
  const tags = test.tags?.map(t => t.toLowerCase()) ?? [];
  const name = test.name.toLowerCase();

  if (tags.includes('security') || name.includes('security') || name.includes('injection') || name.includes('xss'))
    return 'security';
  if (tags.includes('error') || name.includes('error') || name.includes('fail') || name.includes('invalid') || test.faults)
    return 'error';
  if (tags.includes('edge') || tags.includes('edge_case') || name.includes('edge') || name.includes('boundary') || name.includes('empty'))
    return 'edge_case';
  if (tags.includes('performance') || tags.includes('perf') || name.includes('performance') || name.includes('latency') || test.expect?.max_duration_ms)
    return 'performance';
  if (tags.includes('happy') || tags.includes('happy_path') || name.includes('happy') || name.includes('basic') || name.includes('should'))
    return 'happy_path';

  return 'happy_path'; // default assumption
}

/**
 * Analyze scenario type coverage.
 */
export function analyzeScenarioCoverage(tests: TestCase[]): ScenarioCoverage {
  const scenarios: Record<ScenarioType, number> = {
    happy_path: 0, error: 0, edge_case: 0, security: 0, performance: 0, unknown: 0,
  };

  for (const test of tests) {
    const type = classifyScenario(test);
    scenarios[type]++;
  }

  const presentTypes = ALL_SCENARIO_TYPES.filter(t => scenarios[t] > 0);
  const missingScenarios = ALL_SCENARIO_TYPES.filter(t => scenarios[t] === 0);
  const coveragePercent = Math.round((presentTypes.length / ALL_SCENARIO_TYPES.length) * 100);

  return { scenarios, total: tests.length, coveragePercent, missingScenarios };
}

/**
 * Generate a full detailed coverage report.
 */
export function generateDetailedCoverage(
  result: SuiteResult,
  tests: TestCase[],
  declaredTools?: string[],
): DetailedCoverageReport {
  const toolCoverage = analyzeToolCoverage(result, declaredTools);
  const assertionCoverage = analyzeAssertionCoverage(tests);
  const scenarioCoverage = analyzeScenarioCoverage(tests);

  const overallScore = Math.round(
    (toolCoverage.coveragePercent + assertionCoverage.coveragePercent + scenarioCoverage.coveragePercent) / 3
  );

  return { toolCoverage, assertionCoverage, scenarioCoverage, overallScore };
}

/**
 * Format detailed coverage report for terminal.
 */
export function formatDetailedCoverage(report: DetailedCoverageReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('📊 Detailed Coverage Report');
  lines.push('═'.repeat(60));
  lines.push(`  Overall Score: ${report.overallScore}%`);
  lines.push('');

  // Tool coverage
  const tc = report.toolCoverage;
  lines.push(`  🔧 Tool Coverage: ${tc.coveragePercent}% (${tc.calledTools.length}/${tc.totalTools})`);
  if (tc.uncalledTools.length > 0) {
    lines.push(`     Untested: ${tc.uncalledTools.join(', ')}`);
  }
  lines.push('');

  // Assertion coverage
  const ac = report.assertionCoverage;
  lines.push(`  ✅ Assertion Type Coverage: ${ac.coveragePercent}% (${ac.usedTypes.length}/${ac.usedTypes.length + ac.unusedTypes.length})`);
  if (ac.unusedTypes.length > 0) {
    lines.push(`     Unused: ${ac.unusedTypes.slice(0, 5).join(', ')}${ac.unusedTypes.length > 5 ? '...' : ''}`);
  }
  lines.push('');

  // Scenario coverage
  const sc = report.scenarioCoverage;
  lines.push(`  🎭 Scenario Coverage: ${sc.coveragePercent}% (${ALL_SCENARIO_TYPES.length - sc.missingScenarios.length}/${ALL_SCENARIO_TYPES.length})`);
  for (const [type, count] of Object.entries(sc.scenarios)) {
    if (count > 0) lines.push(`     ${type}: ${count} tests`);
  }
  if (sc.missingScenarios.length > 0) {
    lines.push(`     Missing: ${sc.missingScenarios.join(', ')}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Record a coverage trend data point.
 */
export function recordCoverageTrend(
  report: DetailedCoverageReport,
  testCount: number,
): CoverageTrendPoint {
  return {
    timestamp: new Date().toISOString(),
    toolCoverage: report.toolCoverage.coveragePercent,
    assertionCoverage: report.assertionCoverage.coveragePercent,
    scenarioCoverage: report.scenarioCoverage.coveragePercent,
    testCount,
  };
}
