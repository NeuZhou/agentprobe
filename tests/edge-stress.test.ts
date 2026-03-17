/**
 * Deep edge-case and stress tests for core modules:
 * - assertions edge cases (empty traces, unicode, multi-output)
 * - compose assertions (allOf, anyOf, noneOf)
 * - merge edge cases (correct API)
 * - converters edge cases
 * - templates edge cases
 * - anonymize edge cases
 */
import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/assertions';
import { evaluateAllOf, evaluateAnyOf, evaluateNoneOf } from '../src/compose';
import { mergeTraces } from '../src/merge';
import { detectFormat, listFormats } from '../src/converters';
import { expandTemplate, isTemplate, listTemplates } from '../src/templates';
import { generateTests } from '../src/codegen';
import { anonymizeTrace } from '../src/anonymize';
import type { AgentTrace, Expectations } from '../src/types';

// ========== Helpers ==========

function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'edge-trace',
    timestamp: '2026-01-01T00:00:00Z',
    steps: [],
    metadata: {},
    ...overrides,
  };
}

// ========== Assertions Edge Cases ==========

describe('Assertions - Edge Cases', () => {
  it('should handle empty trace with no steps', () => {
    const trace = makeTrace({ steps: [] });
    const results = evaluate(trace, { max_steps: 10 });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should handle trace with 0 max_steps', () => {
    const trace = makeTrace({
      steps: [
        { type: 'llm_call', timestamp: '', data: {}, duration_ms: 10 },
      ],
    });
    const results = evaluate(trace, { max_steps: 0 });
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it('should handle unicode in output_contains', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: '你好世界 🦀 日本語テスト' } },
      ],
    });
    const results = evaluate(trace, { output_contains: '🦀' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should handle output_not_contains with empty output', () => {
    const trace = makeTrace({ steps: [] });
    const results = evaluate(trace, { output_not_contains: 'anything' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should handle output_matches with regex', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'The price is $42.99 today' } },
      ],
    });
    const results = evaluate(trace, { output_matches: '\\$\\d+\\.\\d{2}' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should handle tool_sequence with exact match', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search' } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'write' } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'publish' } },
      ],
    });
    const results = evaluate(trace, { tool_sequence: ['search', 'write', 'publish'] });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should fail tool_sequence when order is wrong', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'write' } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search' } },
      ],
    });
    const results = evaluate(trace, { tool_sequence: ['search', 'write'] });
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it('should handle tool_args_match with Record format', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: { query: 'AI trends', limit: 10 } } },
      ],
    });
    // tool_args_match uses Record<string, object> format
    const results = evaluate(trace, {
      tool_args_match: { search: { query: 'AI trends' } },
    });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should handle multiple output steps concatenation', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'Part one. ' } },
        { type: 'output', timestamp: '', data: { content: 'Part two.' } },
      ],
    });
    const results = evaluate(trace, { output_contains: 'Part two' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should handle max_tokens assertion', () => {
    const trace = makeTrace({
      steps: [
        { type: 'llm_call', timestamp: '', data: { tokens: { input: 500, output: 500 } } },
        { type: 'llm_call', timestamp: '', data: { tokens: { input: 300, output: 200 } } },
      ],
    });
    const results = evaluate(trace, { max_tokens: 2000 });
    expect(results.every(r => r.passed)).toBe(true);

    const results2 = evaluate(trace, { max_tokens: 100 });
    expect(results2.some(r => !r.passed)).toBe(true);
  });

  it('should handle max_duration_ms assertion', () => {
    const trace = makeTrace({
      steps: [
        { type: 'llm_call', timestamp: '', data: {}, duration_ms: 500 },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search' }, duration_ms: 300 },
      ],
    });
    const results = evaluate(trace, { max_duration_ms: 1000 });
    expect(results.every(r => r.passed)).toBe(true);

    const results2 = evaluate(trace, { max_duration_ms: 100 });
    expect(results2.some(r => !r.passed)).toBe(true);
  });

  it('should handle max_cost_usd assertion', () => {
    const trace = makeTrace({
      steps: [
        { type: 'llm_call', timestamp: '', data: { model: 'gpt-4', tokens: { input: 100, output: 50 } } },
      ],
    });
    // Generous budget - should pass
    const results = evaluate(trace, { max_cost_usd: 100 });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should handle not assertion for negation', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'Safe output' } },
      ],
    });
    const results = evaluate(trace, {
      not: { output_contains: 'dangerous' },
    });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should fail not assertion when inner passes', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'This is dangerous content' } },
      ],
    });
    const results = evaluate(trace, {
      not: { output_contains: 'dangerous' },
    });
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it('should handle custom assertion with expression', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search' } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'write' } },
      ],
    });
    const results = evaluate(trace, {
      custom: 'steps.length === 2',
    });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should handle chain assertion', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'read_file' } },
        { type: 'llm_call', timestamp: '', data: {} },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'write_file' } },
      ],
    });
    const results = evaluate(trace, {
      chain: [
        { tool_called: 'read_file', then: { tool_called: 'write_file' } },
      ],
    });
    expect(results.every(r => r.passed)).toBe(true);
  });
});

