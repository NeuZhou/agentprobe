import { describe, it, expect } from 'vitest';
import type { AgentTrace } from '../src/types';
import { evaluate } from '../src/assertions';
import { evaluateComposed, evaluateAllOf, evaluateAnyOf, evaluateNoneOf } from '../src/compose';
import { mergeTraces, splitTrace } from '../src/merge';
import { reportJUnit } from '../src/reporters/junit';
import { loadTrace } from '../src/recorder';

function makeTrace(steps: AgentTrace['steps'] = []): AgentTrace {
  return {
    id: 'test-trace',
    timestamp: new Date().toISOString(),
    steps,
    metadata: {},
  };
}

function makeToolStep(name: string, ts?: string) {
  return {
    type: 'tool_call' as const,
    timestamp: ts ?? new Date().toISOString(),
    data: { tool_name: name, tool_args: {} },
  };
}

function makeOutputStep(content: string, ts?: string) {
  return {
    type: 'output' as const,
    timestamp: ts ?? new Date().toISOString(),
    data: { content },
  };
}

// ===== Compose Tests =====
describe('evaluateAllOf', () => {
  it('passes when all conditions match', () => {
    const trace = makeTrace([makeToolStep('search'), makeOutputStep('result found')]);
    const results = evaluateAllOf(trace, [
      { tool_called: 'search' },
      { output_contains: 'result' },
    ]);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('fails when any condition fails', () => {
    const trace = makeTrace([makeToolStep('search')]);
    const results = evaluateAllOf(trace, [
      { tool_called: 'search' },
      { tool_called: 'missing_tool' },
    ]);
    expect(results.some(r => !r.passed)).toBe(true);
  });
});

describe('evaluateAnyOf', () => {
  it('passes when at least one condition matches', () => {
    const trace = makeTrace([makeToolStep('web_search')]);
    const results = evaluateAnyOf(trace, [
      { tool_called: 'web_search' },
      { tool_called: 'bing_search' },
    ]);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('fails when no condition matches', () => {
    const trace = makeTrace([makeToolStep('other')]);
    const results = evaluateAnyOf(trace, [
      { tool_called: 'web_search' },
      { tool_called: 'bing_search' },
    ]);
    expect(results.some(r => !r.passed)).toBe(true);
  });
});

describe('evaluateNoneOf', () => {
  it('passes when no condition matches', () => {
    const trace = makeTrace([makeToolStep('search')]);
    const results = evaluateNoneOf(trace, [
      { tool_called: 'exec' },
      { tool_called: 'shell' },
    ]);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('fails when a forbidden condition matches', () => {
    const trace = makeTrace([makeToolStep('exec')]);
    const results = evaluateNoneOf(trace, [
      { tool_called: 'exec' },
    ]);
    expect(results.some(r => !r.passed)).toBe(true);
  });
});

describe('evaluateComposed', () => {
  it('handles combined all_of + any_of + none_of', () => {
    const trace = makeTrace([
      makeToolStep('search'),
      makeToolStep('web_search'),
      makeOutputStep('result data'),
    ]);
    const results = evaluateComposed(trace, {
      all_of: [{ tool_called: 'search' }, { output_contains: 'result' }],
      any_of: [{ tool_called: 'web_search' }, { tool_called: 'bing_search' }],
      none_of: [{ tool_called: 'exec' }],
    });
    expect(results.every(r => r.passed)).toBe(true);
  });
});

// ===== Merge Tests =====
describe('mergeTraces', () => {
  it('merges and sorts by timestamp', () => {
    const t1 = makeTrace([makeToolStep('a', '2024-01-01T00:00:01Z')]);
    const t2 = makeTrace([makeToolStep('b', '2024-01-01T00:00:00Z')]);
    const merged = mergeTraces([
      { trace: t1, name: 'agent1' },
      { trace: t2, name: 'agent2' },
    ]);
    expect(merged.steps.length).toBe(2);
    expect(merged.steps[0].data.tool_name).toBe('b');
    expect(merged.steps[1].data.tool_name).toBe('a');
    expect(merged.agents).toEqual(['agent1', 'agent2']);
    expect(merged.steps[0].agent_name).toBe('agent2');
  });

  it('round-trips via splitTrace', () => {
    const t1 = makeTrace([makeToolStep('x', '2024-01-01T00:00:00Z')]);
    const t2 = makeTrace([makeToolStep('y', '2024-01-01T00:00:01Z')]);
    const merged = mergeTraces([
      { trace: t1, name: 'a' },
      { trace: t2, name: 'b' },
    ]);
    const split = splitTrace(merged);
    expect(split.size).toBe(2);
    expect(split.get('a')!.steps.length).toBe(1);
    expect(split.get('b')!.steps.length).toBe(1);
  });
});

// ===== JUnit Reporter Tests =====
describe('reportJUnit', () => {
  it('generates valid XML', () => {
    const xml = reportJUnit({
      name: 'Test Suite',
      passed: 1,
      failed: 1,
      total: 2,
      duration_ms: 100,
      results: [
        { name: 'pass test', passed: true, assertions: [], duration_ms: 50 },
        {
          name: 'fail test', passed: false, duration_ms: 50,
          assertions: [{ name: 'check', passed: false, message: 'Expected foo', expected: 'foo', actual: 'bar' }],
        },
      ],
    });
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('pass test');
    expect(xml).toContain('<failure');
    expect(xml).toContain('Expected foo');
  });

  it('handles skipped tests', () => {
    const xml = reportJUnit({
      name: 'Suite',
      passed: 0,
      failed: 0,
      total: 1,
      duration_ms: 0,
      results: [
        { name: 'skipped', passed: false, assertions: [], duration_ms: 0, skipped: true, skipReason: 'Dep failed' },
      ],
    });
    expect(xml).toContain('<skipped');
    expect(xml).toContain('Dep failed');
  });

  it('escapes XML special chars', () => {
    const xml = reportJUnit({
      name: 'Suite <&>',
      passed: 1,
      failed: 0,
      total: 1,
      duration_ms: 10,
      results: [
        { name: 'test "quotes"', passed: true, assertions: [], duration_ms: 10 },
      ],
    });
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&quot;');
  });
});
