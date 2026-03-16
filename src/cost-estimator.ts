/**
 * Agent Cost Estimator — Estimate costs before running test suites.
 *
 * Analyzes test definitions to predict token usage and costs
 * across different model providers.
 */

import * as fs from 'fs';
import YAML from 'yaml';
import { PRICING } from './cost';
import type { TestSuite, TestCase } from './types';

export interface ModelEstimate {
  model: string;
  avgCallsPerTest: number;
  avgCostPerCall: number;
  totalCost: number;
}

export interface CostEstimate {
  testCount: number;
  models: ModelEstimate[];
  totalEstimated: number;
  suggestedBudget: number;
  safetyMargin: number;
}

export interface EstimateOptions {
  /** Models to estimate for (default: top models) */
  models?: string[];
  /** Average calls per test (default: 3) */
  avgCallsPerTest?: number;
  /** Average tokens per call input (default: 800) */
  avgInputTokens?: number;
  /** Average tokens per call output (default: 400) */
  avgOutputTokens?: number;
  /** Safety margin multiplier (default: 1.5) */
  safetyMargin?: number;
}

const DEFAULT_MODELS = ['gpt-4o', 'claude-3.5-sonnet', 'gemini-2.0-flash'];

/**
 * Load a test suite from a YAML file.
 */
export function loadTestSuiteForEstimate(filePath: string): TestSuite {
  const content = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(content) as TestSuite;
}

/**
 * Count tests in a suite, expanding parameterized tests.
 */
export function countTests(suite: TestSuite): number {
  let count = 0;
  for (const test of suite.tests) {
    if (test.each && test.each.length > 0) {
      count += test.each.length;
    } else {
      count += 1;
    }
  }
  return count;
}

/**
 * Estimate complexity of a test based on its expectations.
 */
export function estimateTestComplexity(test: TestCase): number {
  let complexity = 1.0;

  // More tool expectations → more calls
  if (test.expect.tool_sequence) {
    complexity += test.expect.tool_sequence.length * 0.3;
  }
  if (test.expect.tool_called) {
    const tools = Array.isArray(test.expect.tool_called)
      ? test.expect.tool_called
      : [test.expect.tool_called];
    complexity += tools.length * 0.2;
  }
  if (test.expect.chain) {
    complexity += test.expect.chain.length * 0.4;
  }
  if (test.expect.judge || test.expect.judge_rubric) {
    complexity += 0.5; // judge adds an extra LLM call
  }
  if (test.expect.max_steps) {
    complexity = Math.max(complexity, test.expect.max_steps * 0.3);
  }

  return Math.max(1, complexity);
}

/**
 * Estimate costs for running a test suite.
 */
export function estimateCosts(
  suite: TestSuite,
  options: EstimateOptions = {},
): CostEstimate {
  const models = options.models ?? DEFAULT_MODELS;
  const baseCallsPerTest = options.avgCallsPerTest ?? 3;
  const avgInputTokens = options.avgInputTokens ?? 800;
  const avgOutputTokens = options.avgOutputTokens ?? 400;
  const safetyMargin = options.safetyMargin ?? 1.5;

  const testCount = countTests(suite);

  // Calculate average complexity
  const totalComplexity = suite.tests.reduce(
    (sum, t) => sum + estimateTestComplexity(t) * (t.each?.length || 1),
    0,
  );
  const avgComplexity = testCount > 0 ? totalComplexity / testCount : 1;
  const adjustedCalls = baseCallsPerTest * avgComplexity;

  const modelEstimates: ModelEstimate[] = models.map(model => {
    const pricing = PRICING[model] ?? { input: 0.15, output: 0.6 };
    const costPerCall =
      (avgInputTokens / 1_000_000) * pricing.input +
      (avgOutputTokens / 1_000_000) * pricing.output;
    const totalCost = testCount * adjustedCalls * costPerCall;

    return {
      model,
      avgCallsPerTest: Math.round(adjustedCalls * 10) / 10,
      avgCostPerCall: Math.round(costPerCall * 10000) / 10000,
      totalCost: Math.round(totalCost * 100) / 100,
    };
  });

  const totalEstimated = modelEstimates.reduce((sum, m) => sum + m.totalCost, 0);
  const suggestedBudget = Math.round(totalEstimated * safetyMargin * 100) / 100;

  return {
    testCount,
    models: modelEstimates,
    totalEstimated: Math.round(totalEstimated * 100) / 100,
    suggestedBudget,
    safetyMargin,
  };
}

/**
 * Estimate costs from a file path.
 */
export function estimateCostsFromFile(
  filePath: string,
  options: EstimateOptions = {},
): CostEstimate {
  const suite = loadTestSuiteForEstimate(filePath);
  return estimateCosts(suite, options);
}

/**
 * Format cost estimate for display.
 */
export function formatCostEstimate(estimate: CostEstimate): string {
  const lines: string[] = [];
  lines.push(`\n💰 Cost Estimate for ${estimate.testCount} tests:\n`);

  for (const m of estimate.models) {
    lines.push(
      `  ${m.model}: ~$${m.totalCost.toFixed(2)} (avg ${m.avgCallsPerTest} calls/test × $${m.avgCostPerCall.toFixed(4)}/call)`,
    );
  }

  lines.push(`\n  Total estimated: $${estimate.totalEstimated.toFixed(2)}`);
  lines.push(
    `  Suggested budget: $${estimate.suggestedBudget.toFixed(2)} (${estimate.safetyMargin}x safety margin)`,
  );

  return lines.join('\n');
}