// ========== Compose Edge Cases ==========

describe('Compose - Edge Cases', () => {
  it('should evaluateAllOf pass when all conditions match', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search' } },
        { type: 'output', timestamp: '', data: { content: 'Found results' } },
      ],
    });
    const results = evaluateAllOf(trace, [
      { tool_called: 'search' },
      { output_contains: 'results' },
    ]);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should evaluateAllOf fail when any condition fails', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'Hello' } },
      ],
    });
    const results = evaluateAllOf(trace, [
      { output_contains: 'Hello' },
      { tool_called: 'nonexistent' },
    ]);
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it('should evaluateAnyOf pass when at least one matches', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'Hello world' } },
      ],
    });
    const results = evaluateAnyOf(trace, [
      { output_contains: 'world' },
      { output_contains: 'nonexistent' },
    ]);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should evaluateAnyOf fail when none match', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'Hello' } },
      ],
    });
    const results = evaluateAnyOf(trace, [
      { output_contains: 'goodbye' },
      { output_contains: 'farewell' },
    ]);
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it('should evaluateNoneOf pass when nothing matches', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'Safe output' } },
      ],
    });
    const results = evaluateNoneOf(trace, [
      { output_contains: 'dangerous' },
      { output_contains: 'harmful' },
    ]);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('should evaluateNoneOf fail when one matches', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'This is dangerous' } },
      ],
    });
    const results = evaluateNoneOf(trace, [
      { output_contains: 'dangerous' },
    ]);
    expect(results.some(r => !r.passed)).toBe(true);
  });
});

// ========== MergeTraces Edge Cases ==========

describe('MergeTraces - Edge Cases', () => {
  it('should merge empty array of traces', () => {
    const merged = mergeTraces([]);
    expect(merged.steps).toHaveLength(0);
  });

  it('should merge single trace, preserving steps', () => {
    const trace = makeTrace({
      steps: [
        { type: 'llm_call', timestamp: '2026-01-01T00:00:00Z', data: { model: 'gpt-4' } },
      ],
    });
    const merged = mergeTraces([{ trace, name: 'agent-1' }]);
    expect(merged.steps).toHaveLength(1);
    expect(merged.agents).toContain('agent-1');
  });

  it('should merge multiple traces preserving all steps', () => {
    const t1 = makeTrace({
      id: 't1',
      steps: [
        { type: 'llm_call', timestamp: '2026-01-01T00:00:00Z', data: {} },
      ],
    });
    const t2 = makeTrace({
      id: 't2',
      steps: [
        { type: 'tool_call', timestamp: '2026-01-01T00:00:01Z', data: { tool_name: 'search' } },
      ],
    });
    const merged = mergeTraces([{ trace: t1, name: 'a' }, { trace: t2, name: 'b' }]);
    expect(merged.steps.length).toBe(2);
    expect(merged.agents).toContain('a');
    expect(merged.agents).toContain('b');
  });

  it('should sort merged steps by timestamp', () => {
    const t1 = makeTrace({
      steps: [{ type: 'llm_call', timestamp: '2026-01-01T00:00:05Z', data: {} }],
    });
    const t2 = makeTrace({
      steps: [{ type: 'tool_call', timestamp: '2026-01-01T00:00:01Z', data: { tool_name: 'search' } }],
    });
    const merged = mergeTraces([{ trace: t1, name: 'a' }, { trace: t2, name: 'b' }]);
    expect(merged.steps[0].agent_name).toBe('b');
    expect(merged.steps[1].agent_name).toBe('a');
  });
});

// ========== Converters Edge Cases ==========

describe('Converters - Edge Cases', () => {
  it('should detect agentprobe format', () => {
    expect(detectFormat({
      id: 'test',
      timestamp: '2026-01-01',
      steps: [],
      metadata: {},
    })).toBe('agentprobe');
  });

  it('should detect langsmith format', () => {
    expect(detectFormat({ runs: [] })).toBe('langsmith');
  });

  it('should detect opentelemetry format', () => {
    expect(detectFormat({ resourceSpans: [] })).toBe('opentelemetry');
  });

  it('should list at least 6 formats', () => {
    const formats = listFormats();
    expect(formats.length).toBeGreaterThanOrEqual(6);
    expect(formats).toContain('agentprobe');
    expect(formats).toContain('crewai');
    expect(formats).toContain('autogen');
  });
});

