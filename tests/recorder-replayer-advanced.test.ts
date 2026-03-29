import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { Recorder, createSampler, matchesPriorityRule } from '../src/recorder';
import { replayTrace, deterministicReplay, formatDeterministicReplay, formatReplayResult } from '../src/replay';
import { evaluate } from '../src/assertions';
import { makeTrace, toolCall, output, llmCall } from './helpers';
import type { AgentTrace } from '../src/types';

vi.mock('fs');

// ===== Recorder: Multi-Turn Conversation Scenarios =====

describe('Recorder — Multi-Turn & Tool Call Scenarios', () => {
  let recorder: Recorder;

  beforeEach(() => {
    recorder = new Recorder({ model: 'gpt-4' });
    vi.restoreAllMocks();
  });

  it('records a normal multi-turn conversation flow', () => {
    recorder.addStep({ type: 'llm_call', data: { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] } });
    recorder.addStep({ type: 'output', data: { content: 'Hello! How can I help?' } });
    recorder.addStep({ type: 'llm_call', data: { model: 'gpt-4', messages: [{ role: 'user', content: 'search for cats' }] } });
    recorder.addStep({ type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'cats' } } });
    recorder.addStep({ type: 'tool_result', data: { tool_name: 'search', tool_result: { results: ['cat1', 'cat2'] } } });
    recorder.addStep({ type: 'output', data: { content: 'Found 2 cat results.' } });

    const trace = recorder.getTrace();
    expect(trace.steps).toHaveLength(6);
    expect(trace.steps.map(s => s.type)).toEqual([
      'llm_call', 'output', 'llm_call', 'tool_call', 'tool_result', 'output',
    ]);
  });

  it('records multiple sequential tool calls', () => {
    recorder.addStep({ type: 'tool_call', data: { tool_name: 'read', tool_args: { path: '/a' } } });
    recorder.addStep({ type: 'tool_result', data: { tool_name: 'read', tool_result: 'content-a' } });
    recorder.addStep({ type: 'tool_call', data: { tool_name: 'write', tool_args: { path: '/b', content: 'new' } } });
    recorder.addStep({ type: 'tool_result', data: { tool_name: 'write', tool_result: 'ok' } });
    recorder.addStep({ type: 'tool_call', data: { tool_name: 'exec', tool_args: { command: 'ls' } } });
    recorder.addStep({ type: 'tool_result', data: { tool_name: 'exec', tool_result: 'file1\nfile2' } });

    const trace = recorder.getTrace();
    const toolCalls = trace.steps.filter(s => s.type === 'tool_call');
    expect(toolCalls).toHaveLength(3);
    expect(toolCalls.map(t => t.data.tool_name)).toEqual(['read', 'write', 'exec']);
  });

  it('handles recording interruption (partial trace)', () => {
    recorder.addStep({ type: 'llm_call', data: { model: 'gpt-4' } });
    recorder.addStep({ type: 'tool_call', data: { tool_name: 'search', tool_args: {} } });
    // Interruption — no tool_result or output follows
    const trace = recorder.getTrace();
    expect(trace.steps).toHaveLength(2);
    // The trace exists but is incomplete — no assertion error
  });

  it('records steps with proper timestamps', () => {
    const start = Date.now();
    recorder.addStep({ type: 'output', data: { content: 'first' } });
    recorder.addStep({ type: 'output', data: { content: 'second' } });
    const trace = recorder.getTrace();
    const ts1 = new Date(trace.steps[0].timestamp).getTime();
    const ts2 = new Date(trace.steps[1].timestamp).getTime();
    expect(ts1).toBeGreaterThanOrEqual(start);
    expect(ts2).toBeGreaterThanOrEqual(ts1);
  });

  it('saves a complex trace to JSON file', () => {
    const writeSpy = vi.mocked(fs.writeFileSync);
    recorder.addStep({ type: 'llm_call', data: { model: 'gpt-4' } });
    recorder.addStep({ type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'test' } } });
    recorder.addStep({ type: 'output', data: { content: 'done' } });
    recorder.save('/tmp/multi-turn.json');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeSpy.mock.calls[0][1] as string) as AgentTrace;
    expect(written.steps).toHaveLength(3);
    expect(written.metadata.model).toBe('gpt-4');
  });
});

// ===== Recorder: Edge Cases =====

describe('Recorder — Edge Cases', () => {
  it('handles step with empty data object', () => {
    const recorder = new Recorder();
    recorder.addStep({ type: 'output', data: {} });
    expect(recorder.getTrace().steps[0].data).toEqual({});
  });

  it('handles step with very large tool_args', () => {
    const recorder = new Recorder();
    const largeArgs = { data: 'x'.repeat(100_000) };
    recorder.addStep({ type: 'tool_call', data: { tool_name: 'big', tool_args: largeArgs } });
    expect(recorder.getTrace().steps[0].data.tool_args!.data).toHaveLength(100_000);
  });

  it('handles step with undefined optional fields', () => {
    const recorder = new Recorder();
    recorder.addStep({ type: 'tool_call', data: { tool_name: 'test' } });
    const step = recorder.getTrace().steps[0];
    expect(step.duration_ms).toBeUndefined();
    expect(step.data.tool_args).toBeUndefined();
  });
});

