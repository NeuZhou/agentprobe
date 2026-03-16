import { describe, it, expect, beforeEach } from 'vitest';
import { AgentProbeExporter } from '../src/otel/exporter';
import { TraceAnalyzer } from '../src/otel/analyzer';
import { TraceVisualizer } from '../src/otel/visualizer';
import { DistributedTracer } from '../src/otel/distributed';
import type { TestResults } from '../src/otel/exporter';
import type { OTelSpan } from '../src/otel';
import type { SuiteResult, AgentTrace } from '../src/types';

// ── Helpers ──────────────────────────────────────────────

function makeSuiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'test-suite',
    passed: 2,
    failed: 0,
    total: 2,
    duration_ms: 3000,
    results: [
      {
        name: 'test-1',
        passed: true,
        assertions: [{ name: 'a1', passed: true }],
        duration_ms: 2000,
        trace: makeTrace(),
      },
      {
        name: 'test-2',
        passed: true,
        assertions: [{ name: 'a2', passed: true }],
        duration_ms: 1000,
      },
    ],
    ...overrides,
  };
}

function makeTrace(): AgentTrace {
  const now = new Date().toISOString();
  return {
    id: 'trace-1',
    timestamp: now,
    steps: [
      { type: 'llm_call', timestamp: now, data: { model: 'gpt-4' }, duration_ms: 500 },
      { type: 'tool_call', timestamp: now, data: { tool_name: 'search', tool_args: { q: 'test' } }, duration_ms: 300 },
      { type: 'tool_call', timestamp: now, data: { tool_name: 'calculate', tool_args: { x: 1 } }, duration_ms: 100 },
    ],
    metadata: {},
  };
}

function makeTestResults(overrides: Partial<TestResults> = {}): TestResults {
  return { suite: makeSuiteResult(), ...overrides };
}

function makeSpans(count: number, opts: Partial<OTelSpan> = {}): OTelSpan[] {
  const now = Date.now() * 1_000_000;
  return Array.from({ length: count }, (_, i) => ({
    traceId: '00000000000000000000000000000001',
    spanId: `span-${i}`,
    parentSpanId: i === 0 ? undefined : 'span-0',
    operationName: `op-${i}`,
    startTimeUnixNano: now + i * 100_000_000,
    endTimeUnixNano: now + (i + 1) * 100_000_000,
    attributes: {},
    status: { code: 'OK' as const },
    kind: 'INTERNAL' as const,
    ...opts,
  }));
}

// ── AgentProbeExporter ───────────────────────────────────