// ========== Templates Edge Cases ==========

describe('Templates - Edge Cases', () => {
  it('should list more than 10 templates', () => {
    expect(listTemplates().length).toBeGreaterThan(10);
  });

  it('should return false for nonexistent template', () => {
    expect(isTemplate('definitely_not_a_template')).toBe(false);
  });

  it('should expand security_scan template', () => {
    const expanded = expandTemplate('security_scan');
    expect(expanded.tool_not_called).toBeDefined();
  });

  it('should expand all registered templates without error', () => {
    const templates = listTemplates();
    for (const t of templates) {
      expect(() => expandTemplate(t.name)).not.toThrow();
    }
  });
});

// ========== Codegen Edge Cases ==========

describe('Codegen - Edge Cases', () => {
  it('should generate tests for a trace', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: { q: 'test' } } },
        { type: 'output', timestamp: '', data: { content: 'Result found' } },
      ],
    });
    const tests = generateTests(trace, 'trace.json');
    expect(tests.length).toBeGreaterThan(0);
  });

  it('should handle empty trace', () => {
    const trace = makeTrace({ steps: [] });
    const tests = generateTests(trace, 'empty.json');
    // May generate 0 or some default tests
    expect(Array.isArray(tests)).toBe(true);
  });
});

// ========== Anonymize Edge Cases ==========

describe('Anonymize - Edge Cases', () => {
  it('should handle empty trace', () => {
    const trace = makeTrace({ steps: [] });
    const anon = anonymizeTrace(trace);
    expect(anon.steps).toHaveLength(0);
    expect(anon.id).toBeDefined();
  });

  it('should anonymize email addresses in output', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'Contact john@example.com for info' } },
      ],
    });
    const anon = anonymizeTrace(trace);
    const output = anon.steps[0].data.content ?? '';
    expect(output).not.toContain('john@example.com');
  });

  it('should be consistent on same trace', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'No PII here' } },
      ],
    });
    const anon1 = anonymizeTrace(trace);
    const anon2 = anonymizeTrace(trace);
    expect(anon1.steps[0].data.content).toEqual(anon2.steps[0].data.content);
  });

  it('should handle trace with tool calls containing PII', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'send_email', tool_args: { to: 'jane@corp.com', body: 'Hello' } } },
      ],
    });
    const anon = anonymizeTrace(trace);
    // The tool name should be preserved, but PII in args should be anonymized
    expect(anon.steps[0].data.tool_name).toBe('send_email');
  });
});

// ========== Stress Tests ==========

describe('Stress Tests', () => {
  it('should handle trace with 500 steps', () => {
    const steps = Array.from({ length: 500 }, (_, i) => ({
      type: (i % 3 === 0 ? 'llm_call' : i % 3 === 1 ? 'tool_call' : 'output') as any,
      timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
      data: i % 3 === 1 ? { tool_name: `tool_${i % 10}` } : { content: `output_${i}` },
      duration_ms: i,
    }));
    const trace = makeTrace({ steps });

    const results = evaluate(trace, { max_steps: 600 });
    expect(results.every(r => r.passed)).toBe(true);

    const results2 = evaluate(trace, { max_steps: 100 });
    expect(results2.some(r => !r.passed)).toBe(true);
  });

  it('should evaluate 100 different expectations quickly', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search' } },
        { type: 'output', timestamp: '', data: { content: 'result data here' } },
      ],
    });

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      evaluate(trace, { output_contains: 'result', max_steps: 10 });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500); // should be well under 500ms
  });

  it('should merge 50 traces without issues', () => {
    const traces = Array.from({ length: 50 }, (_, i) => ({
      trace: makeTrace({
        id: `trace-${i}`,
        steps: [
          { type: 'llm_call' as const, timestamp: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`, data: {} },
        ],
      }),
      name: `agent-${i}`,
    }));
    const merged = mergeTraces(traces);
    expect(merged.steps.length).toBe(50);
    expect(merged.agents.length).toBe(50);
  });

  it('should anonymize large trace quickly', () => {
    const steps = Array.from({ length: 200 }, (_, i) => ({
      type: 'output' as const,
      timestamp: '',
      data: { content: `User john.doe${i}@example.com called at 555-${String(i).padStart(4, '0')}` },
    }));
    const trace = makeTrace({ steps });

    const start = performance.now();
    const anon = anonymizeTrace(trace);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(anon.steps).toHaveLength(200);
  });
});
