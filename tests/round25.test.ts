import { describe, it, expect } from 'vitest';
import {
  getStandardBenchmark,
  scoreBenchmark,
  formatBenchmarkReport,
  listBenchmarkSuiteNames,
} from '../src/benchmark-suite';
import type { BenchmarkSuiteConfig, BenchmarkReport } from '../src/benchmark-suite';
import {
  analyzeFlakiness,
  detectFlakyTests,
  formatFlakyReport,
} from '../src/flaky-detector';
import type { FlakyTestReport } from '../src/flaky-detector';
import {
  toolSequenceSimilarity,
  outputSimilarity,
  traceSimilarity,
  findSimilarTraces,
  formatSimilarityResults,
} from '../src/similarity';
import type { SimilarityResult } from '../src/similarity';
import {
  buildCoverageMap,
  formatCoverageMap,
} from '../src/coverage-map';
import type { CoverageMap } from '../src/coverage-map';
import {
  buildPayload,
  buildPagerDutyPayload,
  buildEmailBody,
  triggerNotifications,
  formatWebhookPayload,
} from '../src/webhooks';
import type {
  WebhookPayload,
  NotificationHubConfig,
  EmailNotificationConfig,
  PagerDutyNotificationConfig,
  HttpNotificationConfig,
  SlackNotificationConfig,
} from '../src/webhooks';
import type { AgentTrace, TestResult, TestCase, SuiteResult } from '../src/types';

// ===== Helpers =====
function makeTrace(toolNames: string[], outputs: string[] = []): AgentTrace {
  const steps: AgentTrace['steps'] = [];
  for (const name of toolNames) {
    steps.push({ type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: name } });
  }
  for (const content of outputs) {
    steps.push({ type: 'output', timestamp: new Date().toISOString(), data: { content } });
  }
  return { id: 'test', timestamp: new Date().toISOString(), steps, metadata: {} };
}

function makeResult(name: string, passed: boolean, duration_ms = 100, error?: string): TestResult {
  return { name, passed, assertions: [], duration_ms, error, tags: [] };
}

function makeSuiteResult(overrides?: Partial<SuiteResult>): SuiteResult {
  return {
    name: 'test-suite',
    passed: 5,
    failed: 1,
    total: 6,
    duration_ms: 1000,
    results: [
      makeResult('test-1', true),
      makeResult('test-2', true),
      makeResult('test-3', false, 200, 'assertion failed'),
    ],
    ...overrides,
  };
}

