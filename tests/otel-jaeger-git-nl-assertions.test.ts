/**
 * Round 39 - v4.1.0 Tests
 *
 * Tests for: OpenTelemetry Integration (enhanced), Git Integration,
 * Natural Language Assertions, Test Impact Analysis (enhanced)
 */

import { describe, it, expect } from 'vitest';
import type { AgentTrace, SuiteResult, TestResult } from '../src/types';
import {
  traceToOTel, traceToOTLP, OTelExporter,
  toJaegerSpans, toZipkinSpans,
} from '../src/otel';
import type { OTelSpan, JaegerSpan, ZipkinSpan } from '../src/otel';
import {
  parseCommitLine, parseDiffStat, parseNumstat,
  diffSuiteResults, buildCommitResult, generateGitReport,
  calculateTrend, formatGitReport,
  parseBisectExpression, bisectSearch, formatBisectResult,
} from '../src/git-integration';
import type { CommitTestResult } from '../src/git-integration';
import {
  parseNLAssertion, categorizeAssertion, extractKeywords,
  evaluateNLAssertion, evaluateNLTest, nlResultsToAssertions, formatNLResults,
} from '../src/nl-assert';
import type { NLTestCase } from '../src/nl-assert';
import { analyzeImpact, formatImpact, parseGitDiffOutput, estimateSavings } from '../src/impact';

// === Helpers ===

function makeTrace(steps: AgentTrace['steps'] = [], meta: Record<string, any> = {}): AgentTrace {
  return {
    id: 'test-trace-39',
    timestamp: new Date().toISOString(),
    steps,
    metadata: meta,
  };
}

function makeSuiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'test-suite',
    passed: 10,
    failed: 0,
    total: 10,
    duration_ms: 1000,
    results: [],
    ...overrides,
  };
}

function makeTestResult(name: string, passed: boolean): TestResult {
  return {
    name,
    passed,
    assertions: [{ name: 'check', passed, message: passed ? 'ok' : 'fail' }],
    duration_ms: 100,
  };
}

// =============================================================
// 1. OpenTelemetry Integration (enhanced)
// =============================================================

