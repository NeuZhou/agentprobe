/**
 * Trace Anomaly Detection - Detect anomalous agent behavior by comparing
 * current traces against a baseline of normal behavior.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace } from './types';
import YAML from 'yaml';

export interface AnomalyResult {
  anomalies: Anomaly[];
  baselineStats: BaselineStats;
  currentStats: BaselineStats;
}

export interface Anomaly {
  type: 'tool_sequence' | 'response_length' | 'error_pattern' | 'new_tool' | 'latency_spike' | 'cost_spike' | 'token_spike';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  details: Record<string, any>;
}

export interface BaselineStats {
  toolSequences: string[][];
  toolFrequency: Record<string, number>;
  avgResponseTokens: number;
  stdResponseTokens: number;
  errorPatterns: Record<string, number>;
  avgLatencyMs: number;
  stdLatencyMs: number;
  avgCostUsd: number;
  traceCount: number;
}

function loadTracesFromDir(dir: string): AgentTrace[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f =>
    f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml')
  );
  const traces: AgentTrace[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const data = file.endsWith('.json') ? JSON.parse(content) : YAML.parse(content);
      if (data.steps && Array.isArray(data.steps)) {
        traces.push(data as AgentTrace);
      }
    } catch {
      // skip invalid
    }
  }
  return traces;
}

function computeStats(traces: AgentTrace[]): BaselineStats {
  const toolSequences: string[][] = [];
  const toolFreq: Record<string, number> = {};
  const responseLengths: number[] = [];
  const errorPatterns: Record<string, number> = {};
  const latencies: number[] = [];
  let totalCost = 0;

  for (const trace of traces) {
    const seq: string[] = [];
    let traceTokens = 0;

    for (const step of trace.steps) {
      if (step.type === 'tool_call' && step.data.tool_name) {
        seq.push(step.data.tool_name);
        toolFreq[step.data.tool_name] = (toolFreq[step.data.tool_name] ?? 0) + 1;
      }
      if (step.type === 'output') {
        traceTokens += (step.data.tokens?.output ?? 0);
      }
      if (step.data.tool_result && typeof step.data.tool_result === 'string' && step.data.tool_result.toLowerCase().includes('error')) {
        const pattern = String(step.data.tool_result).slice(0, 50);
        errorPatterns[pattern] = (errorPatterns[pattern] ?? 0) + 1;
      }
      if (step.duration_ms) {
        latencies.push(step.duration_ms);
      }
    }

    if (seq.length > 0) toolSequences.push(seq);
    responseLengths.push(traceTokens);
    totalCost += trace.metadata?.cost_usd ?? 0;
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const std = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  };

  return {
    toolSequences,
    toolFrequency: toolFreq,
    avgResponseTokens: avg(responseLengths),
    stdResponseTokens: std(responseLengths),
    errorPatterns,
    avgLatencyMs: avg(latencies),
    stdLatencyMs: std(latencies),
    avgCostUsd: traces.length > 0 ? totalCost / traces.length : 0,
    traceCount: traces.length,
  };
}

function seqToString(seq: string[]): string {
  return seq.join(' → ');
}

/**
 * Detect anomalies by comparing current traces against baseline.
 */
