import { describe, it, expect } from 'vitest';
import { replayTrace } from '../src/replay';
import { expandTemplate, listTemplates, registerTemplate } from '../src/templates';
import { evaluateOrchestration } from '../src/orchestration';
import { recordGolden, verifyGolden } from '../src/golden';
import { formatTraceTimeline } from '../src/viewer';
import { evaluate } from '../src/assertions';
import type { AgentTrace } from '../src/types';

function makeTrace(steps: any[] = []): AgentTrace {
  return {
    id: 'test-trace',
    timestamp: new Date().toISOString(),
    steps: steps.map((s) => ({
      type: s.type ?? 'tool_call',
      timestamp: new Date().toISOString(),
      data: s.data ?? {},
      duration_ms: s.duration_ms ?? 100,
    })),
    metadata: {},
  };
}

describe('Assertion Explanations', () => {
  it('provides detailed explanation for tool_sequence failure', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search' } },
      { type: 'tool_call', data: { tool_name: 'save' } },
      { type: 'tool_call', data: { tool_name: 'calculate' } },
    ]);
    const results = evaluate(trace, { tool_sequence: ['search', 'calculate', 'save'] });
    const seq = results.find((r) => r.name.includes('tool_sequence'))!;
    expect(seq.passed).toBe(false);
    expect(seq.message).toContain('Expected:');
    expect(seq.message).toContain('Actual:');
    expect(seq.message).toContain('Suggestion:');
  });

  it('provides detailed explanation for max_steps failure', () => {
    const trace = makeTrace(Array(15).fill({ type: 'tool_call', data: { tool_name: 'x' } }));
    const results = evaluate(trace, { max_steps: 10 });
    const r = results.find((r) => r.name.includes('max_steps'))!;
    expect(r.passed).toBe(false);
    expect(r.message).toContain('15 steps');
    expect(r.message).toContain('Suggestion');
  });

  it('provides detailed explanation for max_tokens failure', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { tokens: { input: 5000, output: 3000 } } },
    ]);
    const results = evaluate(trace, { max_tokens: 4000 });
    const r = results.find((r) => r.name.includes('max_tokens'))!;
    expect(r.passed).toBe(false);
    expect(r.message).toContain('Input tokens: 5000');
    expect(r.message).toContain('Output tokens: 3000');
  });
});

describe('Trace Replay', () => {
  it('overrides tool results', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'web_search', tool_args: { q: 'test' } } },
      { type: 'tool_result', data: { tool_result: { results: ['a', 'b'] } } },
      { type: 'output', data: { content: 'Found results' } },
    ]);
    const result = replayTrace({
      trace,
      overrides: { web_search: { return: { results: [] } } },
    });
    expect(result.modifications.length).toBeGreaterThan(0);
    expect(result.trace.id).toContain('replay-');
    const resultStep = result.trace.steps.find((s) => s.type === 'tool_result');
    expect(resultStep?.data.tool_result).toEqual({ results: [] });
  });

  it('injects errors', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'api' } },
      { type: 'tool_result', data: { tool_result: 'ok' } },
    ]);
    const result = replayTrace({
      trace,
      overrides: { api: { error: 'timeout' } },
    });
    const resultStep = result.trace.steps.find((s) => s.type === 'tool_result');
    expect(resultStep?.data.tool_result).toEqual({ error: 'timeout' });
  });

  it('drops steps', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search' } },
      { type: 'tool_result', data: { tool_result: 'x' } },
      { type: 'output', data: { content: 'done' } },
    ]);
    const result = replayTrace({
      trace,
      overrides: { search: { drop: true } },
    });
    expect(result.trace.steps).toHaveLength(1);
    expect(result.trace.steps[0].type).toBe('output');
  });
});

