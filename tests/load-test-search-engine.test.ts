import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentTrace, TraceStep } from '../src/types';

// === Load Test ===
import {
  parseDuration, percentile, aggregateResults, classifyError,
  formatLoadTestResult,
} from '../src/load-test';
import type { LoadTestResult } from '../src/load-test';

// === Search Engine ===
import {
  tokenize, scoreStep, scoreTrace, extractPreview,
  searchEngine, formatSearchEngineResult,
} from '../src/search-engine';
import type { SearchEngineResult } from '../src/search-engine';

// === Health Dashboard ===
import {
  collectDashboardMetrics, formatUptime, generateDashboardHTML,
} from '../src/health-dashboard';
import type { DashboardMetrics } from '../src/health-dashboard';

// === Migrate ===
import {
  convertPromptFoo, convertDeepEval, convertLangSmith,
  migrate, formatMigrateResult,
} from '../src/migrate';

// === Smart Sampling ===
import {
  matchesPriorityRule, createSampler,
} from '../src/recorder';
import type { TraceSamplingConfig, PriorityRule } from '../src/recorder';

function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'test-trace-1',
    timestamp: new Date().toISOString(),
    steps: [],
    metadata: {},
    ...overrides,
  };
}

function makeStep(overrides: Partial<TraceStep> = {}): TraceStep {
  return {
    type: 'output',
    timestamp: new Date().toISOString(),
    data: { content: 'hello world' },
    duration_ms: 100,
    ...overrides,
  };
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-r30-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ========== 1. Load Testing ==========
describe('load-test', () => {
  it('parseDuration handles seconds', () => {
    expect(parseDuration('60s')).toBe(60000);
  });

  it('parseDuration handles minutes', () => {
    expect(parseDuration('5m')).toBe(300000);
  });

  it('parseDuration handles hours', () => {
    expect(parseDuration('1h')).toBe(3600000);
  });

  it('parseDuration handles milliseconds', () => {
    expect(parseDuration('500ms')).toBe(500);
  });

  it('parseDuration throws on invalid input', () => {
    expect(() => parseDuration('abc')).toThrow('Invalid duration');
  });

  it('percentile returns correct values', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile(sorted, 99)).toBe(10);
  });

  it('percentile handles empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('classifyError detects timeout', () => {
    expect(classifyError('Request timeout after 30s')).toBe('timeout');
  });

  it('classifyError detects rate limit', () => {
    expect(classifyError('429 Too Many Requests')).toBe('rate_limit');
  });

  it('classifyError detects auth errors', () => {
    expect(classifyError('401 Unauthorized')).toBe('auth');
  });

  it('classifyError detects server errors', () => {
    expect(classifyError('500 Internal Server Error')).toBe('server_error');
  });

  it('classifyError returns unknown for unrecognized', () => {
    expect(classifyError('something weird')).toBe('unknown');
  });

  it('aggregateResults computes correct metrics', () => {
    const results = [
      { passed: true, durationMs: 1000, cost: 0.05 },
      { passed: true, durationMs: 2000, cost: 0.10 },
      { passed: false, durationMs: 5000, error: 'timeout', cost: 0 },
    ];
    const agg = aggregateResults(results, 10000);
    expect(agg.totalRequests).toBe(3);
    expect(agg.successCount).toBe(2);
    expect(agg.failureCount).toBe(1);
    expect(agg.successRate).toBeCloseTo(66.67, 1);
    expect(agg.totalCost).toBeCloseTo(0.15);
    expect(agg.throughput).toBeCloseTo(0.3);
    expect(agg.errors).toHaveLength(1);
    expect(agg.errors[0].type).toBe('timeout');
  });

  it('aggregateResults handles empty results', () => {
    const agg = aggregateResults([], 1000);
    expect(agg.totalRequests).toBe(0);
    expect(agg.successRate).toBe(0);
  });

  it('formatLoadTestResult produces readable output', () => {
    const result: LoadTestResult = {
      totalRequests: 100,
      successCount: 95,
      failureCount: 5,
      successRate: 95,
      avgLatencyMs: 2100,
      p50LatencyMs: 1800,
      p95LatencyMs: 4500,
      p99LatencyMs: 8200,
      errors: [{ type: 'timeout', count: 3 }, { type: 'rate_limit', count: 2 }],
      totalCost: 14.20,
      throughput: 2.37,
      durationMs: 60000,
    };
    const output = formatLoadTestResult(result);
    expect(output).toContain('Load Test Results');
    expect(output).toContain('100');
    expect(output).toContain('95.0%');
    expect(output).toContain('$14.20');
  });
});

