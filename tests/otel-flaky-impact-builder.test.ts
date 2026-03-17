import { describe, it, expect } from 'vitest';
import { makeTrace, toolCall, output, llmCall } from './helpers';
import { traceToOTel, traceToOTLP } from '../src/otel';
import { detectFlaky, formatFlaky } from '../src/flaky';
import { analyzeImpact, formatImpact } from '../src/impact';
import { buildAssertion, buildSuite, parseBuilderInput } from '../src/builder';
import { getBenchmarkSuite, listBenchmarkSuites } from '../src/benchmarks';
import { computeDetailedStats, formatDetailedStats } from '../src/stats';
import type { SuiteResult, TraceStep } from '../src/types';

// Helper to make a SuiteResult
function makeSuiteResult(tests: Array<{ name: string; passed: boolean; error?: string; duration_ms?: number }>): SuiteResult {
  return {
    name: 'test-suite',
    passed: tests.filter(t => t.passed).length,
    failed: tests.filter(t => !t.passed).length,
    total: tests.length,
    duration_ms: 100,
    results: tests.map(t => ({
      name: t.name,
      passed: t.passed,
      assertions: [],
      duration_ms: t.duration_ms ?? 10,
      error: t.error,
    })),
  };
}

// ========== OpenTelemetry (otel.ts) ==========

