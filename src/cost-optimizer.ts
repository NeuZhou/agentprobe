/**
 * Cost Optimizer — Analyze test suite reports and recommend cost savings.
 *
 * Scans report directories, identifies expensive tests, finds duplicates,
 * suggests model downgrades, caching opportunities, and batching strategies.
 */

import { PRICING, calculateCost } from './cost';
import type { SuiteResult } from './types';

// ===== Types =====

export interface CostOptimizationReport {
  current_monthly_estimate: number;
  recommendations: CostRecommendation[];
  estimated_after_optimization: number;
  savings_percentage: number;
  test_costs: TestCostEntry[];
}

export interface CostRecommendation {
  type: 'model_downgrade' | 'caching' | 'duplicate_removal' | 'batching' | 'unused_removal';
  description: string;
  affected_tests: string[];
  estimated_savings: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface TestCostEntry {
  name: string;
  model: string;
  cost_per_run: number;
  monthly_estimate: number;
  input_tokens: number;
  output_tokens: number;
  runs_per_month: number;
}

// ===== Analysis =====

export function analyzeTestCosts(results: SuiteResult, runsPerMonth: number = 30): TestCostEntry[] {
  const entries: TestCostEntry[] = [];

  for (const test of results.results) {
    if (!test.trace) continue;
    const costReport = calculateCost(test.trace);
    const model = costReport.breakdowns[0]?.model ?? 'unknown';

    entries.push({
      name: test.name,
      model,
      cost_per_run: costReport.total_cost,
      monthly_estimate: costReport.total_cost * runsPerMonth,
      input_tokens: costReport.total_input_tokens,
      output_tokens: costReport.total_output_tokens,
      runs_per_month: runsPerMonth,
    });
  }

  return entries.sort((a, b) => b.monthly_estimate - a.monthly_estimate);
}

export function findDuplicateTests(results: SuiteResult): string[][] {
  const groups: Map<string, string[]> = new Map();

  for (const test of results.results) {
    if (!test.trace) continue;
    // Create a fingerprint from tool sequence
    const toolSeq = test.trace.steps
      .filter(s => s.type === 'tool_call')
      .map(s => s.data.tool_name)
      .join(',');
    const key = toolSeq || `output:${test.trace.steps.filter(s => s.type === 'output').length}`;

    const existing = groups.get(key) ?? [];
    existing.push(test.name);
    groups.set(key, existing);
  }

  return [...groups.values()].filter(g => g.length > 1);
}

export function suggestModelDowngrades(entries: TestCostEntry[]): CostRecommendation[] {
  const recommendations: CostRecommendation[] = [];
  const expensiveModels = ['gpt-4', 'gpt-4-turbo', 'claude-3-opus', 'o1'];
  const cheaperAlternatives: Record<string, string> = {
    'gpt-4': 'gpt-3.5-turbo',
    'gpt-4-turbo': 'gpt-4o-mini',
    'claude-3-opus': 'claude-3.5-sonnet',
    'o1': 'o3-mini',
    'claude-3-sonnet': 'claude-3-haiku',
    'gpt-4o': 'gpt-4o-mini',
  };

  const expensiveTests = entries.filter(e =>
    expensiveModels.some(m => e.model.includes(m))
  );

  if (expensiveTests.length > 0) {
    const totalSavings = expensiveTests.reduce((sum, t) => {
      const alt = cheaperAlternatives[t.model];
      if (!alt) return sum;
      const altPricing = PRICING[alt];
      if (!altPricing) return sum;
      const currentPricing = PRICING[t.model];
      if (!currentPricing) return sum;
      const altCost = (t.input_tokens / 1_000_000 * altPricing.input +
                       t.output_tokens / 1_000_000 * altPricing.output) * t.runs_per_month;
      return sum + (t.monthly_estimate - altCost);
    }, 0);

    recommendations.push({
      type: 'model_downgrade',
      description: `Switch ${expensiveTests.length} test(s) to cheaper models (save ~60%)`,
      affected_tests: expensiveTests.map(t => t.name),
      estimated_savings: totalSavings,
      confidence: 'medium',
    });
  }

  return recommendations;
}

export function suggestCaching(entries: TestCostEntry[]): CostRecommendation | null {
  // Tests with high input token counts benefit from prompt caching
  const highInput = entries.filter(e => e.input_tokens > 1000);
  if (highInput.length === 0) return null;

  const savings = highInput.reduce((sum, t) => sum + t.monthly_estimate * 0.25, 0);
  return {
    type: 'caching',
    description: `Enable prompt caching for ${highInput.length} test(s) with high input tokens (save ~25%)`,
    affected_tests: highInput.map(t => t.name),
    estimated_savings: savings,
    confidence: 'medium',
  };
}

export function suggestBatching(entries: TestCostEntry[]): CostRecommendation | null {
  // Group tests by model — batching similar model calls reduces overhead
  const byModel: Map<string, TestCostEntry[]> = new Map();
  for (const e of entries) {
    const arr = byModel.get(e.model) ?? [];
    arr.push(e);
    byModel.set(e.model, arr);
  }

  const batchable = [...byModel.entries()].filter(([, tests]) => tests.length >= 3);
  if (batchable.length === 0) return null;

  const allTests = batchable.flatMap(([, tests]) => tests);
  const savings = allTests.reduce((sum, t) => sum + t.monthly_estimate * 0.05, 0);

  return {
    type: 'batching',
    description: `Batch ${allTests.length} similar tests together to reduce API overhead`,
    affected_tests: allTests.map(t => t.name),
    estimated_savings: savings,
    confidence: 'low',
  };
}

// ===== Main optimizer =====

export function optimizeCosts(results: SuiteResult, runsPerMonth: number = 30): CostOptimizationReport {
  const entries = analyzeTestCosts(results, runsPerMonth);
  const currentMonthly = entries.reduce((sum, e) => sum + e.monthly_estimate, 0);

  const recommendations: CostRecommendation[] = [];

  // Model downgrades
  recommendations.push(...suggestModelDowngrades(entries));

  // Caching
  const caching = suggestCaching(entries);
  if (caching) recommendations.push(caching);

  // Duplicate removal
  const duplicates = findDuplicateTests(results);
  if (duplicates.length > 0) {
    const dupTests = duplicates.flatMap(g => g.slice(1));
    const savings = entries
      .filter(e => dupTests.includes(e.name))
      .reduce((sum, e) => sum + e.monthly_estimate, 0);
    recommendations.push({
      type: 'duplicate_removal',
      description: `Remove ${dupTests.length} duplicate test(s)`,
      affected_tests: dupTests,
      estimated_savings: savings,
      confidence: 'high',
    });
  }

  // Batching
  const batching = suggestBatching(entries);
  if (batching) recommendations.push(batching);

  const totalSavings = recommendations.reduce((sum, r) => sum + r.estimated_savings, 0);
  const estimated = Math.max(0, currentMonthly - totalSavings);
  const savingsPercent = currentMonthly > 0 ? (totalSavings / currentMonthly) * 100 : 0;

  return {
    current_monthly_estimate: currentMonthly,
    recommendations,
    estimated_after_optimization: estimated,
    savings_percentage: savingsPercent,
    test_costs: entries,
  };
}

// ===== Formatting =====

export function formatCostOptimization(report: CostOptimizationReport): string {
  const lines: string[] = [
    '',
    '  💰 Cost Optimization Report',
    `     Current: $${report.current_monthly_estimate.toFixed(2)}/month (est.)`,
    '',
    '  Recommendations:',
  ];

  for (let i = 0; i < report.recommendations.length; i++) {
    const r = report.recommendations[i];
    lines.push(`     ${i + 1}. ${r.description}: -$${r.estimated_savings.toFixed(2)} [${r.confidence}]`);
  }

  lines.push('');
  lines.push(`  Estimated after optimization: $${report.estimated_after_optimization.toFixed(2)}/month (-${report.savings_percentage.toFixed(0)}%)`);

  return lines.join('\n');
}