// ========== 2. Search Engine ==========
describe('search-engine', () => {
  it('tokenize splits and lowercases', () => {
    const terms = tokenize('User asked about Refund');
    expect(terms).toContain('user');
    expect(terms).toContain('asked');
    expect(terms).toContain('refund');
  });

  it('tokenize removes short tokens', () => {
    const terms = tokenize('I am a user');
    expect(terms).not.toContain('I');
    expect(terms).not.toContain('a');
  });

  it('tokenize deduplicates', () => {
    const terms = tokenize('hello hello HELLO');
    expect(terms).toEqual(['hello']);
  });

  it('scoreStep returns 0 for empty step', () => {
    const step = makeStep({ data: {} });
    expect(scoreStep(step, ['test'])).toBe(0);
  });

  it('scoreStep returns 1.0 for exact match', () => {
    const step = makeStep({ data: { content: 'refund' } });
    expect(scoreStep(step, ['refund'])).toBe(1);
  });

  it('scoreStep returns partial for partial match', () => {
    const step = makeStep({ data: { content: 'refund order' } });
    expect(scoreStep(step, ['refund', 'missing'])).toBe(0.5);
  });

  it('scoreTrace scores and returns matched steps', () => {
    const trace = makeTrace({
      steps: [
        makeStep({ data: { content: 'Can I get a refund?' } }),
        makeStep({ data: { content: 'Processing payment' } }),
        makeStep({ data: { content: 'Refund issued' } }),
      ],
    });
    const result = scoreTrace(trace, ['refund']);
    expect(result.matchedSteps).toContain(0);
    expect(result.matchedSteps).toContain(2);
    expect(result.score).toBeGreaterThan(0);
  });

  it('extractPreview returns content slice', () => {
    const step = makeStep({ data: { content: 'This is a long response about refunds' } });
    expect(extractPreview(step)).toContain('refunds');
  });

  it('extractPreview returns tool name for tool steps', () => {
    const step = makeStep({ type: 'tool_call', data: { tool_name: 'search_db' } });
    expect(extractPreview(step)).toContain('search_db');
  });

  it('searchEngine finds matching traces in directory', () => {
    // Create trace files
    const trace1 = makeTrace({ steps: [makeStep({ data: { content: 'Can I get a refund?' } })] });
    const trace2 = makeTrace({ steps: [makeStep({ data: { content: 'Weather today' } })] });
    fs.writeFileSync(path.join(tmpDir, 'trace-1.json'), JSON.stringify(trace1));
    fs.writeFileSync(path.join(tmpDir, 'trace-2.json'), JSON.stringify(trace2));

    const result = searchEngine({ query: 'refund', tracesDir: tmpDir });
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.hits[0].file).toContain('trace-1.json');
  });

  it('searchEngine returns empty for no matches', () => {
    const trace = makeTrace({ steps: [makeStep({ data: { content: 'hello' } })] });
    fs.writeFileSync(path.join(tmpDir, 'trace.json'), JSON.stringify(trace));
    const result = searchEngine({ query: 'nonexistent_xyz', tracesDir: tmpDir });
    expect(result.hits).toHaveLength(0);
  });

  it('formatSearchEngineResult formats output', () => {
    const result: SearchEngineResult = {
      hits: [{ file: 'trace-1.json', score: 0.95, preview: 'Can I get a refund?', matchedSteps: [0], trace: makeTrace() }],
      totalSearched: 5,
      queryTerms: ['refund'],
      elapsed_ms: 42,
    };
    const output = formatSearchEngineResult(result);
    expect(output).toContain('Found 1');
    expect(output).toContain('0.95');
    expect(output).toContain('refund');
  });
});

