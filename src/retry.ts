/**
 * Test Retry for Flaky Tests
 */

import type { TestResult } from './types';

export type BackoffStrategy = 'fixed' | 'linear' | 'exponential';

export type RetryableError = 'adapter_error' | 'timeout' | 'rate_limit' | 'assertion_failed' | 'unknown';

export interface RetryConfig {
  retries: number;
  retry_delay_ms?: number;
  backoff?: BackoffStrategy;
  retry_on?: RetryableError[];
  skip_on?: RetryableError[];
}

/**
 * Classify a test failure into an error category.
 */
export function classifyError(result: TestResult): RetryableError {
  const err = (result.error || '').toLowerCase();
  if (err.includes('timeout') || err.includes('timed out')) return 'timeout';
  if (err.includes('rate limit') || err.includes('429') || err.includes('rate_limit')) return 'rate_limit';
  if (err.includes('adapter') || err.includes('connection') || err.includes('network')) return 'adapter_error';
  if (err.includes('assert') || err.includes('expect')) return 'assertion_failed';
  // Also check assertions for deterministic failures
  if (result.assertions.some(a => !a.passed)) return 'assertion_failed';
  return 'unknown';
}

/**
 * Determine if a failed result should be retried based on config.
 */
export function shouldRetry(result: TestResult, config: RetryConfig): boolean {
  const errorType = classifyError(result);
  if (config.skip_on?.includes(errorType)) return false;
  if (config.retry_on && config.retry_on.length > 0) return config.retry_on.includes(errorType);
  return true;
}

/**
 * Compute delay for a given attempt using backoff strategy.
 */
export function computeBackoffDelay(attempt: number, baseDelay: number, strategy: BackoffStrategy = 'fixed'): number {
  switch (strategy) {
    case 'exponential': return baseDelay * Math.pow(2, attempt - 1);
    case 'linear': return baseDelay * attempt;
    case 'fixed':
    default: return baseDelay;
  }
}

export interface RetryResult extends TestResult {
  attempts?: number;
  attemptResults?: TestResult[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a test function with retry support.
 * Returns the final result with attempt info.
 */
export async function withRetry(
  runFn: () => Promise<TestResult>,
  config: RetryConfig,
): Promise<RetryResult> {
  const attemptResults: TestResult[] = [];
  const maxAttempts = config.retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runFn();
    attemptResults.push(result);

    if (result.passed) {
      return {
        ...result,
        name: attempt > 1 ? `${result.name}` : result.name,
        attempts: attempt,
        attemptResults,
      };
    }

    // Check if this error type should be retried
    if (attempt < maxAttempts && !shouldRetry(result, config)) {
      // Don't retry deterministic failures
      return { ...result, attempts: attempt, attemptResults };
    }

    if (attempt < maxAttempts) {
      const baseDelay = config.retry_delay_ms || 0;
      if (baseDelay > 0) {
        const delay = computeBackoffDelay(attempt, baseDelay, config.backoff);
        await sleep(delay);
      }
    }
  }

  // All attempts failed
  const last = attemptResults[attemptResults.length - 1];
  return {
    ...last,
    attempts: maxAttempts,
    attemptResults,
  };
}

/**
 * Format retry info for display.
 */
export function formatRetryInfo(result: RetryResult): string {
  if (!result.attempts || result.attempts <= 1) return '';
  if (result.passed) {
    return ` (passed on attempt ${result.attempts})`;
  }
  return ` (failed all ${result.attempts} attempts)`;
}
