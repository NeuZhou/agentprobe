/**
 * Round 35 Tests — A/B Testing, Anonymizer (enhanced), Report Exporter,
 * Retry Policy, Metrics Collector
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ===== 1. A/B Testing Framework =====
import {
  ABTestRunner,
  chiSquaredTest,
  tTest,
  formatABTest,
  type ABTestResult,
  type AgentVariant,
} from '../src/ab-test';

describe('ABTestRunner', () => {
  it('requires at least 2 variants', () => {
    expect(() => new ABTestRunner({ variants: [{ name: 'a' }], sampleSize: 10, metric: 'passRate' }))
      .toThrow('at least 2 variants');
  });

  it('constructs with valid config', () => {
    const runner = new ABTestRunner({
      variants: [{ name: 'gpt-4' }, { name: 'claude-3' }],
      sampleSize: 5,
      metric: 'passRate',
    });
    expect(runner).toBeDefined();
  });

  it('run() returns ABTestResult with variants array', () => {
    const runner = new ABTestRunner({
      variants: [{ name: 'a', model: 'gpt-4' }, { name: 'b', model: 'claude' }],
      sampleSize: 3,
      metric: 'passRate',
    });
    const result = runner.run('test-suite');
    expect(result.variants).toHaveLength(2);
    expect(result.modelA.model).toBe('a');
    expect(result.modelB.model).toBe('b');
    expect(result).toHaveProperty('chiSquared');
    expect(result).toHaveProperty('recommendation');
  });

  it('isSignificant checks confidence level', () => {
    const runner = new ABTestRunner({
      variants: [{ name: 'a' }, { name: 'b' }],
      sampleSize: 10,
      metric: 'passRate',
    });
    const mockResult: ABTestResult = {
      modelA: { model: 'a', passRate: 90, avgCost: 0, avgTime: 1, passCount: 90, failCount: 10, results: [] },
      modelB: { model: 'b', passRate: 70, avgCost: 0, avgTime: 1, passCount: 70, failCount: 30, results: [] },
      variants: [],
      pValue: 0.03,
      chiSquared: 5.5,
      significant: true,
      qualityWinner: 'a',
      costWinner: 'a',
      recommendation: 'a wins',
    };
    expect(runner.isSignificant(mockResult, 0.95)).toBe(true);
    expect(runner.isSignificant(mockResult, 0.99)).toBe(false);
  });

  it('supports 3+ variants', () => {
    const runner = new ABTestRunner({
      variants: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      sampleSize: 5,
      metric: 'passRate',
    });
    const result = runner.run('suite');
    expect(result.variants).toHaveLength(3);
  });
});

describe('chiSquaredTest', () => {
  it('returns non-significant for equal distributions', () => {
    const result = chiSquaredTest([{ pass: 50, fail: 50 }, { pass: 50, fail: 50 }]);
    expect(result.chiSquared).toBe(0);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it('returns significant for very different distributions', () => {
    const result = chiSquaredTest([{ pass: 95, fail: 5 }, { pass: 50, fail: 50 }]);
    expect(result.chiSquared).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it('handles empty data', () => {
    const result = chiSquaredTest([{ pass: 0, fail: 0 }, { pass: 0, fail: 0 }]);
    expect(result.chiSquared).toBe(0);
    expect(result.pValue).toBe(1);
  });

  it('works with 3 variants', () => {
    const result = chiSquaredTest([
      { pass: 90, fail: 10 },
      { pass: 80, fail: 20 },
      { pass: 70, fail: 30 },
    ]);
    expect(result.df).toBe(2);
    expect(result.chiSquared).toBeGreaterThan(0);
  });
});

describe('tTest (legacy)', () => {
  it('returns 1 for identical samples', () => {
    expect(tTest([1, 1, 1], [1, 1, 1])).toBe(1);
  });

  it('returns low p for very different samples', () => {
    const p = tTest([100, 101, 102, 103, 104], [1, 2, 3, 4, 5]);
    expect(p).toBeLessThan(0.05);
  });

  it('returns 1 for insufficient data', () => {
    expect(tTest([1], [2])).toBe(1);
  });
});

describe('formatABTest', () => {
  it('produces readable output', () => {
    const result: ABTestResult = {
      modelA: { model: 'gpt-4', passRate: 90, avgCost: 0.05, avgTime: 2.1, passCount: 90, failCount: 10, results: [] },
      modelB: { model: 'claude', passRate: 85, avgCost: 0.03, avgTime: 1.8, passCount: 85, failCount: 15, results: [] },
      variants: [
        { model: 'gpt-4', passRate: 90, avgCost: 0.05, avgTime: 2.1, passCount: 90, failCount: 10, results: [] },
        { model: 'claude', passRate: 85, avgCost: 0.03, avgTime: 1.8, passCount: 85, failCount: 15, results: [] },
      ],
      pValue: 0.03,
      chiSquared: 4.5,
      significant: true,
      qualityWinner: 'gpt-4',
      costWinner: 'claude',
      recommendation: 'gpt-4 wins',
    };
    const output = formatABTest(result);
    expect(output).toContain('gpt-4');
    expect(output).toContain('claude');
    expect(output).toContain('significant');
  });
});

// ===== 2. Enhanced Anonymizer =====
import {
  anonymizeString,
  anonymize,
  anonymizeWithReport,
  anonymizeReversible,
  deanonymize,
  formatAnonymizationReport,
} from '../src/anonymize';

describe('Anonymizer - SSN detection', () => {
  it('redacts SSN patterns', () => {
    const result = anonymizeString('SSN: 123-45-6789', { ssns: true });
    expect(result).toContain('[SSN]');
    expect(result).not.toContain('123-45-6789');
  });

  it('does not redact non-SSN patterns', () => {
    const result = anonymizeString('version 1.2.3', { ssns: true });
    expect(result).not.toContain('[SSN]');
  });
});

describe('Anonymizer - Address detection', () => {
  it('redacts street addresses', () => {
    const result = anonymizeString('Lives at 123 Main St', { addresses: true });
    expect(result).toContain('[ADDRESS]');
  });

  it('redacts avenue addresses', () => {
    const result = anonymizeString('Office at 456 Park Avenue', { addresses: true });
    expect(result).toContain('[ADDRESS]');
  });
});

describe('Anonymizer - Report with new types', () => {
  it('includes SSN and address in report', () => {
    const data = {
      text: 'SSN: 123-45-6789, addr: 789 Oak Drive, email: test@foo.com',
    };
    const { report } = anonymizeWithReport(data, { ssns: true, addresses: true });
    expect(report.totalRedactions).toBeGreaterThan(0);
    expect(report.byType).toHaveProperty('email');
  });
});

// ===== 3. Report Exporter =====
import {
  exportToCsv,
  exportToJunit,
  exportToSarif,
  exportToPdf,
  exportToMarkdown,
  exportReport,
} from '../src/report-exporter';
import type { SuiteResult } from '../src/types';

const mockSuiteResult: SuiteResult = {
  name: 'test-suite',
  passed: 3,
  failed: 1,
  total: 4,
  duration_ms: 5000,
  results: [
    { name: 'test-1', passed: true, assertions: [{ name: 'a1', passed: true }], duration_ms: 1000 },
    { name: 'test-2', passed: true, assertions: [{ name: 'a2', passed: true }], duration_ms: 1200 },
    { name: 'test-3', passed: false, assertions: [{ name: 'a3', passed: false, expected: 'yes', actual: 'no', message: 'mismatch' }], duration_ms: 1500, error: 'Assertion failed' },
    { name: 'test-4', passed: true, assertions: [{ name: 'a4', passed: true }], duration_ms: 1300, tags: ['smoke'] },
  ],
};

describe('exportToCsv', () => {
  it('produces valid CSV', () => {
    const csv = exportToCsv(mockSuiteResult);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('test_name');
    expect(lines).toHaveLength(5); // header + 4 results
  });

  it('marks failures', () => {
    const csv = exportToCsv(mockSuiteResult);
    expect(csv).toContain('FAIL');
    expect(csv).toContain('PASS');
  });
});

describe('exportToJunit', () => {
  it('produces valid XML', () => {
    const xml = exportToJunit(mockSuiteResult);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('</testsuites>');
  });

  it('includes failure details', () => {
    const xml = exportToJunit(mockSuiteResult);
    expect(xml).toContain('<failure');
    expect(xml).toContain('Assertion failed');
  });

  it('reports correct test count', () => {
    const xml = exportToJunit(mockSuiteResult);
    expect(xml).toContain('tests="4"');
    expect(xml).toContain('failures="1"');
  });
});

describe('exportToSarif', () => {
  it('produces valid SARIF JSON', () => {
    const sarif = JSON.parse(exportToSarif(mockSuiteResult));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
  });

  it('only includes failures as results', () => {
    const sarif = JSON.parse(exportToSarif(mockSuiteResult));
    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0].level).toBe('error');
  });

  it('includes tool info', () => {
    const sarif = JSON.parse(exportToSarif(mockSuiteResult));
    expect(sarif.runs[0].tool.driver.name).toBe('agentprobe');
  });
});

describe('exportToPdf', () => {
  it('produces structured text report', () => {
    const pdf = exportToPdf(mockSuiteResult);
    expect(pdf).toContain('test-suite');
    expect(pdf).toContain('[PASS]');
    expect(pdf).toContain('[FAIL]');
    expect(pdf).toContain('Pass Rate');
  });

  it('accepts custom title', () => {
    const pdf = exportToPdf(mockSuiteResult, 'Custom Report');
    expect(pdf).toContain('Custom Report');
  });
});

describe('exportToMarkdown', () => {
  it('produces markdown table', () => {
    const md = exportToMarkdown(mockSuiteResult);
    expect(md).toContain('# ');
    expect(md).toContain('| Test |');
    expect(md).toContain('✅ PASS');
    expect(md).toContain('❌ FAIL');
  });
});

describe('exportReport', () => {
  it('dispatches to correct format', () => {
    expect(exportReport(mockSuiteResult, { format: 'csv' })).toContain('test_name');
    expect(exportReport(mockSuiteResult, { format: 'junit' })).toContain('<testsuites');
    expect(exportReport(mockSuiteResult, { format: 'json' })).toContain('"name"');
  });

  it('throws on unknown format', () => {
    expect(() => exportReport(mockSuiteResult, { format: 'xml' as any })).toThrow();
  });
});

// ===== 4. Retry Policy =====
import {
  RetryPolicy,
  CircuitBreaker,
  CircuitState,
  calculateDelay,
  classifyError,
  isRetryable,
  parseRetryConfig,
  DEFAULT_RETRY_CONFIG,
} from '../src/retry-policy';

describe('calculateDelay', () => {
  it('fixed strategy returns constant', () => {
    const config = { ...DEFAULT_RETRY_CONFIG, strategy: 'fixed' as const, jitter: false };
    expect(calculateDelay(1, config)).toBe(1000);
    expect(calculateDelay(3, config)).toBe(1000);
  });

  it('linear strategy scales linearly', () => {
    const config = { ...DEFAULT_RETRY_CONFIG, strategy: 'linear' as const, jitter: false };
    expect(calculateDelay(1, config)).toBe(1000);
    expect(calculateDelay(3, config)).toBe(3000);
  });

  it('exponential strategy doubles', () => {
    const config = { ...DEFAULT_RETRY_CONFIG, strategy: 'exponential' as const, jitter: false };
    expect(calculateDelay(1, config)).toBe(1000);
    expect(calculateDelay(2, config)).toBe(2000);
    expect(calculateDelay(3, config)).toBe(4000);
  });

  it('respects max_delay_ms', () => {
    const config = { ...DEFAULT_RETRY_CONFIG, strategy: 'exponential' as const, jitter: false, max_delay_ms: 5000 };
    expect(calculateDelay(10, config)).toBe(5000);
  });
});

describe('classifyError', () => {
  it('classifies timeout', () => {
    expect(classifyError(new Error('request timed out'))).toBe('timeout');
  });

  it('classifies rate limit by status', () => {
    expect(classifyError({ status: 429, message: '' })).toBe('rate_limit');
  });

  it('classifies server error', () => {
    expect(classifyError({ status: 500, message: '' })).toBe('server_error');
  });

  it('classifies network error', () => {
    expect(classifyError(new Error('ECONNREFUSED'))).toBe('network_error');
  });

  it('returns unknown for unrecognized', () => {
    expect(classifyError(new Error('something else'))).toBe('unknown');
  });
});

describe('isRetryable', () => {
  it('returns true for configured error types', () => {
    expect(isRetryable(new Error('timed out'), DEFAULT_RETRY_CONFIG)).toBe(true);
    expect(isRetryable({ status: 429, message: '' }, DEFAULT_RETRY_CONFIG)).toBe(true);
  });

  it('returns false for non-retryable errors', () => {
    expect(isRetryable(new Error('invalid input'), DEFAULT_RETRY_CONFIG)).toBe(false);
  });
});

describe('CircuitBreaker', () => {
  it('starts closed', () => {
    const cb = new CircuitBreaker({ threshold: 3, reset_ms: 1000 });
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    expect(cb.canExecute()).toBe(true);
  });

  it('opens after threshold failures', () => {
    const cb = new CircuitBreaker({ threshold: 3, reset_ms: 60000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.OPEN);
    expect(cb.canExecute()).toBe(false);
  });

  it('resets on success', () => {
    const cb = new CircuitBreaker({ threshold: 3, reset_ms: 60000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    expect(cb.getFailureCount()).toBe(0);
  });

  it('reset() clears state', () => {
    const cb = new CircuitBreaker({ threshold: 2, reset_ms: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.OPEN);
    cb.reset();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });
});

describe('RetryPolicy', () => {
  it('succeeds on first try', async () => {
    const policy = new RetryPolicy();
    const result = await policy.execute(async () => 'ok');
    expect(result.success).toBe(true);
    expect(result.result).toBe('ok');
    expect(result.attempts).toBe(1);
  });

  it('retries on retryable error', async () => {
    let attempt = 0;
    const policy = new RetryPolicy({ strategy: 'fixed', base_delay_ms: 10, jitter: false });
    const result = await policy.execute(async () => {
      attempt++;
      if (attempt < 3) throw new Error('timed out');
      return 'ok';
    });
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('fails after max attempts', async () => {
    const policy = new RetryPolicy({ max_attempts: 2, base_delay_ms: 10, jitter: false });
    const result = await policy.execute(async () => { throw new Error('timed out'); });
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
  });

  it('does not retry non-retryable errors', async () => {
    const policy = new RetryPolicy({ base_delay_ms: 10 });
    const result = await policy.execute(async () => { throw new Error('invalid input'); });
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it('respects circuit breaker', async () => {
    const policy = new RetryPolicy({
      max_attempts: 1,
      base_delay_ms: 10,
      circuit_breaker: { threshold: 2, reset_ms: 60000 },
    });

    // Trigger circuit breaker
    await policy.execute(async () => { throw new Error('server error'); });
    await policy.execute(async () => { throw new Error('server error'); });

    const result = await policy.execute(async () => 'ok');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Circuit breaker');
  });
});

describe('parseRetryConfig', () => {
  it('parses YAML-like config', () => {
    const config = parseRetryConfig({
      retry: {
        strategy: 'linear',
        max_attempts: 5,
        base_delay_ms: 500,
        max_delay_ms: 10000,
        retry_on: ['timeout'],
        circuit_breaker: { threshold: 3, reset_ms: 30000 },
      },
    });
    expect(config.strategy).toBe('linear');
    expect(config.max_attempts).toBe(5);
    expect(config.circuit_breaker?.threshold).toBe(3);
  });

  it('uses defaults for missing fields', () => {
    const config = parseRetryConfig({});
    expect(config.strategy).toBe('exponential');
    expect(config.max_attempts).toBe(3);
  });
});

// ===== 5. Metrics Collector =====
import {
  MetricsRegistry,
  Counter,
  Gauge,
  defaultRegistry,
  recordTestResult,
  getMetrics,
} from '../src/metrics';

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  it('creates counters', () => {
    const counter = registry.counter('test_total', 'Test counter');
    counter.inc({ status: 'pass' });
    counter.inc({ status: 'pass' });
    counter.inc({ status: 'fail' });
    expect(counter.get({ status: 'pass' })).toBe(2);
    expect(counter.get({ status: 'fail' })).toBe(1);
  });

  it('creates gauges', () => {
    const gauge = registry.gauge('active', 'Active count');
    gauge.set(5);
    gauge.inc();
    expect(gauge.get()).toBe(6);
    gauge.dec({}, 2);
    expect(gauge.get()).toBe(4);
  });

  it('serializes to Prometheus format', () => {
    const counter = registry.counter('requests_total', 'Total requests');
    counter.inc({ method: 'GET' }, 10);
    const output = registry.serialize();
    expect(output).toContain('# HELP requests_total');
    expect(output).toContain('# TYPE requests_total counter');
    expect(output).toContain('requests_total{method="GET"} 10');
  });

  it('serializes summaries with quantiles', () => {
    const summary = registry.summary('duration', 'Duration', [0.5, 0.95]);
    for (let i = 1; i <= 100; i++) summary.observe(i);
    const output = registry.serialize();
    expect(output).toContain('quantile="0.5"');
    expect(output).toContain('quantile="0.95"');
    expect(output).toContain('duration_count');
    expect(output).toContain('duration_sum');
  });

  it('serializes histograms with buckets', () => {
    const hist = registry.histogram('latency', 'Latency');
    hist.observe(0.1);
    hist.observe(1.5);
    const output = registry.serialize();
    expect(output).toContain('latency_bucket');
    expect(output).toContain('+Inf');
  });

  it('reset clears all metrics', () => {
    registry.counter('foo', 'bar').inc();
    registry.reset();
    expect(registry.getMetricNames()).toHaveLength(0);
  });

  it('getMetricNames lists registered metrics', () => {
    registry.counter('a', 'A');
    registry.gauge('b', 'B');
    expect(registry.getMetricNames()).toEqual(['a', 'b']);
  });
});

describe('recordTestResult', () => {
  beforeEach(() => {
    defaultRegistry.reset();
  });

  it('records pass/fail counts', () => {
    recordTestResult('test-1', true, 1500);
    recordTestResult('test-2', false, 2000);
    const output = getMetrics();
    expect(output).toContain('agentprobe_tests_total{status="pass"} 1');
    expect(output).toContain('agentprobe_tests_total{status="fail"} 1');
  });

  it('records cost by model', () => {
    recordTestResult('test-1', true, 1000, 'gpt-4', 0.05);
    const output = getMetrics();
    expect(output).toContain('agentprobe_cost_total{model="gpt-4"} 0.05');
  });
});

describe('Gauge labels', () => {
  it('supports labeled set', () => {
    const registry = new MetricsRegistry();
    const gauge = registry.gauge('temp', 'Temperature');
    gauge.set({ location: 'us-east' }, 42);
    gauge.set({ location: 'eu-west' }, 38);
    const output = registry.serialize();
    expect(output).toContain('location="us-east"');
    expect(output).toContain('location="eu-west"');
  });
});
