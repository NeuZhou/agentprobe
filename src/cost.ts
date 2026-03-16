import type { AgentTrace } from './types';

/**
 * Model pricing per 1M tokens (USD).
 */
export const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-3-opus': { input: 15.00, output: 75.00 },
  'claude-3.5-haiku': { input: 0.80, output: 4.00 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
};

export interface CostBreakdown {
  model: string;
  input_tokens: number;
  output_tokens: number;
  input_cost: number;
  output_cost: number;
  total_cost: number;
}

export interface CostReport {
  breakdowns: CostBreakdown[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
}

/**
 * Calculate cost from an AgentTrace.
 */
export function calculateCost(trace: AgentTrace): CostReport {
  const byModel: Record<string, { input: number; output: number }> = {};

  for (const step of trace.steps) {
    const model = step.data.model;
    const tokens = step.data.tokens;
    if (!model || !tokens) continue;

    if (!byModel[model]) byModel[model] = { input: 0, output: 0 };
    byModel[model].input += tokens.input ?? 0;
    byModel[model].output += tokens.output ?? 0;
  }

  const breakdowns: CostBreakdown[] = [];
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (const [model, tokens] of Object.entries(byModel)) {
    const pricing = findPricing(model);
    const inputCost = (tokens.input / 1_000_000) * pricing.input;
    const outputCost = (tokens.output / 1_000_000) * pricing.output;
    const cost = inputCost + outputCost;

    breakdowns.push({
      model,
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      input_cost: inputCost,
      output_cost: outputCost,
      total_cost: cost,
    });

    totalCost += cost;
    totalInput += tokens.input;
    totalOutput += tokens.output;
  }

  return {
    breakdowns,
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_cost: totalCost,
  };
}

/**
 * Find pricing for a model, fuzzy-matching known models.
 */
function findPricing(model: string): { input: number; output: number } {
  if (PRICING[model]) return PRICING[model];
  // Fuzzy match: try prefix
  const normalized = model.toLowerCase();
  for (const [key, val] of Object.entries(PRICING)) {
    if (normalized.includes(key) || key.includes(normalized)) return val;
  }
  // Default: gpt-4o-mini pricing as fallback
  return { input: 0.15, output: 0.60 };
}

/**
 * Format cost report for display.
 */
export function formatCostReport(report: CostReport): string {
  const lines: string[] = ['', '  💰 Cost Breakdown'];
  for (const b of report.breakdowns) {
    lines.push(`     ${b.model}: ${b.input_tokens} in + ${b.output_tokens} out = $${b.total_cost.toFixed(4)}`);
  }
  lines.push(`     Total: $${report.total_cost.toFixed(4)} (${report.total_input_tokens} in + ${report.total_output_tokens} out)`);
  return lines.join('\n');
}