// ===== Replayer: Deterministic Replay =====

describe('Deterministic Replay', () => {
  it('passes when traces match exactly', () => {
    const trace = makeTrace([
      toolCall('search', { q: 'test' }),
      toolCall('read', { path: '/a' }),
    ]);
    const result = deterministicReplay(trace, trace);
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.verifiedSteps).toBe(2);
  });

  it('fails when tool names differ', () => {
    const expected = makeTrace([toolCall('search')]);
    const actual = makeTrace([toolCall('write')]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some(m => m.field === 'tool_name')).toBe(true);
  });

  it('fails when tool args differ', () => {
    const expected = makeTrace([toolCall('search', { q: 'cats' })]);
    const actual = makeTrace([toolCall('search', { q: 'dogs' })]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some(m => m.field === 'tool_args')).toBe(true);
  });

  it('detects different number of tool calls', () => {
    const expected = makeTrace([toolCall('search'), toolCall('write')]);
    const actual = makeTrace([toolCall('search')]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some(m => m.field === 'tool_call_count')).toBe(true);
  });

  it('detects extra calls in actual', () => {
    const expected = makeTrace([toolCall('search')]);
    const actual = makeTrace([toolCall('search'), toolCall('extra')]);
    const result = deterministicReplay(expected, actual);
    expect(result.mismatches.some(m => m.field === 'tool_call_count' || m.field === 'extra_call')).toBe(true);
  });

  it('passes with verify=false (no checks)', () => {
    const expected = makeTrace([toolCall('search')]);
    const actual = makeTrace([toolCall('write')]);
    const result = deterministicReplay(expected, actual, { verify: false });
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('handles traces without tool calls', () => {
    const expected = makeTrace([output('hello')]);
    const actual = makeTrace([output('world')]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(true); // no tool calls to compare
  });
});

describe('formatDeterministicReplay', () => {
  it('formats passing result', () => {
    const result = deterministicReplay(
      makeTrace([toolCall('search')]),
      makeTrace([toolCall('search')]),
    );
    const formatted = formatDeterministicReplay(result);
    expect(formatted).toContain('PASSED');
    expect(formatted).toContain('✅');
  });

  it('formats failing result with mismatch details', () => {
    const result = deterministicReplay(
      makeTrace([toolCall('search')]),
      makeTrace([toolCall('write')]),
    );
    const formatted = formatDeterministicReplay(result);
    expect(formatted).toContain('FAILED');
    expect(formatted).toContain('❌');
    expect(formatted).toContain('tool_name');
  });
});

// ===== Replayer: Advanced Override Scenarios =====

describe('Replay — Advanced Scenarios', () => {
  function toolResult(toolName: string, result: any): any {
    return {
      type: 'tool_result',
      data: {
        tool_name: toolName,
        tool_result: result,
        content: JSON.stringify(result),
      },
    };
  }

  it('adds delay to tool result', () => {
    const trace = makeTrace([
      toolCall('search'),
      toolResult('search', { data: 'ok' }),
      output('done'),
    ]);
    const result = replayTrace({
      trace,
      overrides: { search: { delay_ms: 5000 } },
    });
    expect(result.modifications.some(m => m.type === 'delay_added')).toBe(true);
  });

  it('replay metadata marks trace as replay', () => {
    const trace = makeTrace([toolCall('search'), output('hi')]);
    const result = replayTrace({ trace, overrides: {} });
    expect(result.trace.metadata.replay).toBe(true);
    expect(result.trace.id).toMatch(/^replay-/);
  });

  it('preserves non-tool steps during replay', () => {
    const trace = makeTrace([
      llmCall({ input: 10, output: 5 }),
      toolCall('search'),
      output('result'),
    ]);
    const result = replayTrace({ trace, overrides: {} });
    expect(result.trace.steps.map(s => s.type)).toEqual(['llm_call', 'tool_call', 'output']);
  });

  it('handles multiple overrides with mixed actions', () => {
    const trace = makeTrace([
      toolCall('search'),
      toolResult('search', 'orig-search'),
      toolCall('write'),
      toolResult('write', 'orig-write'),
    ]);
    const result = replayTrace({
      trace,
      overrides: {
        search: { return: 'new-search' },
        write: { error: 'disk full' },
      },
    });
    expect(result.modifications.some(m => m.type === 'return_override')).toBe(true);
    expect(result.modifications.some(m => m.type === 'error_injected')).toBe(true);
  });
});

// ===== Assertions: Boundary & Edge Cases =====

describe('Assertions — Edge Cases', () => {
  it('empty trace: tool_called fails', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { tool_called: 'anything' });
    expect(results[0].passed).toBe(false);
  });

  it('empty trace: max_steps passes with limit >= 0', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { max_steps: 0 });
    expect(results[0].passed).toBe(true);
  });

  it('empty trace: output_contains fails', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { output_contains: 'anything' });
    expect(results[0].passed).toBe(false);
  });

  it('multiple outputs: joined with newlines for matching', () => {
    const trace = makeTrace([output('Hello'), output('World')]);
    const results = evaluate(trace, { output_contains: 'Hello\nWorld' });
    expect(results[0].passed).toBe(true);
  });

  it('invalid regex in output_matches', () => {
    const trace = makeTrace([output('test')]);
    const results = evaluate(trace, { output_matches: '[invalid regex' });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('Invalid regex');
  });

  it('max_tokens with no token data passes', () => {
    const trace = makeTrace([toolCall('search')]);
    const results = evaluate(trace, { max_tokens: 100 });
    expect(results[0].passed).toBe(true);
  });

  it('not: negates inner assertion', () => {
    const trace = makeTrace([toolCall('search')]);
    const results = evaluate(trace, { not: { tool_called: 'write' } });
    // "tool_called: write" would fail (write not called), so not(fail) = pass
    expect(results[0].passed).toBe(true);
  });

  it('not: fails when inner passes', () => {
    const trace = makeTrace([toolCall('search')]);
    const results = evaluate(trace, { not: { tool_called: 'search' } });
    // "tool_called: search" passes, so not(pass) = fail
    expect(results[0].passed).toBe(false);
  });

  it('chain: sequential assertions pass in order', () => {
    const trace = makeTrace([
      toolCall('search'),
      output('searching...'),
      toolCall('write'),
      output('done'),
    ]);
    const results = evaluate(trace, {
      chain: [
        { tool_called: 'search' },
        { output_contains: 'searching' },
        { tool_called: 'write' },
      ],
    });
    expect(results[0].passed).toBe(true);
  });

  it('chain: fails when order is wrong', () => {
    const trace = makeTrace([
      toolCall('write'),
      toolCall('search'),
    ]);
    const results = evaluate(trace, {
      chain: [
        { tool_called: 'search' },
        { tool_called: 'write' },
      ],
    });
    // After finding search (step 1), look for write but it's already passed
    expect(results[0].passed).toBe(false);
  });

  it('max_cost_usd passes for free trace', () => {
    const trace = makeTrace([output('hello')]);
    const results = evaluate(trace, { max_cost_usd: 1.0 });
    expect(results[0].passed).toBe(true);
  });

  it('tool_args_match with missing key fails', () => {
    const trace = makeTrace([toolCall('search', { q: 'test' })]);
    const results = evaluate(trace, { tool_args_match: { search: { q: 'test', limit: 10 } } });
    expect(results[0].passed).toBe(false);
  });

  it('custom: blocks unsafe expressions', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { custom: 'process.exit(1)' });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('Unsafe');
  });

  it('custom: blocks eval', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { custom: 'eval("1+1")' });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('Unsafe');
  });

  it('custom: blocks require', () => {
    const trace = makeTrace([]);
    const results = evaluate(trace, { custom: 'require("fs").readFileSync("/etc/passwd")' });
    expect(results[0].passed).toBe(false);
  });
});