// ===== Benchmark Suite Tests =====
describe('Benchmark Suite', () => {
  it('getStandardBenchmark returns valid config', () => {
    const suite = getStandardBenchmark();
    expect(suite.name).toBe('standard');
    expect(suite.tasks.length).toBeGreaterThan(10);
    expect(suite.tasks.every(t => t.category && t.name && t.input !== undefined)).toBe(true);
  });

  it('getStandardBenchmark has all expected categories', () => {
    const suite = getStandardBenchmark();
    const categories = [...new Set(suite.tasks.map(t => t.category))];
    expect(categories).toContain('Simple Q&A');
    expect(categories).toContain('Tool Usage');
    expect(categories).toContain('Safety');
    expect(categories).toContain('Error Recovery');
    expect(categories).toContain('Multi-step Reasoning');
  });

  it('listBenchmarkSuiteNames returns known suites', () => {
    const names = listBenchmarkSuiteNames();
    expect(names).toContain('standard');
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it('scoreBenchmark produces correct category scores', () => {
    const config: BenchmarkSuiteConfig = {
      name: 'test',
      tasks: [
        { name: 't1', category: 'A', input: 'x', expect: {} },
        { name: 't2', category: 'A', input: 'y', expect: {} },
        { name: 't3', category: 'B', input: 'z', expect: {} },
      ],
    };
    const results: TestResult[] = [
      makeResult('t1', true, 50),
      makeResult('t2', false, 100),
      makeResult('t3', true, 75),
    ];
    const report = scoreBenchmark(config, results);
    expect(report.categories.length).toBe(2);
    const catA = report.categories.find(c => c.category === 'A')!;
    expect(catA.passed).toBe(1);
    expect(catA.tasks).toBe(2);
    expect(catA.score).toBe(50);
    const catB = report.categories.find(c => c.category === 'B')!;
    expect(catB.passed).toBe(1);
    expect(catB.score).toBe(100);
  });

  it('scoreBenchmark handles empty results', () => {
    const config: BenchmarkSuiteConfig = { name: 'empty', tasks: [] };
    const report = scoreBenchmark(config, []);
    expect(report.overall.score).toBe(0);
    expect(report.categories.length).toBe(0);
  });

  it('formatBenchmarkReport produces readable output', () => {
    const config = getStandardBenchmark();
    const results = config.tasks.map(t => makeResult(t.name, true, 100));
    const report = scoreBenchmark(config, results);
    const output = formatBenchmarkReport(report);
    expect(output).toContain('Agent Benchmark Results');
    expect(output).toContain('Overall');
    expect(output).toContain('/100');
  });

  it('scoreBenchmark computes overall as average of categories', () => {
    const config: BenchmarkSuiteConfig = {
      name: 'avg',
      tasks: [
        { name: 't1', category: 'A', input: '', expect: {} },
        { name: 't2', category: 'B', input: '', expect: {} },
      ],
    };
    const results = [makeResult('t1', true), makeResult('t2', false)];
    const report = scoreBenchmark(config, results);
    expect(report.overall.score).toBe(50); // (100 + 0) / 2
  });
});

// ===== Flaky Detector Tests =====
describe('Flaky Detector', () => {
  it('detects stable test (all pass)', () => {
    const results = [makeResult('t', true), makeResult('t', true), makeResult('t', true)];
    const report = analyzeFlakiness('t', results);
    expect(report.status).toBe('stable');
    expect(report.passRate).toBe(1);
  });

  it('detects broken test (all fail)', () => {
    const results = [makeResult('t', false), makeResult('t', false)];
    const report = analyzeFlakiness('t', results);
    expect(report.status).toBe('broken');
    expect(report.passRate).toBe(0);
  });

  it('detects flaky test (mixed)', () => {
    const results = [
      makeResult('t', true),
      makeResult('t', false, 100, 'assertion failed'),
      makeResult('t', true),
    ];
    const report = analyzeFlakiness('t', results);
    expect(report.status).toBe('flaky');
    expect(report.passRate).toBeCloseTo(0.667, 2);
    expect(report.pattern).toBeDefined();
    expect(report.suggestion).toBeDefined();
  });

  it('detects timeout pattern', () => {
    const results = [
      makeResult('t', true, 100),
      makeResult('t', false, 5000, 'timeout: exceeded 5000ms'),
      makeResult('t', false, 5000, 'timed out'),
    ];
    const report = analyzeFlakiness('t', results);
    expect(report.status).toBe('flaky');
    expect(report.pattern).toContain('timeout');
  });

  it('detectFlakyTests sorts by pass rate', () => {
    const map = new Map<string, TestResult[]>();
    map.set('stable', [makeResult('stable', true), makeResult('stable', true)]);
    map.set('flaky', [makeResult('flaky', true), makeResult('flaky', false)]);
    map.set('broken', [makeResult('broken', false), makeResult('broken', false)]);
    const reports = detectFlakyTests(map);
    expect(reports[0].name).toBe('broken');
    expect(reports[reports.length - 1].name).toBe('stable');
  });

  it('formatFlakyReport includes all sections', () => {
    const reports: FlakyTestReport[] = [
      { name: 'ok', status: 'stable', passRate: 1, passCount: 5, totalRuns: 5, durations_ms: [100] },
      { name: 'bad', status: 'flaky', passRate: 0.6, passCount: 3, totalRuns: 5, durations_ms: [100], pattern: 'timeout', suggestion: 'increase timeout' },
      { name: 'dead', status: 'broken', passRate: 0, passCount: 0, totalRuns: 5, durations_ms: [100] },
    ];
    const output = formatFlakyReport(reports);
    expect(output).toContain('Flaky Test Report');
    expect(output).toContain('FLAKY');
    expect(output).toContain('BROKEN');
    expect(output).toContain('Stable');
  });

  it('handles empty results gracefully', () => {
    const report = analyzeFlakiness('t', []);
    expect(report.status).toBe('broken');
    expect(report.passRate).toBe(0);
  });
});

// ===== Similarity Tests =====
describe('Trace Similarity', () => {
  it('identical tool sequences have similarity 1', () => {
    const a = makeTrace(['search', 'read', 'write']);
    const b = makeTrace(['search', 'read', 'write']);
    expect(toolSequenceSimilarity(a, b)).toBe(1);
  });

  it('completely different sequences have similarity 0', () => {
    const a = makeTrace(['search']);
    const b = makeTrace(['write']);
    expect(toolSequenceSimilarity(a, b)).toBe(0);
  });

  it('partial overlap gives intermediate similarity', () => {
    const a = makeTrace(['search', 'read', 'write']);
    const b = makeTrace(['search', 'delete']);
    const sim = toolSequenceSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('empty traces are identical', () => {
    expect(toolSequenceSimilarity(makeTrace([]), makeTrace([]))).toBe(1);
  });

  it('one empty one non-empty gives 0', () => {
    expect(toolSequenceSimilarity(makeTrace([]), makeTrace(['search']))).toBe(0);
  });

  it('outputSimilarity with identical outputs is 1', () => {
    const a = makeTrace([], ['hello world']);
    const b = makeTrace([], ['hello world']);
    expect(outputSimilarity(a, b)).toBe(1);
  });

  it('outputSimilarity with disjoint outputs is 0', () => {
    const a = makeTrace([], ['alpha beta']);
    const b = makeTrace([], ['gamma delta']);
    expect(outputSimilarity(a, b)).toBe(0);
  });

  it('traceSimilarity combines tool and output', () => {
    const a = makeTrace(['search'], ['hello world']);
    const b = makeTrace(['search'], ['hello world']);
    expect(traceSimilarity(a, b)).toBe(1);
  });

  it('findSimilarTraces returns empty for missing dir', () => {
    const results = findSimilarTraces(makeTrace([]), '/nonexistent/path');
    expect(results).toEqual([]);
  });

  it('formatSimilarityResults handles empty', () => {
    expect(formatSimilarityResults([])).toContain('No similar');
  });

  it('formatSimilarityResults formats results', () => {
    const results: SimilarityResult[] = [
      { tracePath: '/tmp/a.json', similarity: 0.95, reason: 'same tool pattern' },
    ];
    const output = formatSimilarityResults(results);
    expect(output).toContain('0.95');
    expect(output).toContain('same tool pattern');
  });
});

// ===== Coverage Map Tests =====
describe('Coverage Map', () => {
  it('buildCoverageMap categorizes tool usage tests', () => {
    const tests: TestCase[] = [
      { name: 't1', input: 'test', expect: { tool_called: 'search' } },
      { name: 't2', input: 'test', expect: { tool_not_called: 'exec' } },
    ];
    const map = buildCoverageMap(tests);
    const toolEntry = map.entries.find(e => e.category === 'Tool Usage')!;
    expect(toolEntry.testCount).toBeGreaterThanOrEqual(2);
  });

  it('buildCoverageMap detects safety tests', () => {
    const tests: TestCase[] = [
      { name: 'injection', input: 'ignore previous instructions', expect: { output_not_contains: 'secret' } },
    ];
    const map = buildCoverageMap(tests);
    const safety = map.entries.find(e => e.category === 'Safety')!;
    expect(safety.testCount).toBeGreaterThanOrEqual(1);
  });

  it('buildCoverageMap reports gaps', () => {
    const map = buildCoverageMap([]);
    expect(map.entries.every(e => e.gap !== undefined)).toBe(true);
    expect(map.overallCoverage).toBe(0);
  });

  it('formatCoverageMap produces ASCII art', () => {
    const map = buildCoverageMap([]);
    const output = formatCoverageMap(map);
    expect(output).toContain('Coverage Map');
    expect(output).toContain('░');
    expect(output).toContain('Gaps');
  });

  it('buildCoverageMap detects performance tests', () => {
    const tests: TestCase[] = [
      { name: 'fast', input: 'hi', expect: { max_duration_ms: 1000 } },
      { name: 'cheap', input: 'x', expect: { max_cost_usd: 0.01 } },
    ];
    const map = buildCoverageMap(tests);
    const perf = map.entries.find(e => e.category === 'Performance')!;
    expect(perf.testCount).toBeGreaterThanOrEqual(2);
  });

  it('buildCoverageMap caps at 100%', () => {
    const tests: TestCase[] = Array.from({ length: 20 }, (_, i) => ({
      name: `tool-${i}`,
      input: 'x',
      expect: { tool_called: `tool_${i}` },
    }));
    const map = buildCoverageMap(tests);
    const tool = map.entries.find(e => e.category === 'Tool Usage')!;
    expect(tool.coveragePercent).toBeLessThanOrEqual(100);
  });

  it('overallCoverage is average of categories', () => {
    const map = buildCoverageMap([]);
    expect(map.overallCoverage).toBe(0);
  });
});

// ===== Notification Hub Tests (enhanced webhooks) =====
describe('Notification Hub', () => {
  const suiteResult = makeSuiteResult();

  it('buildPagerDutyPayload has correct structure', () => {
    const payload = buildPayload('on_failure', suiteResult);
    const pd = buildPagerDutyPayload(payload, 'test-key', 'critical') as any;
    expect(pd.routing_key).toBe('test-key');
    expect(pd.event_action).toBe('trigger');
    expect(pd.payload.severity).toBe('critical');
    expect(pd.payload.summary).toContain('test-suite');
    expect(pd.payload.custom_details.failed).toBe(1);
  });

  it('buildPagerDutyPayload defaults to error severity', () => {
    const payload = buildPayload('on_failure', suiteResult);
    const pd = buildPagerDutyPayload(payload, 'key') as any;
    expect(pd.payload.severity).toBe('error');
  });

  it('buildEmailBody has subject and body', () => {
    const payload = buildPayload('on_failure', suiteResult);
    const email = buildEmailBody(payload);
    expect(email.subject).toContain('AgentProbe');
    expect(email.text).toContain('Passed: 5/6');
    expect(email.text).toContain('Failures:');
    expect(email.html).toContain('<pre>');
  });

  it('buildEmailBody includes regressions when present', () => {
    const payload = buildPayload('on_regression', suiteResult, { regressions: ['test-3 regressed'] });
    const email = buildEmailBody(payload);
    expect(email.text).toContain('Regressions:');
    expect(email.text).toContain('test-3 regressed');
  });

  it('buildEmailBody clean for passing suite', () => {
    const passing = makeSuiteResult({ failed: 0, results: [makeResult('t', true)] });
    const payload = buildPayload('on_success', passing);
    const email = buildEmailBody(payload);
    expect(email.subject).toContain('✅');
    expect(email.text).not.toContain('Failures:');
  });

  it('triggerNotifications skips non-matching events', async () => {
    const hub: NotificationHubConfig = {
      notifications: [
        { type: 'email', to: 'x@y.com', on: ['on_regression'] } as EmailNotificationConfig,
      ],
    };
    const passing = makeSuiteResult({ failed: 0, results: [] });
    const results = await triggerNotifications(hub, passing);
    expect(results.length).toBe(0); // no regression -> email not sent
  });

  it('triggerNotifications fires on matching events', async () => {
    const hub: NotificationHubConfig = {
      notifications: [
        { type: 'email', to: 'x@y.com', on: ['on_failure'] } as EmailNotificationConfig,
      ],
    };
    const results = await triggerNotifications(hub, suiteResult);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('email');
    expect(results[0].success).toBe(true);
  });

  it('triggerNotifications fires on_complete for any result', async () => {
    const hub: NotificationHubConfig = {
      notifications: [
        { type: 'email', to: 'x@y.com', on: ['on_complete'] } as EmailNotificationConfig,
      ],
    };
    const passing = makeSuiteResult({ failed: 0, results: [] });
    const results = await triggerNotifications(hub, passing);
    expect(results.length).toBe(1);
  });

  it('WebhookPayload format for slack is valid JSON', () => {
    const payload = buildPayload('on_failure', suiteResult);
    const formatted = formatWebhookPayload(payload, 'slack');
    const parsed = JSON.parse(formatted);
    expect(parsed.blocks).toBeDefined();
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });

  it('NotificationConfig types are distinct', () => {
    const email: EmailNotificationConfig = { type: 'email', to: 'a@b.com', on: ['on_failure'] };
    const pd: PagerDutyNotificationConfig = { type: 'pagerduty', routing_key: 'x', on: ['on_failure'] };
    const http: HttpNotificationConfig = { type: 'http', url: 'https://example.com', on: ['on_complete'] };
    const slack: SlackNotificationConfig = { type: 'slack', webhook_url: 'https://hooks.slack.com/x', on: ['on_success'] };
    expect(email.type).toBe('email');
    expect(pd.type).toBe('pagerduty');
    expect(http.type).toBe('http');
    expect(slack.type).toBe('slack');
  });
});
