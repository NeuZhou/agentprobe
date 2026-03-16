import { describe, it, expect } from 'vitest';
import { generateTests, formatGeneratedTests } from '../src/codegen';
import type { AgentTrace } from '../src/types';

function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'test-trace',
    timestamp: new Date().toISOString(),
    steps: [],
    metadata: { input: 'test input' },
    ...overrides,
  };
}

describe('codegen', () => {
  it('generates tool_called test from trace with tool calls', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: { q: 'hello' } }, duration_ms: 10 },
        { type: 'output', timestamp: '', data: { content: 'The result is here for you to see clearly' }, duration_ms: 5 },
      ],
    });

    const tests = generateTests(trace, 'traces/test.json');
    expect(tests.length).toBeGreaterThanOrEqual(1);

    const toolTest = tests.find(t => t.name.includes('search'));
    expect(toolTest).toBeDefined();
    expect(toolTest!.expect.tool_called).toBe('search');
    expect(toolTest!.expect.max_steps).toBeGreaterThan(0);
  });

  it('generates output_contains test from output steps', () => {
    const trace = makeTrace({
      steps: [
        { type: 'output', timestamp: '', data: { content: 'The weather in Tokyo is sunny and warm today' }, duration_ms: 5 },
      ],
    });

    const tests = generateTests(trace, 'traces/test.json');
    const outputTest = tests.find(t => t.name.includes('output'));
    expect(outputTest).toBeDefined();
    expect(outputTest!.expect.output_contains).toBeDefined();
  });

  it('generates tool_sequence test for multiple tool calls', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search' }, duration_ms: 10 },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'write_file' }, duration_ms: 10 },
      ],
    });

    const tests = generateTests(trace, 'traces/test.json');
    const seqTest = tests.find(t => t.name.includes('sequence'));
    expect(seqTest).toBeDefined();
    expect(seqTest!.expect.tool_sequence).toEqual(['search', 'write_file']);
  });

  it('generates basic test for trace with no interesting behavior', () => {
    const trace = makeTrace({ steps: [] });
    const tests = generateTests(trace, 'traces/empty.json');
    expect(tests.length).toBe(1);
    expect(tests[0].expect.max_steps).toBeGreaterThan(0);
  });

  it('formatGeneratedTests produces valid YAML with TODO comments', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search' }, duration_ms: 10 },
        { type: 'output', timestamp: '', data: { content: 'Result found successfully in the database' }, duration_ms: 5 },
      ],
    });
    const tests = generateTests(trace, 'traces/test.json');
    const yaml = formatGeneratedTests(tests, 'test.json');
    expect(yaml).toContain('TODO');
    expect(yaml).toContain('name:');
  });
});
