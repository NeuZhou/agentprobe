/**
 * Agent Retry Policy - Configurable retry strategies with circuit breaker.
 *
 * Supports fixed, linear, and exponential backoff strategies.
 * Includes circuit breaker pattern to prevent cascading failures.
 */

export type RetryStrategy = 'fixed' | 'linear' | 'exponential';

export type RetryableError = 'timeout' | 'rate_limit' | 'server_error' | 'network_error' | 'unknown';

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  threshold: number;
  /** Time in ms before attempting reset */
  reset_ms: number;
}

export interface RetryPolicyConfig {
  strategy: RetryStrategy;
  max_attempts: number;
  base_delay_ms: number;
  max_delay_ms: number;
  retry_on: RetryableError[];
  jitter?: boolean;
  circuit_breaker?: CircuitBreakerConfig;
}

export const DEFAULT_RETRY_CONFIG: RetryPolicyConfig = {
  strategy: 'exponential',
  max_attempts: 3,
  base_delay_ms: 1000,
  max_delay_ms: 30000,
  retry_on: ['timeout', 'rate_limit', 'server_error'],
  jitter: true,
};

// ===== Circuit Breaker =====

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private threshold: number;
  private resetMs: number;

  constructor(config: CircuitBreakerConfig) {
    this.threshold = config.threshold;
    this.resetMs = config.reset_ms;
  }

  getState(): CircuitState {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.resetMs) {
        this.state = CircuitState.HALF_OPEN;
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const state = this.getState();
    return state === CircuitState.CLOSED || state === CircuitState.HALF_OPEN;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.threshold) {
      this.state = CircuitState.OPEN;
    }
  }

  reset(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
    this.lastFailureTime = 0;
  }

  getFailureCount(): number {
    return this.failureCount;
  }
}

// ===== Delay Calculation =====

export function calculateDelay(
  attempt: number,
  config: RetryPolicyConfig,
): number {
  let delay: number;
  switch (config.strategy) {
    case 'fixed':
      delay = config.base_delay_ms;
      break;
    case 'linear':
      delay = config.base_delay_ms * attempt;
      break;
    case 'exponential':
      delay = config.base_delay_ms * Math.pow(2, attempt - 1);
      break;
    default:
      delay = config.base_delay_ms;
  }

  delay = Math.min(delay, config.max_delay_ms);

  if (config.jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
  }

  return Math.round(delay);
}

// ===== Error Classification =====

export function classifyError(error: any): RetryableError {
  if (!error) return 'unknown';
  const msg = (error.message || String(error)).toLowerCase();
  const status = error.status || error.statusCode || 0;

  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('ETIMEDOUT')) {
    return 'timeout';
  }
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'rate_limit';
  }
  if (status >= 500 || msg.includes('server error') || msg.includes('internal error')) {
    return 'server_error';
  }
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network')) {
    return 'network_error';
  }
  return 'unknown';
}

export function isRetryable(error: any, config: RetryPolicyConfig): boolean {
  const errorType = classifyError(error);
  return config.retry_on.includes(errorType);
}

// ===== Retry Policy =====

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelay: number;
  errors: Array<{ attempt: number; error: any; delay: number }>;
}

export class RetryPolicy {
  private config: RetryPolicyConfig;
  private circuitBreaker?: CircuitBreaker;

  constructor(config: Partial<RetryPolicyConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    if (this.config.circuit_breaker) {
      this.circuitBreaker = new CircuitBreaker(this.config.circuit_breaker);
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<RetryResult<T>> {
    const errors: Array<{ attempt: number; error: any; delay: number }> = [];
    let totalDelay = 0;

    for (let attempt = 1; attempt <= this.config.max_attempts; attempt++) {
      // Check circuit breaker
      if (this.circuitBreaker && !this.circuitBreaker.canExecute()) {
        return {
          success: false,
          error: new Error('Circuit breaker is open'),
          attempts: attempt,
          totalDelay,
          errors,
        };
      }

      try {
        const result = await fn();
        this.circuitBreaker?.recordSuccess();
        return { success: true, result, attempts: attempt, totalDelay, errors };
      } catch (err: any) {
        this.circuitBreaker?.recordFailure();
        const delay = attempt < this.config.max_attempts
          ? calculateDelay(attempt, this.config)
          : 0;
        errors.push({ attempt, error: err, delay });
        totalDelay += delay;

        if (attempt >= this.config.max_attempts || !isRetryable(err, this.config)) {
          return { success: false, error: err, attempts: attempt, totalDelay, errors };
        }

        if (delay > 0) {
          await sleep(delay);
        }
      }
    }

    return { success: false, error: new Error('Max attempts reached'), attempts: this.config.max_attempts, totalDelay, errors };
  }

  getCircuitBreaker(): CircuitBreaker | undefined {
    return this.circuitBreaker;
  }

  getConfig(): RetryPolicyConfig {
    return { ...this.config };
  }
}

// ===== Parse YAML config =====

export function parseRetryConfig(yamlConfig: Record<string, any>): RetryPolicyConfig {
  const retry = yamlConfig.retry || yamlConfig;
  return {
    strategy: retry.strategy || 'exponential',
    max_attempts: retry.max_attempts || 3,
    base_delay_ms: retry.base_delay_ms || 1000,
    max_delay_ms: retry.max_delay_ms || 30000,
    retry_on: retry.retry_on || ['timeout', 'rate_limit', 'server_error'],
    jitter: retry.jitter !== false,
    circuit_breaker: retry.circuit_breaker ? {
      threshold: retry.circuit_breaker.threshold || 5,
      reset_ms: retry.circuit_breaker.reset_ms || 60000,
    } : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
