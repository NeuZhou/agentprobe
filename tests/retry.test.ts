import { describe, it, expect } from 'vitest';
import { withRetry, formatRetryInfo } from '../src/retry';
import type { TestResult } from '../src/types';

function makeResult(passed: boolean, name = 'test'): TestResult {
  return { name, passed, assertions: [], duration_ms: 10 };
}

describe('retry', () => {
  it('passes on first attempt without retry', async () => {
    let calls = 0;
    const result = await withRetry(() => { calls++; return Promise.resolve(makeResult(true)); }, { retries: 2 });
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it('retries and passes on second attempt', async () => {
    let calls = 0;
    const result = await withRetry(() => {
      calls++;
      return Promise.resolve(makeResult(calls >= 2));
    }, { retries: 3 });
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('fails after all retries exhausted', async () => {
    const result = await withRetry(() => Promise.resolve(makeResult(false)), { retries: 2 });
    expect(result.passed).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.attemptResults).toHaveLength(3);
  });

  it('respects retry_delay_ms', async () => {
    const start = Date.now();
    let calls = 0;
    await withRetry(() => { calls++; return Promise.resolve(makeResult(calls >= 3)); }, { retries: 2, retry_delay_ms: 50 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(80); // ~2 delays of 50ms
  });
});

describe('formatRetryInfo', () => {
  it('returns empty for single attempt', () => {
    expect(formatRetryInfo({ ...makeResult(true), attempts: 1, attemptResults: [] })).toBe('');
  });

  it('shows passed on Nth attempt', () => {
    const info = formatRetryInfo({ ...makeResult(true), attempts: 3, attemptResults: [] });
    expect(info).toContain('attempt 3');
  });
});
