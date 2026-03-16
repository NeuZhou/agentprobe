import { describe, it, expect } from 'vitest';
import { evaluateScoring, formatScoringResult } from '../src/scoring';
import type { ScoringConfig } from '../src/scoring';
import { makeTrace, toolCall, output, llmCall } from './helpers';

describe('scoring', () => {
  it('single assertion scoring', () => {
    const trace = makeTrace([toolCall('search'), output('result')]);
    const scoring: ScoringConfig = { tool_called_search: { weight: 1 } };
    const result = evaluateScoring(trace, scoring, 0.5);
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('multiple assertions with weights', () => {
    const trace = makeTrace([toolCall('search'), output('result')]);
    const scoring: ScoringConfig = {
      tool_called_search: { weight: 2 },
      output_contains_result: { weight: 1 },
    };
    const result = evaluateScoring(trace, scoring, 0.5);
    expect(result.score).toBeCloseTo(1.0);
    expect(result.passed).toBe(true);
  });

  it('threshold pass (above)', () => {
    const trace = makeTrace([toolCall('search'), output('result')]);
    const scoring: ScoringConfig = { tool_called_search: { weight: 1 } };
    const result = evaluateScoring(trace, scoring, 0.5);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  it('threshold fail (below)', () => {
    const trace = makeTrace([output('no tools')]);
    const scoring: ScoringConfig = {
      tool_called_search: { weight: 1 },
      tool_called_calculate: { weight: 1 },
    };
    const result = evaluateScoring(trace, scoring, 0.8);
    expect(result.passed).toBe(false);
  });

  it('equal weights', () => {
    const trace = makeTrace([toolCall('search'), output('result')]);
    const scoring: ScoringConfig = {
      tool_called_search: { weight: 1 },
      output_contains_result: { weight: 1 },
    };
    const result = evaluateScoring(trace, scoring, 0.5);
    expect(result.details[0].weight).toBe(1);
    expect(result.details[1].weight).toBe(1);
  });

  it('zero weight assertions', () => {
    const trace = makeTrace([output('hello')]);
    const scoring: ScoringConfig = { tool_called_missing: { weight: 0 } };
    const result = evaluateScoring(trace, scoring, 0);
    // 0 weight means 0 total weight, normalized = 0
    expect(result.details).toHaveLength(1);
  });

  it('unknown scoring key gives failed assertion', () => {
    const trace = makeTrace([output('hello')]);
    const scoring: ScoringConfig = { unknown_key_xyz: { weight: 1 } };
    const result = evaluateScoring(trace, scoring, 0.5);
    expect(result.details[0].passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('perfect score (1.0)', () => {
    const trace = makeTrace([toolCall('search'), output('result')]);
    const scoring: ScoringConfig = { tool_called_search: { weight: 1 } };
    const result = evaluateScoring(trace, scoring, 1.0);
    expect(result.score).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it('zero score (0.0)', () => {
    const trace = makeTrace([output('nothing')]);
    const scoring: ScoringConfig = { tool_called_search: { weight: 1 } };
    const result = evaluateScoring(trace, scoring, 0.5);
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('no scoring config (empty)', () => {
    const trace = makeTrace([output('hello')]);
    const scoring: ScoringConfig = {};
    const result = evaluateScoring(trace, scoring, 0.5);
    expect(result.score).toBe(0);
    expect(result.details).toHaveLength(0);
  });

  it('formatScoringResult includes score percentage', () => {
    const trace = makeTrace([toolCall('search'), output('result')]);
    const scoring: ScoringConfig = { tool_called_search: { weight: 1 } };
    const result = evaluateScoring(trace, scoring, 0.7);
    const formatted = formatScoringResult(result);
    expect(formatted).toContain('Score:');
    expect(formatted).toContain('threshold:');
  });
});