describe('Round 39: OTel Enhanced', () => {
  it('OTelExporter supports format config', () => {
    const exporter = new OTelExporter({ format: 'jaeger', serviceName: 'test' });
    expect(exporter.getFormat()).toBe('jaeger');
  });

  it('OTelExporter defaults to otlp-http', () => {
    const exporter = new OTelExporter();
    expect(exporter.getFormat()).toBe('otlp-http');
  });

  it('toOTelSpans returns spans from trace', () => {
    const exporter = new OTelExporter({ serviceName: 'myapp' });
    const trace = makeTrace([
      { type: 'llm_call', timestamp: new Date().toISOString(), data: { model: 'gpt-4' }, duration_ms: 500 },
    ]);
    const spans = exporter.toOTelSpans(trace);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0].traceId).toBeDefined();
  });

  it('exportMetrics produces correct metric names', () => {
    const exporter = new OTelExporter({ serviceName: 'probe' });
    const suite = makeSuiteResult({ name: 'metrics-test', passed: 8, failed: 2, total: 10, duration_ms: 5000 });
    const metricsExport = exporter.exportMetrics(suite);
    const metrics = metricsExport.resourceMetrics[0].scopeMetrics[0].metrics;
    const names = metrics.map((m) => m.name);
    expect(names).toContain('agentprobe.tests.total');
    expect(names).toContain('agentprobe.tests.passed');
    expect(names).toContain('agentprobe.tests.failed');
    expect(names).toContain('agentprobe.tests.duration');
    expect(names).toContain('agentprobe.tests.pass_rate');
  });

  it('exportMetrics calculates pass rate', () => {
    const exporter = new OTelExporter();
    const suite = makeSuiteResult({ passed: 7, failed: 3, total: 10 });
    const metricsExport = exporter.exportMetrics(suite);
    const passRate = metricsExport.resourceMetrics[0].scopeMetrics[0].metrics.find(
      (m) => m.name === 'agentprobe.tests.pass_rate',
    );
    expect(passRate?.value).toBe(70);
  });

  it('toJaegerSpans converts correctly', () => {
    const trace = makeTrace([
      { type: 'llm_call', timestamp: new Date().toISOString(), data: { model: 'gpt-4' }, duration_ms: 200 },
    ]);
    const otelSpans = traceToOTel(trace);
    const jaeger = toJaegerSpans(otelSpans, 'svc');
    expect(jaeger.length).toBe(otelSpans.length);
    expect(jaeger[0].process.serviceName).toBe('svc');
    expect(jaeger[0].traceID).toBe(otelSpans[0].traceId);
    // Jaeger uses microseconds
    expect(jaeger[0].startTime).toBe(Math.floor(otelSpans[0].startTimeUnixNano / 1000));
  });

  it('toZipkinSpans converts correctly', () => {
    const trace = makeTrace([
      { type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: 'search' }, duration_ms: 100 },
    ]);
    const otelSpans = traceToOTel(trace);
    const zipkin = toZipkinSpans(otelSpans, 'myapp');
    expect(zipkin.length).toBe(otelSpans.length);
    expect(zipkin[0].localEndpoint.serviceName).toBe('myapp');
    // Zipkin tags should be string values
    for (const span of zipkin) {
      for (const val of Object.values(span.tags)) {
        expect(typeof val).toBe('string');
      }
    }
  });

  it('OTelExporter.toJaeger and toZipkin work', () => {
    const exporter = new OTelExporter({ serviceName: 'test-svc', format: 'zipkin' });
    const trace = makeTrace([
      { type: 'llm_call', timestamp: new Date().toISOString(), data: {}, duration_ms: 50 },
    ]);
    const spans = exporter.exportTrace(trace);
    expect(exporter.toJaeger(spans).length).toBe(spans.length);
    expect(exporter.toZipkin(spans).length).toBe(spans.length);
  });

  it('exportMetrics handles empty suite', () => {
    const exporter = new OTelExporter();
    const suite = makeSuiteResult({ passed: 0, failed: 0, total: 0 });
    const m = exporter.exportMetrics(suite);
    const passRate = m.resourceMetrics[0].scopeMetrics[0].metrics.find(
      (x) => x.name === 'agentprobe.tests.pass_rate',
    );
    expect(passRate?.value).toBe(0);
  });
});

// =============================================================
// 2. Git Integration
// =============================================================

