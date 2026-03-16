/**
 * Built-in Plugin: Smart Retry
 *
 * Smart retry with exponential backoff for flaky tests.
 * Wraps the existing retry logic with plugin hooks.
 */

import type { AgentProbePlugin } from '../plugins';
import type { TestResult } from '../types';
import { classifyError, shouldRetry, computeBackoffDelay, type BackoffStrategy, type RetryableError } from '../retry';

export interface SmartRetryConfig {
  /** Max retries per test (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelay?: number;
  /** Backoff strategy (default: exponential) */
  backoff?: BackoffStrategy;
  /** Only retry on these error types */
  retryOn?: RetryableError[];
  /** Never retry on these error types */
  skipOn?: RetryableError[];
  /** Maximum total retry time per test in ms */
  maxRetryTime?: number;
  /** Jitter factor (0-1) to add randomness to delays */
  jitter?: number;
}

export interface RetryRecord {
  testName: string;
  attempts: number;
  errorType: RetryableError;
  delays: number[];
  finalPassed: boolean;
}

export class SmartRetryTracker {
  private records: RetryRecord[] = [];
  readonly config: SmartRetryConfig;

  constructor(config: SmartRetryConfig = {}) {
    this.config = {
      maxRetries: 3,
      initialDelay: 1000,
      backoff: 'exponential',
      jitter: 0.1,
      ...config,
    };
  }

  computeDelay(attempt: number): number {
    const base = computeBackoffDelay(
      attempt,
      this.config.initialDelay ?? 1000,
      this.config.backoff,
    );
    if (this.config.jitter && this.config.jitter > 0) {
      const jitterAmount = base * this.config.jitter;
      return Math.round(base + (Math.random() * 2 - 1) * jitterAmount);
    }
    return base;
  }

  shouldRetry(result: TestResult, attempt: number): boolean {
    if (attempt >= (this.config.maxRetries ?? 3)) return false;
    const errorType = classifyError(result);
    if (this.config.skipOn?.includes(errorType)) return false;
    if (this.config.retryOn && !this.config.retryOn.includes(errorType)) return false;
    return shouldRetry(
      result,
      { retries: this.config.maxRetries!, retry_on: this.config.retryOn, skip_on: this.config.skipOn },
    );
  }

  recordRetry(testName: string, attempts: number, errorType: RetryableError, delays: number[], passed: boolean): void {
    this.records.push({ testName, attempts, errorType, delays, finalPassed: passed });
  }

  getRecords(): RetryRecord[] {
    return [...this.records];
  }

  getFlakyTests(): RetryRecord[] {
    return this.records.filter((r) => r.attempts > 1 && r.finalPassed);
  }

  reset(): void {
    this.records = [];
  }

  formatReport(): string {
    const lines = ['Smart Retry Report', '='.repeat(40)];
    const flaky = this.getFlakyTests();
    lines.push(`  Total retried: ${this.records.length}`);
    lines.push(`  Flaky (passed after retry): ${flaky.length}`);
    for (const r of this.records) {
      lines.push(`  ${r.testName}: ${r.attempts} attempts, ${r.errorType}, ${r.finalPassed ? 'PASSED' : 'FAILED'}`);
    }
    return lines.join('\n');
  }
}

/**
 * Create the smart-retry plugin instance.
 */
export function createRetryPlugin(config: SmartRetryConfig = {}): AgentProbePlugin & { retryTracker: SmartRetryTracker } {
  const retryTracker = new SmartRetryTracker(config);

  return {
    name: 'smart-retry',
    version: '1.0.0',
    type: 'lifecycle',
    hooks: {
      onSuiteStart() {
        retryTracker.reset();
      },
    },
    retryTracker,
  };
}

export default createRetryPlugin;
