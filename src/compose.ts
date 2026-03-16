import type { AgentTrace, Expectations, AssertionResult } from './types';
import { evaluate } from './assertions';

/**
 * Composed assertion: all conditions must pass (AND).
 */
export function evaluateAllOf(trace: AgentTrace, conditions: Expectations[]): AssertionResult[] {
  const results: AssertionResult[] = [];
  for (let i = 0; i < conditions.length; i++) {
    const sub = evaluate(trace, conditions[i]);
    for (const r of sub) {
      results.push({
        ...r,
        name: `all_of[${i}].${r.name}`,
      });
    }
  }
  return results;
}

/**
 * Composed assertion: at least one condition must pass (OR).
 */
export function evaluateAnyOf(trace: AgentTrace, conditions: Expectations[]): AssertionResult[] {
  const groups: AssertionResult[][] = [];
  for (const cond of conditions) {
    groups.push(evaluate(trace, cond));
  }

  const anyGroupPassed = groups.some(group => group.every(r => r.passed));

  if (anyGroupPassed) {
    return [{
      name: `any_of: at least one condition passed`,
      passed: true,
    }];
  }

  // All failed — report all for debugging
  const results: AssertionResult[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (const r of groups[i]) {
      results.push({
        ...r,
        name: `any_of[${i}].${r.name}`,
        passed: false,
        message: r.message ?? `any_of: no condition group passed`,
      });
    }
  }
  return results;
}

/**
 * Composed assertion: no condition must pass (NOT).
 */
export function evaluateNoneOf(trace: AgentTrace, conditions: Expectations[]): AssertionResult[] {
  const results: AssertionResult[] = [];
  for (let i = 0; i < conditions.length; i++) {
    const sub = evaluate(trace, conditions[i]);
    const groupPassed = sub.every(r => r.passed);
    results.push({
      name: `none_of[${i}]: ${sub.map(r => r.name).join(', ')}`,
      passed: !groupPassed,
      message: groupPassed ? `none_of[${i}] matched but should not have` : undefined,
    });
  }
  return results;
}

/**
 * Evaluate composed expectations (all_of, any_of, none_of) from a test case.
 */
export function evaluateComposed(
  trace: AgentTrace,
  composed: { all_of?: Expectations[]; any_of?: Expectations[]; none_of?: Expectations[] },
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (composed.all_of) {
    results.push(...evaluateAllOf(trace, composed.all_of));
  }
  if (composed.any_of) {
    results.push(...evaluateAnyOf(trace, composed.any_of));
  }
  if (composed.none_of) {
    results.push(...evaluateNoneOf(trace, composed.none_of));
  }

  return results;
}
