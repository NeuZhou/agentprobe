import { describe, it, expect } from 'vitest';
import { profile, formatProfile } from '../src/profiler';
import { makeTrace, toolCall, output, llmCall } from './helpers';

describe('profiler', () => {
  it('calculates p50/p95/p99 correctly', () => {
    const steps = Array.from({ length: 100 }, (_, i) => ({
      type: 'llm_call' as const,
      data: { tokens: { input: 10, output: 5 } },
      duration_ms: i + 1,
      timestamp: new Date().toISOString(),
    }));
    const trace = makeTrace(steps);
    const result = profile([trace]);
    expect(result.llm_latency.p50).toBe(50);
    expect(result.llm_latency.p95).toBe(95);
    expect(result.llm_latency.p99).toBe(99);
  });

  it('single trace profiling', () => {
    const trace = makeTrace([
      llmCall({ input: 100, output: 50 }),
      toolCall('search', {}, 20),
      output('result'),
    ]);
    const result = profile([trace]);
    expect(result.trace_count).toBe(1);
    expect(result.total_steps).toBe(3);
  });

  it('multiple traces profiling', () => {
    const t1 = makeTrace([toolCall('a', {}, 10)]);
    const t2 = makeTrace([toolCall('b', {}, 20)]);
    const result = profile([t1, t2]);
    expect(result.trace_count).toBe(2);
  });

  it('token efficiency calculation', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { tokens: { input: 100, output: 50 } } },
    ]);
    const result = profile([trace]);
    // efficiency = output / total = 50/150 ≈ 0.33
    expect(result.token_efficiency).toBeCloseTo(0.33, 1);
  });

  it('cost per query calculation', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4o-mini', tokens: { input: 1000, output: 500 } } },
    ]);
    const result = profile([trace]);
    expect(result.cost_per_query).toBeGreaterThan(0);
  });

  it('bottleneck identification', () => {
    const trace = makeTrace([
      toolCall('slow_tool', {}, 500),
      toolCall('fast_tool', {}, 10),
    ]);
    const result = profile([trace]);
    expect(result.bottleneck).not.toBeNull();
    expect(result.bottleneck!.name).toBe('slow_tool');
  });

  it('empty traces', () => {
    const result = profile([]);
    expect(result.trace_count).toBe(0);
    expect(result.total_steps).toBe(0);
  });

  it('trace with no tool calls', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { tokens: { input: 10, output: 5 } } },
      output('hello'),
    ]);
    const result = profile([trace]);
    expect(result.tool_breakdown).toHaveLength(0);
    expect(result.bottleneck).toBeNull();
  });

  it('trace with only LLM calls', () => {
    const trace = makeTrace([
      llmCall({ input: 100, output: 50 }),
      llmCall({ input: 200, output: 100 }),
    ]);
    const result = profile([trace]);
    expect(result.llm_latency.count).toBe(2);
    expect(result.tool_latency.count).toBe(0);
  });

  it('formatProfile returns string with stats', () => {
    const trace = makeTrace([toolCall('search', {}, 50), llmCall({ input: 100, output: 50 })]);
    const result = profile([trace]);
    const formatted = formatProfile(result);
    expect(formatted).toContain('Performance Profile');
    expect(formatted).toContain('Token efficiency');
  });
});
