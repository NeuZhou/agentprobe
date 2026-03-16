import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/assertions';
import { makeTrace, toolCall, output, llmCall } from './helpers';

describe('edge-cases', () => {
  it('empty trace (no steps)', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { max_steps: 10 });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('trace with 1000 steps', () => {
    const steps = Array.from({ length: 1000 }, (_, i) => toolCall(`tool_${i}`));
    const trace = makeTrace(steps);
    const results = evaluate(trace, { max_steps: 2000 });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('unicode in output', () => {
    const trace = makeTrace([output('こんにちは世界 🌍 Ñoño')]);
    const results = evaluate(trace, { output_contains: 'こんにちは' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('very long output (10KB+)', () => {
    const longText = 'x'.repeat(12000);
    const trace = makeTrace([output(longText)]);
    const results = evaluate(trace, { output_contains: 'x' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('nested tool calls (tool calls another tool)', () => {
    const trace = makeTrace([
      toolCall('outer'),
      toolCall('inner'),
      output('done'),
    ]);
    const results = evaluate(trace, { tool_called: ['outer', 'inner'] });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('tool with no arguments', () => {
    const trace = makeTrace([toolCall('simple_tool'), output('done')]);
    const results = evaluate(trace, { tool_called: 'simple_tool' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('tool with complex nested arguments', () => {
    const trace = makeTrace([
      toolCall('complex', { a: { b: { c: [1, 2, { d: 'deep' }] } } }),
      output('done'),
    ]);
    const results = evaluate(trace, { tool_called: 'complex' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('null/undefined values in trace data', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'test', tool_args: undefined as any } },
      output('done'),
    ]);
    const results = evaluate(trace, { tool_called: 'test' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('test with no assertions (empty expect)', () => {
    const trace = makeTrace([output('anything')]);
    const results = evaluate(trace, {});
    expect(results).toHaveLength(0);
  });

  it('very large token count', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { tokens: { input: 1000000, output: 500000 } } },
    ]);
    const results = evaluate(trace, { max_tokens: 2000000 });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('zero duration trace', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'fast' }, duration_ms: 0 },
      output('done'),
    ]);
    const results = evaluate(trace, { tool_called: 'fast' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('assertion on missing tool', () => {
    const trace = makeTrace([output('hello')]);
    const results = evaluate(trace, { tool_called: 'nonexistent' });
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it('output_not_contains passes when text absent', () => {
    const trace = makeTrace([output('hello world')]);
    const results = evaluate(trace, { output_not_contains: 'secret' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('output_not_contains fails when text present', () => {
    const trace = makeTrace([output('hello secret world')]);
    const results = evaluate(trace, { output_not_contains: 'secret' });
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it('tool_sequence assertion', () => {
    const trace = makeTrace([
      toolCall('a'),
      toolCall('b'),
      toolCall('c'),
      output('done'),
    ]);
    const results = evaluate(trace, { tool_sequence: ['a', 'b', 'c'] });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('max_steps fails when exceeded', () => {
    const steps = Array.from({ length: 20 }, () => toolCall('x'));
    const trace = makeTrace(steps);
    const results = evaluate(trace, { max_steps: 5 });
    expect(results.some(r => !r.passed)).toBe(true);
  });
});
