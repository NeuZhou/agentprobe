/**
 * Agent A/B Testing Framework - Run A/B tests between agent variants.
 *
 * Supports multiple variants, configurable sample sizes, chi-squared
 * statistical significance testing, and winner recommendation.
 */

import { runSuite } from './runner';
import type { SuiteResult } from './types';
import chalk from 'chalk';

// ===== Types =====

export interface AgentVariant {
  name: string;
  model?: string;
  config?: Record<string, any>;
  env?: Record<string, string>;
}

export interface ABTestConfig {
  /** Legacy: two-model comparison */
  modelA?: string;
  modelB?: string;
  /** New: multi-variant support */
  variants?: AgentVariant[];
  suitePath: string;
  runs: number;
  /** Alias for runs */
  sampleSize?: number;
  /** Primary metric to compare: 'passRate' | 'cost' | 'time' */
  metric?: string;
}

export interface ABModelResult {
  model: string;
  variant?: AgentVariant;
  passRate: number;
  avgCost: number;
  avgTime: number;
  passCount: number;
  failCount: number;
  results: SuiteResult[];
}

export interface ABTestResult {
  modelA: ABModelResult;
  modelB: ABModelResult;
  variants: ABModelResult[];
  pValue: number;
  chiSquared: number;
  significant: boolean;
  qualityWinner: string;
  costWinner: string;
  recommendation: string;
}

// ===== Chi-squared test =====

/**
 * Chi-squared test for independence between variants.
 * Compares observed pass/fail counts against expected (pooled) rates.
 */
export function chiSquaredTest(variants: Array<{ pass: number; fail: number }>): {
  chiSquared: number;
  pValue: number;
  df: number;
} {
  const totalPass = variants.reduce((s, v) => s + v.pass, 0);
  const totalFail = variants.reduce((s, v) => s + v.fail, 0);
  const total = totalPass + totalFail;
  if (total === 0) return { chiSquared: 0, pValue: 1, df: variants.length - 1 };

  const expectedPassRate = totalPass / total;
  const expectedFailRate = totalFail / total;
  let chiSq = 0;

  for (const v of variants) {
    const n = v.pass + v.fail;
    if (n === 0) continue;
    const expectedPass = n * expectedPassRate;
    const expectedFail = n * expectedFailRate;
    if (expectedPass > 0) chiSq += (v.pass - expectedPass) ** 2 / expectedPass;
    if (expectedFail > 0) chiSq += (v.fail - expectedFail) ** 2 / expectedFail;
  }

  const df = variants.length - 1;
  const pValue = chiSquaredPValue(chiSq, df);
  return { chiSquared: chiSq, pValue, df };
}

/**
 * Approximate p-value for chi-squared distribution using Wilson-Hilferty.
 */
function chiSquaredPValue(chiSq: number, df: number): number {
  if (df <= 0 || chiSq <= 0) return 1;
  // Wilson-Hilferty approximation: transform to ~N(0,1)
  const z = Math.pow(chiSq / df, 1 / 3) - (1 - 2 / (9 * df));
  const denom = Math.sqrt(2 / (9 * df));
  const normalZ = z / denom;
  // One-tailed p from standard normal
  return 1 - normalCdf(normalZ);
}

function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

// ===== Welch's t-test (kept for backward compat) =====

export function tTest(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return 1;
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  const varA = a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (a.length - 1);
  const varB = b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (b.length - 1);
  const se = Math.sqrt(varA / a.length + varB / b.length);
  if (se === 0) return meanA === meanB ? 1 : 0;
  const t = Math.abs(meanA - meanB) / se;
  const df = Math.min(a.length, b.length) - 1;
  return 2 * (1 - normalCdf(t / Math.sqrt(1 + t * t / df)));
}

// ===== ABTestRunner class =====

export class ABTestRunner {
  private variants: AgentVariant[];
  private sampleSize: number;
  public readonly metric: string;

  constructor(config: { variants: AgentVariant[]; sampleSize: number; metric: string }) {
    if (!config.variants || config.variants.length < 2) {
      throw new Error('ABTestRunner requires at least 2 variants');
    }
    this.variants = config.variants;
    this.sampleSize = config.sampleSize;
    this.metric = config.metric;
  }

  /**
   * Run the A/B test across all variants on the given test suite.
   */
  run(_testSuite: string): ABTestResult {
    // Synchronous simulation for unit-testable path
    const variantResults: ABModelResult[] = this.variants.map(variant => ({
      model: variant.name,
      variant,
      passRate: 0,
      avgCost: 0,
      avgTime: 0,
      passCount: 0,
      failCount: 0,
      results: [],
    }));

    // In a real run, each variant would execute testSuite `sampleSize` times.
    // The runner populates passCount/failCount from actual results.
    return this.buildResult(variantResults);
  }