describe('Round 39: Git Integration', () => {
  it('parseCommitLine parses valid line', () => {
    const result = parseCommitLine('abc123|abc1|Alice|2024-01-01|Fix bug');
    expect(result).not.toBeNull();
    expect(result!.hash).toBe('abc123');
    expect(result!.shortHash).toBe('abc1');
    expect(result!.author).toBe('Alice');
    expect(result!.message).toBe('Fix bug');
  });

  it('parseCommitLine returns null for invalid line', () => {
    expect(parseCommitLine('too|few')).toBeNull();
  });

  it('parseCommitLine handles message with pipes', () => {
    const result = parseCommitLine('h|sh|A|d|msg|with|pipes');
    expect(result!.message).toBe('msg|with|pipes');
  });

  it('parseDiffStat parses stat output', () => {
    const output = ' src/foo.ts | 10 +++---\n src/bar.ts | 5 +++++';
    const files = parseDiffStat(output);
    expect(files.length).toBe(2);
    expect(files[0].path).toBe('src/foo.ts');
  });

  it('parseNumstat parses numstat output', () => {
    const output = '10\t5\tsrc/foo.ts\n3\t0\tsrc/bar.ts';
    const files = parseNumstat(output);
    expect(files.length).toBe(2);
    expect(files[0].additions).toBe(10);
    expect(files[0].deletions).toBe(5);
    expect(files[1].additions).toBe(3);
  });

  it('diffSuiteResults finds regressions and fixes', () => {
    const prev = makeSuiteResult({
      results: [makeTestResult('a', true), makeTestResult('b', false)],
    });
    const curr = makeSuiteResult({
      results: [makeTestResult('a', false), makeTestResult('b', true)],
    });
    const diff = diffSuiteResults(prev, curr);
    expect(diff.regressions).toEqual(['a']);
    expect(diff.fixes).toEqual(['b']);
  });

  it('diffSuiteResults with no previous returns empty', () => {
    const curr = makeSuiteResult({ results: [makeTestResult('a', true)] });
    const diff = diffSuiteResults(undefined, curr);
    expect(diff.regressions).toEqual([]);
    expect(diff.fixes).toEqual([]);
  });

  it('buildCommitResult creates correct result', () => {
    const commit = { hash: 'abc', shortHash: 'ab', author: 'A', date: 'd', message: 'm' };
    const suite = makeSuiteResult({ passed: 5, failed: 1, total: 6, results: [makeTestResult('x', false)] });
    const result = buildCommitResult(commit, suite);
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(1);
    expect(result.hash).toBe('abc');
  });

  it('calculateTrend with single commit returns zeros', () => {
    const trend = calculateTrend([{
      hash: 'a', shortHash: 'a', author: 'A', date: 'd', message: 'm',
      passed: 5, failed: 0, total: 5, regressions: [], fixes: [],
    }]);
    expect(trend.totalTestsDelta).toBe(0);
    expect(trend.passRateDelta).toBe(0);
  });

  it('calculateTrend computes deltas', () => {
    const commits: CommitTestResult[] = [
      { hash: 'a', shortHash: 'a', author: 'A', date: 'd', message: 'm', passed: 8, failed: 2, total: 10, regressions: ['x'], fixes: [] },
      { hash: 'b', shortHash: 'b', author: 'A', date: 'd', message: 'm', passed: 12, failed: 0, total: 12, regressions: [], fixes: ['x'] },
    ];
    const trend = calculateTrend(commits);
    expect(trend.totalTestsDelta).toBe(2);
    expect(trend.passRateDelta).toBeGreaterThan(0);
    expect(trend.regressionsIntroduced).toBe(1);
    expect(trend.regressionsFixed).toBe(1);
  });

  it('formatGitReport produces readable output', () => {
    const commits: CommitTestResult[] = [
      { hash: 'abc', shortHash: 'abc1', author: 'A', date: '2024-01-01', message: 'init', passed: 10, failed: 0, total: 10, regressions: [], fixes: [] },
    ];
    const trend = calculateTrend(commits);
    const report = formatGitReport(commits, trend);
    expect(report).toContain('abc1');
    expect(report).toContain('10 pass');
  });

  it('generateGitReport bundles everything', () => {
    const commits: CommitTestResult[] = [
      { hash: 'a', shortHash: 'a1', author: 'A', date: 'd', message: 'first', passed: 5, failed: 0, total: 5, regressions: [], fixes: [] },
      { hash: 'b', shortHash: 'b1', author: 'A', date: 'd', message: 'second', passed: 7, failed: 0, total: 7, regressions: [], fixes: [] },
    ];
    const report = generateGitReport(commits);
    expect(report.trend.totalTestsDelta).toBe(2);
    expect(report.summary).toContain('a1');
  });

  it('parseBisectExpression handles pass rate', () => {
    const fn = parseBisectExpression('pass rate > 0.8');
    const good = makeSuiteResult({ passed: 9, failed: 1, total: 10 });
    const bad = makeSuiteResult({ passed: 5, failed: 5, total: 10 });
    expect(fn(good)).toBe(true);
    expect(fn(bad)).toBe(false);
  });

  it('parseBisectExpression defaults to all-pass', () => {
    const fn = parseBisectExpression('invalid expression!!!');
    expect(fn(makeSuiteResult({ failed: 0 }))).toBe(true);
    expect(fn(makeSuiteResult({ failed: 1 }))).toBe(false);
  });

  it('bisectSearch finds failing commit', () => {
    const commits: CommitTestResult[] = [
      { hash: 'a', shortHash: 'a', author: 'A', date: 'd', message: '', passed: 10, failed: 0, total: 10, regressions: [], fixes: [], suiteResult: makeSuiteResult({ passed: 10, failed: 0, total: 10 }) },
      { hash: 'b', shortHash: 'b', author: 'A', date: 'd', message: '', passed: 10, failed: 0, total: 10, regressions: [], fixes: [], suiteResult: makeSuiteResult({ passed: 10, failed: 0, total: 10 }) },
      { hash: 'c', shortHash: 'c', author: 'A', date: 'd', message: 'broke it', passed: 5, failed: 5, total: 10, regressions: ['x'], fixes: [], suiteResult: makeSuiteResult({ passed: 5, failed: 5, total: 10 }) },
      { hash: 'd', shortHash: 'd', author: 'A', date: 'd', message: '', passed: 5, failed: 5, total: 10, regressions: [], fixes: [], suiteResult: makeSuiteResult({ passed: 5, failed: 5, total: 10 }) },
    ];
    const result = bisectSearch(commits, 'pass rate > 0.9');
    expect(result.found).toBe(true);
    expect(result.commit?.shortHash).toBe('c');
  });

  it('bisectSearch with all passing returns not found', () => {
    const commits: CommitTestResult[] = [
      { hash: 'a', shortHash: 'a', author: 'A', date: 'd', message: '', passed: 10, failed: 0, total: 10, regressions: [], fixes: [], suiteResult: makeSuiteResult({ passed: 10, failed: 0, total: 10 }) },
    ];
    const result = bisectSearch(commits, 'pass rate > 0.5');
    expect(result.found).toBe(false);
  });

  it('formatBisectResult formats found result', () => {
    const result = formatBisectResult({
      found: true,
      commit: { hash: 'abc', shortHash: 'abc1', author: 'Alice', date: '2024-01-01', message: 'broke it', passed: 0, failed: 5, total: 5, regressions: [], fixes: [] },
      stepsSearched: 3,
      searchPath: ['b', 'c', 'abc1'],
      expression: 'pass rate > 0.9',
    });
    expect(result).toContain('abc1');
    expect(result).toContain('Alice');
    expect(result).toContain('broke it');
  });
});

