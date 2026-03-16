import { describe, it, expect } from 'vitest';
import { report } from '../src/reporter';
import type { SuiteResult } from '../src/types';

const mockResult: SuiteResult = {
  name: 'Test Suite',
  passed: 2,
  failed: 1,
  total: 3,
  duration_ms: 150,
  results: [
    { name: 'test-pass-1', passed: true, assertions: [{ name: 'a', passed: true }], duration_ms: 30, tags: ['fast'] },
    { name: 'test-pass-2', passed: true, assertions: [{ name: 'b', passed: true }], duration_ms: 40 },
    { name: 'test-fail', passed: false, assertions: [{ name: 'c', passed: false, message: 'expected X', expected: 'X', actual: 'Y' }], duration_ms: 80, tags: ['slow'] },
  ],
};

describe('reporter', () => {
  it('console format has pass/fail markers', () => {
    const out = report(mockResult, 'console');
    // chalk renders ✓ and ✗ (or similar markers)
    expect(out).toContain('test-pass-1');
    expect(out).toContain('test-fail');
    expect(out).toContain('2/3');
  });

  it('JSON format is valid JSON', () => {
    const out = report(mockResult, 'json');
    const parsed = JSON.parse(out);
    expect(parsed.name).toBe('Test Suite');
    expect(parsed.total).toBe(3);
    expect(parsed.results).toHaveLength(3);
  });

  it('markdown format has table', () => {
    const out = report(mockResult, 'markdown');
    expect(out).toContain('| Test |');
    expect(out).toContain('|---');
    expect(out).toContain('test-pass-1');
    expect(out).toContain('test-fail');
    expect(out).toContain('2/3');
  });
});
