import { describe, it, expect } from 'vitest';
import {
  InvariantViolation,
  assertTimestampsMonotonic,
  assertEventsHaveType,
  enforceRecordingLimit,
  assertTraceComplete,
  assertReplaySpeed,
  assertRegisteredAssertionType,
  assertNotBothUndefined,
  REGISTERED_ASSERTION_TYPES,
  DEFAULT_MAX_RECORDING_SIZE,
} from '../src/invariants';
import type { AgentTrace, TraceStep } from '../src/types';

function makeStep(type: string, ts: string, overrides: Partial<TraceStep> = {}): TraceStep {
  return {
    type: type as any,
    timestamp: ts,
    data: {},
    ...overrides,
  };
}

function makeTrace(steps: TraceStep[] = [], metadata: Record<string, any> = {}): AgentTrace {
  return {
    id: 'test',
    timestamp: new Date().toISOString(),
    steps,
    metadata,
  };
}

// ===== Recorder Guards =====

describe('Recorder Invariants', () => {
  describe('assertTimestampsMonotonic', () => {
    it('passes for monotonically increasing timestamps', () => {
      const trace = makeTrace([
        makeStep('llm_call', '2026-01-01T00:00:00Z'),
        makeStep('tool_call', '2026-01-01T00:00:01Z'),
        makeStep('output', '2026-01-01T00:00:02Z'),
      ]);
      expect(() => assertTimestampsMonotonic(trace)).not.toThrow();
    });

    it('passes for equal timestamps (same-millisecond events)', () => {
      const ts = '2026-01-01T00:00:00Z';
      const trace = makeTrace([
        makeStep('llm_call', ts),
        makeStep('tool_call', ts),
        makeStep('output', ts),
      ]);
      expect(() => assertTimestampsMonotonic(trace)).not.toThrow();
    });

    it('throws InvariantViolation for out-of-order timestamps', () => {
      const trace = makeTrace([
        makeStep('llm_call', '2026-01-01T00:00:05Z'),
        makeStep('tool_call', '2026-01-01T00:00:01Z'),
      ]);
      expect(() => assertTimestampsMonotonic(trace)).toThrow(InvariantViolation);
      expect(() => assertTimestampsMonotonic(trace)).toThrow('timestamps_monotonic');
    });

    it('passes for empty trace', () => {
      const trace = makeTrace([]);
      expect(() => assertTimestampsMonotonic(trace)).not.toThrow();
    });

    it('passes for single-step trace', () => {
      const trace = makeTrace([makeStep('output', '2026-01-01T00:00:00Z')]);
      expect(() => assertTimestampsMonotonic(trace)).not.toThrow();
    });
  });

  describe('assertEventsHaveType', () => {
    it('passes when all events have type', () => {
      const steps = [
        { type: 'llm_call' as const, timestamp: '', data: {} },
        { type: 'tool_call' as const, timestamp: '', data: {} },
      ];
      expect(() => assertEventsHaveType(steps)).not.toThrow();
    });

    it('throws when an event is missing type', () => {
      const steps = [
        { type: 'llm_call', timestamp: '', data: {} },
        { timestamp: '', data: {} } as any,
      ];
      expect(() => assertEventsHaveType(steps)).toThrow(InvariantViolation);
      expect(() => assertEventsHaveType(steps)).toThrow('event_has_type');
      expect(() => assertEventsHaveType(steps)).toThrow('Step 1');
    });

    it('passes for empty array', () => {
      expect(() => assertEventsHaveType([])).not.toThrow();
    });

    it('throws for undefined type', () => {
      const steps = [{ type: undefined, timestamp: '', data: {} }] as any;
      expect(() => assertEventsHaveType(steps)).toThrow(InvariantViolation);
    });

    it('throws for empty string type', () => {
      const steps = [{ type: '', timestamp: '', data: {} }] as any;
      expect(() => assertEventsHaveType(steps)).toThrow(InvariantViolation);
    });
  });

  describe('enforceRecordingLimit', () => {
    it('returns steps unchanged when under limit', () => {
      const steps = [makeStep('output', '2026-01-01T00:00:00Z')];
      const result = enforceRecordingLimit(steps, 100);
      expect(result.truncated).toBe(false);
      expect(result.steps).toHaveLength(1);
      expect(result.warning).toBeUndefined();
    });

    it('returns steps unchanged when exactly at limit', () => {
      const steps = Array.from({ length: 5 }, (_, i) => makeStep('output', `2026-01-01T00:00:0${i}Z`));
      const result = enforceRecordingLimit(steps, 5);
      expect(result.truncated).toBe(false);
      expect(result.steps).toHaveLength(5);
    });

    it('truncates to most recent events when over limit', () => {
      const steps = Array.from({ length: 10 }, (_, i) =>
        makeStep('output', `2026-01-01T00:00:0${i}Z`, { data: { content: `step-${i}` } }),
      );
      const result = enforceRecordingLimit(steps, 3);
      expect(result.truncated).toBe(true);
      expect(result.steps).toHaveLength(3);
      // Should keep the LAST 3 steps (most recent)
      expect(result.steps[0].data.content).toBe('step-7');
      expect(result.steps[2].data.content).toBe('step-9');
      expect(result.warning).toContain('10');
      expect(result.warning).toContain('3');
    });

    it('uses default max size', () => {
      expect(DEFAULT_MAX_RECORDING_SIZE).toBe(10_000);
    });
  });
});