// ========== 3. Health Dashboard ==========
describe('health-dashboard', () => {
  it('formatUptime formats days', () => {
    expect(formatUptime(90061000)).toContain('1d');
  });

  it('formatUptime formats hours', () => {
    expect(formatUptime(7200000)).toBe('2h 0m');
  });

  it('formatUptime formats minutes', () => {
    expect(formatUptime(300000)).toBe('5m');
  });

  it('collectDashboardMetrics handles empty directory', () => {
    const metrics = collectDashboardMetrics(tmpDir);
    expect(metrics.totalRuns).toBe(0);
    expect(metrics.passRate).toBe(100);
    expect(metrics.slaStatus).toBe('healthy');
  });

  it('collectDashboardMetrics reads report files', () => {
    const report = { name: 'test-run', timestamp: '2024-01-01T00:00:00Z', passed: 9, failed: 1, duration_ms: 5000, cost: 1.50 };
    fs.writeFileSync(path.join(tmpDir, 'report-1.json'), JSON.stringify(report));
    const metrics = collectDashboardMetrics(tmpDir);
    expect(metrics.totalRuns).toBe(1);
    expect(metrics.passRate).toBe(90);
    expect(metrics.errorRate).toBe(10);
    expect(metrics.totalCost).toBe(1.50);
    expect(metrics.slaStatus).toBe('degraded');
  });

  it('collectDashboardMetrics detects critical status', () => {
    const report = { name: 'bad-run', passed: 2, failed: 8, duration_ms: 1000, cost: 0 };
    fs.writeFileSync(path.join(tmpDir, 'report.json'), JSON.stringify(report));
    const metrics = collectDashboardMetrics(tmpDir);
    expect(metrics.slaStatus).toBe('critical');
  });

  it('generateDashboardHTML produces valid HTML', () => {
    const metrics: DashboardMetrics = {
      uptime: '2d 3h',
      totalRuns: 10,
      passRate: 95,
      errorRate: 5,
      avgLatencyMs: 2000,
      totalCost: 50,
      slaStatus: 'healthy',
      lastUpdated: '2024-01-01T12:00:00Z',
      recentRuns: [],
    };
    const html = generateDashboardHTML(metrics);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('AgentProbe Health Dashboard');
    expect(html).toContain('HEALTHY');
    expect(html).toContain('95.0%');
  });

  it('generateDashboardHTML includes recent runs', () => {
    const metrics: DashboardMetrics = {
      uptime: '1h',
      totalRuns: 1,
      passRate: 100,
      errorRate: 0,
      avgLatencyMs: 1000,
      totalCost: 5,
      slaStatus: 'healthy',
      lastUpdated: '2024-01-01T12:00:00Z',
      recentRuns: [{ name: 'run-1', timestamp: '2024-01-01T12:00:00Z', passed: 10, failed: 0, durationMs: 5000, cost: 5 }],
    };
    const html = generateDashboardHTML(metrics);
    expect(html).toContain('run-1');
    expect(html).toContain('$5.00');
  });

  it('generateDashboardHTML respects custom title', () => {
    const metrics = collectDashboardMetrics(tmpDir);
    const html = generateDashboardHTML(metrics, { title: 'My Agent Monitor' });
    expect(html).toContain('My Agent Monitor');
  });
});

