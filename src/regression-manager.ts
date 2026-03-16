/**
 * Regression Suite Manager — Track test results over time.
 * Detect regressions automatically between labeled runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SuiteResult } from './types';
import { calculateCost } from './cost';

const REGRESSION_DIR = '.agentprobe/regressions';

export interface RegressionSnapshot {
  label: string;
  saved_at: string;
  suite_name: string;
  suite_path: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration_ms: number;
  };
  tests: RegressionTestEntry[];
}

export interface RegressionTestEntry {
  name: string;
  passed: boolean;
  steps: number;
  duration_ms: number;
  cost_usd: number;
  tools_called: string[];
  tags?: string[];
}

export interface RegressionComparison {
  label_a: string;
  label_b: string;
  new_failures: string[];
  new_passes: string[];
  step_regressions: Array<{ test: string; before: number; after: number }>;
  cost_regressions: Array<{ test: string; before: number; after: number }>;
  duration_regressions: Array<{ test: string; before: number; after: number }>;
  summary: {
    total_regressions: number;
    total_improvements: number;
  };
}

function getDir(baseDir?: string): string {
  return baseDir ?? REGRESSION_DIR;
}

/**
 * Add a regression snapshot from suite results.
 */
export function addRegressionSnapshot(
  result: SuiteResult,
  label: string,
  suitePath: string,
  baseDir?: string,
): string {
  const dir = getDir(baseDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const snapshot: RegressionSnapshot = {
    label,
    saved_at: new Date().toISOString(),
    suite_name: result.name,
    suite_path: suitePath,
    summary: {
      total: result.total,
      passed: result.passed,
      failed: result.failed,
      duration_ms: result.duration_ms,
    },
    tests: result.results.map((r) => ({
      name: r.name,
      passed: r.passed,
      steps: r.trace?.steps.length ?? 0,
      duration_ms: r.duration_ms,
      cost_usd: r.trace ? calculateCost(r.trace).total_cost : 0,
      tools_called: r.trace
        ? r.trace.steps.filter((s) => s.type === 'tool_call').map((s) => s.data.tool_name!).filter(Boolean)
        : [],
      tags: r.tags,
    })),
  };

  const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(dir, `${safeLabel}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

/**
 * Load a regression snapshot by label.
 */
export function loadRegressionSnapshot(label: string, baseDir?: string): RegressionSnapshot | null {
  const dir = getDir(baseDir);
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(dir, `${safeLabel}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * List all regression snapshots.
 */
export function listRegressionSnapshots(baseDir?: string): RegressionSnapshot[] {
  const dir = getDir(baseDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean) as RegressionSnapshot[];
}

/**
 * Compare two labeled snapshots and detect regressions.
 */
export function compareRegressionSnapshots(
  labelA: string,
  labelB: string,
  baseDir?: string,
): RegressionComparison | null {
  const a = loadRegressionSnapshot(labelA, baseDir);
  const b = loadRegressionSnapshot(labelB, baseDir);
  if (!a || !b) return null;

  const new_failures: string[] = [];
  const new_passes: string[] = [];
  const step_regressions: Array<{ test: string; before: number; after: number }> = [];
  const cost_regressions: Array<{ test: string; before: number; after: number }> = [];
  const duration_regressions: Array<{ test: string; before: number; after: number }> = [];

  for (const bTest of b.tests) {
    const aTest = a.tests.find((t) => t.name === bTest.name);
    if (!aTest) continue;

    if (aTest.passed && !bTest.passed) new_failures.push(bTest.name);
    if (!aTest.passed && bTest.passed) new_passes.push(bTest.name);

    if (aTest.steps > 0 && bTest.steps > aTest.steps * 1.5) {
      step_regressions.push({ test: bTest.name, before: aTest.steps, after: bTest.steps });
    }
    if (aTest.cost_usd > 0 && bTest.cost_usd > aTest.cost_usd * 2) {
      cost_regressions.push({ test: bTest.name, before: aTest.cost_usd, after: bTest.cost_usd });
    }
    if (aTest.duration_ms > 0 && bTest.duration_ms > aTest.duration_ms * 3) {
      duration_regressions.push({ test: bTest.name, before: aTest.duration_ms, after: bTest.duration_ms });
    }
  }

  return {
    label_a: labelA,
    label_b: labelB,
    new_failures,
    new_passes,
    step_regressions,
    cost_regressions,
    duration_regressions,
    summary: {
      total_regressions: new_failures.length + step_regressions.length + cost_regressions.length + duration_regressions.length,
      total_improvements: new_passes.length,
    },
  };
}

/**
 * Format comparison for CLI display.
 */
export function formatRegressionComparison(cmp: RegressionComparison): string {
  const lines: string[] = [`\n📊 Regression Comparison: "${cmp.label_a}" → "${cmp.label_b}"\n`];

  if (cmp.new_failures.length > 0) {
    lines.push('  ❌ New failures:');
    for (const f of cmp.new_failures) lines.push(`     • ${f}`);
  }
  if (cmp.new_passes.length > 0) {
    lines.push('  ✅ New passes:');
    for (const p of cmp.new_passes) lines.push(`     • ${p}`);
  }
  if (cmp.step_regressions.length > 0) {
    lines.push('  ⚠️  Step regressions:');
    for (const r of cmp.step_regressions) lines.push(`     • ${r.test}: ${r.before} → ${r.after} steps`);
  }
  if (cmp.cost_regressions.length > 0) {
    lines.push('  💸 Cost regressions:');
    for (const r of cmp.cost_regressions) lines.push(`     • ${r.test}: $${r.before.toFixed(4)} → $${r.after.toFixed(4)}`);
  }

  if (cmp.summary.total_regressions === 0 && cmp.summary.total_improvements === 0) {
    lines.push('  ✅ No regressions detected');
  } else {
    lines.push(`\n  Summary: ${cmp.summary.total_regressions} regression(s), ${cmp.summary.total_improvements} improvement(s)`);
  }

  return lines.join('\n');
}

/**
 * Format list of snapshots for CLI.
 */
export function formatSnapshotList(snapshots: RegressionSnapshot[]): string {
  if (snapshots.length === 0) return '  No regression snapshots found.';
  const lines: string[] = ['\n📋 Regression Snapshots:\n'];
  for (const s of snapshots) {
    lines.push(`  ${s.label.padEnd(25)} ${s.summary.passed}/${s.summary.total} passed  ${s.saved_at}`);
  }
  return lines.join('\n');
}
