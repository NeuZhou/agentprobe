/**
 * Tests for src/perf-profiler.ts - Detailed latency breakdown and percentile analysis
 */
import { describe, it, expect } from 'vitest';
import {
  detailedLatencyBreakdown,
  stepPercentiles,
  identifyBottleneck,
  formatDetailedBreakdown,
} from '../src/perf-profiler';
import type { AgentTrace } from '../src/types';

function makeTrace(steps: Array<{ type: string; duration: number; tool?: string }>): AgentTrace {
  return {
    id: 'trace-1',
    timestamp: '2026-01-01T00:00:00Z',
    steps: steps.map((s, i) => ({
      type: s.type as any,
      timestamp: `2026-01-01T00:00:0${i}Z`,
      data: s.tool ? { tool_name: s.tool } : {},
      duration_ms: s.duration,
    })),
    metadata: {},
  };
}

describe('Performance Profiler', () => {
  describe('detailedLatencyBreakdown', () => {
    it('should compute breakdown for mixed trace', () => {
      const trace = makeTrace([
        { type: 'llm_call', duration: 500 },
        { type: 'tool_call', duration: 200, tool: 'search' },
        { type: 'output', duration: 50 },
      ]);
      const breakdown = detailedLatencyBreakdown([trace]);

      expect(breakdown.llm.total_ms).toBe(500);
      expect(breakdown.llm.count).toBe(1);
      expect(breakdown.tool.total_ms).toBe(200);
      expect(breakdown.tool.count).toBe(1);
      expect(breakdown.overhead.total_ms).toBe(50);
      expect(breakdown.total_ms).toBe(750);
    });

    it('should compute correct percentages', () => {
      const trace = makeTrace([
        { type: 'llm_call', duration: 800 },
        { type: 'tool_call', duration: 200, tool: 'search' },
      ]);
      const breakdown = detailedLatencyBreakdown([trace]);

      expect(breakdown.llm.pct).toBeCloseTo(80, 0);
      expect(breakdown.tool.pct).toBeCloseTo(20, 0);
    });

    it('should handle empty traces array', () => {
      const breakdown = detailedLatencyBreakdown([]);
      expect(breakdown.total_ms).toBe(0);
      expect(breakdown.llm.pct).toBe(0);
    });

    it('should handle trace with no duration_ms', () => {
      const trace: AgentTrace = {
        id: 'trace-1',
        timestamp: '2026-01-01T00:00:00Z',
        steps: [
          { type: 'llm_call', timestamp: '2026-01-01T00:00:00Z', data: {} },
        ],
        metadata: {},
      };
      const breakdown = detailedLatencyBreakdown([trace]);
      expect(breakdown.total_ms).toBe(0);
    });

    it('should aggregate across multiple traces', () => {
      const traces = [
        makeTrace([{ type: 'llm_call', duration: 100 }]),
        makeTrace([{ type: 'llm_call', duration: 200 }]),
      ];
      const breakdown = detailedLatencyBreakdown(traces);
      expect(breakdown.llm.total_ms).toBe(300);
      expect(breakdown.llm.count).toBe(2);
    });
  });

  describe('stepPercentiles', () => {
    it('should compute percentiles for step durations', () => {
      const traces = [
        makeTrace([
          { type: 'llm_call', duration: 100 },
          { type: 'llm_call', duration: 200 },
          { type: 'llm_call', duration: 300 },
          { type: 'tool_call', duration: 400, tool: 'search' },
          { type: 'tool_call', duration: 500, tool: 'write' },
        ]),
      ];
      const p = stepPercentiles(traces);

      expect(p.min).toBe(100);
      expect(p.max).toBe(500);
      expect(p.avg).toBe(300);
      expect(p.p50).toBeGreaterThanOrEqual(100);
      expect(p.p95).toBeGreaterThanOrEqual(p.p50);
      expect(p.p99).toBeGreaterThanOrEqual(p.p95);
    });

    it('should handle empty traces', () => {
      const p = stepPercentiles([]);
      expect(p.min).toBe(0);
      expect(p.max).toBe(0);
      expect(p.avg).toBe(0);
    });

    it('should handle single value', () => {
      const traces = [makeTrace([{ type: 'llm_call', duration: 42 }])];
      const p = stepPercentiles(traces);
      expect(p.min).toBe(42);
      expect(p.max).toBe(42);
      expect(p.p50).toBe(42);
    });
  });

  describe('identifyBottleneck', () => {
    it('should find the slowest tool', () => {
      const trace = makeTrace([
        { type: 'tool_call', duration: 100, tool: 'search' },
        { type: 'tool_call', duration: 500, tool: 'database_query' },
        { type: 'tool_call', duration: 50, tool: 'format' },
      ]);
      const bottleneck = identifyBottleneck([trace]);

      expect(bottleneck).not.toBeNull();
      expect(bottleneck!.tool).toBe('database_query');
      expect(bottleneck!.totalMs).toBe(500);
      expect(bottleneck!.pctOfTotal).toBeGreaterThan(0);
    });

    it('should return null when no tool calls exist', () => {
      const trace = makeTrace([
        { type: 'llm_call', duration: 500 },
        { type: 'output', duration: 50 },
      ]);
      expect(identifyBottleneck([trace])).toBeNull();
    });

    it('should aggregate across multiple traces', () => {
      const traces = [
        makeTrace([{ type: 'tool_call', duration: 100, tool: 'search' }]),
        makeTrace([{ type: 'tool_call', duration: 200, tool: 'search' }]),
        makeTrace([{ type: 'tool_call', duration: 150, tool: 'write' }]),
      ];
      const bottleneck = identifyBottleneck(traces);
      expect(bottleneck!.tool).toBe('search');
      expect(bottleneck!.totalMs).toBe(300);
    });
  });

  describe('formatDetailedBreakdown', () => {
    it('should format breakdown as console output', () => {
      const breakdown = {
        llm: { total_ms: 500, pct: 66.7, count: 2 },
        tool: { total_ms: 200, pct: 26.7, count: 1 },
        overhead: { total_ms: 50, pct: 6.7 },
        total_ms: 750,
      };
      const output = formatDetailedBreakdown(breakdown);

      expect(output).toContain('⏱️');
      expect(output).toContain('500ms');
      expect(output).toContain('200ms');
      expect(output).toContain('750ms');
      expect(output).toContain('2 calls');
    });
  });
});