describe('AgentProbeExporter', () => {
  let exporter: AgentProbeExporter;

  beforeEach(() => {
    exporter = new AgentProbeExporter({ serviceName: 'test-svc' });
  });

  it('should create with default config', () => {
    const e = new AgentProbeExporter();
    expect(e.endpoint).toBe('http://localhost:4318/v1/traces');
    expect(e.serviceName).toBe('agentprobe');
  });

  it('should accept custom config', () => {
    expect(exporter.serviceName).toBe('test-svc');
  });

  it('should export test run as spans', () => {
    const spans = exporter.exportTestRun(makeTestResults());
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0].operationName).toContain('test-run:');
  });

  it('should create root span with suite attributes', () => {
    const spans = exporter.exportTestRun(makeTestResults());
    const root = spans[0];
    expect(root.attributes['test.suite']).toBe('test-suite');
    expect(root.attributes['test.total']).toBe(2);
    expect(root.kind).toBe('SERVER');
  });

  it('should create child spans for each test', () => {
    const spans = exporter.exportTestRun(makeTestResults());
    const testSpans = spans.filter(s => s.operationName.startsWith('test:'));
    expect(testSpans.length).toBe(2);
  });

  it('should create tool call spans from trace', () => {
    const spans = exporter.exportTestRun(makeTestResults());
    const toolSpans = spans.filter(s => s.operationName.startsWith('tool:'));
    expect(toolSpans.length).toBe(2); // search + calculate
  });

  it('should include assertion spans', () => {
    const spans = exporter.exportTestRun(makeTestResults());
    const assertSpans = spans.filter(s => s.operationName === 'assertion');
    expect(assertSpans.length).toBeGreaterThan(0);
  });

  it('should include metadata attributes when provided', () => {
    const results = makeTestResults({
      metadata: { model: 'gpt-4', totalCost: 0.05, totalTokens: 1000 },
    });
    const spans = exporter.exportTestRun(results);
    expect(spans[0].attributes['agent.model']).toBe('gpt-4');
    expect(spans[0].attributes['agent.cost']).toBe(0.05);
    expect(spans[0].attributes['agent.tokens']).toBe(1000);
  });

  it('should set ERROR status for failed suite', () => {
    const suite = makeSuiteResult({ failed: 1 });
    const spans = exporter.exportTestRun({ suite });
    expect(spans[0].status.code).toBe('ERROR');
  });

  it('should handle empty suite', () => {
    const suite = makeSuiteResult({ results: [], total: 0, passed: 0 });
    const spans = exporter.exportTestRun({ suite });
    expect(spans.length).toBe(1); // just root
  });

  // Console export
  it('should export to console string', () => {
    const output = exporter.exportToConsole(makeTestResults());
    expect(output).toContain('Trace:');
    expect(output).toContain('TraceID:');
  });

  it('should show status icons in console output', () => {
    const output = exporter.exportToConsole(makeTestResults());
    expect(output).toContain('✅');
  });

  // JSON export
  it('should export to JSON (OTLP format)', () => {
    const json = exporter.exportToJSON(makeTestResults());
    expect(json.resourceSpans).toBeDefined();
    expect(json.resourceSpans[0].resource.attributes['service.name']).toBe('test-svc');
    expect(json.resourceSpans[0].scopeSpans[0].scope.version).toBe('4.12.0');
  });

  it('should export to JSON with correct span count', () => {
    const json = exporter.exportToJSON(makeTestResults());
    const spans = json.resourceSpans[0].scopeSpans[0].spans;
    expect(spans.length).toBeGreaterThan(3);
  });

  // OTLP export (network — just verify it builds correctly, don't actually send)
  it('should throw on OTLP export failure', async () => {
    const e = new AgentProbeExporter({ endpoint: 'http://localhost:1/bad', timeout: 100 });
    await expect(e.exportToOTLP(makeTestResults())).rejects.toThrow();
  });

  it('should handle test with tags', () => {
    const suite = makeSuiteResult({
      results: [{
        name: 'tagged-test',
        passed: true,
        assertions: [],
        duration_ms: 100,
        tags: ['smoke', 'fast'],
      }],
    });
    const spans = exporter.exportTestRun({ suite });
    const testSpan = spans.find(s => s.operationName === 'test:tagged-test');
    expect(testSpan?.attributes['test.tags']).toBe('smoke,fast');
  });

  it('should handle failed test with error message', () => {
    const suite = makeSuiteResult({
      results: [{
        name: 'fail-test',
        passed: false,
        assertions: [{ name: 'a', passed: false, message: 'oops' }],
        duration_ms: 100,
        error: 'assertion failed',
      }],
      failed: 1,
    });
    const spans = exporter.exportTestRun({ suite });
    const testSpan = spans.find(s => s.operationName === 'test:fail-test');
    expect(testSpan?.status.code).toBe('ERROR');
    expect(testSpan?.status.message).toBe('assertion failed');
  });
});

// ── TraceAnalyzer ────────────────────────────────────────

