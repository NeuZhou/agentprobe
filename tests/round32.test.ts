/**
 * Round 32 Tests - v3.4.0 features:
 *   - Canary Deployment Testing
 *   - Agent Dependency Graph
 *   - Trace Compression (enhanced)
 *   - SLA Monitor (trend analysis)
 *   - Interactive Test Builder
 */

import { describe, it, expect } from 'vitest';
import {
  extractMetrics,
  compare,
  shouldPromote,
  formatCanaryReport,
  DEFAULT_THRESHOLDS,
} from '../src/canary-deploy';
import type { CanaryReport, CanaryThresholds } from '../src/canary-deploy';
import {
  analyzeTrace,
  buildDependencyGraph,
  formatDependencyTree,
  generateDepMermaid,
} from '../src/dep-graph';
import {
  compressTrace,
  decompressTrace,
  stripEmbeddings,
  deduplicateResponses,
  optimizeTrace,
  formatCompressionStats,
} from '../src/compress';
import type { CompressionStats } from '../src/compress';
import {
  loadSLAConfig,
  checkSLA,
  percentile,
  linearSlope,
  analyzeTrend,
  monitorSLA,
  formatSLAMonitor,
} from '../src/sla';
import type { SLAConfig, SLAMonitoringConfig, SLATrendPoint } from '../src/sla';
import {
  answersToTestCase,
  generateFilename,
  serializeTest,
  validateAnswers,
  formatTestPreview,
} from '../src/test-builder';
import type { TestBuilderAnswers } from '../src/test-builder';
import type { AgentTrace, SuiteResult, TestResult } from '../src/types';

// ===== Helpers =====

function makeSuiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'test-suite',
    passed: 8,
    failed: 2,
    total: 10,
    duration_ms: 5000,
    results: Array.from({ length: 10 }, (_, i) => ({
      name: `test-${i}`,
      passed: i < 8,
      assertions: [{ name: 'output', passed: i < 8 }],
      duration_ms: 200 + i * 50,
    })) as TestResult[],
    ...overrides,
  };
}

function makeTrace(toolCalls: Array<{ name: string; error?: boolean; ms?: number }> = []): AgentTrace {
  const steps = toolCalls.flatMap(tc => [
    {
      type: 'tool_call' as const,
      timestamp: new Date().toISOString(),
      data: { tool_name: tc.name, tool_args: {} },
      duration_ms: tc.ms || 100,
    },
    {
      type: 'tool_result' as const,
      timestamp: new Date().toISOString(),
      data: {
        tool_name: tc.name,
        tool_result: tc.error ? { error: 'failed' } : { success: true },
      },
      duration_ms: 0,
    },
  ]);
  return {
    id: 'trace-' + Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    steps,
    metadata: { agent: 'test-agent' },
  };
}

// ===== 1. Canary Deployment Testing =====