// ========== 4. Test Migration ==========
describe('migrate', () => {
  it('convertPromptFoo converts basic tests', () => {
    const content = {
      tests: [
        { description: 'test-1', vars: { input: 'What is 2+2?' }, assert: [{ type: 'contains', value: '4' }] },
        { description: 'test-2', vars: { input: 'Hello' } },
      ],
    };
    const tests = convertPromptFoo(content);
    expect(tests).toHaveLength(2);
    expect(tests[0].name).toBe('test-1');
    expect(tests[0].input).toBe('What is 2+2?');
    expect(tests[0].expect.output_contains).toBe('4');
    expect(tests[0].tags).toContain('promptfoo');
  });

  it('convertPromptFoo handles function-call assertions', () => {
    const content = {
      tests: [{ vars: { input: 'Search for shoes' }, assert: [{ type: 'function-call', value: 'search' }] }],
    };
    const tests = convertPromptFoo(content);
    expect(tests[0].expect.tool_called).toBe('search');
  });

  it('convertPromptFoo uses description as fallback input', () => {
    const content = { tests: [{ description: 'no-input' }] };
    const tests = convertPromptFoo(content);
    expect(tests).toHaveLength(1);
    expect(tests[0].input).toBe('no-input');
  });

  it('convertDeepEval converts test cases', () => {
    const content = {
      test_cases: [
        { name: 'refund-test', input: 'I want a refund', expected_output: 'refund processed' },
      ],
    };
    const tests = convertDeepEval(content);
    expect(tests).toHaveLength(1);
    expect(tests[0].input).toBe('I want a refund');
    expect(tests[0].expect.output_contains).toBe('refund processed');
    expect(tests[0].tags).toContain('deepeval');
  });

  it('convertDeepEval handles expected_tools', () => {
    const content = {
      test_cases: [{ input: 'book flight', expected_tools: ['flight_search'] }],
    };
    const tests = convertDeepEval(content);
    expect(tests[0].expect.tool_called).toEqual(['flight_search']);
  });

  it('convertLangSmith converts examples', () => {
    const content = {
      examples: [
        { name: 'ex-1', inputs: { input: 'Hello' }, outputs: { output: 'Hi there' } },
      ],
    };
    const tests = convertLangSmith(content);
    expect(tests).toHaveLength(1);
    expect(tests[0].input).toBe('Hello');
    expect(tests[0].expect.output_contains).toBe('Hi there');
  });

  it('migrate writes output files', () => {
    const inputDir = path.join(tmpDir, 'input');
    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(inputDir);
    const content = { tests: [{ vars: { input: 'test query' }, description: 'migrated' }] };
    fs.writeFileSync(path.join(inputDir, 'tests.yaml'), require('yaml').stringify(content));

    const result = migrate({ from: 'promptfoo', inputDir, outputDir });
    expect(result.converted).toBe(1);
    expect(result.outputFiles).toHaveLength(1);
    expect(fs.existsSync(result.outputFiles[0])).toBe(true);
  });

  it('migrate handles missing directory', () => {
    const result = migrate({ from: 'promptfoo', inputDir: '/nonexistent', outputDir: tmpDir });
    expect(result.errors).toHaveLength(1);
    expect(result.converted).toBe(0);
  });

  it('migrate dry run does not write', () => {
    const inputDir = path.join(tmpDir, 'input');
    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, 'test.json'), JSON.stringify({ tests: [{ vars: { input: 'x' }, description: 'd' }] }));

    const result = migrate({ from: 'promptfoo', inputDir, outputDir, dryRun: true });
    expect(result.converted).toBe(1);
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it('formatMigrateResult includes error info', () => {
    const result = { converted: 5, skipped: 1, errors: ['bad file'], outputFiles: ['out.yaml'] };
    const output = formatMigrateResult(result);
    expect(output).toContain('5 tests');
    expect(output).toContain('bad file');
    expect(output).toContain('out.yaml');
  });
});

