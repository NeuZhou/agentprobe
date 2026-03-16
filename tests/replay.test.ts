import { describe, it, expect } from 'vitest';
import { replayTrace, formatReplayResult } from '../src/replay';
import type { ReplayConfig } from '../src/replay';
import { makeTrace, toolCall, output } from './helpers';
import { evaluate } from '../src/assertions';

function toolResult(toolName: string, result: any): any {
  return { type: 'tool_result', data: { tool_name: toolName, tool_result: result, content: JSON.stringify(result) } };
}

describe('replay', () => {
  it('replay without modifications (identical)', () => {
    const trace = makeTrace([toolCall('search'), output('hello')]);
    const result = replayTrace({ trace, overrides: {} });
    expect(result.trace.steps).toHaveLength(trace.steps.length);
    expect(result.modifications).toHaveLength(0);
  });

  it('override single tool response', () => {
    const trace = makeTrace([
      toolCall('search'),
      toolResult('search', { data: 'original' }),
      output('hello'),
    ]);
    const result = replayTrace({
      trace,
      overrides: { search: { return: { data: 'overridden' } } },
    });
    expect(result.modifications.some(m => m.type === 'return_override')).toBe(true);
  });

  it('override multiple tools', () => {
    const trace = makeTrace([
      toolCall('search'),
      toolResult('search', 'orig1'),
      toolCall('calculate'),
      toolResult('calculate', 'orig2'),
    ]);
    const result = replayTrace({
      trace,
      overrides: {
        search: { return: 'new1' },
        calculate: { return: 'new2' },
      },
    });
    expect(result.modifications.filter(m => m.type === 'return_override')).toHaveLength(2);
  });

  it('inject error on tool', () => {
    const trace = makeTrace([
      toolCall('search'),
      toolResult('search', 'ok'),
      output('hello'),
    ]);
    const result = replayTrace({
      trace,
      overrides: { search: { error: 'API down' } },
    });
    expect(result.modifications.some(m => m.type === 'error_injected')).toBe(true);
  });

  it('drop a step', () => {
    const trace = makeTrace([
      toolCall('search'),
      toolResult('search', 'ok'),
      output('hello'),
    ]);
    const result = replayTrace({
      trace,
      overrides: { search: { drop: true } },
    });
    expect(result.modifications.some(m => m.type === 'step_dropped')).toBe(true);
    expect(result.trace.steps.length).toBeLessThan(trace.steps.length);
  });

  it('non-existent tool override (ignored)', () => {
    const trace = makeTrace([toolCall('search'), output('hello')]);
    const result = replayTrace({
      trace,
      overrides: { nonexistent: { return: 'x' } },
    });
    expect(result.modifications).toHaveLength(0);
  });

  it('empty overrides', () => {
    const trace = makeTrace([toolCall('search'), output('hello')]);
    const result = replayTrace({ trace, overrides: {} });
    expect(result.modifications).toHaveLength(0);
  });

  it('override with empty response', () => {
    const trace = makeTrace([
      toolCall('search'),
      toolResult('search', 'original'),
      output('hello'),
    ]);
    const result = replayTrace({
      trace,
      overrides: { search: { return: '' } },
    });
    expect(result.modifications.some(m => m.type === 'return_override')).toBe(true);
  });

  it('assertions still work on replayed trace', () => {
    const trace = makeTrace([
      toolCall('search'),
      toolResult('search', 'original'),
      output('hello world'),
    ]);
    const result = replayTrace({ trace, overrides: {} });
    const assertions = evaluate(result.trace, { output_contains: 'hello' });
    expect(assertions.every(a => a.passed)).toBe(true);
  });

  it('formatReplayResult outputs info', () => {
    const trace = makeTrace([toolCall('search'), output('hello')]);
    const result = replayTrace({ trace, overrides: {} });
    const formatted = formatReplayResult(result);
    expect(formatted).toContain('Replay');
  });
});