describe('Canary Deployment Testing', () => {
  it('should extract metrics from a suite result', () => {
    const suite = makeSuiteResult();
    const metrics = extractMetrics(suite);
    expect(metrics.passRate).toBe(0.8);
    expect(metrics.errorRate).toBe(0.2);
    expect(metrics.avgLatencyMs).toBeGreaterThan(0);
    expect(metrics.p95LatencyMs).toBeGreaterThan(0);
    expect(metrics.safetyScore).toBe(1.0); // no safety assertions
  });

  it('should extract safety score from safety assertions', () => {
    const suite = makeSuiteResult({
      results: [
        { name: 't1', passed: true, assertions: [{ name: 'safety-check', passed: true }], duration_ms: 100 },
        { name: 't2', passed: false, assertions: [{ name: 'pii-check', passed: false }], duration_ms: 100 },
      ] as TestResult[],
      total: 2, passed: 1, failed: 1,
    });
    const metrics = extractMetrics(suite);
    expect(metrics.safetyScore).toBe(0.5);
  });

  it('should compare baseline and canary suites', () => {
    const baseline = makeSuiteResult({ name: 'baseline-v1' });
    const canary = makeSuiteResult({ name: 'canary-v2', passed: 9, failed: 1 });
    const report = compare(baseline, canary);
    expect(report.baselineName).toBe('baseline-v1');
    expect(report.canaryName).toBe('canary-v2');
    expect(report.comparisons).toHaveLength(6);
    expect(report.confidence).toBeGreaterThan(0);
    expect(['promote', 'rollback', 'extend']).toContain(report.recommendation);
  });

  it('should recommend rollback when safety is critically low', () => {
    const baseline = makeSuiteResult({ name: 'base' });
    const canary = makeSuiteResult({
      name: 'canary',
      results: [
        { name: 't1', passed: false, assertions: [{ name: 'safety-check', passed: false }], duration_ms: 100 },
        { name: 't2', passed: false, assertions: [{ name: 'pii-check', passed: false }], duration_ms: 100 },
      ] as TestResult[],
      total: 2, passed: 0, failed: 2,
    });
    const report = compare(baseline, canary);
    expect(report.recommendation).toBe('rollback');
  });

  it('should promote when canary meets all thresholds', () => {
    const baseline = makeSuiteResult();
    const canary = makeSuiteResult({ passed: 9, failed: 1 });
    const report = compare(baseline, canary);
    report.metrics.canary.safetyScore = 0.99;
    expect(shouldPromote(report)).toBe(true);
  });

  it('should not promote when pass rate drops too much', () => {
    const baseline = makeSuiteResult();
    const canary = makeSuiteResult({ passed: 4, failed: 6 });
    const report = compare(baseline, canary);
    expect(shouldPromote(report)).toBe(false);
  });

  it('should not promote when safety score is too low', () => {
    const baseline = makeSuiteResult();
    const canary = makeSuiteResult();
    const report = compare(baseline, canary);
    report.metrics.canary.safetyScore = 0.5;
    expect(shouldPromote(report)).toBe(false);
  });

  it('should format canary report', () => {
    const baseline = makeSuiteResult({ name: 'base-v1' });
    const canary = makeSuiteResult({ name: 'canary-v2' });
    const report = compare(baseline, canary);
    const formatted = formatCanaryReport(report);
    expect(formatted).toContain('base-v1');
    expect(formatted).toContain('canary-v2');
    expect(formatted).toContain('Confidence');
  });

  it('should handle empty suite results', () => {
    const empty = makeSuiteResult({ total: 0, passed: 0, failed: 0, results: [] });
    const metrics = extractMetrics(empty);
    expect(metrics.passRate).toBe(0);
    expect(metrics.avgLatencyMs).toBe(0);
  });
});

// ===== 2. Agent Dependency Graph =====

describe('Agent Dependency Graph', () => {
  it('should analyze a trace for tool calls', () => {
    const trace = makeTrace([
      { name: 'search_kb' },
      { name: 'search_kb' },
      { name: 'get_order' },
    ]);
    const stats = analyzeTrace(trace);
    expect(stats.get('search_kb')?.calls).toBe(2);
    expect(stats.get('get_order')?.calls).toBe(1);
  });

  it('should count errors in tool calls', () => {
    const trace = makeTrace([
      { name: 'search_kb', error: true },
      { name: 'search_kb' },
    ]);
    const stats = analyzeTrace(trace);
    expect(stats.get('search_kb')?.errors).toBe(1);
  });

  it('should build dependency graph from multiple traces', () => {
    const traces = [
      makeTrace([{ name: 'search_kb' }, { name: 'get_order' }]),
      makeTrace([{ name: 'search_kb' }, { name: 'process_refund' }]),
      makeTrace([{ name: 'search_kb' }, { name: 'get_order' }]),
    ];
    const node = buildDependencyGraph(traces, 'customer-support');
    expect(node.agentName).toBe('customer-support');
    expect(node.traceCount).toBe(3);

    const searchDep = node.dependencies.find(d => d.name === 'search_kb');
    expect(searchDep?.required).toBe(true);
    expect(searchDep?.avgCallsPerTrace).toBe(1);

    const refundDep = node.dependencies.find(d => d.name === 'process_refund');
    expect(refundDep?.conditional).toBe(true);
  });

  it('should detect sub-agent dependencies', () => {
    const traces = [
      makeTrace([{ name: 'search_kb' }, { name: 'escalation-agent' }]),
    ];
    const node = buildDependencyGraph(traces);
    const escalation = node.dependencies.find(d => d.name === 'escalation-agent');
    expect(escalation?.type).toBe('sub-agent');
  });

  it('should format dependency tree', () => {
    const traces = [
      makeTrace([{ name: 'search_kb' }, { name: 'get_order' }]),
    ];
    const node = buildDependencyGraph(traces, 'my-agent');
    const tree = formatDependencyTree(node);
    expect(tree).toContain('my-agent');
    expect(tree).toContain('search_kb');
    expect(tree).toContain('get_order');
  });

  it('should generate Mermaid diagram', () => {
    const traces = [
      makeTrace([{ name: 'tool_a' }, { name: 'tool_b' }]),
    ];
    const node = buildDependencyGraph(traces, 'agent-x');
    const mermaid = generateDepMermaid(node);
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('agent_x');
    expect(mermaid).toContain('tool_a');
  });

  it('should handle empty traces', () => {
    const node = buildDependencyGraph([], 'empty-agent');
    expect(node.dependencies).toHaveLength(0);
    expect(node.traceCount).toBe(1); // fallback to 1 to avoid div by zero
  });

  it('should calculate average latency per tool', () => {
    const traces = [
      makeTrace([{ name: 'slow_tool', ms: 500 }, { name: 'fast_tool', ms: 10 }]),
    ];
    const node = buildDependencyGraph(traces);
    const slow = node.dependencies.find(d => d.name === 'slow_tool');
    expect(slow?.avgLatencyMs).toBe(500);
  });
});

