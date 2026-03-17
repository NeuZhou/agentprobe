/**
 * New Feature: Test Result Summary / Statistics
 * Aggregate statistics across test runs for trend analysis.
 */
import { describe, it, expect } from 'vitest';
import { aggregateResults, type AggregateStats } from '../src/stats-aggregator';
import type { SuiteResult, TestResult } from '../src/types';

const makeResult = (overrides: Partial<TestResult> = {}): TestResult => ({
  name: 'test-1',
  passed: true,
  assertions: [{ name: 'a1', passed: true }],
  duration_ms: 100,
  ...overrides,
});

const makeSuite = (overrides: Partial<SuiteResult> = {}): SuiteResult => ({
  name: 'suite-1',
  passed: 3,
  failed: 1,
  total: 4,
  duration_ms: 500,
  results: [
    makeResult({ name: 'test-1', passed: true, duration_ms: 100 }),
    makeResult({ name: 'test-2', passed: true, duration_ms: 150 }),
    makeResult({ name: 'test-3', passed: true, duration_ms: 200 }),
    makeResult({ name: 'test-4', passed: false, duration_ms: 50, error: 'Assertion failed' }),
  ],
  ...overrides,
});

describe('Stats Aggregator', () => {
  it('should calculate pass rate', () => {
    const stats = aggregateResults([makeSuite()]);
    expect(stats.passRate).toBe(0.75); // 3/4
  });

  it('should calculate total/passed/failed counts', () => {
    const stats = aggregateResults([makeSuite()]);
    expect(stats.totalTests).toBe(4);
    expect(stats.totalPassed).toBe(3);
    expect(stats.totalFailed).toBe(1);
  });

  it('should calculate duration stats', () => {
    const stats = aggregateResults([makeSuite()]);
    expect(stats.avgDuration).toBeDefined();
    expect(stats.maxDuration).toBe(200);
    expect(stats.minDuration).toBe(50);
    expect(stats.totalDuration).toBe(500);
  });

  it('should aggregate multiple suites', () => {
    const suite1 = makeSuite({ name: 'suite-1' });
    const suite2 = makeSuite({
      name: 'suite-2',
      passed: 5,
      failed: 0,
      total: 5,
      duration_ms: 300,
      results: Array.from({ length: 5 }, (_, i) =>
        makeResult({ name: `suite2-test-${i}`, passed: true, duration_ms: 60 }),
      ),
    });
    const stats = aggregateResults([suite1, suite2]);
    expect(stats.totalTests).toBe(9);
    expect(stats.totalPassed).toBe(8);
    expect(stats.totalFailed).toBe(1);
    expect(stats.suiteCount).toBe(2);
  });

  it('should list slowest tests', () => {
    const stats = aggregateResults([makeSuite()]);
    expect(stats.slowestTests).toBeDefined();
    expect(stats.slowestTests.length).toBeGreaterThan(0);
    expect(stats.slowestTests[0].duration_ms).toBe(200);
  });

  it('should list failed test names', () => {
    const stats = aggregateResults([makeSuite()]);
    expect(stats.failedTests).toBeDefined();
    expect(stats.failedTests.length).toBe(1);
    expect(stats.failedTests[0]).toBe('test-4');
  });

  it('should handle empty input', () => {
    const stats = aggregateResults([]);
    expect(stats.totalTests).toBe(0);
    expect(stats.passRate).toBe(1); // 0/0 → 100%
  });

  it('should handle all-pass suites', () => {
    const suite = makeSuite({
      passed: 4,
      failed: 0,
      total: 4,
      results: Array.from({ length: 4 }, (_, i) =>
        makeResult({ name: `test-${i}`, passed: true }),
      ),
    });
    const stats = aggregateResults([suite]);
    expect(stats.passRate).toBe(1);
    expect(stats.failedTests.length).toBe(0);
  });
});
