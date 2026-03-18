/**
 * Tests for src/cost.ts, src/cost-estimator.ts, src/cost-optimizer.ts
 * Cost calculation, estimation, and optimization
 */
import { describe, it, expect } from 'vitest';
import { calculateCost } from '../src/cost';
import type { AgentTrace } from '../src/types';

function makeTrace(steps: Array<{ type: string; model?: string; input?: number; output?: number }>): AgentTrace {
  return {
    id: 'cost-trace',
    timestamp: '2026-01-01T00:00:00Z',
    steps: steps.map((s, i) => ({
      type: s.type as any,
      timestamp: `2026-01-01T00:00:0${i}Z`,
      data: {
        model: s.model,
        tokens: s.input != null || s.output != null
          ? { input: s.input ?? 0, output: s.output ?? 0 }
          : undefined,
      },
      duration_ms: 100,
    })),
    metadata: {},
  };
}

describe('Cost Calculation', () => {
  it('should calculate cost for GPT-4 tokens', () => {
    const trace = makeTrace([
      { type: 'llm_call', model: 'gpt-4', input: 1000, output: 500 },
    ]);
    const cost = calculateCost(trace);
    expect(cost.total_cost).toBeGreaterThan(0);
    expect(cost.input_tokens).toBe(1000);
    expect(cost.output_tokens).toBe(500);
    expect(cost.total_tokens).toBe(1500);
  });

  it('should handle empty trace', () => {
    const trace = makeTrace([]);
    const cost = calculateCost(trace);
    expect(cost.total_cost).toBe(0);
    expect(cost.total_tokens).toBe(0);
  });

  it('should accumulate across multiple LLM calls', () => {
    const trace = makeTrace([
      { type: 'llm_call', model: 'gpt-4', input: 500, output: 200 },
      { type: 'llm_call', model: 'gpt-4', input: 300, output: 100 },
    ]);
    const cost = calculateCost(trace);
    expect(cost.input_tokens).toBe(800);
    expect(cost.output_tokens).toBe(300);
    expect(cost.total_tokens).toBe(1100);
  });

  it('should ignore non-LLM steps for token counting', () => {
    const trace = makeTrace([
      { type: 'llm_call', model: 'gpt-4', input: 100, output: 50 },
      { type: 'tool_call' },
      { type: 'output' },
    ]);
    const cost = calculateCost(trace);
    expect(cost.total_tokens).toBe(150);
  });

  it('should handle missing token data', () => {
    const trace = makeTrace([
      { type: 'llm_call', model: 'gpt-4' },
    ]);
    const cost = calculateCost(trace);
    expect(cost.total_tokens).toBe(0);
  });

  it('should handle unknown models', () => {
    const trace = makeTrace([
      { type: 'llm_call', model: 'custom-model-v1', input: 1000, output: 500 },
    ]);
    const cost = calculateCost(trace);
    // Should still calculate, possibly with default pricing
    expect(cost.total_tokens).toBe(1500);
  });
});