// ===== 3. Trace Compression (enhanced) =====

describe('Trace Compression (enhanced)', () => {
  it('should compress and decompress a trace', () => {
    const trace = makeTrace([{ name: 'tool_a' }]);
    const compressed = compressTrace(trace);
    expect(compressed.length).toBeLessThan(JSON.stringify(trace).length);
    const decompressed = decompressTrace(compressed);
    expect(decompressed.id).toBe(trace.id);
  });

  it('should strip embeddings from trace data', () => {
    const trace: AgentTrace = {
      id: 't1',
      timestamp: new Date().toISOString(),
      steps: [{
        type: 'tool_result',
        timestamp: new Date().toISOString(),
        data: {
          tool_name: 'embed',
          tool_result: {
            embedding: Array.from({ length: 1536 }, () => Math.random()),
            text: 'hello',
          },
        },
      }],
      metadata: {},
    };
    const stripped = stripEmbeddings(trace);
    const result = stripped.steps[0].data.tool_result;
    expect(result.embedding).toBe('[embedding:1536d]');
    expect(result.text).toBe('hello');
  });

  it('should strip nested embedding arrays', () => {
    const trace: AgentTrace = {
      id: 't2',
      timestamp: new Date().toISOString(),
      steps: [{
        type: 'tool_result',
        timestamp: new Date().toISOString(),
        data: {
          tool_name: 'search',
          tool_result: {
            results: [
              { text: 'doc1', vector: Array(768).fill(0.1) },
            ],
          },
        },
      }],
      metadata: {},
    };
    const stripped = stripEmbeddings(trace);
    expect(stripped.steps[0].data.tool_result.results[0].vector).toBe('[embedding:768d]');
  });

  it('should deduplicate identical tool responses', () => {
    const trace: AgentTrace = {
      id: 't3',
      timestamp: new Date().toISOString(),
      steps: [
        { type: 'tool_result', timestamp: '', data: { tool_name: 'search', tool_result: { items: ['a', 'b'] } } },
        { type: 'tool_result', timestamp: '', data: { tool_name: 'search', tool_result: { items: ['a', 'b'] } } },
      ],
      metadata: {},
    };
    const deduped = deduplicateResponses(trace);
    expect(deduped.steps[1].data.tool_result).toMatch(/\[ref:r0\]/);
  });

  it('should optimize trace (strip + dedup)', () => {
    const trace: AgentTrace = {
      id: 't4',
      timestamp: new Date().toISOString(),
      steps: [
        { type: 'tool_result', timestamp: '', data: { tool_name: 'embed', tool_result: { embedding: Array(512).fill(0) } } },
        { type: 'tool_result', timestamp: '', data: { tool_name: 'embed', tool_result: { embedding: Array(512).fill(0) } } },
      ],
      metadata: {},
    };
    const optimized = optimizeTrace(trace);
    const json = JSON.stringify(optimized);
    expect(json.length).toBeLessThan(JSON.stringify(trace).length);
  });

  it('should format compression stats', () => {
    const stats: CompressionStats = { fileCount: 10, originalBytes: 45000000, compressedBytes: 3200000, ratio: 0.071 };
    const formatted = formatCompressionStats(stats);
    expect(formatted).toContain('10 file(s)');
    expect(formatted).toContain('reduction');
  });
});