// =============================================================
// 3. Natural Language Test Assertions
// =============================================================

describe('Round 39: NL Assertions', () => {
  it('parseNLAssertion detects contains', () => {
    const a = parseNLAssertion('Response mentions temperature');
    expect(a.category).toBe('contains');
    expect(a.negated).toBe(false);
    expect(a.keywords).toContain('temperature');
  });

  it('parseNLAssertion detects negation', () => {
    const a = parseNLAssertion('No hallucinated data sources');
    expect(a.negated).toBe(true);
    expect(a.category).toBe('safety');
  });

  it('parseNLAssertion detects tone', () => {
    const a = parseNLAssertion('Tone is helpful and concise');
    expect(a.category).toBe('tone');
  });

  it('categorizeAssertion identifies format', () => {
    expect(categorizeAssertion('response uses bullet list format')).toBe('format');
  });

  it('categorizeAssertion identifies safety', () => {
    expect(categorizeAssertion('no hallucinated sources')).toBe('safety');
  });

  it('extractKeywords removes stop words', () => {
    const kw = extractKeywords('The response includes a city name');
    expect(kw).not.toContain('the');
    expect(kw).toContain('city');
    expect(kw).toContain('name');
  });

  it('evaluateNLAssertion contains passes when keyword found', () => {
    const a = parseNLAssertion('Response mentions temperature');
    const result = evaluateNLAssertion(a, 'The temperature in Paris is 15°C.');
    expect(result.passed).toBe(true);
  });

  it('evaluateNLAssertion contains fails when keyword missing', () => {
    const a = parseNLAssertion('Response mentions temperature');
    const result = evaluateNLAssertion(a, 'It is sunny today.');
    expect(result.passed).toBe(false);
  });

  it('evaluateNLAssertion safety passes for clean output', () => {
    const a = parseNLAssertion('No hallucinated data sources');
    const result = evaluateNLAssertion(a, 'The weather is nice today.');
    expect(result.passed).toBe(true);
  });

  it('evaluateNLAssertion tone checks helpful', () => {
    const a = parseNLAssertion('Tone is helpful');
    const result = evaluateNLAssertion(a, 'Here are some suggestions to help you.');
    expect(result.passed).toBe(true);
  });

  it('evaluateNLTest runs all assertions', () => {
    const testCase: NLTestCase = {
      input: "What's the weather in Paris?",
      assertions: [
        'Response mentions temperature',
        'Response includes a city name',
      ],
    };
    const result = evaluateNLTest(testCase, 'The temperature in the city of Paris is 20°C.');
    expect(result.results.length).toBe(2);
    expect(result.allPassed).toBe(true);
  });

  it('nlResultsToAssertions converts to standard format', () => {
    const testCase: NLTestCase = {
      input: 'test',
      assertions: ['Response mentions hello'],
    };
    const nlResult = evaluateNLTest(testCase, 'hello world');
    const assertions = nlResultsToAssertions(nlResult);
    expect(assertions.length).toBe(1);
    expect(assertions[0].name).toContain('nl:');
    expect(assertions[0].passed).toBe(true);
  });

  it('formatNLResults produces readable output', () => {
    const testCase: NLTestCase = { input: 'test', assertions: ['mentions foo'] };
    const result = evaluateNLTest(testCase, 'foo bar');
    const output = formatNLResults([result]);
    expect(output).toContain('Natural Language');
    expect(output).toContain('1/1');
  });

  it('evaluateNLAssertion format detects bullet list', () => {
    const a = parseNLAssertion('Response uses bullet list format');
    const result = evaluateNLAssertion(a, '- item 1\n- item 2\n- item 3');
    expect(result.passed).toBe(true);
  });

  it('evaluateNLAssertion length checks short', () => {
    const a = parseNLAssertion('Response is brief');
    const result = evaluateNLAssertion(a, 'Yes, it is 20°C.');
    expect(result.passed).toBe(true);
  });
});

