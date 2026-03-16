/**
 * Rate Limiter - Prevent overwhelming APIs during testing.
 *
 * Token-bucket algorithm with per-provider and global rate limits.
 */

export interface RateLimitConfig {
  /** Requests per minute per provider, e.g. { openai: 60, anthropic: 40 } */
  [provider: string]: number;
}

export interface RateLimiterOptions {
  /** Per-provider limits (requests per minute) */
  limits: RateLimitConfig;
  /** Global limit across all providers (requests per minute) */
  global?: number;
}

interface Bucket {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per ms
  lastRefill: number;
}

/**
 * Token-bucket rate limiter for API calls during testing.
 */
export class RateLimiter {
  private buckets: Map<string, Bucket> = new Map();
  private globalBucket?: Bucket;
  constructor(options: RateLimiterOptions) {
    // Initialize per-provider buckets
    for (const [provider, rpm] of Object.entries(options.limits)) {
      if (typeof rpm === 'number') {
        this.buckets.set(provider, this.createBucket(rpm));
      }
    }

    // Initialize global bucket
    if (options.global) {
      this.globalBucket = this.createBucket(options.global);
    }
  }

  private createBucket(rpm: number): Bucket {
    return {
      tokens: rpm,
      maxTokens: rpm,
      refillRate: rpm / 60000, // tokens per ms
      lastRefill: Date.now(),
    };
  }

  private refillBucket(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = now;
  }

  private tryConsume(bucket: Bucket): boolean {
    this.refillBucket(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  private waitTimeMs(bucket: Bucket): number {
    this.refillBucket(bucket);
    if (bucket.tokens >= 1) return 0;
    const needed = 1 - bucket.tokens;
    return Math.ceil(needed / bucket.refillRate);
  }

  /**
   * Acquire a rate limit token for the given provider.
   * Blocks (via promise) if rate limit is exceeded.
   */
  async acquire(provider: string): Promise<void> {
    // Check provider bucket
    const bucket = this.buckets.get(provider);
    if (bucket) {
      const wait = this.waitTimeMs(bucket);
      if (wait > 0) {
        await this.sleep(wait);
      }
      this.tryConsume(bucket);
    }

    // Check global bucket
    if (this.globalBucket) {
      const wait = this.waitTimeMs(this.globalBucket);
      if (wait > 0) {
        await this.sleep(wait);
      }
      this.tryConsume(this.globalBucket);
    }
  }

  /**
   * Check if a request can proceed without waiting.
   */
  canProceed(provider: string): boolean {
    const bucket = this.buckets.get(provider);
    if (bucket) {
      this.refillBucket(bucket);
      if (bucket.tokens < 1) return false;
    }
    if (this.globalBucket) {
      this.refillBucket(this.globalBucket);
      if (this.globalBucket.tokens < 1) return false;
    }
    return true;
  }

  /**
   * Get remaining tokens for a provider.
   */
  remaining(provider: string): number {
    const bucket = this.buckets.get(provider);
    if (!bucket) return Infinity;
    this.refillBucket(bucket);
    return Math.floor(bucket.tokens);
  }

  /**
   * Get remaining global tokens.
   */
  globalRemaining(): number {
    if (!this.globalBucket) return Infinity;
    this.refillBucket(this.globalBucket);
    return Math.floor(this.globalBucket.tokens);
  }

  /**
   * Get estimated wait time in ms for a provider.
   */
  estimatedWait(provider: string): number {
    let maxWait = 0;
    const bucket = this.buckets.get(provider);
    if (bucket) {
      maxWait = Math.max(maxWait, this.waitTimeMs(bucket));
    }
    if (this.globalBucket) {
      maxWait = Math.max(maxWait, this.waitTimeMs(this.globalBucket));
    }
    return maxWait;
  }

  /**
   * Reset all buckets to full capacity.
   */
  reset(): void {
    for (const bucket of this.buckets.values()) {
      bucket.tokens = bucket.maxTokens;
      bucket.lastRefill = Date.now();
    }
    if (this.globalBucket) {
      this.globalBucket.tokens = this.globalBucket.maxTokens;
      this.globalBucket.lastRefill = Date.now();
    }
  }

  /**
   * Get status of all rate limiters.
   */
  status(): Record<string, { remaining: number; limit: number }> {
    const result: Record<string, { remaining: number; limit: number }> = {};
    for (const [provider, bucket] of this.buckets) {
      this.refillBucket(bucket);
      result[provider] = {
        remaining: Math.floor(bucket.tokens),
        limit: bucket.maxTokens,
      };
    }
    if (this.globalBucket) {
      this.refillBucket(this.globalBucket);
      result['_global'] = {
        remaining: Math.floor(this.globalBucket.tokens),
        limit: this.globalBucket.maxTokens,
      };
    }
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a rate limiter from YAML-style config.
 * Accepts strings like "60/min" or plain numbers (interpreted as per-minute).
 */
export function createRateLimiter(config: Record<string, string | number>): RateLimiter {
  const limits: RateLimitConfig = {};
  let global: number | undefined;

  for (const [key, value] of Object.entries(config)) {
    const rpm = parseRate(value);
    if (key === 'global') {
      global = rpm;
    } else {
      limits[key] = rpm;
    }
  }

  return new RateLimiter({ limits, global });
}

/**
 * Parse a rate string like "60/min" into requests per minute.
 */
export function parseRate(rate: string | number): number {
  if (typeof rate === 'number') return rate;
  const match = rate.match(/^(\d+)\/(min|sec|hour|s|m|h)$/i);
  if (!match) {
    const n = parseInt(rate, 10);
    if (isNaN(n)) throw new Error(`Invalid rate format: "${rate}"`);
    return n;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'sec':
    case 's':
      return value * 60;
    case 'min':
    case 'm':
      return value;
    case 'hour':
    case 'h':
      return value / 60;
    default:
      return value;
  }
}