describe('TraceAnalyzer', () => {
  let analyzer: TraceAnalyzer;

  beforeEach(() => {
    analyzer = new TraceAnalyzer();
  });

  it('should analyze empty spans', () => {
    const result = analyzer.analyzeSpans([]);
    expect(result.totalSpans).toBe(0);
    expect(result.totalDurationMs).toBe(0);
    expect(result.errorRate).toBe(0);
  });

  it('should count spans correctly', () => {
    const spans = makeSpans(5);
    const result = analyzer.analyzeSpans(spans);
    expect(result.totalSpans).toBe(5);
  });

  it('should calculate error rate', () => {
    const spans = makeSpans(4);
    spans[1].status = { code: 'ERROR', message: 'fail' };
    spans[3].status = { code: 'ERROR', message: 'fail2' };
    const result = analyzer.analyzeSpans(spans);
    expect(result.errorRate).toBe(0.5);
  });

  it('should categorize spans by type', () => {
    const spans = makeSpans(3);
    spans[0].operationName = 'tool:search';
    spans[1].operationName = 'tool:calc';
    spans[2].operationName = 'test:foo';
    const result = analyzer.analyzeSpans(spans);
    expect(result.spansByType['tool']).toBe(2);
    expect(result.spansByType['test']).toBe(1);
  });

  it('should detect bottlenecks', () => {
    const now = Date.now() * 1_000_000;
    const spans: OTelSpan[] = [
      { traceId: 't1', spanId: 'root', operationName: 'suite', startTimeUnixNano: now, endTimeUnixNano: now + 10_000_000_000, attributes: {}, status: { code: 'OK' }, kind: 'SERVER' },
      { traceId: 't1', spanId: 's1', parentSpanId: 'root', operationName: 'tool:slow', startTimeUnixNano: now, endTimeUnixNano: now + 8_000_000_000, attributes: {}, status: { code: 'OK' }, kind: 'CLIENT' },
    ];
    const result = analyzer.analyzeSpans(spans);
    expect(result.bottlenecks.length).toBeGreaterThan(0);
    expect(result.bottlenecks[0].type).toBe('slow-tool');
  });

  it('should detect retry storms', () => {
    const spans = makeSpans(6);
    for (const s of spans) s.operationName = 'tool:retry-me';
    const result = analyzer.analyzeSpans(spans);
    const retryAnomaly = result.anomalies.find(a => a.type === 'retry-storm');
    expect(retryAnomaly).toBeDefined();
    expect(retryAnomaly!.severity).toBe('high');
  });

  it('should detect critical retry storms (10+)', () => {
    const spans = makeSpans(12);
    for (const s of spans) s.operationName = 'tool:hammered';
    const result = analyzer.analyzeSpans(spans);
    const retryAnomaly = result.anomalies.find(a => a.type === 'retry-storm');
    expect(retryAnomaly!.severity).toBe('critical');
  });

  it('should detect error cascades', () => {
    const spans = makeSpans(5);
    for (const s of spans) s.status = { code: 'ERROR', message: 'err' };
    const result = analyzer.analyzeSpans(spans);
    const cascade = result.anomalies.find(a => a.type === 'error-cascade');
    expect(cascade).toBeDefined();
  });

  it('should detect infinite loops (20+ children)', () => {
    const spans = makeSpans(22);
    // All children of span-0
    for (let i = 1; i < spans.length; i++) spans[i].parentSpanId = 'span-0';
    const result = analyzer.analyzeSpans(spans);
    const loop = result.anomalies.find(a => a.type === 'infinite-loop');
    expect(loop).toBeDefined();
  });

  it('should detect timeouts (>30s spans)', () => {
    const now = Date.now() * 1_000_000;
    const spans: OTelSpan[] = [{
      traceId: 't1', spanId: 's1', operationName: 'tool:slow',
      startTimeUnixNano: now, endTimeUnixNano: now + 45_000_000_000,
      attributes: {}, status: { code: 'OK' }, kind: 'CLIENT',
    }];
    const result = analyzer.analyzeSpans(spans);
    const timeout = result.anomalies.find(a => a.type === 'timeout');
    expect(timeout).toBeDefined();
    expect(timeout!.severity).toBe('high');
  });

  it('should generate insights for healthy traces', () => {
    const spans = makeSpans(3);
    const result = analyzer.analyzeSpans(spans);
    expect(result.insights.some(i => i.includes('successfully'))).toBe(true);
  });

  it('should generate insights for high error rate', () => {
    const spans = makeSpans(5);
    spans[0].status = { code: 'ERROR' };
    spans[1].status = { code: 'ERROR' };
    const result = analyzer.analyzeSpans(spans);
    expect(result.insights.some(i => i.includes('Error rate'))).toBe(true);
  });

  it('should include summary string', () => {
    const result = analyzer.analyzeSpans(makeSpans(3));
    expect(result.summary).toContain('spans');
    expect(result.summary).toContain('✅');
  });

  it('should show degraded status on errors', () => {
    const spans = makeSpans(10);
    spans[0].status = { code: 'ERROR' };
    const result = analyzer.analyzeSpans(spans);
    expect(result.summary).toContain('🔶');
  });
});