// ===== 4. SLA Monitor (trend analysis) =====

describe('SLA Monitor (trend analysis)', () => {
  const slaConfig: SLAConfig = {
    availability: 99.9,
    latency_p95: 5000,
    cost_per_query: 0.50,
    accuracy: 95,
  };

  const monitorConfig: SLAMonitoringConfig = {
    windowHours: 24,
    alertThreshold: 0.9,
    trend: 'degrading',
  };

  it('should calculate linear regression slope', () => {
    const points = [{ x: 0, y: 10 }, { x: 1, y: 12 }, { x: 2, y: 14 }];
    expect(linearSlope(points)).toBeCloseTo(2.0);
  });

  it('should return 0 slope for constant values', () => {
    const points = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
    expect(linearSlope(points)).toBeCloseTo(0);
  });

  it('should return 0 slope for empty/single point', () => {
    expect(linearSlope([])).toBe(0);
    expect(linearSlope([{ x: 0, y: 5 }])).toBe(0);
  });

  it('should detect degrading trend', () => {
    const points = [{ x: 0, y: 99.5 }, { x: 1, y: 99.0 }, { x: 2, y: 98.5 }];
    const result = analyzeTrend('accuracy', points, 95, 0.9, true);
    expect(result.direction).toBe('degrading');
  });

  it('should detect improving trend', () => {
    const points = [{ x: 0, y: 90 }, { x: 1, y: 93 }, { x: 2, y: 96 }];
    const result = analyzeTrend('accuracy', points, 95, 0.9, true);
    expect(result.direction).toBe('improving');
  });

  it('should estimate breach ETA for degrading metric', () => {
    const points = [{ x: 0, y: 99 }, { x: 1, y: 98 }, { x: 2, y: 97 }];
    const result = analyzeTrend('accuracy', points, 95, 0.9, true);
    expect(result.breachEta).toBeDefined();
    expect(result.breachEta!).toBeCloseTo(2, 0);
  });

  it('should alert when approaching SLA threshold', () => {
    const points = [{ x: 0, y: 96 }, { x: 1, y: 95.5 }, { x: 2, y: 95.1 }];
    const result = analyzeTrend('accuracy', points, 95, 0.96, true);
    expect(result.alert).toBe(true);
  });

  it('should run full SLA monitoring', () => {
    const history: SLATrendPoint[] = [
      { timestamp: '2024-01-01T00:00:00Z', availability: 100, latency_p95: 1000, cost_per_query: 0.3, accuracy: 98 },
      { timestamp: '2024-01-01T06:00:00Z', availability: 99.9, latency_p95: 1100, cost_per_query: 0.3, accuracy: 97 },
      { timestamp: '2024-01-01T12:00:00Z', availability: 99.8, latency_p95: 1200, cost_per_query: 0.32, accuracy: 96 },
    ];
    const reports = [makeSuiteResult()];
    const result = monitorSLA(slaConfig, monitorConfig, history, reports);
    expect(result.overallStatus).toBeDefined();
    expect(result.trends).toHaveLength(4);
  });

  it('should format SLA monitor result', () => {
    const history: SLATrendPoint[] = [
      { timestamp: '2024-01-01T00:00:00Z', availability: 100, latency_p95: 1000, cost_per_query: 0.3, accuracy: 98 },
    ];
    const reports = [makeSuiteResult()];
    const result = monitorSLA(slaConfig, monitorConfig, history, reports);
    const formatted = formatSLAMonitor(result);
    expect(formatted).toContain('SLA Monitor');
    expect(formatted).toContain('Trends');
  });

  it('should detect critical status on SLA violations', () => {
    const history: SLATrendPoint[] = [
      { timestamp: '2024-01-01T00:00:00Z', availability: 50, latency_p95: 10000, cost_per_query: 2, accuracy: 30 },
    ];
    const reports = [makeSuiteResult({ passed: 1, failed: 9, total: 10 })];
    const result = monitorSLA(slaConfig, monitorConfig, history, reports);
    expect(result.overallStatus).toBe('critical');
  });

  it('should compute percentile correctly', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([], 95)).toBe(0);
  });
});

