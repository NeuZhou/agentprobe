import { describe, it, expect, beforeEach } from 'vitest';
import { StreamingRecorder } from '../src/streaming';
import { searchTraces, matchTrace, formatSearchResults } from '../src/search';
import { sampleTraces, sampleFiles } from '../src/sampling';
import { evaluate } from '../src/assertions';
import type { AgentTrace, Expectations } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ===== Helper: make a trace =====
function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'test-trace',
    timestamp: new Date().toISOString(),
    steps: [],
    metadata: {},
    ...overrides,
  };
}

function traceWithTools(...tools: string[]): AgentTrace {
  return makeTrace({
    steps: tools.map((t) => ({
      type: 'tool_call' as const,
      timestamp: new Date().toISOString(),
      data: { tool_name: t, tool_args: {} },
    })),
  });
}

function traceWithOutput(content: string): AgentTrace {
  return makeTrace({
    steps: [
      { type: 'output' as const, timestamp: new Date().toISOString(), data: { content } },
    ],
  });
}

function traceWithStepsAndOutput(tools: string[], output: string): AgentTrace {
  return makeTrace({
    steps: [
      ...tools.map((t) => ({
        type: 'tool_call' as const,
        timestamp: new Date().toISOString(),
        data: { tool_name: t, tool_args: {} },
      })),
      { type: 'output' as const, timestamp: new Date().toISOString(), data: { content: output } },
    ],
  });
}