describe('OpenTelemetry Integration', () => {
  it('converts a simple trace to OTel spans', () => {
    const trace = makeTrace([
      llmCall({ input: 100, output: 50 }),
      toolCall('search', { query: 'test' }),
      output('result'),
    ]);
    const spans = traceToOTel(trace);
    // Root span + 3 step spans
    expect(spans.length).toBe(4);
    expect(spans[0].operationName).toContain('agent.run');
    expect(spans[0].kind).toBe('SERVER');
  });

  it('maps LLM calls as CLIENT spans with model attributes', () => {
    const trace = makeTrace([
      { type: 'llm_call' as const, data: { model: 'gpt-4', tokens: { input: 200, output: 100 } }, duration_ms: 500, timestamp: new Date().toISOString() },
    ]);
    const spans = traceToOTel(trace);
    const llmSpan = spans.find(s => s.operationName.includes('llm.call'));
    expect(llmSpan).toBeDefined();
    expect(llmSpan!.kind).toBe('CLIENT');
    expect(llmSpan!.attributes['llm.model']).toBe('gpt-4');
    expect(llmSpan!.attributes['llm.tokens.input']).toBe(200);
  });

  it('maps tool calls as child spans of LLM calls', () => {
    const trace = makeTrace([
      llmCall({ input: 100, output: 50 }),
      toolCall('search'),
      toolCall('calculate'),
    ]);
    const spans = traceToOTel(trace);
    const llmSpan = spans.find(s => s.operationName.includes('llm.call'));
    const toolSpans = spans.filter(s => s.operationName.includes('tool.call'));
    expect(toolSpans.length).toBe(2);
    // Tool spans should be children of the LLM span
    for (const ts of toolSpans) {
      expect(ts.parentSpanId).toBe(llmSpan!.spanId);
    }
  });

  it('generates OTLP export format', () => {
    const trace = makeTrace([toolCall('search')]);
    const otlp = traceToOTLP(trace, 'my-service');
    expect(otlp.resourceSpans).toHaveLength(1);
    expect(otlp.resourceSpans[0].resource.attributes['service.name']).toBe('my-service');
    expect(otlp.resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThan(0);
  });

  it('sets cost attribute on root span', () => {
    const trace = makeTrace([
      { type: 'llm_call' as const, data: { model: 'gpt-4', tokens: { input: 1000, output: 500 } }, duration_ms: 100, timestamp: new Date().toISOString() },
    ]);
    const spans = traceToOTel(trace);
    const root = spans[0];
    expect(root.attributes['agentprobe.cost.total']).toBeGreaterThan(0);
  });

  it('handles empty trace', () => {
    const trace = makeTrace([]);
    const spans = traceToOTel(trace);
    // Just root span
    expect(spans.length).toBe(1);
  });

  it('assigns unique span IDs', () => {
    const trace = makeTrace([toolCall('a'), toolCall('b'), toolCall('c')]);
    const spans = traceToOTel(trace);
    const ids = spans.map(s => s.spanId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses consistent traceId across all spans', () => {
    const trace = makeTrace([toolCall('search'), llmCall()]);
    const spans = traceToOTel(trace);
    const traceIds = new Set(spans.map(s => s.traceId));
    expect(traceIds.size).toBe(1);
  });
});

// ========== Flaky Test Detection (flaky.ts) ==========

describe('Flaky Test Detection', () => {
  it('detects stable tests (all pass)', () => {
    const runs = [
      makeSuiteResult([{ name: 'test-1', passed: true }]),
      makeSuiteResult([{ name: 'test-1', passed: true }]),
      makeSuiteResult([{ name: 'test-1', passed: true }]),
    ];
    const result = detectFlaky(runs);
    expect(result.stable).toBe(1);
    expect(result.flaky).toBe(0);
    expect(result.broken).toBe(0);
    expect(result.results[0].status).toBe('stable');
    expect(result.results[0].passRate).toBe(1);
  });

  it('detects broken tests (all fail)', () => {
    const runs = [
      makeSuiteResult([{ name: 'test-1', passed: false, error: 'fail' }]),
      makeSuiteResult([{ name: 'test-1', passed: false, error: 'fail' }]),
    ];
    const result = detectFlaky(runs);
    expect(result.broken).toBe(1);
    expect(result.results[0].status).toBe('broken');
    expect(result.results[0].passRate).toBe(0);
  });

  it('detects flaky tests (mixed pass/fail)', () => {
    const runs = [
      makeSuiteResult([{ name: 'test-1', passed: true }]),
      makeSuiteResult([{ name: 'test-1', passed: false, error: 'timeout' }]),
      makeSuiteResult([{ name: 'test-1', passed: true }]),
      makeSuiteResult([{ name: 'test-1', passed: false, error: 'timeout' }]),
      makeSuiteResult([{ name: 'test-1', passed: true }]),
    ];
    const result = detectFlaky(runs);
    expect(result.flaky).toBe(1);
    expect(result.results[0].status).toBe('flaky');
    expect(result.results[0].passRate).toBe(0.6);
  });

  it('handles multiple tests across runs', () => {
    const runs = [
      makeSuiteResult([
        { name: 'stable', passed: true },
        { name: 'flaky', passed: true },
        { name: 'broken', passed: false },
      ]),
      makeSuiteResult([
        { name: 'stable', passed: true },
        { name: 'flaky', passed: false },
        { name: 'broken', passed: false },
      ]),
    ];
    const result = detectFlaky(runs);
    expect(result.stable).toBe(1);
    expect(result.flaky).toBe(1);
    expect(result.broken).toBe(1);
  });

  it('handles empty runs', () => {
    const result = detectFlaky([]);
    expect(result.totalRuns).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it('collects unique errors', () => {
    const runs = [
      makeSuiteResult([{ name: 't', passed: false, error: 'timeout' }]),
      makeSuiteResult([{ name: 't', passed: false, error: 'timeout' }]),
      makeSuiteResult([{ name: 't', passed: false, error: 'connection reset' }]),
    ];
    const result = detectFlaky(runs);
    expect(result.results[0].errors).toContain('timeout');
    expect(result.results[0].errors).toContain('connection reset');
    expect(result.results[0].errors.length).toBe(2);
  });

  it('formats results correctly', () => {
    const runs = [
      makeSuiteResult([{ name: 'test-1', passed: true }]),
      makeSuiteResult([{ name: 'test-1', passed: false }]),
    ];
    const result = detectFlaky(runs);
    const formatted = formatFlaky(result);
    expect(formatted).toContain('Flaky Test Detection');
    expect(formatted).toContain('FLAKY');
  });
});

// ========== Test Impact Analysis (impact.ts) ==========

describe('Test Impact Analysis', () => {
  it('identifies tests affected by tool file changes', () => {
    // We need actual YAML files for this, so test the logic with mocked fs
    const result = analyzeImpact(['src/tools/search.ts'], []);
    expect(result.changedFiles).toHaveLength(1);
    expect(result.affectedTests).toHaveLength(0); // no suite files
  });

  it('returns empty for no changes', () => {
    const result = analyzeImpact([], []);
    expect(result.affectedTests).toHaveLength(0);
    expect(result.unaffectedCount).toBe(0);
  });

  it('formats impact results', () => {
    const result = {
      changedFiles: ['src/search.ts'],
      affectedTests: [{ name: 'search test', file: 'tests.yaml', reason: 'uses tool: search' }],
      unaffectedCount: 5,
    };
    const formatted = formatImpact(result);
    expect(formatted).toContain('Test Impact Analysis');
    expect(formatted).toContain('search test');
    expect(formatted).toContain('5 tests can be skipped');
  });
});

// ========== Assertion Builder (builder.ts) ==========

describe('Assertion Builder', () => {
  it('builds a simple assertion with tool', () => {
    const yaml = buildAssertion({
      action: 'Call the search tool',
      tool: 'search',
    });
    expect(yaml).toContain('tool_called: search');
    expect(yaml).toContain('Call the search tool');
  });

  it('builds assertion with output_contains', () => {
    const yaml = buildAssertion({
      action: 'Get results',
      outputContains: 'results',
    });
    expect(yaml).toContain('output_contains: results');
  });

  it('builds assertion with max_steps', () => {
    const yaml = buildAssertion({
      action: 'Quick task',
      maxSteps: 5,
    });
    expect(yaml).toContain('max_steps: 5');
  });

  it('builds assertion with security check', () => {
    const yaml = buildAssertion({
      action: 'Security test',
      securityCheck: true,
    });
    expect(yaml).toContain('tool_not_called: exec');
    expect(yaml).toContain('output_not_contains: system prompt');
  });

  it('builds a complete suite', () => {
    const yaml = buildSuite('My Tests', [
      { action: 'Search', tool: 'search' },
      { action: 'Calculate', tool: 'calc', maxSteps: 5 },
    ]);
    expect(yaml).toContain('My Tests');
    expect(yaml).toContain('search');
    expect(yaml).toContain('calc');
  });

  it('parses builder input lines', () => {
    const answers = parseBuilderInput([
      'action=Call search',
      'tool=search',
      'max_steps=10',
      'security=true',
    ]);
    expect(answers.action).toBe('Call search');
    expect(answers.tool).toBe('search');
    expect(answers.maxSteps).toBe(10);
    expect(answers.securityCheck).toBe(true);
  });

  it('handles empty builder input', () => {
    const answers = parseBuilderInput([]);
    expect(answers.action).toBe('');
    expect(answers.tool).toBeUndefined();
  });
});

// ========== Benchmark Suites (benchmarks.ts) ==========

describe('Benchmark Suites', () => {
  it('lists available suites', () => {
    const suites = listBenchmarkSuites();
    expect(suites).toContain('safety');
    expect(suites).toContain('efficiency');
    expect(suites).toContain('reliability');
  });

  it('returns safety benchmark with tests', () => {
    const suite = getBenchmarkSuite('safety');
    expect(suite.name).toContain('Safety');
    expect(suite.tests.length).toBeGreaterThanOrEqual(5);
    // All safety tests should have expectations
    for (const test of suite.tests) {
      expect(test.expect).toBeDefined();
    }
  });

  it('returns efficiency benchmark', () => {
    const suite = getBenchmarkSuite('efficiency');
    expect(suite.name).toContain('Efficiency');
    expect(suite.tests.length).toBeGreaterThanOrEqual(5);
    // Efficiency tests should have max_steps or max_tokens
    for (const test of suite.tests) {
      const hasLimit = test.expect.max_steps != null || test.expect.max_tokens != null || test.expect.max_cost_usd != null;
      expect(hasLimit).toBe(true);
    }
  });

  it('returns reliability benchmark', () => {
    const suite = getBenchmarkSuite('reliability');
    expect(suite.name).toContain('Reliability');
    expect(suite.tests.length).toBeGreaterThanOrEqual(5);
  });

  it('throws for unknown suite', () => {
    expect(() => getBenchmarkSuite('nonexistent')).toThrow('Unknown benchmark suite');
  });

  it('safety tests include injection tests', () => {
    const suite = getBenchmarkSuite('safety');
    const injectionTests = suite.tests.filter(t =>
      t.name.toLowerCase().includes('injection') || t.name.toLowerCase().includes('prompt')
    );
    expect(injectionTests.length).toBeGreaterThan(0);
  });

  it('all benchmark tests have required fields', () => {
    for (const name of listBenchmarkSuites()) {
      const suite = getBenchmarkSuite(name);
      for (const test of suite.tests) {
        expect(test.name).toBeTruthy();
        expect(test.input).toBeDefined();
        expect(test.expect).toBeDefined();
      }
    }
  });
});

// ========== Enhanced Stats (stats.ts) ==========

describe('Detailed Stats', () => {
  it('computes detailed stats with model breakdown', () => {
    const traces = [
      makeTrace([
        { type: 'llm_call' as const, data: { model: 'gpt-4', tokens: { input: 100, output: 50 } }, duration_ms: 500, timestamp: new Date().toISOString() },
        toolCall('search', {}, 200),
      ]),
      makeTrace([
        { type: 'llm_call' as const, data: { model: 'gpt-3.5-turbo', tokens: { input: 50, output: 25 } }, duration_ms: 300, timestamp: new Date().toISOString() },
      ]),
    ];
    const stats = computeDetailedStats(traces);
    expect(stats.models.get('gpt-4')).toBe(1);
    expect(stats.models.get('gpt-3.5-turbo')).toBe(1);
    expect(stats.avgSteps).toBe(1.5);
    expect(stats.p50Latency).toBeGreaterThanOrEqual(0);
  });

  it('computes standard deviation', () => {
    const traces = [
      makeTrace([toolCall('a'), toolCall('b')]),
      makeTrace([toolCall('a'), toolCall('b'), toolCall('c'), toolCall('d')]),
    ];
    const stats = computeDetailedStats(traces);
    expect(stats.avgSteps).toBe(3);
    expect(stats.stdSteps).toBeGreaterThan(0);
  });

  it('computes failure rate', () => {
    const traces = [
      makeTrace([output('all good')]),
      makeTrace([output('error: something failed')]),
    ];
    const stats = computeDetailedStats(traces);
    expect(stats.failureRate).toBe(0.5);
  });

  it('handles single trace', () => {
    const stats = computeDetailedStats([makeTrace([toolCall('x')])]);
    expect(stats.traceCount).toBe(1);
    expect(stats.stdSteps).toBe(0);
  });

  it('handles empty traces array', () => {
    const stats = computeDetailedStats([]);
    expect(stats.traceCount).toBe(0);
    expect(stats.avgSteps).toBe(0);
    expect(stats.failureRate).toBe(0);
  });

  it('formats detailed stats', () => {
    const traces = [
      makeTrace([
        { type: 'llm_call' as const, data: { model: 'gpt-4', tokens: { input: 100, output: 50 } }, duration_ms: 500, timestamp: new Date().toISOString() },
        toolCall('search'),
      ]),
    ];
    const stats = computeDetailedStats(traces);
    const formatted = formatDetailedStats(stats);
    expect(formatted).toContain('Trace Statistics');
    expect(formatted).toContain('gpt-4');
    expect(formatted).toContain('σ=');
    expect(formatted).toContain('P95');
    expect(formatted).toContain('Failure rate');
  });

  it('computes percentiles correctly', () => {
    // Create traces with varying durations
    const traces = Array.from({ length: 100 }, (_, i) =>
      makeTrace([{ type: 'tool_call' as const, data: { tool_name: 't' }, duration_ms: (i + 1) * 10, timestamp: new Date().toISOString() }])
    );
    const stats = computeDetailedStats(traces);
    expect(stats.p50Latency).toBeGreaterThan(0);
    expect(stats.p95Latency).toBeGreaterThan(stats.p50Latency);
    expect(stats.p99Latency).toBeGreaterThanOrEqual(stats.p95Latency);
  });

  it('tracks tool usage percentages across traces', () => {
    const traces = [
      makeTrace([toolCall('search'), toolCall('calc')]),
      makeTrace([toolCall('search')]),
      makeTrace([toolCall('save')]),
    ];
    const stats = computeDetailedStats(traces);
    expect(stats.toolUsage.get('search')).toBe(2);
    expect(stats.toolUsage.get('calc')).toBe(1);
  });
});

// ========== Additional edge case tests ==========

describe('OTel edge cases', () => {
  it('handles trace with only tool calls (no LLM parent)', () => {
    const trace = makeTrace([toolCall('a'), toolCall('b')]);
    const spans = traceToOTel(trace);
    const toolSpans = spans.filter(s => s.operationName.includes('tool.call'));
    // Should fall back to root span as parent
    expect(toolSpans[0].parentSpanId).toBe(spans[0].spanId);
  });

  it('includes tool args in attributes', () => {
    const trace = makeTrace([toolCall('search', { query: 'hello' })]);
    const spans = traceToOTel(trace);
    const toolSpan = spans.find(s => s.operationName.includes('tool.call'));
    expect(toolSpan!.attributes['tool.args']).toContain('hello');
  });
});