// ===== 5. Interactive Test Builder =====

describe('Interactive Test Builder', () => {
  it('should convert answers to a test case', () => {
    const answers: TestBuilderAnswers = {
      description: 'Search for flights to Paris',
      input: 'Find flights to Paris next week',
      expectedTool: 'search_flights',
      expectedOutput: 'Paris',
      safetyChecks: ['SSN', 'credit card'],
      tags: ['flights', 'search'],
    };
    const tc = answersToTestCase(answers);
    expect(tc.name).toBe('Search for flights to Paris');
    expect(tc.input).toBe('Find flights to Paris next week');
    expect(tc.expect.tool_called).toBe('search_flights');
    expect(tc.expect.output_contains).toBe('Paris');
    expect(tc.expect.output_not_contains).toEqual(['SSN', 'credit card']);
    expect(tc.tags).toEqual(['flights', 'search']);
  });

  it('should generate a filename from description', () => {
    expect(generateFilename('Search for flights to Paris')).toBe('search-for-flights-to-paris');
    expect(generateFilename('Test: PII Check!')).toBe('test-pii-check');
    expect(generateFilename('')).toBe('');
  });

  it('should truncate long filenames', () => {
    const long = 'a'.repeat(100);
    expect(generateFilename(long).length).toBeLessThanOrEqual(50);
  });

  it('should serialize test case to YAML', () => {
    const tc = answersToTestCase({
      description: 'Test',
      input: 'hello',
      expectedTool: 'greet',
    });
    const yaml = serializeTest(tc, 'yaml');
    expect(yaml).toContain('name: Test');
    expect(yaml).toContain('greet');
  });

  it('should serialize test case to JSON', () => {
    const tc = answersToTestCase({
      description: 'Test',
      input: 'hello',
      expectedTool: 'greet',
    });
    const json = serializeTest(tc, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.tests[0].name).toBe('Test');
  });

  it('should validate answers - missing description', () => {
    const errors = validateAnswers({ input: 'hello', expectedTool: 'x' });
    expect(errors).toContain('Description is required');
  });

  it('should validate answers - missing input', () => {
    const errors = validateAnswers({ description: 'Test' });
    expect(errors).toContain('Input prompt is required');
  });

  it('should validate answers - no expectations', () => {
    const errors = validateAnswers({ description: 'Test', input: 'hello' });
    expect(errors.some(e => e.includes('expectation'))).toBe(true);
  });

  it('should pass validation with valid answers', () => {
    const errors = validateAnswers({
      description: 'Test',
      input: 'hello',
      expectedTool: 'greet',
    });
    expect(errors).toHaveLength(0);
  });

  it('should format test preview', () => {
    const tc = answersToTestCase({
      description: 'Search flights',
      input: 'Find flights',
      expectedTool: 'search_flights',
      safetyChecks: ['PII'],
      tags: ['search'],
    });
    const preview = formatTestPreview(tc);
    expect(preview).toContain('Search flights');
    expect(preview).toContain('search_flights');
    expect(preview).toContain('PII');
    expect(preview).toContain('search');
  });

  it('should handle answers with only safety checks', () => {
    const tc = answersToTestCase({
      description: 'Safety test',
      input: 'Tell me about user',
      safetyChecks: ['SSN', 'password'],
    });
    expect(tc.expect.output_not_contains).toEqual(['SSN', 'password']);
    expect(tc.expect.tool_called).toBeUndefined();
  });

  it('should handle max steps and duration', () => {
    const tc = answersToTestCase({
      description: 'Perf test',
      input: 'quick task',
      expectedTool: 'fast_tool',
      maxSteps: 5,
      maxDurationMs: 3000,
    });
    expect(tc.expect.max_steps).toBe(5);
    expect(tc.expect.max_duration_ms).toBe(3000);
  });
});
