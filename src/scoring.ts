import type { AgentTrace, Expectations, AssertionResult } from './types';
import { evaluate } from './assertions';

/**
 * A scored assertion with a weight.
 */
export interface ScoringRule {
  weight: number;
}

/**
 * Scoring configuration for a test.
 */
export interface ScoringConfig {
  [assertionKey: string]: ScoringRule;
}

/**
 * Result of weighted scoring evaluation.
 */
export interface ScoringResult {
  score: number;
  threshold: number;
  passed: boolean;
  details: Array<{
    key: string;
    weight: number;
    passed: boolean;
    weighted_score: number;
    assertions: AssertionResult[];
  }>;
}

/**
 * Map scoring keys to Expectations.
 * Keys like "tool_called_search" map to { tool_called: "search" }.
 * Keys like "output_quality" map to judge-based evaluation.
 * Keys like "efficiency" map to step/token limits.
 */
function scoringKeyToExpectations(key: string): Expectations | null {
  // tool_called_<name>
  const toolCalledMatch = key.match(/^tool_called_(.+)$/);
  if (toolCalledMatch) {
    return { tool_called: toolCalledMatch[1] };
  }

  // tool_not_called_<name>
  const toolNotCalledMatch = key.match(/^tool_not_called_(.+)$/);
  if (toolNotCalledMatch) {
    return { tool_not_called: toolNotCalledMatch[1] };
  }

  // output_contains_<text>
  const outputContainsMatch = key.match(/^output_contains_(.+)$/);
  if (outputContainsMatch) {
    return { output_contains: outputContainsMatch[1] };
  }

  // max_steps_<n>
  const maxStepsMatch = key.match(/^max_steps_(\d+)$/);
  if (maxStepsMatch) {
    return { max_steps: parseInt(maxStepsMatch[1], 10) };
  }

  // efficiency → max_steps: 10 (reasonable default)
  if (key === 'efficiency') {
    return { max_steps: 10 };
  }

  // output_quality → check output is non-empty and substantial
  if (key === 'output_quality') {
    return { custom: 'outputs.length > 50' };
  }

  return null;
}

/**
 * Evaluate a trace with weighted scoring.
 */
export function evaluateScoring(
  trace: AgentTrace,
  scoring: ScoringConfig,
  threshold: number = 0.7,
): ScoringResult {
  const totalWeight = Object.values(scoring).reduce((sum, r) => sum + r.weight, 0);
  const details: ScoringResult['details'] = [];
  let weightedSum = 0;

  for (const [key, rule] of Object.entries(scoring)) {
    const expectations = scoringKeyToExpectations(key);
    if (!expectations) {
      details.push({
        key,
        weight: rule.weight,
        passed: false,
        weighted_score: 0,
        assertions: [{
          name: `scoring: ${key}`,
          passed: false,
          message: `Unknown scoring key: "${key}"`,
        }],
      });
      continue;
    }

    const assertions = evaluate(trace, expectations);
    const passed = assertions.every(a => a.passed);
    const normalizedWeight = totalWeight > 0 ? rule.weight / totalWeight : 0;
    const weighted_score = passed ? normalizedWeight : 0;

    details.push({
      key,
      weight: rule.weight,
      passed,
      weighted_score,
      assertions,
    });

    weightedSum += weighted_score;
  }

  return {
    score: weightedSum,
    threshold,
    passed: weightedSum >= threshold,
    details,
  };
}

/**
 * Format scoring result for display.
 */
export function formatScoringResult(result: ScoringResult): string {
  const lines: string[] = [];
  const icon = result.passed ? '✅' : '❌';
  const pct = (result.score * 100).toFixed(1);
  const threshPct = (result.threshold * 100).toFixed(1);

  lines.push(`${icon} Score: ${pct}% (threshold: ${threshPct}%)`);
  lines.push('');

  for (const d of result.details) {
    const dIcon = d.passed ? '✓' : '✗';
    lines.push(`  ${dIcon} ${d.key} (weight: ${d.weight}) → ${(d.weighted_score * 100).toFixed(1)}%`);
    for (const a of d.assertions) {
      if (!a.passed) {
        lines.push(`    ❌ ${a.name}: ${a.message ?? 'failed'}`);
      }
    }
  }

  return lines.join('\n');
}