// =============================================================
// 4. Test Impact Analysis (enhanced)
// =============================================================

describe('Round 39: Impact Analysis Enhanced', () => {
  it('parseGitDiffOutput splits lines', () => {
    const files = parseGitDiffOutput('src/foo.ts\nsrc/bar.ts\n');
    expect(files).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('parseGitDiffOutput handles empty', () => {
    expect(parseGitDiffOutput('')).toEqual([]);
  });

  it('estimateSavings with no affected', () => {
    const result = { changedFiles: [], affectedTests: [], unaffectedCount: 100 };
    const savings = estimateSavings(result);
    expect(savings.runtimePercent).toBe(100);
  });

  it('estimateSavings with all affected', () => {
    const result = {
      changedFiles: ['core.ts'],
      affectedTests: [
        { name: 'a', file: 'a.yaml', reason: 'core' },
        { name: 'b', file: 'b.yaml', reason: 'core' },
      ],
      unaffectedCount: 0,
    };
    const savings = estimateSavings(result);
    expect(savings.runtimePercent).toBe(0);
  });

  it('formatImpact includes savings estimate', () => {
    const result = {
      changedFiles: ['search.ts'],
      affectedTests: [{ name: 'test1', file: 'suite.yaml', reason: 'uses tool: search' }],
      unaffectedCount: 9,
    };
    const output = formatImpact(result);
    expect(output).toContain('savings');
    expect(output).toContain('90%');
  });
});
