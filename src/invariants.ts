/**
 * Invariant Guards — Runtime assertions for AgentProbe core modules.
 *
 * These guards enforce structural invariants at runtime:
 * - Recorder: monotonic timestamps, required fields, size limits
 * - Replayer: trace completeness, valid speed
 * - Assertions: registered types, defined values
 */

import type { AgentTrace, TraceStep } from './types';

// ===== Error class =====

export class InvariantViolation extends Error {
  constructor(
    public readonly guard: string,
    message: string,
  ) {
    super(`[InvariantViolation:${guard}] ${message}`);
    this.name = 'InvariantViolation';
  }
}

// ===== Recorder Guards =====

/** Default max events before auto-truncation warning */
export const DEFAULT_MAX_RECORDING_SIZE = 10_000;

/**
 * Assert that trace timestamps are monotonically non-decreasing.
 * Throws InvariantViolation if a step has a timestamp earlier than a previous step.
 */
export function assertTimestampsMonotonic(trace: AgentTrace): void {
  for (let i = 1; i < trace.steps.length; i++) {
    const prev = new Date(trace.steps[i - 1].timestamp).getTime();
    const curr = new Date(trace.steps[i].timestamp).getTime();
    if (curr < prev) {
      throw new InvariantViolation(
        'timestamps_monotonic',
        `Step ${i} timestamp (${trace.steps[i].timestamp}) is earlier than step ${i - 1} (${trace.steps[i - 1].timestamp})`,
      );
    }
  }
}

/**
 * Assert every event has a `type` field.
 */
export function assertEventsHaveType(steps: Partial<TraceStep>[]): void {
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i].type) {
      throw new InvariantViolation(
        'event_has_type',
        `Step ${i} is missing a 'type' field`,
      );
    }
  }
}

/**
 * Check recording size against a limit. Returns truncated steps + warning
 * if over the limit; otherwise returns the steps unchanged.
 */
export function enforceRecordingLimit(
  steps: TraceStep[],
  maxSize: number = DEFAULT_MAX_RECORDING_SIZE,
): { steps: TraceStep[]; truncated: boolean; warning?: string } {
  if (steps.length <= maxSize) {
    return { steps, truncated: false };
  }
  const warning = `Recording exceeded max size (${steps.length} > ${maxSize}). Truncated to ${maxSize} most recent events.`;
  return {
    steps: steps.slice(-maxSize),
    truncated: true,
    warning,
  };
}

// ===== Replayer Guards =====

/**
 * Assert that a trace is "complete" — has both a first event (acting as start)
 * and a final event (acting as end). For replay purposes, this means
 * the trace must have at least one step.
 */
export function assertTraceComplete(trace: AgentTrace): void {
  if (!trace.steps || trace.steps.length === 0) {
    throw new InvariantViolation(
      'trace_complete',
      'Trace has no steps — cannot replay an empty trace',
    );
  }
}

/**
 * Assert replay speed is positive (> 0).
 */
export function assertReplaySpeed(speed: number): void {
  if (speed <= 0) {
    throw new InvariantViolation(
      'replay_speed',
      `Replay speed must be positive, got ${speed}`,
    );
  }
  if (!Number.isFinite(speed)) {
    throw new InvariantViolation(
      'replay_speed',
      `Replay speed must be a finite number, got ${speed}`,
    );
  }
}

// ===== Assertion Guards =====

/** The set of registered assertion types used in the evaluate() function. */
export const REGISTERED_ASSERTION_TYPES = new Set([
  'tool_called',
  'tool_not_called',
  'output_contains',
  'output_not_contains',
  'output_matches',
  'max_steps',
  'max_tokens',
  'max_duration_ms',
  'tool_sequence',
  'tool_args_match',
  'max_cost_usd',
  'custom',
  'chain',
  'custom_assertions',
  'judge',
  'judge_rubric',
  'snapshot',
  'not',
  'all_of',
  'any_of',
  'none_of',
]);

/**
 * Assert that an assertion name is a registered type.
 */
export function assertRegisteredAssertionType(name: string): void {
  if (!REGISTERED_ASSERTION_TYPES.has(name)) {
    throw new InvariantViolation(
      'registered_assertion_type',
      `Unknown assertion type: "${name}". Registered types: ${[...REGISTERED_ASSERTION_TYPES].join(', ')}`,
    );
  }
}

/**
 * Assert that expected and actual values are not both undefined.
 */
export function assertNotBothUndefined(
  expected: any,
  actual: any,
  context: string = '',
): void {
  if (expected === undefined && actual === undefined) {
    throw new InvariantViolation(
      'not_both_undefined',
      `Both expected and actual values are undefined${context ? ` in ${context}` : ''}. At least one must be defined.`,
    );
  }
}
