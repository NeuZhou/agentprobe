import { describe, it, expect } from 'vitest';
import type { AgentTrace } from '../src/types';
import { evaluate } from '../src/assertions';
import { evaluateComposed } from '../src/compose';
import { mergeTraces } from '../src/merge';
import { generateTests } from '../src/codegen';
import { loadTrace } from '../src/recorder';

function makeTrace(stepCount: number): AgentTrace {
  const steps = [];
  for (let i = 0; i < stepCount; i++) {
    steps.push({
      type: (i % 3 === 0 ? 'tool_call' : i % 3 === 1 ? 'tool_result' : 'output') as any,
      timestamp: new Date(Date.now() + i * 100).toISOString(),
      data: {
        tool_name: `tool_${i % 10}`,
        tool_args: { query: `query_${i}` },
        content: `output_${i}`,
        tokens: { input: 100, output: 50 },
      },
      duration_ms: 10,
    });
  }
  return {
    id: `perf-trace-${stepCount}`,
    timestamp: new Date().toISOString(),
    steps,
    metadata: { size: stepCount },
  };
}

describe('Performance Benchmarks', () => {
  it('evaluates 1000 assertions quickly', () => {
    const trace = makeTrace(100);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      evaluate(trace, { max_steps: 200, tool_called: 'tool_0' });
    }
    const elapsed = performance.now() - start;
    console.log(`  1000 evaluations: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(5000); // Should be well under 5s
  });

  it('evaluates composed assertions at scale', () => {
    const trace = makeTrace(100);
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      evaluateComposed(trace, {
        all_of: [{ tool_called: 'tool_0' }, { max_steps: 200 }],
        any_of: [{ tool_called: 'tool_0' }, { tool_called: 'tool_99' }],
        none_of: [{ tool_called: 'nonexistent' }],
      });
    }
    const elapsed = performance.now() - start;
    console.log(`  500 composed evaluations: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(5000);
  });

  it('merges 100 traces efficiently', () => {
    const traces = Array.from({ length: 100 }, (_, i) => ({
      trace: makeTrace(10),
      name: `agent-${i}`,
    }));
    const start = performance.now();
    const merged = mergeTraces(traces);
    const elapsed = performance.now() - start;
    console.log(`  Merge 100 traces (1000 steps): ${elapsed.toFixed(1)}ms`);
    expect(merged.steps.length).toBe(1000);
    expect(elapsed).toBeLessThan(2000);
  });

  it('handles large traces (1000 steps) without excessive memory', () => {
    const before = process.memoryUsage().heapUsed;
    const traces: AgentTrace[] = [];
    for (let i = 0; i < 10; i++) {
      traces.push(makeTrace(1000));
    }
    const after = process.memoryUsage().heapUsed;
    const mbUsed = (after - before) / 1024 / 1024;
    console.log(`  10x 1000-step traces: ${mbUsed.toFixed(1)}MB heap`);
    expect(mbUsed).toBeLessThan(100); // Should be well under 100MB
    expect(traces.length).toBe(10);
  });

  it('codegen on large trace is fast', () => {
    const trace = makeTrace(200);
    const start = performance.now();
    const result = generateTests(trace);
    const elapsed = performance.now() - start;
    console.log(`  Codegen (200 steps): ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(2000);
    expect(result).toBeDefined();
  });
});
