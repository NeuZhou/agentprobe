/**
 * A/B Testing Framework - Compare two agent versions
 */

import { runSuite } from './runner';
import type { SuiteResult } from './types';
import chalk from 'chalk';

export interface ABTestConfig {
  modelA: string;
  modelB: string;
  suitePath: string;
  runs: number;
}

export interface ABModelResult {
  model: string;
  passRate: number;
  avgCost: number;
  avgTime: number;
  results: SuiteResult[];
}

export interface ABTestResult {
  modelA: ABModelResult;
  modelB: ABModelResult;
  pValue: number;
  significant: boolean;
  qualityWinner: string;
  costWinner: string;
}

/**
 * Welch's t-test for two independent samples (unequal variance).
 */
export function tTest(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return 1;
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  const varA = a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (a.length - 1);
  const varB = b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (b.length - 1);
  const se = Math.sqrt(varA / a.length + varB / b.length);
  if (se === 0) return meanA === meanB ? 1 : 0;
  const t = Math.abs(meanA - meanB) / se;
  // Approximate p-value using normal distribution for large samples
  const df = Math.min(a.length, b.length) - 1;
  return approximatePValue(t, df);
}

/**
 * Approximate two-tailed p-value from t-statistic using simple approximation.
 */
function approximatePValue(t: number, df: number): number {
  // Use a rough approximation: p ≈ 2 * (1 - Φ(|t|)) for large df
  // For small df, use a conservative estimate
  const x = t / Math.sqrt(1 + t * t / df);
  // Approximation of the CDF of standard normal
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const absX = Math.abs(x);
  const tt = 1.0 / (1.0 + p * absX);
  const phi = 1 - (((((a5 * tt + a4) * tt) + a3) * tt + a2) * tt + a1) * tt * Math.exp(-absX * absX / 2);
  return 2 * (1 - phi);
}

/**
 * Run A/B test comparing two models.
 */
export async function runABTest(config: ABTestConfig): Promise<ABTestResult> {
  const resultsA: SuiteResult[] = [];
  const resultsB: SuiteResult[] = [];

  for (let i = 0; i < config.runs; i++) {
    // Set model env for each run
    process.env.AGENTPROBE_MODEL = config.modelA;
    const rA = await runSuite(config.suitePath);
    resultsA.push(rA);

    process.env.AGENTPROBE_MODEL = config.modelB;
    const rB = await runSuite(config.suitePath);
    resultsB.push(rB);
  }

  delete process.env.AGENTPROBE_MODEL;

  const passRatesA = resultsA.map(r => r.passed / r.total);
  const passRatesB = resultsB.map(r => r.passed / r.total);
  const timesA = resultsA.map(r => r.duration_ms);
  const timesB = resultsB.map(r => r.duration_ms);

  const avgPassA = passRatesA.reduce((s, v) => s + v, 0) / passRatesA.length;
  const avgPassB = passRatesB.reduce((s, v) => s + v, 0) / passRatesB.length;
  const avgTimeA = timesA.reduce((s, v) => s + v, 0) / timesA.length;
  const avgTimeB = timesB.reduce((s, v) => s + v, 0) / timesB.length;

  const pValue = tTest(passRatesA, passRatesB);

  const modelAResult: ABModelResult = {
    model: config.modelA,
    passRate: avgPassA * 100,
    avgCost: 0, // Cost from traces if available
    avgTime: avgTimeA / 1000,
    results: resultsA,
  };

  const modelBResult: ABModelResult = {
    model: config.modelB,
    passRate: avgPassB * 100,
    avgCost: 0,
    avgTime: avgTimeB / 1000,
    results: resultsB,
  };

  return {
    modelA: modelAResult,
    modelB: modelBResult,
    pValue,
    significant: pValue < 0.05,
    qualityWinner: avgPassA >= avgPassB ? config.modelA : config.modelB,
    costWinner: avgTimeA <= avgTimeB ? config.modelA : config.modelB,
  };
}

/**
 * Format A/B test results for console output.
 */
export function formatABTest(result: ABTestResult): string {
  const lines: string[] = [];
  lines.push(chalk.bold('\n📊 A/B Test Results\n'));
  lines.push(`  Model A (${result.modelA.model}): Pass ${result.modelA.passRate.toFixed(0)}%, Avg cost $${result.modelA.avgCost.toFixed(3)}, Avg time ${result.modelA.avgTime.toFixed(1)}s`);
  lines.push(`  Model B (${result.modelB.model}): Pass ${result.modelB.passRate.toFixed(0)}%, Avg cost $${result.modelB.avgCost.toFixed(3)}, Avg time ${result.modelB.avgTime.toFixed(1)}s`);
  lines.push(`  Statistical significance: p=${result.pValue.toFixed(2)} (${result.significant ? 'significant' : 'not significant'})`);
  lines.push(`  Winner: ${result.qualityWinner} (quality), ${result.costWinner} (cost-efficiency)`);
  return lines.join('\n');
}
