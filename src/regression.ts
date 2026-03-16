import * as fs from 'fs';
import * as path from 'path';
import type { SuiteResult } from './types';
import { calculateCost } from './cost';

const BASELINES_DIR = '.agentprobe/baselines';

export interface Baseline {
  saved_at: string;
  suite: string;
  tests: BaselineEntry[];
}

export interface BaselineEntry {
  name: string;
  passed: boolean;
  steps: number;
  duration_ms: number;
  cost_usd: number;
  assertions_passed: number;
  assertions_total: number;
}

export interface Regression {
  test: string;
  type: 'steps' | 'cost' | 'duration' | 'pass_fail';
  message: string;
  baseline: any;
  current: any;
}

/**
 * Save current results as a baseline.
 */
export function saveBaseline(result: SuiteResult, dir?: string): string {
  const baseDir = dir ?? BASELINES_DIR;
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

  const baseline: Baseline = {
    saved_at: new Date().toISOString(),
    suite: result.name,
    tests: result.results.map((r) => ({
      name: r.name,
      passed: r.passed,
      steps: r.trace?.steps.length ?? 0,
      duration_ms: r.duration_ms,
      cost_usd: r.trace ? calculateCost(r.trace).total_cost : 0,
      assertions_passed: r.assertions.filter((a) => a.passed).length,
      assertions_total: r.assertions.length,
    })),
  };

  const safeName = result.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(baseDir, `${safeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2));
  return filePath;
}

/**
 * Load a baseline for a suite.
 */
export function loadBaseline(suiteName: string, dir?: string): Baseline | null {
  const baseDir = dir ?? BASELINES_DIR;
  const safeName = suiteName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(baseDir, `${safeName}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Compare current results against a baseline, detecting regressions.
 */
export function detectRegressions(result: SuiteResult, baseline: Baseline): Regression[] {
  const regressions: Regression[] = [];

  for (const current of result.results) {
    const base = baseline.tests.find((b) => b.name === current.name);
    if (!base) continue;

    // Pass → Fail regression
    if (base.passed && !current.passed) {
      regressions.push({
        test: current.name,
        type: 'pass_fail',
        message: `was passing, now failing`,
        baseline: 'passed',
        current: 'failed',
      });
    }

    // Step count regression (>50% increase)
    const currentSteps = current.trace?.steps.length ?? 0;
    if (base.steps > 0 && currentSteps > base.steps * 1.5) {
      regressions.push({
        test: current.name,
        type: 'steps',
        message: `was ${base.steps} steps, now ${currentSteps} steps`,
        baseline: base.steps,
        current: currentSteps,
      });
    }

    // Cost regression (>100% increase)
    const currentCost = current.trace ? calculateCost(current.trace).total_cost : 0;
    if (base.cost_usd > 0 && currentCost > base.cost_usd * 2) {
      regressions.push({
        test: current.name,
        type: 'cost',
        message: `cost increased from $${base.cost_usd.toFixed(4)} to $${currentCost.toFixed(4)}`,
        baseline: base.cost_usd,
        current: currentCost,
      });
    }

    // Duration regression (>200% increase)
    if (base.duration_ms > 0 && current.duration_ms > base.duration_ms * 3) {
      regressions.push({
        test: current.name,
        type: 'duration',
        message: `duration increased from ${base.duration_ms}ms to ${current.duration_ms}ms`,
        baseline: base.duration_ms,
        current: current.duration_ms,
      });
    }
  }

  return regressions;
}

/**
 * Format regressions for display.
 */
export function formatRegressions(regressions: Regression[]): string {
  if (regressions.length === 0) return '  ✅ No regressions detected';
  const lines = ['', '  ⚠️  Regressions Detected:'];
  for (const r of regressions) {
    lines.push(`     ⚠ ${r.test} — ${r.message}`);
  }
  return lines.join('\n');
}
