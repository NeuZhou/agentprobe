/**
 * Fluent Assertion Builder — Chainable API for building complex agent assertions.
 *
 * @example
 * ```typescript
 * const assertion = new AssertionBuilder()
 *   .that("response")
 *   .contains("Paris")
 *   .and().hasToolCall("search_flights")
 *   .and().costLessThan(0.10)
 *   .and().completedWithin(5000)
 *   .build();
 *
 * const result = assertion.evaluate(trace);
 * ```
 */

import type { AgentTrace, TraceStep } from './types';
import { calculateCost } from './cost';

// ─── Types ───────────────────────────────────────────────────────────

export type AssertionTarget = 'response' | 'trace' | 'tools' | 'cost' | 'steps';

export interface AssertionCheck {
  type: string;
  target: AssertionTarget;
  params: Record<string, any>;
  negate: boolean;
}

export interface AssertionResult {
  passed: boolean;
  checks: AssertionCheckResult[];
  summary: string;
}

export interface AssertionCheckResult {
  type: string;
  passed: boolean;
  message: string;
  expected?: any;
  actual?: any;
}

export interface BuiltAssertion {
  checks: AssertionCheck[];
  evaluate(trace: AgentTrace): AssertionResult;
  toString(): string;
}

// ─── Builder ─────────────────────────────────────────────────────────

export class AssertionBuilder {
  private checks: AssertionCheck[] = [];
  private currentTarget: AssertionTarget = 'response';
  private negated = false;

  /**
   * Set the target for subsequent assertions.
   */
  that(target: AssertionTarget): AssertionBuilder {
    this.currentTarget = target;
    return this;
  }

  /**
   * Negate the next assertion.
   */
  not(): AssertionBuilder {
    this.negated = true;
    return this;
  }

  /**
   * Chain another assertion.
   */
  and(): AssertionBuilder {
    return this;
  }

  /**
   * Response contains a substring.
   */
  contains(text: string): AssertionBuilder {
    this.addCheck('contains', { text });
    return this;
  }

  /**
   * Response matches a regex.
   */
  matches(pattern: string | RegExp): AssertionBuilder {
    const str = pattern instanceof RegExp ? pattern.source : pattern;
    const flags = pattern instanceof RegExp ? pattern.flags : '';
    this.addCheck('matches', { pattern: str, flags });
    return this;
  }

  /**
   * A specific tool was called.
   */
  hasToolCall(toolName: string, args?: Record<string, any>): AssertionBuilder {
    this.addCheck('hasToolCall', { toolName, args }, 'tools');
    return this;
  }

  /**
   * Tool was called exactly N times.
   */
  toolCalledTimes(toolName: string, count: number): AssertionBuilder {
    this.addCheck('toolCalledTimes', { toolName, count }, 'tools');
    return this;
  }

  /**
   * Total cost is less than threshold (USD).
   */
  costLessThan(maxCost: number): AssertionBuilder {
    this.addCheck('costLessThan', { maxCost }, 'cost');
    return this;
  }

  /**
   * Total cost is greater than threshold (USD).
   */
  costGreaterThan(minCost: number): AssertionBuilder {
    this.addCheck('costGreaterThan', { minCost }, 'cost');
    return this;
  }

  /**
   * Trace completed within the given time (ms).
   */
  completedWithin(maxMs: number): AssertionBuilder {
    this.addCheck('completedWithin', { maxMs }, 'trace');
    return this;
  }

  /**
   * Total steps are within range.
   */
  stepCount(min: number, max?: number): AssertionBuilder {
    this.addCheck('stepCount', { min, max }, 'steps');
    return this;
  }

  /**
   * No tool errors occurred.
   */
  noErrors(): AssertionBuilder {
    this.addCheck('noErrors', {}, 'trace');
    return this;
  }

  /**
   * Total tokens used is less than threshold.
   */
  tokensLessThan(maxTokens: number): AssertionBuilder {
    this.addCheck('tokensLessThan', { maxTokens }, 'cost');
    return this;
  }

  /**
   * Tools were called in order.
   */
  toolOrder(...tools: string[]): AssertionBuilder {
    this.addCheck('toolOrder', { tools }, 'tools');
    return this;
  }

  /**
   * Custom predicate assertion.
   */
  satisfies(name: string, predicate: (trace: AgentTrace) => boolean): AssertionBuilder {
    this.addCheck('custom', { name, predicate });
    return this;
  }

  /**
   * Build the assertion into an evaluatable object.
   */
  build(): BuiltAssertion {
    const checks = [...this.checks];
    return {
      checks,
      evaluate: (trace: AgentTrace) => evaluateChecks(checks, trace),
      toString: () => formatChecks(checks),
    };
  }

  private addCheck(type: string, params: Record<string, any>, target?: AssertionTarget): void {
    this.checks.push({
      type,
      target: target ?? this.currentTarget,
      params,
      negate: this.negated,
    });
    this.negated = false;
  }
}

// ─── Evaluation ──────────────────────────────────────────────────────

function getResponseText(trace: AgentTrace): string {
  return trace.steps
    .filter(s => s.type === 'output')
    .map(s => s.data.content ?? '')
    .join('\n');
}

function getToolCalls(trace: AgentTrace): TraceStep[] {
  return trace.steps.filter(s => s.type === 'tool_call');
}

function getTotalDuration(trace: AgentTrace): number {
  return trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
}

function getTotalTokens(trace: AgentTrace): number {
  return trace.steps.reduce((sum, s) => {
    const t = s.data.tokens;
    return sum + (t ? (t.input ?? 0) + (t.output ?? 0) : 0);
  }, 0);
}