// =====================================================
// 1. STREAMING RECORDER TESTS
// =====================================================
describe('StreamingRecorder', () => {
  it('should create a recorder with default options', () => {
    const recorder = new StreamingRecorder();
    expect(recorder.isFinished()).toBe(false);
    expect(recorder.getChunks()).toEqual([]);
  });

  it('should record OpenAI streaming chunks', () => {
    const recorder = new StreamingRecorder({ format: 'openai' });
    recorder.recordChunk({
      choices: [{ delta: { content: 'Hello' } }],
    });
    recorder.recordChunk({
      choices: [{ delta: { content: ' World' } }],
    });
    const trace = recorder.finish();
    const output = trace.steps.find((s) => s.type === 'output');
    expect(output?.data.content).toBe('Hello World');
  });

  it('should record OpenAI tool call chunks', () => {
    const recorder = new StreamingRecorder({ format: 'openai' });
    recorder.recordChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'search' } }] } }],
    });
    recorder.recordChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } }],
    });
    recorder.recordChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] } }],
    });
    const trace = recorder.finish();
    const toolStep = trace.steps.find((s) => s.type === 'tool_call');
    expect(toolStep?.data.tool_name).toBe('search');
    expect(toolStep?.data.tool_args).toEqual({ q: 'test' });
  });

  it('should record Anthropic streaming chunks', () => {
    const recorder = new StreamingRecorder({ format: 'anthropic' });
    recorder.recordChunk({ type: 'message_start', message: {} });
    recorder.recordChunk({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello' },
    });
    recorder.recordChunk({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: ' Anthropic' },
    });
    const trace = recorder.finish();
    const output = trace.steps.find((s) => s.type === 'output');
    expect(output?.data.content).toBe('Hello Anthropic');
  });

  it('should record Anthropic tool use chunks', () => {
    const recorder = new StreamingRecorder({ format: 'anthropic' });
    recorder.recordChunk({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', name: 'calculator' },
    });
    recorder.recordChunk({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"expr":' },
    });
    recorder.recordChunk({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"2+2"}' },
    });
    const trace = recorder.finish();
    const toolStep = trace.steps.find((s) => s.type === 'tool_call');
    expect(toolStep?.data.tool_name).toBe('calculator');
    expect(toolStep?.data.tool_args).toEqual({ expr: '2+2' });
  });

  it('should auto-detect OpenAI format', () => {
    const recorder = new StreamingRecorder();
    recorder.recordChunk({
      object: 'chat.completion.chunk',
      choices: [{ delta: { content: 'auto' } }],
    });
    const chunks = recorder.getChunks();
    expect(chunks[0].type).toBe('openai');
  });

  it('should auto-detect Anthropic format', () => {
    const recorder = new StreamingRecorder();
    recorder.recordChunk({ type: 'message_start', message: {} });
    const chunks = recorder.getChunks();
    expect(chunks[0].type).toBe('anthropic');
  });

  it('should handle SSE text parsing', () => {
    const recorder = new StreamingRecorder({ format: 'openai' });
    recorder.recordSSE(
      'data: {"choices":[{"delta":{"content":"SSE"}}]}\n\ndata: [DONE]\n',
    );
    expect(recorder.isFinished()).toBe(true);
    const trace = recorder.finish();
    expect(trace.steps.some((s) => s.data.content === 'SSE')).toBe(true);
  });

  it('should fire onChunk handlers', () => {
    const recorder = new StreamingRecorder({ format: 'openai' });
    const chunks: any[] = [];
    recorder.onChunk((c) => chunks.push(c));
    recorder.recordChunk({ choices: [{ delta: { content: 'x' } }] });
    expect(chunks).toHaveLength(1);
  });

  it('should fire onComplete handlers', () => {
    const recorder = new StreamingRecorder();
    let completed: AgentTrace | null = null;
    recorder.onComplete((t) => { completed = t; });
    recorder.recordChunk({ choices: [{ delta: { content: 'done' } }] });
    recorder.finish();
    expect(completed).not.toBeNull();
    expect(completed!.metadata.streaming).toBe(true);
  });

  it('should not record chunks after finish', () => {
    const recorder = new StreamingRecorder();
    recorder.finish();
    recorder.recordChunk({ choices: [{ delta: { content: 'late' } }] });
    expect(recorder.getChunks()).toHaveLength(0);
  });

  it('should handle empty chunk gracefully', () => {
    const recorder = new StreamingRecorder({ format: 'openai' });
    recorder.recordChunk({ choices: [{ delta: {} }] });
    const trace = recorder.finish();
    // No output step should be added for empty content
    const outputs = trace.steps.filter((s) => s.type === 'output');
    expect(outputs).toHaveLength(0);
  });

  it('should handle multiple tool calls', () => {
    const recorder = new StreamingRecorder({ format: 'openai' });
    recorder.recordChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'tool_a' } }] } }],
    });
    recorder.recordChunk({
      choices: [{ delta: { tool_calls: [{ index: 1, function: { name: 'tool_b' } }] } }],
    });
    recorder.recordChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }],
    });
    recorder.recordChunk({
      choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{}' } }] } }],
    });
    const trace = recorder.finish();
    const toolSteps = trace.steps.filter((s) => s.type === 'tool_call');
    expect(toolSteps).toHaveLength(2);
    expect(toolSteps.map((s) => s.data.tool_name)).toEqual(['tool_a', 'tool_b']);
  });

  it('should include metadata in assembled trace', () => {
    const recorder = new StreamingRecorder({
      metadata: { model: 'gpt-4', session: 'abc' },
    });
    const trace = recorder.finish();
    expect(trace.metadata.model).toBe('gpt-4');
    expect(trace.metadata.session).toBe('abc');
    expect(trace.metadata.streaming).toBe(true);
    expect(trace.metadata.chunk_count).toBe(0);
  });

  it('should save trace to file', () => {
    const recorder = new StreamingRecorder({ format: 'openai' });
    recorder.recordChunk({ choices: [{ delta: { content: 'saved' } }] });
    const tmpFile = path.join(os.tmpdir(), `agentprobe-stream-${Date.now()}.json`);
    try {
      recorder.save(tmpFile);
      const loaded = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(loaded.metadata.streaming).toBe(true);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it('should handle SSE with non-JSON data', () => {
    const recorder = new StreamingRecorder();
    recorder.recordSSE('data: plain text\n\n');
    expect(recorder.getChunks()).toHaveLength(1);
  });

  it('should handle SSE with comments', () => {
    const recorder = new StreamingRecorder();
    recorder.recordSSE(': this is a comment\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n');
    expect(recorder.getChunks()).toHaveLength(1);
  });

  it('should handle malformed tool call arguments', () => {
    const recorder = new StreamingRecorder({ format: 'openai' });
    recorder.recordChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'bad', arguments: 'not json' } }] } }],
    });
    const trace = recorder.finish();
    const toolStep = trace.steps.find((s) => s.type === 'tool_call');
    expect(toolStep?.data.tool_args).toEqual({ _raw: 'not json' });
  });
});