// ── TraceVisualizer ──────────────────────────────────────

describe('TraceVisualizer', () => {
  let viz: TraceVisualizer;

  beforeEach(() => {
    viz = new TraceVisualizer();
  });

  it('should render empty spans', () => {
    expect(viz.renderTimeline([])).toBe('(no spans)');
    expect(viz.renderWaterfall([])).toBe('(no spans)');
    expect(viz.renderFlameGraph([])).toBe('(no spans)');
  });

  it('should render timeline with tree structure', () => {
    const spans = makeSpans(3);
    const output = viz.renderTimeline(spans);
    expect(output).toContain('op-0');
    expect(output).toContain('op-1');
  });

  it('should show status icons in timeline', () => {
    const spans = makeSpans(2);
    spans[1].status = { code: 'ERROR' };
    const output = viz.renderTimeline(spans);
    expect(output).toContain('❌');
    expect(output).toContain('✅');
  });

  it('should render waterfall with bars', () => {
    const spans = makeSpans(3);
    const output = viz.renderWaterfall(spans);
    expect(output).toContain('Waterfall');
    expect(output).toContain('█');
    expect(output).toContain('ms');
  });

  it('should render flame graph', () => {
    const spans = makeSpans(3);
    const output = viz.renderFlameGraph(spans);
    expect(output).toContain('Flame Graph');
    expect(output).toContain('═');
  });

  it('should handle single span timeline', () => {
    const spans = makeSpans(1);
    spans[0].parentSpanId = undefined;
    const output = viz.renderTimeline(spans);
    expect(output).toContain('op-0');
  });

  it('should handle deeply nested spans', () => {
    const now = Date.now() * 1_000_000;
    const spans: OTelSpan[] = [
      { traceId: 't', spanId: 'a', operationName: 'root', startTimeUnixNano: now, endTimeUnixNano: now + 3_000_000_000, attributes: {}, status: { code: 'OK' }, kind: 'SERVER' },
      { traceId: 't', spanId: 'b', parentSpanId: 'a', operationName: 'child', startTimeUnixNano: now, endTimeUnixNano: now + 2_000_000_000, attributes: {}, status: { code: 'OK' }, kind: 'INTERNAL' },
      { traceId: 't', spanId: 'c', parentSpanId: 'b', operationName: 'grandchild', startTimeUnixNano: now, endTimeUnixNano: now + 1_000_000_000, attributes: {}, status: { code: 'OK' }, kind: 'INTERNAL' },
    ];
    const output = viz.renderTimeline(spans);
    expect(output).toContain('root');
    expect(output).toContain('grandchild');
  });

  it('should render waterfall with error markers', () => {
    const spans = makeSpans(3);
    spans[2].status = { code: 'ERROR' };
    const output = viz.renderWaterfall(spans);
    expect(output).toContain('❌');
  });
});

// ── DistributedTracer ────────────────────────────────────

