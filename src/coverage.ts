/**
 * Tool Coverage Report - Analyze which tools are tested
 */

import type { SuiteResult } from './types';

export interface CoverageResult {
  totalTools: number;
  calledTools: string[];
  uncalledTools: string[];
  coveragePercent: number;
  toolArgCombinations: Record<string, Set<string>>;
  callCounts: Record<string, number>;
}

/**
 * Analyze tool coverage from suite results.
 * @param result - The suite result
 * @param declaredTools - All tools the agent declares (optional; if omitted, only called tools are shown)
 */
export function analyzeCoverage(result: SuiteResult, declaredTools?: string[]): CoverageResult {
  const callCounts: Record<string, number> = {};
  const argCombinations: Record<string, Set<string>> = {};

  for (const test of result.results) {
    if (!test.trace) continue;
    for (const step of test.trace.steps) {
      if (step.type !== 'tool_call' || !step.data.tool_name) continue;

      const name = step.data.tool_name;
      callCounts[name] = (callCounts[name] ?? 0) + 1;

      if (!argCombinations[name]) argCombinations[name] = new Set();
      const argKeys = Object.keys(step.data.tool_args ?? {})
        .sort()
        .join(',');
      argCombinations[name].add(argKeys);
    }
  }

  const calledTools = Object.keys(callCounts).sort();
  const allTools = declaredTools
    ? [...new Set([...declaredTools, ...calledTools])].sort()
    : calledTools;
  const uncalledTools = allTools.filter((t) => !callCounts[t]);
  const coveragePercent =
    allTools.length > 0 ? Math.round((calledTools.length / allTools.length) * 100) : 100;

  return {
    totalTools: allTools.length,
    calledTools,
    uncalledTools,
    coveragePercent,
    toolArgCombinations: argCombinations,
    callCounts,
  };
}

/**
 * Format coverage report for console.
 */
export function formatCoverage(cov: CoverageResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('📊 Tool Coverage Report');
  lines.push('═'.repeat(50));
  lines.push(
    `  Coverage: ${cov.coveragePercent}% (${cov.calledTools.length}/${cov.totalTools} tools)`,
  );
  lines.push('');

  if (cov.calledTools.length > 0) {
    lines.push('  ✅ Called tools:');
    for (const t of cov.calledTools) {
      const count = cov.callCounts[t];
      const argSets = cov.toolArgCombinations[t]?.size ?? 0;
      lines.push(`     ${t} (${count}x, ${argSets} arg combination${argSets !== 1 ? 's' : ''})`);
    }
  }

  if (cov.uncalledTools.length > 0) {
    lines.push('');
    lines.push('  ❌ Uncalled tools:');
    for (const t of cov.uncalledTools) {
      lines.push(`     ${t}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