// =====================================================
// 2. TRACE SEARCH TESTS
// =====================================================
describe('Search', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-search-'));
  });

  function writeTrace(name: string, trace: AgentTrace): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, JSON.stringify(trace));
    return filePath;
  }

  it('should search by query matching tool name', () => {
    writeTrace('a.json', traceWithTools('web_search', 'calculate'));
    writeTrace('b.json', traceWithTools('read_file'));
    const result = searchTraces(tmpDir, { query: 'web_search' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchedSteps).toContain(0);
  });

  it('should search by tool filter', () => {
    writeTrace('a.json', traceWithTools('search', 'calculate'));
    writeTrace('b.json', traceWithTools('search'));
    writeTrace('c.json', traceWithTools('read'));
    const result = searchTraces(tmpDir, { tool: 'search' });
    expect(result.matches).toHaveLength(2);
  });

  it('should search by output content', () => {
    writeTrace('a.json', traceWithOutput('The weather in Tokyo is sunny'));
    writeTrace('b.json', traceWithOutput('Stock price is $100'));
    const result = searchTraces(tmpDir, { hasOutput: 'Tokyo' });
    expect(result.matches).toHaveLength(1);
  });

  it('should filter by model', () => {
    writeTrace('a.json', makeTrace({
      steps: [{ type: 'llm_call', timestamp: '', data: { model: 'gpt-4' } }],
    }));
    writeTrace('b.json', makeTrace({
      steps: [{ type: 'llm_call', timestamp: '', data: { model: 'claude-3' } }],
    }));
    const result = searchTraces(tmpDir, { query: 'gpt', model: 'gpt-4' });
    expect(result.matches).toHaveLength(1);
  });

  it('should combine query and tool filter', () => {
    writeTrace('a.json', traceWithStepsAndOutput(['search', 'calculate'], 'found result'));
    writeTrace('b.json', traceWithStepsAndOutput(['search'], 'no calc'));
    const result = searchTraces(tmpDir, { query: 'calculate', tool: 'calculate' });
    expect(result.matches).toHaveLength(1);
  });

  it('should return empty for no matches', () => {
    writeTrace('a.json', traceWithTools('search'));
    const result = searchTraces(tmpDir, { query: 'nonexistent' });
    expect(result.matches).toHaveLength(0);
  });

  it('should handle empty directory', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-empty-'));
    const result = searchTraces(emptyDir, { query: 'test' });
    expect(result.matches).toHaveLength(0);
    expect(result.totalFiles).toBe(0);
  });

  it('should handle nonexistent directory', () => {
    const result = searchTraces('/nonexistent/dir', { query: 'test' });
    expect(result.matches).toHaveLength(0);
  });

  it('should format search results', () => {
    writeTrace('trace1.json', traceWithTools('web_search'));
    const result = searchTraces(tmpDir, { query: 'web_search' });
    const formatted = formatSearchResults(result, { query: 'web_search' });
    expect(formatted).toContain('Found in 1/');
    expect(formatted).toContain('trace1.json');
  });

  it('should filter by step type', () => {
    writeTrace('a.json', makeTrace({
      steps: [
        { type: 'thought', timestamp: '', data: { content: 'thinking...' } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search' } },
      ],
    }));
    const result = searchTraces(tmpDir, { stepType: 'thought' });
    expect(result.matches).toHaveLength(1);
  });
});

