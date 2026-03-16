/**
 * Cost Budget Enforcement — Per-test, per-suite, per-day budgets.
 */

import * as fs from 'fs';
import * as path from 'path';
import { calculateCost } from './cost';
import type { AgentTrace } from './types';

export interface BudgetConfig {
  per_test?: number;
  per_suite?: number;
  per_day?: number;
  alert_threshold?: number; // 0-1, default 0.8
}

export interface BudgetCheck {
  within_budget: boolean;
  test_cost: number;
  suite_cost: number;
  daily_cost: number;
  violations: BudgetViolation[];
  warnings: BudgetWarning[];
}

export interface BudgetViolation {
  type: 'per_test' | 'per_suite' | 'per_day';
  limit: number;
  actual: number;
  message: string;
}

export interface BudgetWarning {
  type: 'per_test' | 'per_suite' | 'per_day';
  limit: number;
  actual: number;
  threshold: number;
  message: string;
}

const DAILY_LOG_DIR = '.agentprobe/cost-logs';

function getDailyLogPath(): string {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(DAILY_LOG_DIR, `${today}.json`);
}

/**
 * Get the total cost spent today.
 */
export function getDailyCost(): number {
  const logPath = getDailyLogPath();
  if (!fs.existsSync(logPath)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    return data.total ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Record a cost expenditure for today.
 */
export function recordCost(amount: number): void {
  if (!fs.existsSync(DAILY_LOG_DIR)) fs.mkdirSync(DAILY_LOG_DIR, { recursive: true });
  const logPath = getDailyLogPath();
  let data = { total: 0, entries: [] as Array<{ time: string; amount: number }> };
  if (fs.existsSync(logPath)) {
    try {
      data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    } catch { /* reset */ }
  }
  data.total += amount;
  data.entries.push({ time: new Date().toISOString(), amount });
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
}

/**
 * Check a trace against budget limits.
 */
export function checkBudget(
  trace: AgentTrace,
  suiteCostSoFar: number,
  budget: BudgetConfig,
): BudgetCheck {
  const costReport = calculateCost(trace);
  const testCost = costReport.total_cost;
  const suiteCost = suiteCostSoFar + testCost;
  const dailyCost = getDailyCost() + testCost;
  const threshold = budget.alert_threshold ?? 0.8;

  const violations: BudgetViolation[] = [];
  const warnings: BudgetWarning[] = [];

  // Per-test check
  if (budget.per_test !== undefined && testCost > budget.per_test) {
    violations.push({
      type: 'per_test',
      limit: budget.per_test,
      actual: testCost,
      message: `Test cost $${testCost.toFixed(4)} exceeds per-test budget $${budget.per_test.toFixed(2)}`,
    });
  } else if (budget.per_test !== undefined && testCost > budget.per_test * threshold) {
    warnings.push({
      type: 'per_test',
      limit: budget.per_test,
      actual: testCost,
      threshold,
      message: `Test cost $${testCost.toFixed(4)} is at ${((testCost / budget.per_test) * 100).toFixed(0)}% of per-test budget`,
    });
  }

  // Per-suite check
  if (budget.per_suite !== undefined && suiteCost > budget.per_suite) {
    violations.push({
      type: 'per_suite',
      limit: budget.per_suite,
      actual: suiteCost,
      message: `Suite cost $${suiteCost.toFixed(4)} exceeds per-suite budget $${budget.per_suite.toFixed(2)}`,
    });
  } else if (budget.per_suite !== undefined && suiteCost > budget.per_suite * threshold) {
    warnings.push({
      type: 'per_suite',
      limit: budget.per_suite,
      actual: suiteCost,
      threshold,
      message: `Suite cost $${suiteCost.toFixed(4)} is at ${((suiteCost / budget.per_suite) * 100).toFixed(0)}% of per-suite budget`,
    });
  }

  // Per-day check
  if (budget.per_day !== undefined && dailyCost > budget.per_day) {
    violations.push({
      type: 'per_day',
      limit: budget.per_day,
      actual: dailyCost,
      message: `Daily cost $${dailyCost.toFixed(4)} exceeds per-day budget $${budget.per_day.toFixed(2)}`,
    });
  } else if (budget.per_day !== undefined && dailyCost > budget.per_day * threshold) {
    warnings.push({
      type: 'per_day',
      limit: budget.per_day,
      actual: dailyCost,
      threshold,
      message: `Daily cost $${dailyCost.toFixed(4)} is at ${((dailyCost / budget.per_day) * 100).toFixed(0)}% of per-day budget`,
    });
  }

  return {
    within_budget: violations.length === 0,
    test_cost: testCost,
    suite_cost: suiteCost,
    daily_cost: dailyCost,
    violations,
    warnings,
  };
}

/**
 * Format budget check results for CLI.
 */
export function formatBudgetCheck(check: BudgetCheck): string {
  const lines: string[] = [];
  for (const v of check.violations) {
    lines.push(`  ❌ BUDGET EXCEEDED: ${v.message}`);
  }
  for (const w of check.warnings) {
    lines.push(`  ⚠️  ${w.message}`);
  }
  if (check.within_budget && check.warnings.length === 0) {
    lines.push(`  ✅ Within budget (test: $${check.test_cost.toFixed(4)}, suite: $${check.suite_cost.toFixed(4)})`);
  }
  return lines.join('\n');
}
