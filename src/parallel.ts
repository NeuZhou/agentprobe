/**
 * Parallel Test Execution — v4.9.0
 *
 * Smart parallel runner with adapter grouping, rate limiting, and live progress.
 */

import type { TestCase, TestResult, SuiteResult } from './types';

// ===== Types =====

export interface ParallelConfig {
  concurrency: number;
  respectRateLimits?: boolean;
  groupByAdapter?: boolean;
  progressCallback?: (state: ParallelProgress) => void;
}

export interface ParallelProgress {
  total: number;
  completed: number;
  running: number;
  queued: number;
  passed: number;
  failed: number;
  eta_ms: number;
  elapsed_ms: number;
}

export interface TestExecutor {
  (test: TestCase): Promise<TestResult>;
}

// ===== ParallelRunner =====

export class ParallelRunner {
  private concurrency: number;
  // @ts-expect-error reserved for future rate-limit enforcement
  private _respectRateLimits: boolean;
  private groupByAdapter: boolean;
  private progressCallback?: (state: ParallelProgress) => void;

  constructor(concurrency: number = 4, config?: Partial<ParallelConfig>) {
    this.concurrency = Math.max(1, concurrency);
    this._respectRateLimits = config?.respectRateLimits ?? true;
    this.groupByAdapter = config?.groupByAdapter ?? true;
    this.progressCallback = config?.progressCallback;
  }

  async run(tests: TestCase[], executor: TestExecutor): Promise<SuiteResult> {
    const startTime = Date.now();
    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;

    // Group tests by adapter if enabled
    const ordered = this.groupByAdapter ? this._groupByAdapter(tests) : tests;

    // Execute with concurrency control
    const queue = [...ordered];
    const running = new Set<Promise<void>>();
    let completed = 0;

    const runNext = async (): Promise<void> => {
      const test = queue.shift();
      if (!test) return;

      try {
        const result = await executor(test);
        results.push(result);
        if (result.passed) passed++; else failed++;
      } catch (err) {
        results.push({
          name: test.name,
          passed: false,
          assertions: [],
          duration_ms: 0,
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }

      completed++;
      this._reportProgress(tests.length, completed, running.size, queue.length, passed, failed, startTime);
    };

    const process = async (): Promise<void> => {
      while (queue.length > 0) {
        if (running.size >= this.concurrency) {
          await Promise.race(running);
        }
        const p = runNext();
        running.add(p);
        p.finally(() => running.delete(p));
      }
      await Promise.all(running);
    };

    await process();

    const duration_ms = Date.now() - startTime;
    return {
      name: 'parallel-suite',
      passed,
      failed,
      total: tests.length,
      duration_ms,
      results,
    };
  }

  private _groupByAdapter(tests: TestCase[]): TestCase[] {
    const groups = new Map<string, TestCase[]>();
    for (const t of tests) {
      const adapter = t.agent?.module ?? t.agent?.command ?? 'default';
      const list = groups.get(adapter) ?? [];
      list.push(t);
      groups.set(adapter, list);
    }
    // Interleave groups so different adapters run concurrently
    const result: TestCase[] = [];
    const iterators = [...groups.values()].map(g => g[Symbol.iterator]());
    let active = true;
    while (active) {
      active = false;
      for (const iter of iterators) {
        const next = iter.next();
        if (!next.done) {
          result.push(next.value);
          active = true;
        }
      }
    }
    return result;
  }

  private _reportProgress(
    total: number, completed: number, running: number,
    queued: number, passed: number, failed: number, startTime: number
  ): void {
    if (!this.progressCallback) return;
    const elapsed = Date.now() - startTime;
    const avgMs = completed > 0 ? elapsed / completed : 0;
    const remaining = total - completed;
    this.progressCallback({
      total, completed, running, queued, passed, failed,
      eta_ms: Math.round(avgMs * remaining),
      elapsed_ms: elapsed,
    });
  }
}

/**
 * Render a text progress bar.
 */
export function renderParallelProgress(state: ParallelProgress): string {
  const pct = state.total > 0 ? state.completed / state.total : 0;
  const barLen = 30;
  const filled = Math.round(pct * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  const etaSec = Math.round(state.eta_ms / 1000);
  return `[${bar}] ${state.completed}/${state.total} | ✅ ${state.passed} ❌ ${state.failed} | ETA ${etaSec}s`;
}

/**
 * Estimate optimal concurrency based on test count and adapter count.
 */
export function estimateConcurrency(testCount: number, adapterCount: number = 1): number {
  const base = Math.min(testCount, 8);
  return Math.max(1, Math.min(base, adapterCount * 4));
}