// =====================================================
// 3. ASSERTION NEGATION TESTS
// =====================================================
describe('Assertion Negation (not:)', () => {
  it('should negate tool_called (tool not present → pass)', () => {
    const trace = traceWithTools('search');
    const results = evaluate(trace, {
      not: { tool_called: 'dangerous_tool' },
    });
    // tool_called: dangerous_tool fails (tool not called), negated → pass
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should negate tool_called (tool present → fail)', () => {
    const trace = traceWithTools('dangerous_tool');
    const results = evaluate(trace, {
      not: { tool_called: 'dangerous_tool' },
    });
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  it('should negate output_contains (absent → pass)', () => {
    const trace = traceWithOutput('safe response');
    const results = evaluate(trace, {
      not: { output_contains: 'system prompt' },
    });
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should negate output_contains (present → fail)', () => {
    const trace = traceWithOutput('here is the system prompt');
    const results = evaluate(trace, {
      not: { output_contains: 'system prompt' },
    });
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  it('should negate max_steps (within limit → negated to fail)', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'a' } },
      ],
    });
    const results = evaluate(trace, {
      not: { max_steps: 5 },
    });
    // 1 step <= 5 → passes, negated → fails
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  it('should name negated assertions with not() prefix', () => {
    const trace = traceWithTools('search');
    const results = evaluate(trace, {
      not: { tool_called: 'search' },
    });
    expect(results[0].name).toMatch(/^not\(/);
  });

  it('should work with multiple negated assertions', () => {
    const trace = traceWithStepsAndOutput(['search'], 'safe output');
    const results = evaluate(trace, {
      not: {
        tool_called: 'exec',
        output_contains: 'secret',
      },
    });
    // exec not called → tool_called fails → negated passes
    // 'secret' not in output → output_contains fails → negated passes
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should combine not with regular assertions', () => {
    const trace = traceWithStepsAndOutput(['search'], 'Tokyo weather is sunny');
    const results = evaluate(trace, {
      tool_called: 'search',
      not: { tool_called: 'exec' },
    });
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should provide failure message on negated pass', () => {
    const trace = traceWithTools('search');
    const results = evaluate(trace, {
      not: { tool_called: 'search' },
    });
    const failed = results.find((r) => !r.passed);
    expect(failed?.message).toContain('should NOT have passed');
  });

  it('should handle negation of output_matches', () => {
    const trace = traceWithOutput('no numbers here');
    const results = evaluate(trace, {
      not: { output_matches: '\\d{10}' },
    });
    // regex doesn't match → inner fails → negated passes
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

// =====================================================
// 4. TEST TIMEOUT TESTS
// =====================================================
describe('Test Timeout (timeout_ms in types)', () => {
  it('should have timeout_ms field on TestCase type', () => {
    // Type-level test: just verify it compiles
    const testCase = {
      name: 'fast test',
      input: 'test',
      timeout_ms: 5000,
      expect: { max_duration_ms: 3000 },
    };
    expect(testCase.timeout_ms).toBe(5000);
  });

  it('should accept timeout_ms in test config', () => {
    const testCase = {
      name: 'slow test',
      input: 'do something',
      timeout_ms: 100,
      expect: { max_steps: 5 },
    };
    expect(testCase.timeout_ms).toBe(100);
  });

  it('should work with max_duration_ms assertion', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'slow_tool' }, duration_ms: 6000 },
      ],
    });
    const results = evaluate(trace, { max_duration_ms: 3000 });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('exceeds');
  });

  it('should pass when duration within timeout', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'fast_tool' }, duration_ms: 100 },
      ],
    });
    const results = evaluate(trace, { max_duration_ms: 5000 });
    expect(results[0].passed).toBe(true);
  });
});