// ========== 5. Trace Sampling ==========
describe('trace-sampling', () => {
  it('matchesPriorityRule detects error traces', () => {
    const trace = makeTrace({ metadata: { error: true }, steps: [] });
    expect(matchesPriorityRule(trace, [{ error: 'always' }])).toBe(true);
  });

  it('matchesPriorityRule detects error in step content', () => {
    const trace = makeTrace({ steps: [makeStep({ data: { content: 'Error occurred' } })] });
    expect(matchesPriorityRule(trace, [{ error: 'always' }])).toBe(true);
  });

  it('matchesPriorityRule returns false when no error', () => {
    const trace = makeTrace({ steps: [makeStep({ data: { content: 'All good' } })] });
    expect(matchesPriorityRule(trace, [{ error: 'always' }])).toBe(false);
  });

  it('matchesPriorityRule detects costly traces', () => {
    const trace = makeTrace({ metadata: { cost: 0.50 }, steps: [] });
    expect(matchesPriorityRule(trace, [{ cost_gt: 0.10 }])).toBe(true);
  });

  it('matchesPriorityRule skips cheap traces', () => {
    const trace = makeTrace({ metadata: { cost: 0.01 }, steps: [] });
    expect(matchesPriorityRule(trace, [{ cost_gt: 0.10 }])).toBe(false);
  });

  it('matchesPriorityRule detects slow traces', () => {
    const trace = makeTrace({ steps: [makeStep({ duration_ms: 15000 })] });
    expect(matchesPriorityRule(trace, [{ duration_gt: '10s' }])).toBe(true);
  });

  it('matchesPriorityRule detects tool usage', () => {
    const trace = makeTrace({ steps: [makeStep({ type: 'tool_call', data: { tool_name: 'danger_tool' } })] });
    expect(matchesPriorityRule(trace, [{ tool_used: 'danger_tool' }])).toBe(true);
  });

  it('createSampler with random strategy samples approximately at rate', () => {
    const sampler = createSampler({ rate: 0.5, strategy: 'random', seed: 42 });
    let kept = 0;
    for (let i = 0; i < 1000; i++) {
      if (sampler(makeTrace())) kept++;
    }
    // Should be roughly 500 ± 100
    expect(kept).toBeGreaterThan(350);
    expect(kept).toBeLessThan(650);
  });

  it('createSampler always captures priority traces', () => {
    const sampler = createSampler({
      rate: 0.01, // Very low rate
      strategy: 'random',
      seed: 1,
      priority_rules: [{ error: 'always' }],
    });
    const errorTrace = makeTrace({ metadata: { error: true } });
    // Should always capture error traces regardless of low rate
    let captured = 0;
    for (let i = 0; i < 100; i++) {
      if (sampler(errorTrace)) captured++;
    }
    expect(captured).toBe(100);
  });

  it('createSampler with reservoir strategy works', () => {
    const sampler = createSampler({ rate: 0.1, strategy: 'reservoir', seed: 99 });
    let kept = 0;
    for (let i = 0; i < 100; i++) {
      if (sampler(makeTrace())) kept++;
    }
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(50);
  });

  it('createSampler with priority strategy falls back to rate', () => {
    const sampler = createSampler({ rate: 0.5, strategy: 'priority', seed: 7 });
    let kept = 0;
    for (let i = 0; i < 200; i++) {
      if (sampler(makeTrace())) kept++;
    }
    expect(kept).toBeGreaterThan(50);
    expect(kept).toBeLessThan(150);
  });

  it('createSampler is deterministic with same seed', () => {
    const results1: boolean[] = [];
    const results2: boolean[] = [];
    const s1 = createSampler({ rate: 0.3, strategy: 'random', seed: 123 });
    const s2 = createSampler({ rate: 0.3, strategy: 'random', seed: 123 });
    for (let i = 0; i < 50; i++) {
      results1.push(s1(makeTrace()));
      results2.push(s2(makeTrace()));
    }
    expect(results1).toEqual(results2);
  });
});

// ========== 6. Integration / edge cases ==========
describe('round30 integration', () => {
  it('search engine handles nested trace directories', () => {
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    const trace = makeTrace({ steps: [makeStep({ data: { content: 'nested refund trace' } })] });
    fs.writeFileSync(path.join(subDir, 'trace.json'), JSON.stringify(trace));
    const result = searchEngine({ query: 'refund', tracesDir: tmpDir });
    expect(result.hits).toHaveLength(1);
  });

  it('search engine handles malformed JSON gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), 'not json');
    fs.writeFileSync(path.join(tmpDir, 'good.json'), JSON.stringify(makeTrace({ steps: [makeStep({ data: { content: 'valid' } })] })));
    const result = searchEngine({ query: 'valid', tracesDir: tmpDir });
    expect(result.totalSearched).toBe(2);
    expect(result.hits).toHaveLength(1);
  });

  it('dashboard metrics handles malformed report files', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), 'not json');
    const metrics = collectDashboardMetrics(tmpDir);
    expect(metrics.totalRuns).toBe(0);
  });

  it('migrate handles mixed file formats', () => {
    const inputDir = path.join(tmpDir, 'mixed');
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, 'test.json'), JSON.stringify({
      test_cases: [{ input: 'json test', expected_output: 'ok' }],
    }));
    const result = migrate({ from: 'deepeval', inputDir, outputDir: path.join(tmpDir, 'out') });
    expect(result.converted).toBe(1);
  });

  it('load test aggregateResults handles all-failed results', () => {
    const results = [
      { passed: false, durationMs: 1000, error: 'timeout' },
      { passed: false, durationMs: 2000, error: 'rate limit 429' },
    ];
    const agg = aggregateResults(results, 5000);
    expect(agg.successRate).toBe(0);
    expect(agg.errors).toHaveLength(2);
  });
});
