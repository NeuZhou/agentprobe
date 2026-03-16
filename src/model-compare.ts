/**
 * Multi-Model Comparison — Compare agent behavior across different LLMs
 * @module
 */

import type { SuiteResult, TestResult } from './types';

export interface ModelConfig {
  name: string;
  adapter?: string;
  apiKey?: string;
  endpoint?: string;
}

export interface ModelMetrics {
  model: string;
  passRate: number;
  passed: number;
  failed: number;
  total: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  safetyScore: number;
  results: TestResult[];
}

export interface ComparisonResult {
  models: ModelMetrics[];
  testNames: string[];
  matrix: ComparisonCell[][];  // [test][model]
  winner: string | null;
  summary: string;
}

export interface ComparisonCell {
  model: string;
  testName: string;
  passed: boolean;
  durationMs: number;
  costUsd?: number;
}

export interface ComparisonConfig {
  models: ModelConfig[];
  weightPassRate?: number;
  weightLatency?: number;
  weightCost?: number;
  weightSafety?: number;
}

/**
 * Parse model names from a comma-separated string
 */
export function parseModelNames(input: string): string[] {
  return input.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Extract metrics from a suite result for a given model
 */
export function extractMetrics(model: string, suiteResult: SuiteResult, costPerTest = 0.01): ModelMetrics {
  const totalDuration = suiteResult.results.reduce((sum, r) => sum + r.duration_ms, 0);
  const avgLatency = suiteResult.results.length > 0 ? totalDuration / suiteResult.results.length : 0;

  // Count safety-related test passes
  const safetyTests = suiteResult.results.filter(r => r.tags?.includes('safety') || /safety|security|injection/i.test(r.name));
  const safetyScore = safetyTests.length > 0
    ? Math.round((safetyTests.filter(r => r.passed).length / safetyTests.length) * 100)
    : 100; // If no safety tests, assume safe

  return {
    model,
    passRate: suiteResult.total > 0 ? Math.round((suiteResult.passed / suiteResult.total) * 100) : 0,
    passed: suiteResult.passed,
    failed: suiteResult.failed,
    total: suiteResult.total,
    avgLatencyMs: Math.round(avgLatency),
    avgCostUsd: Math.round(costPerTest * suiteResult.total * 100) / 100,
    safetyScore,
    results: suiteResult.results,
  };
}

/**
 * Build comparison matrix from multiple model results
 */
export function buildComparisonMatrix(metricsArr: ModelMetrics[]): { testNames: string[]; matrix: ComparisonCell[][] } {
  const allTests = new Set<string>();
  for (const m of metricsArr) {
    for (const r of m.results) allTests.add(r.name);
  }
  const testNames = [...allTests].sort();

  const matrix: ComparisonCell[][] = testNames.map(testName =>
    metricsArr.map(m => {
      const result = m.results.find(r => r.name === testName);
      return {
        model: m.model,
        testName,
        passed: result?.passed ?? false,
        durationMs: result?.duration_ms ?? 0,
      };
    })
  );

  return { testNames, matrix };
}

/**
 * Score a model based on weighted metrics
 */
export function scoreModel(metrics: ModelMetrics, config: ComparisonConfig): number {
  const wPass = config.weightPassRate ?? 0.5;
  const wLatency = config.weightLatency ?? 0.2;
  const wCost = config.weightCost ?? 0.1;
  const wSafety = config.weightSafety ?? 0.2;

  // Normalize: passRate and safety are 0-100, latency/cost are inverse (lower is better)
  const passScore = metrics.passRate;
  const safetyScoreNorm = metrics.safetyScore;
  const latencyScore = metrics.avgLatencyMs > 0 ? Math.max(0, 100 - metrics.avgLatencyMs / 50) : 100;
  const costScore = metrics.avgCostUsd > 0 ? Math.max(0, 100 - metrics.avgCostUsd * 100) : 100;

  return wPass * passScore + wLatency * latencyScore + wCost * costScore + wSafety * safetyScoreNorm;
}

/**
 * Compare multiple models and determine the winner
 */
export function compareModels(modelResults: Array<{ model: string; result: SuiteResult }>, config?: Partial<ComparisonConfig>): ComparisonResult {
  const fullConfig: ComparisonConfig = {
    models: modelResults.map(mr => ({ name: mr.model })),
    ...config,
  };

  const metricsArr = modelResults.map(mr => extractMetrics(mr.model, mr.result));
  const { testNames, matrix } = buildComparisonMatrix(metricsArr);

  // Score and find winner
  let bestScore = -1;
  let winner: string | null = null;
  for (const m of metricsArr) {
    const score = scoreModel(m, fullConfig);
    if (score > bestScore) {
      bestScore = score;
      winner = m.model;
    }
  }

  const summary = formatComparisonTable(metricsArr);

  return { models: metricsArr, testNames, matrix, winner, summary };
}

/**
 * Format comparison as a table string
 */
export function formatComparisonTable(metrics: ModelMetrics[]): string {
  const lines: string[] = [];
  const pad = (s: string, n: number) => s.padEnd(n);

  lines.push('📊 Model Comparison');
  const header = `${pad('Metric', 16)}| ${metrics.map(m => pad(m.model, 10)).join('| ')}`;
  lines.push(header);
  lines.push('-'.repeat(header.length));

  const rows: [string, (m: ModelMetrics) => string][] = [
    ['Pass rate', m => `${m.passRate}%`],
    ['Avg latency', m => `${(m.avgLatencyMs / 1000).toFixed(1)}s`],
    ['Avg cost', m => `$${m.avgCostUsd.toFixed(2)}`],
    ['Safety score', m => `${m.safetyScore}`],
  ];

  for (const [label, fn] of rows) {
    lines.push(`${pad(label, 16)}| ${metrics.map(m => pad(fn(m), 10)).join('| ')}`);
  }

  return lines.join('\n');
}

/**
 * Generate an HTML comparison report
 */
export function generateComparisonHTML(result: ComparisonResult): string {
  const rows = result.models.map(m =>
    `<tr><td>${m.model}</td><td>${m.passRate}%</td><td>${m.avgLatencyMs}ms</td><td>$${m.avgCostUsd.toFixed(2)}</td><td>${m.safetyScore}</td></tr>`
  ).join('\n');

  return `<!DOCTYPE html>
<html><head><title>Model Comparison</title></head>
<body>
<h1>📊 Model Comparison</h1>
${result.winner ? `<p>Winner: <strong>${result.winner}</strong></p>` : ''}
<table border="1"><tr><th>Model</th><th>Pass Rate</th><th>Avg Latency</th><th>Avg Cost</th><th>Safety</th></tr>
${rows}
</table>
</body></html>`;
}
