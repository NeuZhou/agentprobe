import type { SuiteResult } from './types';
import * as fs from 'fs';

export interface PrioritizedTest {
  name: string;
  priority: number;
  reason: string;
}

export interface PrioritizationResult {
  order: PrioritizedTest[];
  strategy: string;
}

interface TestHistory {
  failures: Record<string, number>;  // test name → failure count
  durations: Record<string, number>; // test name → avg duration
  lastRun: Record<string, boolean>;  // test name → passed last time
}

const HISTORY_FILE = '.agentprobe-history.json';

/**
 * Load test history from disk.
 */
export function loadHistory(dir: string = '.'): TestHistory {
  const filePath = `${dir}/${HISTORY_FILE}`;
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      // Corrupted history
    }
  }
  return { failures: {}, durations: {}, lastRun: {} };
}

/**
 * Save test history to disk.
 */
export function saveHistory(history: TestHistory, dir: string = '.'): void {
  fs.writeFileSync(`${dir}/${HISTORY_FILE}`, JSON.stringify(history, null, 2));
}

/**
 * Update history with latest results.
 */
export function updateHistory(history: TestHistory, result: SuiteResult): TestHistory {
  const updated = { ...history };

  for (const test of result.results) {
    // Track failures
    if (!test.passed) {
      updated.failures[test.name] = (updated.failures[test.name] ?? 0) + 1;
    }

    // Track average duration (exponential moving average)
    const prev = updated.durations[test.name] ?? test.duration_ms;
    updated.durations[test.name] = Math.round(prev * 0.7 + test.duration_ms * 0.3);

    // Track last pass/fail
    updated.lastRun[test.name] = test.passed;
  }

  return updated;
}

/**
 * Prioritize tests based on history and heuristics.
 * Returns test names in priority order (highest first).
 */
export function prioritizeTests(
  testNames: string[],
  history: TestHistory,
  changedFiles?: string[],
): PrioritizationResult {
  const scored: PrioritizedTest[] = testNames.map(name => {
    let priority = 50; // Base priority
    let reason = 'default';

    // Previously failing → run first (highest priority)
    if (history.lastRun[name] === false) {
      priority += 100;
      reason = 'previously failing';
    }

    // Frequently failing → higher priority
    const failCount = history.failures[name] ?? 0;
    if (failCount > 0) {
      priority += Math.min(failCount * 10, 50);
      if (reason === 'default') reason = `failed ${failCount} time(s)`;
    }

    // Affected by changed files (name heuristic)
    if (changedFiles?.length) {
      const nameWords = name.toLowerCase().split(/[\s_-]+/);
      for (const file of changedFiles) {
        const fileBase = file.replace(/.*[/\\]/, '').replace(/\.\w+$/, '').toLowerCase();
        if (nameWords.some(w => fileBase.includes(w) || w.includes(fileBase))) {
          priority += 30;
          reason = `affected by ${file}`;
          break;
        }
      }
    }

    // Slowest tests → run last (lower priority for slow tests)
    const duration = history.durations[name] ?? 0;
    if (duration > 5000) {
      priority -= 20;
      if (reason === 'default') reason = `slow (${duration}ms)`;
    }

    return { name, priority, reason };
  });

  // Sort by priority descending
  scored.sort((a, b) => b.priority - a.priority);

  return {
    order: scored,
    strategy: 'fail-first + change-affinity + slowest-last',
  };
}

/**
 * Format prioritization results for display.
 */
export function formatPrioritization(result: PrioritizationResult): string {
  const lines: string[] = [];
  lines.push(`\n📋 Test Prioritization (${result.strategy})\n`);
  for (let i = 0; i < result.order.length; i++) {
    const t = result.order[i];
    lines.push(`  ${(i + 1).toString().padStart(3)}. ${t.name.padEnd(40)} [${t.priority}] ${t.reason}`);
  }
  return lines.join('\n');
}