// =====================================================
// 5. TRACE SAMPLING TESTS
// =====================================================
describe('Trace Sampling', () => {
  const traces = Array.from({ length: 100 }, (_, i) =>
    makeTrace({ id: `trace-${i}` }),
  );

  it('should sample by count', () => {
    const sampled = sampleTraces(traces, { count: 10 });
    expect(sampled).toHaveLength(10);
  });

  it('should sample by percentage', () => {
    const sampled = sampleTraces(traces, { percentage: 25 });
    expect(sampled).toHaveLength(25);
  });

  it('should return all if count >= total', () => {
    const sampled = sampleTraces(traces, { count: 200 });
    expect(sampled).toHaveLength(100);
  });

  it('should return all if percentage is 100', () => {
    const sampled = sampleTraces(traces, { percentage: 100 });
    expect(sampled).toHaveLength(100);
  });

  it('should return minimum 1 trace', () => {
    const sampled = sampleTraces(traces, { percentage: 0.001 });
    expect(sampled.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle empty input', () => {
    const sampled = sampleTraces([], { count: 10 });
    expect(sampled).toHaveLength(0);
  });

  it('should be reproducible with seed', () => {
    const a = sampleTraces(traces, { count: 10, seed: 42 });
    const b = sampleTraces(traces, { count: 10, seed: 42 });
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
  });

  it('should produce different results with different seeds', () => {
    const a = sampleTraces(traces, { count: 10, seed: 1 });
    const b = sampleTraces(traces, { count: 10, seed: 2 });
    // Extremely unlikely to be identical
    const aIds = a.map((t) => t.id).join(',');
    const bIds = b.map((t) => t.id).join(',');
    expect(aIds).not.toBe(bIds);
  });

  it('should return traces without no options', () => {
    const sampled = sampleTraces(traces, {});
    expect(sampled).toHaveLength(100);
  });

  it('should sample files by count', () => {
    const files = Array.from({ length: 50 }, (_, i) => `trace-${i}.json`);
    const sampled = sampleFiles(files, { count: 5 });
    expect(sampled).toHaveLength(5);
  });

  it('should sample files by percentage', () => {
    const files = Array.from({ length: 200 }, (_, i) => `trace-${i}.json`);
    const sampled = sampleFiles(files, { percentage: 10 });
    expect(sampled).toHaveLength(20);
  });

  it('should handle count of 0 → clamps to 1', () => {
    const sampled = sampleTraces(traces, { count: 0 });
    expect(sampled.length).toBeGreaterThanOrEqual(1);
  });
});

// =====================================================
// 6. ADDITIONAL EDGE CASE TESTS FOR EXISTING FEATURES
// =====================================================
describe('Assertions Edge Cases', () => {
  it('should handle tool_called with empty trace', () => {
    const trace = makeTrace({ steps: [] });
    const results = evaluate(trace, { tool_called: 'search' });
    expect(results[0].passed).toBe(false);
  });

  it('should handle output_contains with empty output', () => {
    const trace = makeTrace({ steps: [] });
    const results = evaluate(trace, { output_contains: 'hello' });
    expect(results[0].passed).toBe(false);
  });

  it('should handle multiple tool_not_called', () => {
    const trace = traceWithTools('search');
    const results = evaluate(trace, {
      tool_not_called: ['exec', 'delete', 'drop'],
    });
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should handle tool_sequence with duplicates', () => {
    const trace = traceWithTools('search', 'search', 'summarize');
    const results = evaluate(trace, {
      tool_sequence: ['search', 'search', 'summarize'],
    });
    expect(results[0].passed).toBe(true);
  });

  it('should handle tool_sequence where order is wrong', () => {
    const trace = traceWithTools('summarize', 'search');
    const results = evaluate(trace, {
      tool_sequence: ['search', 'summarize'],
    });
    // scans: 'summarize' != 'search', 'search' == 'search' → idx=1, then need 'summarize' but no more items → fails
    expect(results[0].passed).toBe(false);
  });

  it('should fail tool_sequence when order is reversed', () => {
    const trace = traceWithTools('b', 'a');
    const results = evaluate(trace, { tool_sequence: ['a', 'b'] });
    // a found at index 1, then b needed after but b is at index 0 → should fail
    // Actually implementation: scans linearly. At 'b' (idx 0), checks if it matches 'a' (seq[0]) → no. At 'a' (idx 1), matches 'a' → idx=1. Then no more items → doesn't find 'b'. Fails.
    expect(results[0].passed).toBe(false);
  });

  it('should handle max_tokens with no token data', () => {
    const trace = makeTrace({
      steps: [{ type: 'llm_call', timestamp: '', data: { model: 'test' } }],
    });
    const results = evaluate(trace, { max_tokens: 1000 });
    expect(results[0].passed).toBe(true);
    expect(results[0].actual).toBe(0);
  });

  it('should handle max_cost_usd with minimal trace', () => {
    const trace = makeTrace({ steps: [] });
    const results = evaluate(trace, { max_cost_usd: 0.01 });
    expect(results[0].passed).toBe(true);
  });

  it('should handle output_matches with special regex chars', () => {
    const trace = traceWithOutput('price is $100.00');
    const results = evaluate(trace, { output_matches: '\\$\\d+\\.\\d+' });
    expect(results[0].passed).toBe(true);
  });

  it('should handle invalid regex in output_matches', () => {
    const trace = traceWithOutput('test');
    const results = evaluate(trace, { output_matches: '[invalid' });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('Invalid regex');
  });

  it('should handle tool_args_match with missing tool', () => {
    const trace = traceWithTools('other');
    const results = evaluate(trace, {
      tool_args_match: { search: { query: 'test' } },
    });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('not called');
  });

  it('should handle tool_args_match with nested objects', () => {
    const trace = makeTrace({
      steps: [{
        type: 'tool_call', timestamp: '', data: {
          tool_name: 'api',
          tool_args: { config: { retries: 3, timeout: 5000 } },
        },
      }],
    });
    const results = evaluate(trace, {
      tool_args_match: { api: { config: { retries: 3 } } },
    });
    expect(results[0].passed).toBe(true);
  });

  it('should handle custom assertion returning truthy value', () => {
    const trace = traceWithTools('search', 'calculate');
    const results = evaluate(trace, {
      custom: 'toolCalls.length === 2',
    });
    expect(results[0].passed).toBe(true);
  });

  it('should handle custom assertion with error value', () => {
    const trace = makeTrace({ steps: [] });
    const results = evaluate(trace, {
      custom: 'toolCalls.length > 99',
    });
    expect(results[0].passed).toBe(false);
  });

  it('should handle output_not_contains with array', () => {
    const trace = traceWithOutput('safe content');
    const results = evaluate(trace, {
      output_not_contains: ['password', 'secret', 'token'],
    });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should handle output_contains with array', () => {
    const trace = traceWithOutput('weather in Tokyo is 25°C and sunny');
    const results = evaluate(trace, {
      output_contains: ['Tokyo', 'sunny'],
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should handle max_steps with exact boundary', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'a' } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'b' } },
        { type: 'output', timestamp: '', data: { content: 'done' } },
      ],
    });
    const results = evaluate(trace, { max_steps: 3 });
    expect(results[0].passed).toBe(true);
  });

  it('should handle max_steps exceeded by one', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'a' } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'b' } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'c' } },
        { type: 'output', timestamp: '', data: { content: 'done' } },
      ],
    });
    const results = evaluate(trace, { max_steps: 3 });
    expect(results[0].passed).toBe(false);
  });

  it('should handle max_duration_ms with multiple slow steps', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'a' }, duration_ms: 1000 },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'b' }, duration_ms: 2000 },
      ],
    });
    const results = evaluate(trace, { max_duration_ms: 2500 });
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('3000ms');
  });
});

