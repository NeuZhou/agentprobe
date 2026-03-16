/**
 * Flake Manager — Track and manage flaky tests across runs
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export interface FlakeEntry {
  testName: string;
  results: Array<{ passed: boolean; timestamp: string; duration_ms: number }>;
}

export interface FlakeRecord {
  testName: string;
  flakeRate: number;
  totalRuns: number;
  passes: number;
  failures: number;
  lastPass: string | null;
  lastFail: string | null;
  trend: 'improving' | 'degrading' | 'stable' | 'new';
  avgDuration: number;
  suggestions: string[];
}

export interface FlakeReport {
  generated: string;
  totalTests: number;
  flakyTests: number;
  records: FlakeRecord[];
}

export interface FlakeManagerConfig {
  /** Threshold above which a test is considered flaky (0-1, default 0.05) */
  flakyThreshold?: number;
  /** Minimum runs before evaluating flakiness (default 3) */
  minRuns?: number;
  /** Path to persist flake data */
  dataPath?: string;
}

/**
 * In-memory flake database that tracks test results over time.
 */
export class FlakeManager {
  private entries: Map<string, FlakeEntry> = new Map();
  private config: Required<FlakeManagerConfig>;

  constructor(config: FlakeManagerConfig = {}) {
    this.config = {
      flakyThreshold: config.flakyThreshold ?? 0.05,
      minRuns: config.minRuns ?? 3,
      dataPath: config.dataPath ?? '.agentprobe/flake-data.json',
    };
  }

  /**
   * Record a test result.
   */
  record(testName: string, passed: boolean, duration_ms = 0): void {
    let entry = this.entries.get(testName);
    if (!entry) {
      entry = { testName, results: [] };
      this.entries.set(testName, entry);
    }
    entry.results.push({
      passed,
      timestamp: new Date().toISOString(),
      duration_ms,
    });
  }

  /**
   * Record multiple results from a suite run.
   */
  recordSuite(results: Array<{ name: string; passed: boolean; duration_ms: number }>): void {
    for (const r of results) {
      this.record(r.name, r.passed, r.duration_ms);
    }
  }

  /**
   * Generate a flake report.
   */
  report(): FlakeReport {
    const records: FlakeRecord[] = [];

    for (const [, entry] of this.entries) {
      const { testName, results } = entry;
      if (results.length < this.config.minRuns) continue;

      const passes = results.filter(r => r.passed).length;
      const failures = results.length - passes;
      const flakeRate = failures / results.length;

      const passTimestamps = results.filter(r => r.passed).map(r => r.timestamp);
      const failTimestamps = results.filter(r => !r.passed).map(r => r.timestamp);
      const lastPass = passTimestamps.length > 0 ? passTimestamps[passTimestamps.length - 1] : null;
      const lastFail = failTimestamps.length > 0 ? failTimestamps[failTimestamps.length - 1] : null;

      // Trend: compare flake rate of recent half vs older half
      const mid = Math.floor(results.length / 2);
      const olderFails = results.slice(0, mid).filter(r => !r.passed).length;
      const recentFails = results.slice(mid).filter(r => !r.passed).length;
      const olderRate = mid > 0 ? olderFails / mid : 0;
      const recentRate = (results.length - mid) > 0 ? recentFails / (results.length - mid) : 0;

      let trend: FlakeRecord['trend'] = 'stable';
      if (results.length < this.config.minRuns * 2) {
        trend = 'new';
      } else if (recentRate < olderRate - 0.05) {
        trend = 'improving';
      } else if (recentRate > olderRate + 0.05) {
        trend = 'degrading';
      }

      const avgDuration = results.reduce((s, r) => s + r.duration_ms, 0) / results.length;

      // Generate suggestions
      const suggestions: string[] = [];
      if (flakeRate > 0.3) {
        suggestions.push('Mark as known-flaky, add retry with backoff');
      } else if (flakeRate > 0.1) {
        suggestions.push('Increase tolerance or add retry');
      }
      if (trend === 'degrading') {
        suggestions.push('Investigate recent changes — flake rate increasing');
      }
      if (avgDuration > 5000) {
        suggestions.push('Consider increasing timeout — slow test may cause intermittent failures');
      }

      records.push({
        testName,
        flakeRate,
        totalRuns: results.length,
        passes,
        failures,
        lastPass,
        lastFail,
        trend,
        avgDuration,
        suggestions,
      });
    }

    // Sort by flake rate descending
    records.sort((a, b) => b.flakeRate - a.flakeRate);

    const flakyTests = records.filter(r => r.flakeRate >= this.config.flakyThreshold).length;

    return {
      generated: new Date().toISOString(),
      totalTests: records.length,
      flakyTests,
      records,
    };
  }

  /**
   * Get the flake rate of a specific test.
   */
  getFlakeRate(testName: string): number | null {
    const entry = this.entries.get(testName);
    if (!entry || entry.results.length < this.config.minRuns) return null;
    return entry.results.filter(r => !r.passed).length / entry.results.length;
  }

  /**
   * Save flake data to disk.
   */
  save(filePath?: string): void {
    const target = filePath || this.config.dataPath;
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = Object.fromEntries(this.entries);
    fs.writeFileSync(target, JSON.stringify(data, null, 2));
  }

  /**
   * Load flake data from disk.
   */
  load(filePath?: string): void {
    const target = filePath || this.config.dataPath;
    if (!fs.existsSync(target)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(target, 'utf-8'));
      for (const [name, entry] of Object.entries(raw)) {
        this.entries.set(name, entry as FlakeEntry);
      }
    } catch { /* skip invalid */ }
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.entries.clear();
  }

  /** Number of tracked tests */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * Format flake report for console output.
 */
export function formatFlakeReport(report: FlakeReport): string {
  const lines: string[] = [];
  lines.push(chalk.bold('\n🎲 Flaky Test Report\n'));
  lines.push(`  Generated: ${report.generated}`);
  lines.push(`  Tests tracked: ${report.totalTests}, Flaky: ${report.flakyTests}\n`);

  if (report.records.length === 0) {
    lines.push('  No tests with enough runs to analyze.');
    return lines.join('\n');
  }

  // Table header
  lines.push(
    '  ' +
    'test-name'.padEnd(30) +
    'flake-rate'.padEnd(12) +
    'runs'.padEnd(8) +
    'trend'.padEnd(12) +
    'avg-ms'
  );
  lines.push('  ' + '-'.repeat(70));

  for (const r of report.records) {
    const name = r.testName.length > 28 ? r.testName.slice(0, 28) + '..' : r.testName;
    const rate = `${(r.flakeRate * 100).toFixed(0)}%`;
    const trendIcon = r.trend === 'improving' ? '📈' : r.trend === 'degrading' ? '📉' : r.trend === 'new' ? '🆕' : '➡️';
    lines.push(
      '  ' +
      name.padEnd(30) +
      rate.padEnd(12) +
      `${r.totalRuns}`.padEnd(8) +
      `${trendIcon} ${r.trend}`.padEnd(12) +
      `${r.avgDuration.toFixed(0)}`
    );
  }

  // Suggestions
  const withSuggestions = report.records.filter(r => r.suggestions.length > 0);
  if (withSuggestions.length > 0) {
    lines.push('\n  Suggestions:');
    for (const r of withSuggestions) {
      for (const s of r.suggestions) {
        lines.push(`    - ${r.testName}: ${s}`);
      }
    }
  }

  return lines.join('\n');
}
