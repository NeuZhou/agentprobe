/**
 * Test Retry for Flaky Tests
 */

import type { TestResult } from './types';

export interface RetryConfig {
  retries: number;
  retry_delay_ms?: number;
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

    if (attempt < maxAttempts && config.retry_delay_ms) {
      await sleep(config.retry_delay_ms);
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