export function detectAnomalies(baselineDir: string, currentDir: string): AnomalyResult {
  const baselineTraces = loadTracesFromDir(baselineDir);
  const currentTraces = loadTracesFromDir(currentDir);
  const baseline = computeStats(baselineTraces);
  const current = computeStats(currentTraces);
  const anomalies: Anomaly[] = [];

  // 1. New tool sequences never seen in baseline
  const baselineSeqSet = new Set(baseline.toolSequences.map(seqToString));
  const currentSeqs = current.toolSequences.map(seqToString);
  for (const seq of currentSeqs) {
    if (seq && !baselineSeqSet.has(seq)) {
      anomalies.push({
        type: 'tool_sequence',
        severity: 'high',
        description: `Unusual tool sequence: [${seq}] (never seen in baseline)`,
        details: { sequence: seq },
      });
    }
  }

  // 2. New tools not in baseline
  for (const tool of Object.keys(current.toolFrequency)) {
    if (!(tool in baseline.toolFrequency)) {
      anomalies.push({
        type: 'new_tool',
        severity: 'medium',
        description: `New tool "${tool}" not seen in baseline (used ${current.toolFrequency[tool]} times)`,
        details: { tool, count: current.toolFrequency[tool] },
      });
    }
  }

  // 3. Response length outlier (>3 std deviations)
  if (baseline.stdResponseTokens > 0 && current.avgResponseTokens > 0) {
    const zScore = Math.abs(current.avgResponseTokens - baseline.avgResponseTokens) / baseline.stdResponseTokens;
    if (zScore > 3) {
      anomalies.push({
        type: 'response_length',
        severity: zScore > 5 ? 'critical' : 'high',
        description: `Response length outlier: ${current.avgResponseTokens.toFixed(0)} tokens (baseline avg: ${baseline.avgResponseTokens.toFixed(0)}±${baseline.stdResponseTokens.toFixed(0)})`,
        details: { current: current.avgResponseTokens, baselineAvg: baseline.avgResponseTokens, baselineStd: baseline.stdResponseTokens, zScore },
      });
    }
  }

  // 4. New error patterns
  for (const [pattern, count] of Object.entries(current.errorPatterns)) {
    if (!(pattern in baseline.errorPatterns)) {
      anomalies.push({
        type: 'error_pattern',
        severity: count > 5 ? 'critical' : 'high',
        description: `New error pattern: "${pattern}" (${count} occurrences, 0 in baseline)`,
        details: { pattern, count },
      });
    }
  }

  // 5. Latency spike
  if (baseline.stdLatencyMs > 0 && current.avgLatencyMs > 0) {
    const zScore = (current.avgLatencyMs - baseline.avgLatencyMs) / baseline.stdLatencyMs;
    if (zScore > 2) {
      anomalies.push({
        type: 'latency_spike',
        severity: zScore > 4 ? 'critical' : 'medium',
        description: `Latency spike: ${current.avgLatencyMs.toFixed(0)}ms avg (baseline: ${baseline.avgLatencyMs.toFixed(0)}±${baseline.stdLatencyMs.toFixed(0)}ms)`,
        details: { currentAvg: current.avgLatencyMs, baselineAvg: baseline.avgLatencyMs, zScore },
      });
    }
  }

  // 6. Token spike
  if (baseline.avgResponseTokens > 0 && current.avgResponseTokens > baseline.avgResponseTokens * 2) {
    anomalies.push({
      type: 'token_spike',
      severity: 'medium',
      description: `Token usage doubled: ${current.avgResponseTokens.toFixed(0)} vs baseline ${baseline.avgResponseTokens.toFixed(0)}`,
      details: { current: current.avgResponseTokens, baseline: baseline.avgResponseTokens },
    });
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { anomalies, baselineStats: baseline, currentStats: current };
}

/**
 * Format anomaly results for console output.
 */
export function formatAnomalies(result: AnomalyResult): string {
  const lines: string[] = [
    '🔍 Trace Anomaly Detection',
    '═'.repeat(50),
    `Baseline: ${result.baselineStats.traceCount} traces | Current: ${result.currentStats.traceCount} traces`,
    '',
  ];

  if (result.anomalies.length === 0) {
    lines.push('✅ No anomalies detected. Current behavior matches baseline.');
  } else {
    lines.push(`⚠️  ${result.anomalies.length} anomalies detected:`);
    lines.push('');
    for (let i = 0; i < result.anomalies.length; i++) {
      const a = result.anomalies[i];
      const icon = a.severity === 'critical' ? '🚨' : a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '🟢';
      lines.push(`  ${i + 1}. ${icon} [${a.severity.toUpperCase()}] ${a.description}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
