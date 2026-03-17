/**
 * Tests for src/model-migration.ts - Model migration testing and comparison
 */
import { describe, it, expect } from 'vitest';
import {
  compareMigrationResults,
  formatMigrationReport,
  type ModelEndpoint,
  type MigrationReport,
} from '../src/model-migration';
import type { SuiteResult, TestResult, AgentTrace } from '../src/types';

function makeTrace(steps: number, tokensPerStep = 100): AgentTrace {
  return {
    id: 'trace-1',
    timestamp: '2026-01-01T00:00:00Z',
    steps: Array.from({ length: steps }, (_, i) => ({
      type: 'llm_call' as const,
      timestamp: `2026-01-01T00:00:0${i}Z`,
      data: { model: 'gpt-4', tokens: { input: tokensPerStep, output: tokensPerStep } },
      duration_ms: 100,
    })),
    metadata: {},
  };
}

function makeResult(name: string, passed: boolean, steps = 3, duration = 500): TestResult {
  return {
    name,
    passed,
    duration_ms: duration,
    assertions: passed
      ? [{ key: 'max_steps', passed: true, message: 'ok' }]
      : [{ key: 'max_steps', passed: false, message: 'failed' }],
    trace: makeTrace(steps),
  };
}

function makeSuiteResult(results: TestResult[]): SuiteResult {
  return {
    suite: 'test-suite',
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    total: results.length,
    duration_ms: results.reduce((s, r) => s + r.duration_ms, 0),
    results,
  };
}

describe('Model Migration', () => {
  const fromEndpoint: ModelEndpoint = { adapter: 'openai', model: 'gpt-3.5-turbo' };
  const toEndpoint: ModelEndpoint = { adapter: 'openai', model: 'gpt-4' };

  describe('compareMigrationResults', () => {
    it('should compare identical results with 100% quality', () => {
      const results = [makeResult('test1', true), makeResult('test2', true)];
      const suite = makeSuiteResult(results);
      const report = compareMigrationResults(fromEndpoint, toEndpoint, suite, suite);

      expect(report.totalTests).toBe(2);
      expect(report.behaviorChanges).toBe(0);
      expect(report.newFailures).toBe(0);
      expect(report.newPasses).toBe(0);
      expect(report.qualityScore).toBe(100);
    });

    it('should detect new failures', () => {
      const fromSuite = makeSuiteResult([makeResult('test1', true), makeResult('test2', true)]);
      const toSuite = makeSuiteResult([makeResult('test1', true), makeResult('test2', false)]);
      const report = compareMigrationResults(fromEndpoint, toEndpoint, fromSuite, toSuite);

      expect(report.newFailures).toBe(1);
      expect(report.behaviorChanges).toBeGreaterThanOrEqual(1);
      expect(report.qualityScore).toBeLessThan(100);
    });

    it('should detect new passes', () => {
      const fromSuite = makeSuiteResult([makeResult('test1', false), makeResult('test2', true)]);
      const toSuite = makeSuiteResult([makeResult('test1', true), makeResult('test2', true)]);
      const report = compareMigrationResults(fromEndpoint, toEndpoint, fromSuite, toSuite);

      expect(report.newPasses).toBe(1);
    });

    it('should detect behavior changes from step count differences', () => {
      const fromR = makeResult('test1', true, 3);
      const toR = makeResult('test1', true, 10); // same pass but very different steps
      const fromSuite = makeSuiteResult([fromR]);
      const toSuite = makeSuiteResult([toR]);
      const report = compareMigrationResults(fromEndpoint, toEndpoint, fromSuite, toSuite);

      expect(report.behaviorChanges).toBe(1);
    });

    it('should skip unmatched tests', () => {
      const fromSuite = makeSuiteResult([makeResult('test1', true)]);
      const toSuite = makeSuiteResult([makeResult('test2', true)]); // different name
      const report = compareMigrationResults(fromEndpoint, toEndpoint, fromSuite, toSuite);

      expect(report.totalTests).toBe(0);
    });

    it('should compute cost and latency diffs', () => {
      const fromSuite = makeSuiteResult([makeResult('test1', true, 3, 500)]);
      const toSuite = makeSuiteResult([makeResult('test1', true, 3, 300)]);
      const report = compareMigrationResults(fromEndpoint, toEndpoint, fromSuite, toSuite);

      expect(report.latencyDiff).toBe(-200); // faster
    });

    it('should build a summary string', () => {
      const fromSuite = makeSuiteResult([makeResult('test1', true)]);
      const toSuite = makeSuiteResult([makeResult('test1', true)]);
      const report = compareMigrationResults(fromEndpoint, toEndpoint, fromSuite, toSuite);

      expect(report.summary).toContain('gpt-3.5-turbo');
      expect(report.summary).toContain('gpt-4');
    });

    it('should handle empty suites', () => {
      const empty = makeSuiteResult([]);
      const report = compareMigrationResults(fromEndpoint, toEndpoint, empty, empty);
      expect(report.totalTests).toBe(0);
      expect(report.qualityScore).toBe(100);
    });
  });

  describe('formatMigrationReport', () => {
    it('should format a clean migration report as Markdown', () => {
      const fromSuite = makeSuiteResult([makeResult('test1', true), makeResult('test2', true)]);
      const report = compareMigrationResults(fromEndpoint, toEndpoint, fromSuite, fromSuite);
      const md = formatMigrationReport(report);

      expect(md).toContain('## 🔄 Model Migration Report');
      expect(md).toContain('gpt-3.5-turbo');
      expect(md).toContain('gpt-4');
      expect(md).toContain('Quality Score');
    });

    it('should include changed tests section when behavior changed', () => {
      const fromSuite = makeSuiteResult([makeResult('test1', true, 3)]);
      const toSuite = makeSuiteResult([makeResult('test1', false, 10)]);
      const report = compareMigrationResults(fromEndpoint, toEndpoint, fromSuite, toSuite);
      const md = formatMigrationReport(report);

      expect(md).toContain('Changed Tests');
      expect(md).toContain('test1');
    });
  });
});
