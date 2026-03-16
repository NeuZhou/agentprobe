import { describe, it, expect } from 'vitest';
import { recordGolden, verifyGolden } from '../src/golden';
import { makeTrace, toolCall, output, llmCall } from './helpers';

describe('golden', () => {
  it('record golden from trace', () => {
    const trace = makeTrace([toolCall('search'), output('hello')]);
    const golden = recordGolden(trace);
    expect(golden.tools_called).toContain('search');
    expect(golden.total_steps).toBe(2);
  });

  it('verify matching trace passes', () => {
    const trace = makeTrace([toolCall('search'), output('hello')]);
    const golden = recordGolden(trace);
    const results = verifyGolden(trace, golden);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('verify different tools fails', () => {
    const trace1 = makeTrace([toolCall('search'), output('hello')]);
    const golden = recordGolden(trace1);
    const trace2 = makeTrace([toolCall('calculate'), output('hello')]);
    const results = verifyGolden(trace2, golden);
    const toolResult = results.find(r => r.name.includes('tools_called'));
    expect(toolResult?.passed).toBe(false);
  });

  it('verify token budget exceeded fails', () => {
    const trace1 = makeTrace([
      { type: 'llm_call', data: { tokens: { input: 100, output: 50 } } },
    ]);
    const golden = recordGolden(trace1);
    const trace2 = makeTrace([
      { type: 'llm_call', data: { tokens: { input: 1000, output: 500 } } },
    ]);
    const results = verifyGolden(trace2, golden, { token_tolerance: 0.2 });
    const tokenResult = results.find(r => r.name.includes('token_budget'));
    expect(tokenResult?.passed).toBe(false);
  });

  it('verify step count exceeded fails', () => {
    const trace1 = makeTrace([output('a')]);
    const golden = recordGolden(trace1);
    const bigTrace = makeTrace(Array.from({ length: 20 }, () => output('x')));
    const results = verifyGolden(bigTrace, golden, { step_tolerance: 5 });
    const stepResult = results.find(r => r.name.includes('step_count'));
    expect(stepResult?.passed).toBe(false);
  });

  it('update golden (re-record)', () => {
    const trace1 = makeTrace([toolCall('search'), output('v1')]);
    const golden1 = recordGolden(trace1);
    const trace2 = makeTrace([toolCall('search'), toolCall('calculate'), output('v2')]);
    const golden2 = recordGolden(trace2);
    expect(golden2.tools_called).toContain('calculate');
    expect(golden2.total_steps).toBe(3);
  });

  it('verify with tolerance (±20%)', () => {
    const trace1 = makeTrace([
      { type: 'llm_call', data: { tokens: { input: 100, output: 50 } } },
      output('hello'),
    ]);
    const golden = recordGolden(trace1);
    const trace2 = makeTrace([
      { type: 'llm_call', data: { tokens: { input: 110, output: 55 } } },
      output('hello'),
    ]);
    const results = verifyGolden(trace2, golden, { token_tolerance: 0.2 });
    const tokenResult = results.find(r => r.name.includes('token_budget'));
    expect(tokenResult?.passed).toBe(true);
  });

  it('exact_sequence check', () => {
    const trace = makeTrace([toolCall('a'), toolCall('b'), output('done')]);
    const golden = recordGolden(trace);
    const trace2 = makeTrace([toolCall('b'), toolCall('a'), output('done')]);
    const results = verifyGolden(trace2, golden, { exact_sequence: true });
    const seqResult = results.find(r => r.name.includes('tool_sequence'));
    expect(seqResult?.passed).toBe(false);
  });

  it('golden with no tool calls', () => {
    const trace = makeTrace([output('just text')]);
    const golden = recordGolden(trace);
    expect(golden.tools_called).toHaveLength(0);
    const results = verifyGolden(trace, golden);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('golden metadata is preserved', () => {
    const trace = makeTrace([output('hello')], { env: 'test' });
    const golden = recordGolden(trace);
    expect(golden.metadata.env).toBe('test');
  });
});