// ===== Replayer Guards =====

describe('Replayer Invariants', () => {
  describe('assertTraceComplete', () => {
    it('passes for trace with steps', () => {
      const trace = makeTrace([makeStep('output', '2026-01-01T00:00:00Z')]);
      expect(() => assertTraceComplete(trace)).not.toThrow();
    });

    it('throws for empty trace', () => {
      const trace = makeTrace([]);
      expect(() => assertTraceComplete(trace)).toThrow(InvariantViolation);
      expect(() => assertTraceComplete(trace)).toThrow('trace_complete');
    });

    it('throws for trace with undefined steps', () => {
      const trace = { id: 'x', timestamp: '', steps: undefined as any, metadata: {} };
      expect(() => assertTraceComplete(trace)).toThrow(InvariantViolation);
    });
  });

  describe('assertReplaySpeed', () => {
    it('passes for positive speed', () => {
      expect(() => assertReplaySpeed(1)).not.toThrow();
      expect(() => assertReplaySpeed(0.5)).not.toThrow();
      expect(() => assertReplaySpeed(10)).not.toThrow();
    });

    it('throws for zero speed', () => {
      expect(() => assertReplaySpeed(0)).toThrow(InvariantViolation);
      expect(() => assertReplaySpeed(0)).toThrow('replay_speed');
    });

    it('throws for negative speed', () => {
      expect(() => assertReplaySpeed(-1)).toThrow(InvariantViolation);
      expect(() => assertReplaySpeed(-0.5)).toThrow(InvariantViolation);
    });

    it('throws for Infinity', () => {
      expect(() => assertReplaySpeed(Infinity)).toThrow(InvariantViolation);
      expect(() => assertReplaySpeed(-Infinity)).toThrow(InvariantViolation);
    });

    it('throws for NaN', () => {
      expect(() => assertReplaySpeed(NaN)).toThrow(InvariantViolation);
    });
  });
});

// ===== Assertion Guards =====

describe('Assertion Invariants', () => {
  describe('assertRegisteredAssertionType', () => {
    it('passes for all registered types', () => {
      for (const type of REGISTERED_ASSERTION_TYPES) {
        expect(() => assertRegisteredAssertionType(type)).not.toThrow();
      }
    });

    it('throws for unknown type', () => {
      expect(() => assertRegisteredAssertionType('nonexistent_type')).toThrow(InvariantViolation);
      expect(() => assertRegisteredAssertionType('nonexistent_type')).toThrow('registered_assertion_type');
    });

    it('throws for empty string', () => {
      expect(() => assertRegisteredAssertionType('')).toThrow(InvariantViolation);
    });

    it('registered types include all expected types', () => {
      const expected = ['tool_called', 'tool_not_called', 'output_contains', 'max_steps', 'chain', 'snapshot', 'not'];
      for (const t of expected) {
        expect(REGISTERED_ASSERTION_TYPES.has(t)).toBe(true);
      }
    });
  });

  describe('assertNotBothUndefined', () => {
    it('passes when expected is defined', () => {
      expect(() => assertNotBothUndefined('value', undefined)).not.toThrow();
    });

    it('passes when actual is defined', () => {
      expect(() => assertNotBothUndefined(undefined, 'value')).not.toThrow();
    });

    it('passes when both are defined', () => {
      expect(() => assertNotBothUndefined('a', 'b')).not.toThrow();
    });

    it('throws when both are undefined', () => {
      expect(() => assertNotBothUndefined(undefined, undefined)).toThrow(InvariantViolation);
      expect(() => assertNotBothUndefined(undefined, undefined)).toThrow('not_both_undefined');
    });

    it('includes context in error message', () => {
      expect(() => assertNotBothUndefined(undefined, undefined, 'test_assertion')).toThrow('test_assertion');
    });

    it('passes when values are null (not undefined)', () => {
      expect(() => assertNotBothUndefined(null, null)).not.toThrow();
    });

    it('passes when values are 0 or empty string', () => {
      expect(() => assertNotBothUndefined(0, '')).not.toThrow();
    });
  });
});

describe('InvariantViolation', () => {
  it('is an Error subclass', () => {
    const err = new InvariantViolation('test_guard', 'test message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvariantViolation);
  });

  it('has guard property', () => {
    const err = new InvariantViolation('my_guard', 'msg');
    expect(err.guard).toBe('my_guard');
  });

  it('has InvariantViolation name', () => {
    const err = new InvariantViolation('g', 'm');
    expect(err.name).toBe('InvariantViolation');
  });

  it('includes guard name in message', () => {
    const err = new InvariantViolation('my_guard', 'something broke');
    expect(err.message).toContain('my_guard');
    expect(err.message).toContain('something broke');
  });
});
