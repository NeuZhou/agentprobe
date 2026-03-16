/**
 * Streaming Progress — Real-time progress during test execution.
 *
 * @example
 * ```
 * Running tests... [████████░░] 80% (8/10)
 *   ✓ test-1 (0.5s, $0.002)
 *   ✓ test-2 (1.2s, $0.005)
 *   ✗ test-3 FAILED: expected tool_called:search (0.8s)
 *   ⏳ test-4 running...
 * ```
 */

import type { SuiteResult } from './types';

// ===== Types =====

export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface ProgressEntry {
  name: string;
  status: TestStatus;
  duration_ms?: number;
  cost_usd?: number;
  error?: string;
}

export interface ProgressState {
  total: number;
  completed: number;
  entries: ProgressEntry[];
  startTime: number;
}

export interface ProgressOptions {
  /** Width of the progress bar in characters (default: 30) */
  barWidth?: number;
  /** Show cost per test (default: true) */
  showCost?: boolean;
  /** Show duration per test (default: true) */
  showDuration?: boolean;
  /** Use color codes (default: true) */
  color?: boolean;
  /** Stream to write output (default: process.stderr) */
  stream?: NodeJS.WritableStream;
}

export type ProgressCallback = (state: ProgressState) => void;

// ===== Progress Bar Rendering =====

const BLOCK_FULL = '█';
const BLOCK_EMPTY = '░';

/**
 * Render a progress bar string.
 */
export function renderProgressBar(completed: number, total: number, width = 30): string {
  if (total === 0) return `[${'░'.repeat(width)}] 0%`;
  const pct = Math.min(completed / total, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = BLOCK_FULL.repeat(filled) + BLOCK_EMPTY.repeat(empty);
  const pctStr = `${Math.round(pct * 100)}%`;
  return `[${bar}] ${pctStr} (${completed}/${total})`;
}

/**
 * Format a single test entry for display.
 */
export function formatEntry(entry: ProgressEntry, options: ProgressOptions = {}): string {
  const { showCost = true, showDuration = true } = options;

  const durationStr =
    showDuration && entry.duration_ms !== undefined
      ? `${(entry.duration_ms / 1000).toFixed(1)}s`
      : '';
  const costStr =
    showCost && entry.cost_usd !== undefined ? `$${entry.cost_usd.toFixed(4)}` : '';
  const suffix = [durationStr, costStr].filter(Boolean).join(', ');
  const suffixStr = suffix ? ` (${suffix})` : '';

  switch (entry.status) {
    case 'passed':
      return `  ✓ ${entry.name}${suffixStr}`;
    case 'failed': {
      const reason = entry.error ? `: ${entry.error}` : '';
      return `  ✗ ${entry.name} FAILED${reason}${suffixStr}`;
    }
    case 'skipped':
      return `  ⊘ ${entry.name} SKIPPED`;
    case 'running':
      return `  ⏳ ${entry.name} running...`;
    case 'pending':
      return `  ○ ${entry.name}`;
    default:
      return `  ? ${entry.name}`;
  }
}

/**
 * Format the full progress display.
 */
export function formatProgress(state: ProgressState, options: ProgressOptions = {}): string {
  const { barWidth = 30 } = options;
  const lines: string[] = [];
  lines.push(`Running tests... ${renderProgressBar(state.completed, state.total, barWidth)}`);
  for (const entry of state.entries) {
    lines.push(formatEntry(entry, options));
  }
  return lines.join('\n');
}

// ===== Progress Tracker =====

/**
 * Track progress of test execution.
 */
export class ProgressTracker {
  private state: ProgressState;
  private options: ProgressOptions;
  private callback?: ProgressCallback;

  constructor(total: number, options: ProgressOptions = {}) {
    this.state = {
      total,
      completed: 0,
      entries: [],
      startTime: Date.now(),
    };
    this.options = options;
  }

  /**
   * Register a callback for progress updates.
   */
  onProgress(cb: ProgressCallback): void {
    this.callback = cb;
  }

  /**
   * Add a pending test.
   */
  addTest(name: string): void {
    this.state.entries.push({ name, status: 'pending' });
    this.emit();
  }

  /**
   * Mark a test as running.
   */
  startTest(name: string): void {
    const entry = this.state.entries.find((e) => e.name === name);
    if (entry) {
      entry.status = 'running';
    } else {
      this.state.entries.push({ name, status: 'running' });
    }
    this.emit();
  }

  /**
   * Mark a test as passed.
   */
  passTest(name: string, duration_ms?: number, cost_usd?: number): void {
    this.completeTest(name, 'passed', duration_ms, cost_usd);
  }

  /**
   * Mark a test as failed.
   */
  failTest(name: string, error?: string, duration_ms?: number, cost_usd?: number): void {
    this.completeTest(name, 'failed', duration_ms, cost_usd, error);
  }

  /**
   * Mark a test as skipped.
   */
  skipTest(name: string): void {
    this.completeTest(name, 'skipped');
  }

  /**
   * Get current progress state.
   */
  getState(): ProgressState {
    return { ...this.state };
  }

  /**
   * Render the current progress display.
   */
  render(): string {
    return formatProgress(this.state, this.options);
  }

  /**
   * Get elapsed time in ms.
   */
  elapsed(): number {
    return Date.now() - this.state.startTime;
  }

  /**
   * Build a summary line after completion.
   */
  summary(): string {
    const passed = this.state.entries.filter((e) => e.status === 'passed').length;
    const failed = this.state.entries.filter((e) => e.status === 'failed').length;
    const skipped = this.state.entries.filter((e) => e.status === 'skipped').length;
    const totalCost = this.state.entries.reduce((s, e) => s + (e.cost_usd ?? 0), 0);
    const elapsed = ((Date.now() - this.state.startTime) / 1000).toFixed(1);
    const parts = [`${passed} passed`, `${failed} failed`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    parts.push(`${elapsed}s`);
    if (totalCost > 0) parts.push(`$${totalCost.toFixed(4)}`);
    return parts.join(', ');
  }

  private completeTest(
    name: string,
    status: TestStatus,
    duration_ms?: number,
    cost_usd?: number,
    error?: string,
  ): void {
    const entry = this.state.entries.find((e) => e.name === name);
    if (entry) {
      entry.status = status;
      entry.duration_ms = duration_ms;
      entry.cost_usd = cost_usd;
      entry.error = error;
    } else {
      this.state.entries.push({ name, status, duration_ms, cost_usd, error });
    }
    this.state.completed++;
    this.emit();
  }

  private emit(): void {
    this.callback?.(this.getState());
  }
}

/**
 * Create a ProgressTracker from suite results (for post-hoc rendering).
 */
export function fromSuiteResult(result: SuiteResult, options?: ProgressOptions): ProgressTracker {
  const tracker = new ProgressTracker(result.total, options);
  for (const r of result.results) {
    if (r.skipped) {
      tracker.skipTest(r.name);
    } else if (r.passed) {
      tracker.passTest(r.name, r.duration_ms);
    } else {
      const firstFail = r.assertions.find((a) => !a.passed);
      tracker.failTest(r.name, firstFail?.message ?? r.error, r.duration_ms);
    }
  }
  return tracker;
}
