import { describe, it, expect } from 'vitest';
import { compareTraces } from '../src/trace-compare';
import type { AgentTrace } from '../src/types';

function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'trace-1',
    timestamp: '2025-01-01T00:00:00Z',
    steps: [],
    metadata: {},
    ...overrides,
  };
}

describe('Trace Compare', () => {
  it('compares two identical empty traces', () => {
    const a = makeTrace();
    const b = makeTrace();
    const result = compareTraces(a, b);
    expect(result.stepsA).toBe(0);
    expect(result.stepsB).toBe(0);
    expect(result.stepsDiff).toBe(0);
    expect(result.outputMatch).toBe(true);
  });

  it('detects step count differences', () => {
    const a = makeTrace({
      steps: [
        { type: 'llm_call', data: { model: 'gpt-4' }, timestamp: 't' },
        { type: 'output', data: { content: 'hi' }, timestamp: 't' },
      ],
    });
    const b = makeTrace({
      steps: [
        { type: 'llm_call', data: { model: 'gpt-4' }, timestamp: 't' },
      ],
    });
    const result = compareTraces(a, b);
    expect(result.stepsA).toBe(2);
    expect(result.stepsB).toBe(1);
    expect(result.stepsDiff).not.toBe(0);
  });

  it('identifies tools unique to each trace', () => {
    const a = makeTrace({
      steps: [
        { type: 'tool_call', data: { tool_name: 'read' }, timestamp: 't' },
        { type: 'tool_call', data: { tool_name: 'exec' }, timestamp: 't' },
      ],
    });
    const b = makeTrace({
      steps: [
        { type: 'tool_call', data: { tool_name: 'read' }, timestamp: 't' },
        { type: 'tool_call', data: { tool_name: 'write' }, timestamp: 't' },
      ],
    });
    const result = compareTraces(a, b);
    expect(result.toolsCommon).toContain('read');
    expect(result.toolsOnlyA).toContain('exec');
    expect(result.toolsOnlyB).toContain('write');
  });

  it('compares step type breakdowns', () => {
    const a = makeTrace({
      steps: [
        { type: 'llm_call', data: {}, timestamp: 't' },
        { type: 'llm_call', data: {}, timestamp: 't' },
        { type: 'tool_call', data: { tool_name: 'read' }, timestamp: 't' },
      ],
    });
    const b = makeTrace({
      steps: [
        { type: 'llm_call', data: {}, timestamp: 't' },
      ],
    });
    const result = compareTraces(a, b);
    expect(result.stepTypesA['llm_call']).toBe(2);
    expect(result.stepTypesB['llm_call']).toBe(1);
  });

  it('compares final outputs', () => {
    const a = makeTrace({
      steps: [
        { type: 'output', data: { content: 'answer A' }, timestamp: 't' },
      ],
    });
    const b = makeTrace({
      steps: [
        { type: 'output', data: { content: 'answer B' }, timestamp: 't' },
      ],
    });
    const result = compareTraces(a, b);
    expect(result.outputMatch).toBe(false);
    expect(result.outputA).toBe('answer A');
    expect(result.outputB).toBe('answer B');
  });

  it('computes duration differences', () => {
    const a = makeTrace({
      steps: [
        { type: 'llm_call', data: {}, timestamp: 't', duration_ms: 1000 },
      ],
    });
    const b = makeTrace({
      steps: [
        { type: 'llm_call', data: {}, timestamp: 't', duration_ms: 2000 },
      ],
    });
    const result = compareTraces(a, b);
    expect(result.durationA).toBe(1000);
    expect(result.durationB).toBe(2000);
  });

  it('counts tool call frequencies', () => {
    const a = makeTrace({
      steps: [
        { type: 'tool_call', data: { tool_name: 'read' }, timestamp: 't' },
        { type: 'tool_call', data: { tool_name: 'read' }, timestamp: 't' },
        { type: 'tool_call', data: { tool_name: 'write' }, timestamp: 't' },
      ],
    });
    const result = compareTraces(a, makeTrace());
    expect(result.toolCountsA['read']).toBe(2);
    expect(result.toolCountsA['write']).toBe(1);
  });

  it('extracts model names', () => {
    const a = makeTrace({
      steps: [
        { type: 'llm_call', data: { model: 'gpt-4' }, timestamp: 't' },
        { type: 'llm_call', data: { model: 'claude-3' }, timestamp: 't' },
      ],
    });
    const result = compareTraces(a, makeTrace());
    expect(result.modelsA).toContain('gpt-4');
    expect(result.modelsA).toContain('claude-3');
  });
});