describe('Templates', () => {
  it('expands rag_pipeline template', () => {
    const expect_ = expandTemplate('rag_pipeline');
    expect(expect_.tool_sequence).toEqual(['embed', 'search', 'generate']);
    expect(expect_.max_cost_usd).toBeDefined();
  });

  it('expands safety_basic template', () => {
    const expect_ = expandTemplate('safety_basic');
    expect(expect_.tool_not_called).toContain('exec');
    expect(expect_.output_not_contains).toContain('system prompt');
  });

  it('allows custom params', () => {
    const expect_ = expandTemplate('rag_pipeline', {
      params: { max_steps: 50, sequence: ['fetch', 'process'] },
    });
    expect(expect_.tool_sequence).toEqual(['fetch', 'process']);
    expect(expect_.max_steps).toBe(50);
  });

  it('allows overrides', () => {
    const expect_ = expandTemplate('safety_basic', {
      overrides: { max_steps: 5 },
    });
    expect(expect_.max_steps).toBe(5);
    expect(expect_.tool_not_called).toContain('exec');
  });

  it('throws on unknown template', () => {
    expect(() => expandTemplate('nonexistent')).toThrow('Unknown template');
  });

  it('lists built-in templates', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(5);
    expect(templates.map((t) => t.name)).toContain('rag_pipeline');
  });

  it('supports custom templates', () => {
    registerTemplate('my_custom', {
      name: 'my_custom',
      description: 'test',
      expand: () => ({ max_steps: 3 }),
    });
    const expect_ = expandTemplate('my_custom');
    expect(expect_.max_steps).toBe(3);
  });
});

describe('Multi-Agent Orchestration', () => {
  it('checks delegated_to', () => {
    const agents = {
      orchestrator: makeTrace([
        { type: 'tool_call', data: { tool_name: 'delegate', tool_args: { agent: 'researcher' } } },
        { type: 'tool_call', data: { tool_name: 'delegate', tool_args: { agent: 'writer' } } },
      ]),
      researcher: makeTrace([{ type: 'output', data: { content: 'research done' } }]),
      writer: makeTrace([{ type: 'output', data: { content: 'writing done' } }]),
    };
    const results = evaluateOrchestration(agents, { delegated_to: ['researcher', 'writer'] }, 'orchestrator');
    const delegations = results.filter((r) => r.name.includes('delegated_to'));
    expect(delegations).toHaveLength(2);
    expect(delegations.every((d) => d.passed)).toBe(true);
  });

  it('checks all_agents_complete', () => {
    const agents = {
      a: makeTrace([{ type: 'output', data: { content: 'done' } }]),
      b: makeTrace([]),
    };
    const results = evaluateOrchestration(agents, { all_agents_complete: true });
    const r = results.find((r) => r.name === 'all_agents_complete')!;
    expect(r.passed).toBe(false);
    expect(r.message).toContain('b');
  });

  it('checks total_steps', () => {
    const agents = {
      a: makeTrace(Array(10).fill({ type: 'tool_call', data: {} })),
      b: makeTrace(Array(15).fill({ type: 'tool_call', data: {} })),
    };
    const results = evaluateOrchestration(agents, { total_steps: { max: 30 } });
    const r = results.find((r) => r.name.includes('total_steps'))!;
    expect(r.passed).toBe(true);
  });
});

describe('Golden Tests', () => {
  it('records and verifies golden snapshot', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4', tokens: { input: 100, output: 50 } } },
      { type: 'tool_call', data: { tool_name: 'search' } },
      { type: 'tool_result', data: { content: 'result' } },
      { type: 'output', data: { content: 'answer' } },
    ]);
    const golden = recordGolden(trace);
    expect(golden.tools_called).toEqual(['search']);
    expect(golden.total_tokens).toBe(150);
    expect(golden.total_steps).toBe(4);

    // Verify same trace passes
    const results = verifyGolden(trace, golden);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('detects tool drift', () => {
    const golden = recordGolden(
      makeTrace([{ type: 'tool_call', data: { tool_name: 'search' } }]),
    );
    const newTrace = makeTrace([{ type: 'tool_call', data: { tool_name: 'fetch' } }]);
    const results = verifyGolden(newTrace, golden, { exact_tools: true });
    const toolResult = results.find((r) => r.name.includes('tools_called'))!;
    expect(toolResult.passed).toBe(false);
    expect(toolResult.message).toContain('Missing: search');
    expect(toolResult.message).toContain('Unexpected: fetch');
  });
});

describe('Trace Timeline', () => {
  it('generates timeline visualization', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4' }, duration_ms: 500 },
      { type: 'tool_call', data: { tool_name: 'search' }, duration_ms: 300 },
      { type: 'tool_result', data: {}, duration_ms: 0 },
      { type: 'llm_call', data: { model: 'gpt-4' }, duration_ms: 400 },
      { type: 'output', data: { content: 'done' }, duration_ms: 10 },
    ]);
    const output = formatTraceTimeline(trace);
    expect(output).toContain('█');
    expect(output).toContain('LLM Call');
    expect(output).toContain('search');
    expect(output).toContain('Total:');
  });

  it('handles empty trace', () => {
    const trace = makeTrace([]);
    expect(formatTraceTimeline(trace)).toContain('No steps');
  });
});