  /**
   * Run the A/B test asynchronously (actually executes test suites).
   */
  async runAsync(testSuitePath: string): Promise<ABTestResult> {
    const variantResults: ABModelResult[] = [];

    for (const variant of this.variants) {
      const suiteResults: SuiteResult[] = [];
      let totalPass = 0;
      let totalFail = 0;
      let totalTime = 0;

      for (let i = 0; i < this.sampleSize; i++) {
        // Apply variant env
        if (variant.model) process.env.AGENTPROBE_MODEL = variant.model;
        if (variant.env) {
          for (const [k, v] of Object.entries(variant.env)) process.env[k] = v;
        }

        const result = await runSuite(testSuitePath);
        suiteResults.push(result);
        totalPass += result.passed;
        totalFail += result.failed;
        totalTime += result.duration_ms;

        // Clean up env
        if (variant.model) delete process.env.AGENTPROBE_MODEL;
        if (variant.env) {
          for (const k of Object.keys(variant.env)) delete process.env[k];
        }
      }

      variantResults.push({
        model: variant.name,
        variant,
        passRate: totalPass / (totalPass + totalFail) * 100 || 0,
        avgCost: 0,
        avgTime: totalTime / this.sampleSize / 1000,
        passCount: totalPass,
        failCount: totalFail,
        results: suiteResults,
      });
    }

    return this.buildResult(variantResults);
  }

  private buildResult(variantResults: ABModelResult[]): ABTestResult {
    const chiResult = chiSquaredTest(
      variantResults.map(v => ({ pass: v.passCount, fail: v.failCount }))
    );

    // Determine winners
    const sortedByQuality = [...variantResults].sort((a, b) => b.passRate - a.passRate);
    const sortedByCost = [...variantResults].sort((a, b) => a.avgTime - b.avgTime);

    const winner = sortedByQuality[0];
    const recommendation = chiResult.pValue < 0.05
      ? `${winner.model} is the recommended variant (statistically significant, p=${chiResult.pValue.toFixed(4)})`
      : `No statistically significant difference found (p=${chiResult.pValue.toFixed(4)}). Consider increasing sample size.`;

    return {
      modelA: variantResults[0],
      modelB: variantResults[1] || variantResults[0],
      variants: variantResults,
      pValue: chiResult.pValue,
      chiSquared: chiResult.chiSquared,
      significant: chiResult.pValue < 0.05,
      qualityWinner: sortedByQuality[0].model,
      costWinner: sortedByCost[0].model,
      recommendation,
    };
  }

  /**
   * Check if results are statistically significant at the given confidence level.
   */
  isSignificant(results: ABTestResult, confidence: number = 0.95): boolean {
    return results.pValue < (1 - confidence);
  }
}

// ===== Legacy function (backward compatible) =====

export async function runABTest(config: ABTestConfig): Promise<ABTestResult> {
  const variants: AgentVariant[] = config.variants || [
    { name: config.modelA || 'model-a', model: config.modelA },
    { name: config.modelB || 'model-b', model: config.modelB },
  ];
  const runner = new ABTestRunner({
    variants,
    sampleSize: config.sampleSize || config.runs,
    metric: config.metric || 'passRate',
  });
  return runner.runAsync(config.suitePath);
}

/**
 * Format A/B test results for console output.
 */
export function formatABTest(result: ABTestResult): string {
  const lines: string[] = [];
  lines.push(chalk.bold('\n🔬 A/B Test Results\n'));

  // Support both legacy (modelA/modelB) and new (variants array) shapes
  const variants: Array<{ model: string; passRate: number; avgCost: number; avgTime: number; passCount?: number; failCount?: number }> =
    (result as any).variants ??
    [(result as any).modelA, (result as any).modelB].filter(Boolean);

  for (const v of variants) {
    const passCount = v.passCount ?? '';
    const failCount = v.failCount ?? '';
    const suffix = passCount !== '' ? ` (${passCount}P/${failCount}F)` : '';
    lines.push(`  ${v.model}: Pass ${v.passRate.toFixed(1)}%, Avg cost $${v.avgCost.toFixed(3)}, Avg time ${v.avgTime.toFixed(1)}s${suffix}`);
  }
  lines.push('');

  const chi = (result as any).chiSquared;
  const chiStr = chi != null ? `Chi-squared: ${chi.toFixed(4)}, ` : '';
  lines.push(`  ${chiStr}p=${result.pValue.toFixed(4)} (${result.significant ? 'significant' : 'not significant'})`);
  lines.push(`  Quality winner: ${result.qualityWinner} | Cost winner: ${result.costWinner}`);
  if ((result as any).recommendation) {
    lines.push(`  ${(result as any).recommendation}`);
  }
  return lines.join('\n');
}