describe('DistributedTracer', () => {
  let tracer: DistributedTracer;

  beforeEach(() => {
    tracer = new DistributedTracer();
  });

  it('should start a trace', () => {
    const ctx = tracer.startTrace('test-1');
    expect(ctx.traceId).toBeDefined();
    expect(ctx.traceId.length).toBe(32);
    expect(ctx.agentId).toBe('orchestrator');
    expect(ctx.sampled).toBe(true);
  });

  it('should store baggage with test id', () => {
    const ctx = tracer.startTrace('test-abc');
    expect(ctx.baggage['test.id']).toBe('test-abc');
  });

  it('should propagate context to child agent', () => {
    const parent = tracer.startTrace('test-1');
    const child = tracer.propagateContext(parent, 'agent-a');
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.agentId).toBe('agent-a');
    expect(child.baggage['parent.agent']).toBe('orchestrator');
  });

  it('should propagate across multiple agents', () => {
    const root = tracer.startTrace('test-1');
    const a = tracer.propagateContext(root, 'agent-a');
    const b = tracer.propagateContext(root, 'agent-b');
    expect(a.traceId).toBe(b.traceId);
    expect(a.spanId).not.toBe(b.spanId);
  });

  it('should record spans under trace', () => {
    const ctx = tracer.startTrace('test-1');
    const now = Date.now() * 1_000_000;
    tracer.recordSpan(ctx, {
      traceId: 'will-be-overridden',
      spanId: 'custom-span',
      operationName: 'tool:search',
      startTimeUnixNano: now,
      endTimeUnixNano: now + 1_000_000_000,
      attributes: {},
      status: { code: 'OK' },
      kind: 'CLIENT',
    });
    const spans = tracer.getSpans(ctx.traceId);
    expect(spans.length).toBe(2); // root + custom
    expect(spans[1].traceId).toBe(ctx.traceId); // overridden
  });

  it('should complete context with status', () => {
    const ctx = tracer.startTrace('test-1');
    const child = tracer.propagateContext(ctx, 'agent-a');
    tracer.completeContext(child, 'ERROR');
    const spans = tracer.getSpans(ctx.traceId);
    const agentSpan = spans.find(s => s.spanId === child.spanId);
    expect(agentSpan?.status.code).toBe('ERROR');
    expect(agentSpan?.endTimeUnixNano).toBeGreaterThanOrEqual(agentSpan!.startTimeUnixNano);
  });

  it('should correlate spans across agents', () => {
    const root = tracer.startTrace('test-1');
    const a = tracer.propagateContext(root, 'agent-a');
    const b = tracer.propagateContext(root, 'agent-b');
    tracer.completeContext(a);
    tracer.completeContext(b);

    const correlated = tracer.correlateSpans([root, a, b]);
    expect(correlated.traceId).toBe(root.traceId);
    expect(correlated.agents).toContain('agent-a');
    expect(correlated.agents).toContain('agent-b');
    expect(correlated.timeline.length).toBe(3); // orchestrator + a + b
  });

  it('should detect cross-agent calls', () => {
    const root = tracer.startTrace('test-1');
    const a = tracer.propagateContext(root, 'agent-a');
    tracer.completeContext(a);

    const correlated = tracer.correlateSpans([root, a]);
    expect(correlated.crossAgentCalls.length).toBeGreaterThan(0);
    expect(correlated.crossAgentCalls[0].fromAgent).toBe('orchestrator');
    expect(correlated.crossAgentCalls[0].toAgent).toBe('agent-a');
  });

  it('should compute total duration in correlation', () => {
    const root = tracer.startTrace('test-1');
    tracer.completeContext(root);
    const correlated = tracer.correlateSpans([root]);
    expect(correlated.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('should throw on empty correlation', () => {
    expect(() => tracer.correlateSpans([])).toThrow('Cannot correlate empty trace list');
  });

  it('should reset state', () => {
    const ctx = tracer.startTrace('test-1');
    tracer.reset();
    expect(tracer.getSpans(ctx.traceId)).toEqual([]);
  });

  it('should handle deep agent chains', () => {
    const root = tracer.startTrace('test-1');
    const a = tracer.propagateContext(root, 'agent-a');
    const b = tracer.propagateContext(a, 'agent-b');
    const c = tracer.propagateContext(b, 'agent-c');
    tracer.completeContext(c);
    tracer.completeContext(b);
    tracer.completeContext(a);

    const correlated = tracer.correlateSpans([root, a, b, c]);
    expect(correlated.agents.length).toBe(4);
    expect(correlated.spans.length).toBeGreaterThanOrEqual(4);
  });
});