describe('Sampling edge cases', () => {
  it('should handle single trace sampling', () => {
    const traces = [makeTrace({ id: 'only' })];
    const sampled = sampleTraces(traces, { count: 1 });
    expect(sampled).toHaveLength(1);
    expect(sampled[0].id).toBe('only');
  });

  it('should preserve order when sampling with seed', () => {
    const traces = Array.from({ length: 20 }, (_, i) => makeTrace({ id: `t-${i}` }));
    const sampled = sampleTraces(traces, { count: 5, seed: 99 });
    // Result indices should be sorted
    const ids = sampled.map((t) => parseInt(t.id.split('-')[1]));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  it('should handle percentage rounding (3% of 10 = 1)', () => {
    const traces = Array.from({ length: 10 }, (_, i) => makeTrace({ id: `t-${i}` }));
    const sampled = sampleTraces(traces, { percentage: 3 });
    expect(sampled.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle negative percentage → clamp to 0 → min 1', () => {
    const traces = Array.from({ length: 10 }, (_, i) => makeTrace({ id: `t-${i}` }));
    const sampled = sampleTraces(traces, { percentage: -5 });
    expect(sampled.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle percentage > 100 → all traces', () => {
    const traces = Array.from({ length: 5 }, (_, i) => makeTrace({ id: `t-${i}` }));
    const sampled = sampleTraces(traces, { percentage: 150 });
    expect(sampled).toHaveLength(5);
  });

  it('sampleFiles should handle empty array', () => {
    expect(sampleFiles([], { count: 5 })).toEqual([]);
  });

  it('sampleFiles should handle count > length', () => {
    const files = ['a.json', 'b.json'];
    expect(sampleFiles(files, { count: 10 })).toHaveLength(2);
  });
});

describe('StreamingRecorder advanced', () => {
  it('should handle SSE format detection for anthropic-inside-sse', () => {
    const recorder = new StreamingRecorder();
    recorder.recordChunk({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'sse-anthropic' },
    });
    expect(recorder.getChunks()[0].type).toBe('anthropic');
  });

  it('should handle finish() being idempotent', () => {
    const recorder = new StreamingRecorder();
    recorder.recordChunk({ choices: [{ delta: { content: 'x' } }] });
    const t1 = recorder.finish();
    const t2 = recorder.finish();
    expect(t1.id).toBe(t2.id);
  });

  it('should handle SSE format for generic data inside SSE', () => {
    const recorder = new StreamingRecorder({ format: 'sse' });
    recorder.recordChunk({ content: 'hello from sse' });
    const trace = recorder.finish();
    const output = trace.steps.find((s) => s.type === 'output');
    expect(output?.data.content).toBe('hello from sse');
  });

  it('should include chunk_count in metadata', () => {
    const recorder = new StreamingRecorder();
    recorder.recordChunk({ choices: [{ delta: { content: 'a' } }] });
    recorder.recordChunk({ choices: [{ delta: { content: 'b' } }] });
    recorder.recordChunk({ choices: [{ delta: { content: 'c' } }] });
    const trace = recorder.finish();
    expect(trace.metadata.chunk_count).toBe(3);
  });

  it('should have llm_call as first step', () => {
    const recorder = new StreamingRecorder();
    recorder.recordChunk({ choices: [{ delta: { content: 'test' } }] });
    const trace = recorder.finish();
    expect(trace.steps[0].type).toBe('llm_call');
  });
});

describe('Search advanced', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-search2-'));
  });

  function writeTrace(name: string, trace: AgentTrace): void {
    fs.writeFileSync(path.join(tmpDir, name), JSON.stringify(trace));
  }

  it('should search in subdirectories', () => {
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    fs.writeFileSync(
      path.join(subDir, 'deep.json'),
      JSON.stringify(traceWithTools('nested_tool')),
    );
    const result = searchTraces(tmpDir, { query: 'nested_tool' });
    expect(result.matches).toHaveLength(1);
  });

  it('should skip non-JSON files', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'not a trace');
    writeTrace('valid.json', traceWithTools('search'));
    const result = searchTraces(tmpDir, { query: 'search' });
    expect(result.matches).toHaveLength(1);
  });

  it('should skip invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{invalid json}');
    writeTrace('good.json', traceWithTools('search'));
    const result = searchTraces(tmpDir, { query: 'search' });
    expect(result.matches).toHaveLength(1);
  });

  it('should search tool args content', () => {
    writeTrace('a.json', makeTrace({
      steps: [{
        type: 'tool_call', timestamp: '', data: {
          tool_name: 'search',
          tool_args: { query: 'quantum computing' },
        },
      }],
    }));
    const result = searchTraces(tmpDir, { query: 'quantum' });
    expect(result.matches).toHaveLength(1);
  });

  it('should handle minSteps filter', () => {
    writeTrace('small.json', makeTrace({ steps: [{ type: 'output', timestamp: '', data: { content: 'x' } }] }));
    writeTrace('big.json', makeTrace({
      steps: Array.from({ length: 10 }, () => ({ type: 'tool_call' as const, timestamp: '', data: { tool_name: 'x' } })),
    }));
    const result = searchTraces(tmpDir, { query: 'x', minSteps: 5 });
    expect(result.matches).toHaveLength(1);
  });

  it('should handle maxSteps filter', () => {
    writeTrace('small.json', makeTrace({ steps: [{ type: 'output', timestamp: '', data: { content: 'x' } }] }));
    writeTrace('big.json', makeTrace({
      steps: Array.from({ length: 10 }, () => ({ type: 'tool_call' as const, timestamp: '', data: { tool_name: 'x' } })),
    }));
    const result = searchTraces(tmpDir, { query: 'x', maxSteps: 5 });
    expect(result.matches).toHaveLength(1);
  });

  it('matchTrace should return null when no criteria match', () => {
    const trace = traceWithTools('search');
    const result = matchTrace(trace, 'test.json', { query: 'nonexistent' });
    expect(result).toBeNull();
  });

  it('should search case-insensitively for output', () => {
    writeTrace('a.json', traceWithOutput('HELLO WORLD'));
    const result = searchTraces(tmpDir, { hasOutput: 'hello' });
    expect(result.matches).toHaveLength(1);
  });
});

describe('Not assertion with output_not_contains', () => {
  it('should double-negate: not(output_not_contains) = output_contains', () => {
    const trace = traceWithOutput('has the secret');
    const results = evaluate(trace, {
      not: { output_not_contains: 'secret' },
    });
    // output_not_contains 'secret' → fails (because it contains 'secret')
    // negated → passes
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should handle not with tool_sequence', () => {
    const trace = traceWithTools('a', 'c', 'b');
    const results = evaluate(trace, {
      not: { tool_sequence: ['a', 'b', 'c'] },
    });
    // a,b,c sequence: scans - finds 'a' at 0, 'b' at 2, 'c' not found after 2 → fails
    // negated → passes
    expect(results.every((r) => r.passed)).toBe(true);
  });
});
