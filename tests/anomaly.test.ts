/**
 * Tests for src/anomaly.ts - Trace anomaly detection
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectAnomalies, formatAnomalies, type AnomalyResult } from '../src/anomaly';
import type { AgentTrace } from '../src/types';

function makeTrace(id: string, overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id,
    timestamp: '2026-01-01T00:00:00Z',
    steps: [
      {
        type: 'tool_call',
        timestamp: '2026-01-01T00:00:00Z',
        data: { tool_name: 'search', tool_args: { q: 'test' } },
        duration_ms: 100,
      },
      {
        type: 'llm_call',
        timestamp: '2026-01-01T00:00:01Z',
        data: { model: 'gpt-4', tokens: { input: 100, output: 50 } },
        duration_ms: 200,
      },
      {
        type: 'output',
        timestamp: '2026-01-01T00:00:02Z',
        data: { content: 'result', tokens: { output: 50 } },
        duration_ms: 10,
      },
    ],
    metadata: { cost_usd: 0.01 },
    ...overrides,
  };
}

describe('Anomaly Detection', () => {
  let tmpDir: string;
  let baselineDir: string;
  let currentDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anomaly-test-'));
    baselineDir = path.join(tmpDir, 'baseline');
    currentDir = path.join(tmpDir, 'current');
    fs.mkdirSync(baselineDir);
    fs.mkdirSync(currentDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('detectAnomalies', () => {
    it('should return no anomalies when baseline and current match', () => {
      const trace = makeTrace('trace-1');
      fs.writeFileSync(path.join(baselineDir, 't1.json'), JSON.stringify(trace));
      fs.writeFileSync(path.join(currentDir, 't1.json'), JSON.stringify(trace));

      const result = detectAnomalies(baselineDir, currentDir);
      expect(result.anomalies).toHaveLength(0);
      expect(result.baselineStats.traceCount).toBe(1);
      expect(result.currentStats.traceCount).toBe(1);
    });

    it('should detect new tool sequences', () => {
      const baseline = makeTrace('t1');
      const current = makeTrace('t2', {
        steps: [
          { type: 'tool_call', timestamp: '', data: { tool_name: 'write_file' }, duration_ms: 50 },
          { type: 'tool_call', timestamp: '', data: { tool_name: 'delete_file' }, duration_ms: 50 },
          { type: 'output', timestamp: '', data: { content: 'done' }, duration_ms: 10 },
        ],
      });

      fs.writeFileSync(path.join(baselineDir, 't1.json'), JSON.stringify(baseline));
      fs.writeFileSync(path.join(currentDir, 't2.json'), JSON.stringify(current));

      const result = detectAnomalies(baselineDir, currentDir);
      const seqAnomalies = result.anomalies.filter(a => a.type === 'tool_sequence');
      expect(seqAnomalies.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect new tools not in baseline', () => {
      const baseline = makeTrace('t1');
      const current = makeTrace('t2', {
        steps: [
          { type: 'tool_call', timestamp: '', data: { tool_name: 'new_dangerous_tool' }, duration_ms: 50 },
          { type: 'output', timestamp: '', data: { content: 'done' }, duration_ms: 10 },
        ],
      });

      fs.writeFileSync(path.join(baselineDir, 't1.json'), JSON.stringify(baseline));
      fs.writeFileSync(path.join(currentDir, 't2.json'), JSON.stringify(current));

      const result = detectAnomalies(baselineDir, currentDir);
      const newToolAnomalies = result.anomalies.filter(a => a.type === 'new_tool');
      expect(newToolAnomalies.length).toBeGreaterThanOrEqual(1);
      expect(newToolAnomalies[0].details.tool).toBe('new_dangerous_tool');
    });

    it('should handle empty directories', () => {
      const result = detectAnomalies(baselineDir, currentDir);
      expect(result.anomalies).toHaveLength(0);
      expect(result.baselineStats.traceCount).toBe(0);
      expect(result.currentStats.traceCount).toBe(0);
    });

    it('should handle nonexistent directories', () => {
      const result = detectAnomalies('/nonexistent/baseline', '/nonexistent/current');
      expect(result.anomalies).toHaveLength(0);
    });

    it('should skip invalid files', () => {
      fs.writeFileSync(path.join(baselineDir, 'bad.json'), 'not valid json');
      fs.writeFileSync(path.join(currentDir, 'bad.json'), 'not valid json');
      const result = detectAnomalies(baselineDir, currentDir);
      expect(result.baselineStats.traceCount).toBe(0);
    });

    it('should load YAML trace files', () => {
      const trace = makeTrace('t1');
      const YAML = require('yaml');
      fs.writeFileSync(path.join(baselineDir, 't1.yaml'), YAML.stringify(trace));
      fs.writeFileSync(path.join(currentDir, 't1.yaml'), YAML.stringify(trace));

      const result = detectAnomalies(baselineDir, currentDir);
      expect(result.baselineStats.traceCount).toBe(1);
    });

    it('should detect error patterns not in baseline', () => {
      const baseline = makeTrace('t1');
      const current = makeTrace('t2', {
        steps: [
          {
            type: 'tool_call',
            timestamp: '',
            data: { tool_name: 'search', tool_result: 'Error: Connection refused' },
            duration_ms: 100,
          },
          { type: 'output', timestamp: '', data: { content: 'failed' }, duration_ms: 10 },
        ],
      });

      fs.writeFileSync(path.join(baselineDir, 't1.json'), JSON.stringify(baseline));
      fs.writeFileSync(path.join(currentDir, 't2.json'), JSON.stringify(current));

      const result = detectAnomalies(baselineDir, currentDir);
      const errorAnomalies = result.anomalies.filter(a => a.type === 'error_pattern');
      expect(errorAnomalies.length).toBeGreaterThanOrEqual(1);
    });

    it('should sort anomalies by severity (critical first)', () => {
      // Create conditions for multiple anomaly types
      const baseline = makeTrace('t1');
      const current = makeTrace('t2', {
        steps: [
          { type: 'tool_call', timestamp: '', data: { tool_name: 'new_tool' }, duration_ms: 50 },
          { type: 'output', timestamp: '', data: { content: 'done' }, duration_ms: 10 },
        ],
      });

      fs.writeFileSync(path.join(baselineDir, 't1.json'), JSON.stringify(baseline));
      fs.writeFileSync(path.join(currentDir, 't2.json'), JSON.stringify(current));

      const result = detectAnomalies(baselineDir, currentDir);
      if (result.anomalies.length >= 2) {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        for (let i = 1; i < result.anomalies.length; i++) {
          expect(severityOrder[result.anomalies[i].severity]).toBeGreaterThanOrEqual(
            severityOrder[result.anomalies[i - 1].severity]
          );
        }
      }
    });
  });

  describe('formatAnomalies', () => {
    it('should format result with no anomalies', () => {
      const result: AnomalyResult = {
        anomalies: [],
        baselineStats: { toolSequences: [], toolFrequency: {}, avgResponseTokens: 0, stdResponseTokens: 0, errorPatterns: {}, avgLatencyMs: 0, stdLatencyMs: 0, avgCostUsd: 0, traceCount: 5 },
        currentStats: { toolSequences: [], toolFrequency: {}, avgResponseTokens: 0, stdResponseTokens: 0, errorPatterns: {}, avgLatencyMs: 0, stdLatencyMs: 0, avgCostUsd: 0, traceCount: 3 },
      };
      const output = formatAnomalies(result);
      expect(output).toContain('✅');
      expect(output).toContain('No anomalies');
      expect(output).toContain('5 traces');
      expect(output).toContain('3 traces');
    });

    it('should format anomalies with severity icons', () => {
      const result: AnomalyResult = {
        anomalies: [
          { type: 'new_tool', severity: 'critical', description: 'Critical issue', details: {} },
          { type: 'new_tool', severity: 'high', description: 'High issue', details: {} },
          { type: 'new_tool', severity: 'medium', description: 'Medium issue', details: {} },
          { type: 'new_tool', severity: 'low', description: 'Low issue', details: {} },
        ],
        baselineStats: { toolSequences: [], toolFrequency: {}, avgResponseTokens: 0, stdResponseTokens: 0, errorPatterns: {}, avgLatencyMs: 0, stdLatencyMs: 0, avgCostUsd: 0, traceCount: 1 },
        currentStats: { toolSequences: [], toolFrequency: {}, avgResponseTokens: 0, stdResponseTokens: 0, errorPatterns: {}, avgLatencyMs: 0, stdLatencyMs: 0, avgCostUsd: 0, traceCount: 1 },
      };
      const output = formatAnomalies(result);
      expect(output).toContain('🚨');
      expect(output).toContain('🔴');
      expect(output).toContain('🟡');
      expect(output).toContain('🟢');
      expect(output).toContain('4 anomalies');
    });
  });
});
