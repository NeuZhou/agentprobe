import { describe, it, expect } from 'vitest';
import { diffTraces } from '../src/diff';
import { makeTrace, toolCall, output, llmCall } from './helpers';

describe('diff', () => {
  it('same traces = no diff', () => {
    const trace = makeTrace([toolCall('search'), output('result')]);
    const diff = diffTraces(trace, trace);
    expect(diff.stepsDelta).toBe(0);
    expect(diff.toolsAdded).toEqual([]);
    expect(diff.toolsRemoved).toEqual([]);
    expect(diff.outputChanged).toBe(false);
    expect(diff.warnings).toHaveLength(0);
  });

  it('different tool counts detected', () => {
    const old = makeTrace([toolCall('search')]);
    const neo = makeTrace([toolCall('search'), toolCall('search'), toolCall('search')]);
    const diff = diffTraces(old, neo);
    expect(diff.stepsOld).toBe(1);
    expect(diff.stepsNew).toBe(3);
    expect(diff.stepsDelta).toBe(2);
  });

  it('token changes detected', () => {
    const old = makeTrace([llmCall({ input: 100, output: 50 })]);
    const neo = makeTrace([llmCall({ input: 500, output: 200 })]);
    const diff = diffTraces(old, neo);
    expect(diff.tokensOld.input).toBe(100);
    expect(diff.tokensNew.input).toBe(500);
    expect(Math.abs(diff.tokensDeltaPercent)).toBeGreaterThan(50);
    expect(diff.warnings).toContain('Token usage changed significantly');
  });

  it('new tools detected', () => {
    const old = makeTrace([toolCall('search')]);
    const neo = makeTrace([toolCall('search'), toolCall('write')]);
    const diff = diffTraces(old, neo);
    expect(diff.toolsAdded).toEqual(['write']);
    expect(diff.toolsRemoved).toEqual([]);
    expect(diff.warnings.some(w => w.includes('write'))).toBe(true);
  });

  it('removed tools detected', () => {
    const old = makeTrace([toolCall('search'), toolCall('write')]);
    const neo = makeTrace([toolCall('search')]);
    const diff = diffTraces(old, neo);
    expect(diff.toolsRemoved).toEqual(['write']);
  });

  it('output change detected', () => {
    const old = makeTrace([output('hello')]);
    const neo = makeTrace([output('goodbye')]);
    const diff = diffTraces(old, neo);
    expect(diff.outputChanged).toBe(true);
  });
});
