/**
 * Canary Testing — deploy tests to production with gradual rollout.
 */

import * as fs from 'fs';
import YAML from 'yaml';

export interface CanaryMetric {
  name: string;
  min?: number;
  max?: number;
}

export interface CanaryConfig {
  percentage: number;
  metrics: CanaryMetric[];
  promote_after: number;
  rollback_on?: string;
}

export interface CanaryRunResult {
  iteration: number;
  passed: boolean;
  metrics: Record<string, number>;
}

export interface CanaryState {
  config: CanaryConfig;
  runs: CanaryRunResult[];
  status: 'canary' | 'promoted' | 'rolled_back';
  totalRuns: number;
  passedRuns: number;
}

export function parseCanaryConfig(raw: Record<string, any>): CanaryConfig {
  const canary = raw.canary || raw;
  const metrics: CanaryMetric[] = [];
  if (Array.isArray(canary.metrics)) {
    for (const m of canary.metrics) {
      if (typeof m === 'object') {
        const [name, constraints] = Object.entries(m)[0] as [string, any];
        metrics.push({ name, min: constraints?.min, max: constraints?.max });
      }
    }
  }
  return {
    percentage: canary.percentage ?? 10,
    metrics,
    promote_after: canary.promote_after ?? 100,
    rollback_on: canary.rollback_on,
  };
}

export function loadCanaryConfig(filePath: string): CanaryConfig {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = YAML.parse(content);
  return parseCanaryConfig(parsed);
}

export function shouldRunCanary(percentage: number): boolean {
  return Math.random() * 100 < percentage;
}

export function evaluateCanaryMetrics(
  config: CanaryConfig,
  actual: Record<string, number>,
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const metric of config.metrics) {
    const value = actual[metric.name];
    if (value === undefined) continue;
    if (metric.min !== undefined && value < metric.min) {
      violations.push(`${metric.name}: ${value} < min(${metric.min})`);
    }
    if (metric.max !== undefined && value > metric.max) {
      violations.push(`${metric.name}: ${value} > max(${metric.max})`);
    }
  }
  return { passed: violations.length === 0, violations };
}

export function evaluateRollback(condition: string | undefined, metrics: Record<string, number>): boolean {
  if (!condition) return false;
  // Parse simple conditions like "pass_rate < 80"
  const match = condition.match(/^(\w+)\s*([<>]=?)\s*(\d+(?:\.\d+)?)$/);
  if (!match) return false;
  const [, name, op, thresholdStr] = match;
  const value = metrics[name];
  const threshold = parseFloat(thresholdStr);
  if (value === undefined) return false;
  switch (op) {
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    default: return false;
  }
}

export function createCanaryState(config: CanaryConfig): CanaryState {
  return { config, runs: [], status: 'canary', totalRuns: 0, passedRuns: 0 };
}

export function recordCanaryRun(state: CanaryState, metrics: Record<string, number>): CanaryState {
  const { passed } = evaluateCanaryMetrics(state.config, metrics);
  const run: CanaryRunResult = {
    iteration: state.totalRuns + 1,
    passed,
    metrics,
  };
  const newState = {
    ...state,
    runs: [...state.runs, run],
    totalRuns: state.totalRuns + 1,
    passedRuns: state.passedRuns + (passed ? 1 : 0),
  };

  // Check rollback
  if (evaluateRollback(state.config.rollback_on, metrics)) {
    newState.status = 'rolled_back';
    return newState;
  }

  // Check promotion
  if (newState.passedRuns >= state.config.promote_after) {
    newState.status = 'promoted';
  }

  return newState;
}

export function formatCanaryState(state: CanaryState): string {
  const statusEmoji = state.status === 'promoted' ? '✅' : state.status === 'rolled_back' ? '🔴' : '🐤';
  const lines = [
    `${statusEmoji} Canary Status: ${state.status.toUpperCase()}`,
    `  Runs: ${state.totalRuns}  Passed: ${state.passedRuns}  Target: ${state.config.promote_after}`,
    `  Traffic: ${state.config.percentage}%`,
  ];
  if (state.runs.length > 0) {
    const last = state.runs[state.runs.length - 1];
    lines.push(`  Last run: ${last.passed ? 'PASS' : 'FAIL'} ${JSON.stringify(last.metrics)}`);
  }
  return lines.join('\n');
}
