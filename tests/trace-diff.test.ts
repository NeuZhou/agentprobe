/**
 * New Feature: Trace Diff — Compare two traces side-by-side
 * Helps users understand behavioral regressions between agent versions.
 */
import { describe, it, expect } from 'vitest';
import { diffTraces, type TraceDiffResult } from '../src/trace-diff';
import type { AgentTrace } from '../src/types';

const makeTrace = (overrides: Partial<AgentTrace> = {}): AgentTrace => ({
  id: 'trace-1',
  timestamp: '2026-01-01T00:00:00Z',
  steps: [
    {
      type: 'tool_call',
      timestamp: '2026-01-01T00:00:00Z',
      data: { tool_name: 'search', tool_args: { query: 'test' } },
      duration_ms: 100,
    },
    {
      type: 'output',
      timestamp: '2026-01-01T00:00:01Z',
      data: { content: 'Search results for test' },
      duration_ms: 50,
    },
  ],
  metadata: {},
  ...overrides,
});

describe('Trace Diff', () => {
  it('should detect identical traces', () => {
    const a = makeTrace();
    const b = makeTrace();
    const diff = diffTraces(a, b);
    expect(diff.identical).toBe(true);
    expect(diff.changes.length).toBe(0);
  });

  it('should detect added steps', () => {
    const a = makeTrace();
    const b = makeTrace({
      steps: [
        ...a.steps,
        {
          type: 'tool_call',
          timestamp: '2026-01-01T00:00:02Z',
          data: { tool_name: 'summarize' },
          duration_ms: 200,
        },
      ],
    });
    const diff = diffTraces(a, b);
    expect(diff.identical).toBe(false);
    expect(diff.changes.some((c) => c.type === 'added')).toBe(true);
  });

  it('should detect removed steps', () => {
    const a = makeTrace();
    const b = makeTrace({ steps: [a.steps[0]] });
    const diff = diffTraces(a, b);
    expect(diff.identical).toBe(false);
    expect(diff.changes.some((c) => c.type === 'removed')).toBe(true);
  });

  it('should detect modified step data', () => {
    const a = makeTrace();
    const b = makeTrace({
      steps: [
        {
          type: 'tool_call',
          timestamp: '2026-01-01T00:00:00Z',
          data: { tool_name: 'search', tool_args: { query: 'different' } },
          duration_ms: 100,
        },
        a.steps[1],
      ],
    });
    const diff = diffTraces(a, b);
    expect(diff.identical).toBe(false);
    expect(diff.changes.some((c) => c.type === 'modified')).toBe(true);
  });

  it('should provide summary statistics', () => {
    const a = makeTrace();
    const b = makeTrace({
      steps: [
        ...a.steps,
        {
          type: 'tool_call',
          timestamp: '2026-01-01T00:00:02Z',
          data: { tool_name: 'new_tool' },
          duration_ms: 300,
        },
      ],
    });
    const diff = diffTraces(a, b);
    expect(diff.summary).toBeDefined();
    expect(diff.summary.stepsA).toBe(2);
    expect(diff.summary.stepsB).toBe(3);
  });

  it('should handle empty traces', () => {
    const empty = makeTrace({ steps: [] });
    const nonEmpty = makeTrace();
    const diff = diffTraces(empty, nonEmpty);
    expect(diff.identical).toBe(false);
    expect(diff.changes.length).toBeGreaterThan(0);
  });

  it('should detect tool sequence changes', () => {
    const a = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: 't1', data: { tool_name: 'a' }, duration_ms: 10 },
        { type: 'tool_call', timestamp: 't2', data: { tool_name: 'b' }, duration_ms: 10 },
      ],
    });
    const b = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: 't1', data: { tool_name: 'b' }, duration_ms: 10 },
        { type: 'tool_call', timestamp: 't2', data: { tool_name: 'a' }, duration_ms: 10 },
      ],
    });
    const diff = diffTraces(a, b);
    expect(diff.identical).toBe(false);
    expect(diff.summary.toolSequenceChanged).toBe(true);
  });
});