function evaluateCheck(check: AssertionCheck, trace: AgentTrace): AssertionCheckResult {
  let passed: boolean;
  let message: string;
  let expected: any;
  let actual: any;

  switch (check.type) {
    case 'contains': {
      const text = getResponseText(trace);
      const target = check.params.text as string;
      passed = text.includes(target);
      expected = target;
      actual = text.length > 100 ? text.slice(0, 97) + '...' : text;
      message = passed ? `Response contains "${target}"` : `Response does not contain "${target}"`;
      break;
    }
    case 'matches': {
      const text = getResponseText(trace);
      const re = new RegExp(check.params.pattern, check.params.flags);
      passed = re.test(text);
      expected = re.toString();
      actual = text.length > 100 ? text.slice(0, 97) + '...' : text;
      message = passed ? `Response matches ${re}` : `Response does not match ${re}`;
      break;
    }
    case 'hasToolCall': {
      const calls = getToolCalls(trace);
      const name = check.params.toolName as string;
      const matchingCalls = calls.filter(c => c.data.tool_name === name);
      passed = matchingCalls.length > 0;
      if (passed && check.params.args) {
        const args = check.params.args;
        passed = matchingCalls.some(c => {
          const callArgs = c.data.tool_args ?? {};
          return Object.entries(args).every(([k, v]) => callArgs[k] === v);
        });
      }
      expected = name;
      actual = calls.map(c => c.data.tool_name);
      message = passed ? `Tool "${name}" was called` : `Tool "${name}" was not called`;
      break;
    }
    case 'toolCalledTimes': {
      const calls = getToolCalls(trace);
      const name = check.params.toolName as string;
      const count = check.params.count as number;
      actual = calls.filter(c => c.data.tool_name === name).length;
      passed = actual === count;
      expected = count;
      message = passed ? `Tool "${name}" called ${count} times` : `Tool "${name}" called ${actual} times, expected ${count}`;
      break;
    }
    case 'costLessThan': {
      const cost = calculateCost(trace);
      actual = cost.total_cost;
      expected = check.params.maxCost;
      passed = actual < expected;
      message = passed ? `Cost $${actual.toFixed(4)} < $${expected}` : `Cost $${actual.toFixed(4)} >= $${expected}`;
      break;
    }
    case 'costGreaterThan': {
      const cost = calculateCost(trace);
      actual = cost.total_cost;
      expected = check.params.minCost;
      passed = actual > expected;
      message = passed ? `Cost $${actual.toFixed(4)} > $${expected}` : `Cost $${actual.toFixed(4)} <= $${expected}`;
      break;
    }
    case 'completedWithin': {
      actual = getTotalDuration(trace);
      expected = check.params.maxMs;
      passed = actual <= expected;
      message = passed ? `Completed in ${actual}ms <= ${expected}ms` : `Took ${actual}ms > ${expected}ms`;
      break;
    }
    case 'stepCount': {
      actual = trace.steps.length;
      const min = check.params.min as number;
      const max = check.params.max as number | undefined;
      passed = actual >= min && (max == null || actual <= max);
      expected = max != null ? `${min}-${max}` : `>=${min}`;
      message = passed ? `Step count ${actual} within ${expected}` : `Step count ${actual} outside ${expected}`;
      break;
    }
    case 'noErrors': {
      const errors = trace.steps.filter(s =>
        s.type === 'tool_result' && s.data.tool_result?.error,
      );
      actual = errors.length;
      passed = actual === 0;
      message = passed ? 'No errors found' : `${actual} errors found`;
      break;
    }
    case 'tokensLessThan': {
      actual = getTotalTokens(trace);
      expected = check.params.maxTokens;
      passed = actual < expected;
      message = passed ? `Tokens ${actual} < ${expected}` : `Tokens ${actual} >= ${expected}`;
      break;
    }
    case 'toolOrder': {
      const calls = getToolCalls(trace).map(c => c.data.tool_name);
      const expectedOrder = check.params.tools as string[];
      let idx = 0;
      for (const call of calls) {
        if (call === expectedOrder[idx]) idx++;
        if (idx >= expectedOrder.length) break;
      }
      passed = idx >= expectedOrder.length;
      expected = expectedOrder;
      actual = calls;
      message = passed ? `Tools called in order: ${expectedOrder.join(' → ')}` : `Tools not in expected order`;
      break;
    }
    case 'custom': {
      const predicate = check.params.predicate as (trace: AgentTrace) => boolean;
      passed = predicate(trace);
      message = passed ? `Custom "${check.params.name}" passed` : `Custom "${check.params.name}" failed`;
      break;
    }
    default:
      passed = false;
      message = `Unknown check: ${check.type}`;
  }

  // Apply negation
  if (check.negate) {
    passed = !passed;
    message = `NOT: ${message}`;
  }

  return { type: check.type, passed, message, expected, actual };
}

function evaluateChecks(checks: AssertionCheck[], trace: AgentTrace): AssertionResult {
  const results = checks.map(c => evaluateCheck(c, trace));
  const allPassed = results.every(r => r.passed);
  const passedCount = results.filter(r => r.passed).length;
  return {
    passed: allPassed,
    checks: results,
    summary: `${passedCount}/${results.length} checks passed`,
  };
}

function formatChecks(checks: AssertionCheck[]): string {
  return checks.map(c => {
    const neg = c.negate ? 'NOT ' : '';
    return `${neg}${c.type}(${JSON.stringify(c.params)})`;
  }).join(' AND ');
}