// ===== Sampling: Edge Cases =====

describe('Trace Sampling — Edge Cases', () => {
  function mkTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
    return { id: 't', timestamp: '', steps: [], metadata: {}, ...overrides };
  }

  it('multiple priority rules: any match triggers capture', () => {
    const rules = [
      { cost_gt: 10 },
      { tool_used: 'exec' },
    ];
    // Cost alone matches
    expect(matchesPriorityRule(mkTrace({ metadata: { cost: 20 } }), rules)).toBe(true);
    // Tool alone matches
    expect(matchesPriorityRule(
      mkTrace({ steps: [{ type: 'tool_call', timestamp: '', data: { tool_name: 'exec' } }] }),
      rules,
    )).toBe(true);
    // Neither matches
    expect(matchesPriorityRule(mkTrace({ metadata: { cost: 1 } }), rules)).toBe(false);
  });

  it('duration_gt handles different units', () => {
    const msTrace = mkTrace({ steps: [{ type: 'llm_call', timestamp: '', data: {}, duration_ms: 500 }] });
    expect(matchesPriorityRule(msTrace, [{ duration_gt: '100ms' }])).toBe(true);
    expect(matchesPriorityRule(msTrace, [{ duration_gt: '1s' }])).toBe(false);

    const longTrace = mkTrace({ steps: [{ type: 'llm_call', timestamp: '', data: {}, duration_ms: 120_000 }] });
    expect(matchesPriorityRule(longTrace, [{ duration_gt: '1m' }])).toBe(true);
  });

  it('priority strategy with no matching rules uses rate-based sampling', () => {
    const sampler = createSampler({
      rate: 1.0,
      strategy: 'priority',
      priority_rules: [{ cost_gt: 999 }],
    });
    // No matching priority rule, falls back to rate=1.0
    expect(sampler(mkTrace())).toBe(true);
  });
});
