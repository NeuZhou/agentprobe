import { describe, it, expect } from 'vitest';
import { analyzeCoverage } from '../src/coverage';
import type { SuiteResult } from '../src/types';
import { makeTrace, toolCall } from './helpers';

function makeSuiteResult(traces: ReturnType<typeof makeTrace>[]): SuiteResult {
  return {
    name: 'test',
    passed: traces.length,
    failed: 0,
    total: traces.length,
    duration_ms: 100,
    results: traces.map((t, i) => ({
      name: `test-${i}`,
      passed: true,
      assertions: [],
      duration_ms: 10,
      trace: t,
    })),
  };
}

describe('coverage', () => {
  it('counts tool calls correctly', () => {
    const suite = makeSuiteResult([
      makeTrace([toolCall('search'), toolCall('search'), toolCall('write')]),
    ]);
    const cov = analyzeCoverage(suite);
    expect(cov.callCounts['search']).toBe(2);
    expect(cov.callCounts['write']).toBe(1);
  });

  it('identifies uncalled tools', () => {
    const suite = makeSuiteResult([makeTrace([toolCall('search')])]);
    const cov = analyzeCoverage(suite, ['search', 'write', 'exec']);
    expect(cov.uncalledTools).toContain('write');
    expect(cov.uncalledTools).toContain('exec');
    expect(cov.uncalledTools).not.toContain('search');
  });

  it('calculates coverage percentage', () => {
    const suite = makeSuiteResult([makeTrace([toolCall('search')])]);
    const cov = analyzeCoverage(suite, ['search', 'write']);
    expect(cov.coveragePercent).toBe(50);
  });

  it('returns 100% when all tools called', () => {
    const suite = makeSuiteResult([makeTrace([toolCall('a'), toolCall('b')])]);
    const cov = analyzeCoverage(suite, ['a', 'b']);
    expect(cov.coveragePercent).toBe(100);
  });

  it('returns 100% with no declared tools and no calls', () => {
    const suite = makeSuiteResult([makeTrace([])]);
    const cov = analyzeCoverage(suite);
    expect(cov.coveragePercent).toBe(100);
  });
});
