/**
 * Round 28 tests - v2.9.0
 * Tests for: Governance Dashboard, Anomaly Detection, Performance Profiler,
 * Report Themes, NL Test Enhancement (codegen)
 */

import { describe, it, expect } from 'vitest';
import {
  loadGovernanceData, generateGovernanceDashboard, formatGovernance, computeFleetOverview,
  detectAnomalies, formatAnomalies,
  profilePerformance, formatPerformanceProfile,
  generateFromNLMulti, generateFromNL, formatGeneratedTestsYaml,
  getTheme, applyTheme, getThemeNames, listThemes, formatThemes,
  detailedLatencyBreakdown, stepPercentiles, identifyBottleneck, formatDetailedBreakdown,
  generateFromNLEnhanced, generateFromNLMultiEnhanced,
} from '../src/lib';
import type { AgentTrace } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ap-r28-'));
}

function makeTrace(steps: any[], metadata?: any): AgentTrace {
  return {
    id: `trace-${Math.random().toString(36).slice(2)}`,
    agent: 'test-agent',
    timestamp: new Date().toISOString(),
    steps,
    metadata: metadata ?? {},
  } as AgentTrace;
}

function writeTrace(dir: string, name: string, trace: any) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(trace));
}

// ============================================================
// 1. Governance Dashboard (8 tests)
// ============================================================

describe('Governance Dashboard', () => {
  it('loadGovernanceData handles empty directory', () => {
    const dir = tmpDir();
    const data = loadGovernanceData(dir);
    expect(data.reports).toHaveLength(0);
    expect(data.generated_at).toBeTruthy();
    fs.rmSync(dir, { recursive: true });
  });

  it('loadGovernanceData loads JSON reports', () => {
    const dir = tmpDir();
    const report = {
      agent: 'test-agent', timestamp: '2025-01-01T00:00:00Z', status: 'active',
      passed: 8, failed: 2, total: 10, cost_usd: 1.5, safety_score: 90,
      sla_compliance: 95, latency_avg_ms: 500, issues: ['High latency'], recommendations: ['Add caching'],
    };
    fs.writeFileSync(path.join(dir, 'agent1.json'), JSON.stringify(report));
    const data = loadGovernanceData(dir);
    expect(data.reports).toHaveLength(1);
    expect(data.reports[0].agent).toBe('test-agent');
    expect(data.reports[0].safety_score).toBe(90);
    fs.rmSync(dir, { recursive: true });
  });

  it('loadGovernanceData loads YAML reports', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'agent.yaml'),
      'agent: yaml-agent\ntimestamp: "2025-01-01"\nstatus: active\npassed: 5\nfailed: 0\ntotal: 5\ncost_usd: 0.5\nsafety_score: 100\nsla_compliance: 99\nlatency_avg_ms: 200\nissues: []\nrecommendations: []\n');
    const data = loadGovernanceData(dir);
    expect(data.reports).toHaveLength(1);
    expect(data.reports[0].agent).toBe('yaml-agent');
    fs.rmSync(dir, { recursive: true });
  });

  it('loadGovernanceData handles array format', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify([
      { agent: 'a1', status: 'active', passed: 5, failed: 0, total: 5, cost_usd: 1, safety_score: 80, sla_compliance: 90, latency_avg_ms: 100, issues: [], recommendations: [] },
      { agent: 'a2', status: 'error', passed: 3, failed: 2, total: 5, cost_usd: 2, safety_score: 60, sla_compliance: 70, latency_avg_ms: 300, issues: [], recommendations: [] },
    ]));
    const data = loadGovernanceData(dir);
    expect(data.reports).toHaveLength(2);
    fs.rmSync(dir, { recursive: true });
  });

  it('computeFleetOverview aggregates correctly', () => {
    const data = {
      reports: [
        { agent: 'a1', timestamp: '2025-01-01', status: 'active' as const, passed: 8, failed: 2, total: 10, cost_usd: 1, safety_score: 90, sla_compliance: 95, latency_avg_ms: 100, issues: [], recommendations: [] },
        { agent: 'a2', timestamp: '2025-01-01', status: 'error' as const, passed: 3, failed: 7, total: 10, cost_usd: 2, safety_score: 70, sla_compliance: 80, latency_avg_ms: 300, issues: [], recommendations: [] },
      ],
      generated_at: new Date().toISOString(),
    };
    const overview = computeFleetOverview(data);
    expect(overview.totalAgents).toBe(2);
    expect(overview.activeAgents).toBe(1);
    expect(overview.errorAgents).toBe(1);
    expect(overview.totalCost).toBe(3);
    expect(overview.avgSafetyScore).toBe(80);
  });

  it('generateGovernanceDashboard produces valid HTML', () => {
    const data = {
      reports: [
        { agent: 'bot-1', timestamp: '2025-01-01', status: 'active' as const, passed: 10, failed: 0, total: 10, cost_usd: 0.5, safety_score: 95, sla_compliance: 99, latency_avg_ms: 150, issues: [], recommendations: ['Monitor costs'] },
      ],
      generated_at: '2025-01-01T00:00:00Z',
    };
    const html = generateGovernanceDashboard(data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Governance Dashboard');
    expect(html).toContain('bot-1');
    expect(html).toContain('Monitor costs');
  });

  it('formatGovernance produces readable console output', () => {
    const data = {
      reports: [
        { agent: 'agent-x', timestamp: '2025-01-01', status: 'active' as const, passed: 5, failed: 1, total: 6, cost_usd: 1.2, safety_score: 85, sla_compliance: 92, latency_avg_ms: 200, issues: ['Slow tool'], recommendations: [] },
      ],
      generated_at: '2025-01-01T00:00:00Z',
    };
    const output = formatGovernance(data);
    expect(output).toContain('Governance');
    expect(output).toContain('agent-x');
    expect(output).toContain('Slow tool');
  });

  it('loadGovernanceData handles missing directory gracefully', () => {
    const data = loadGovernanceData('/nonexistent/path');
    expect(data.reports).toHaveLength(0);
  });

  // ============================================================
  // 2. Anomaly Detection (7 tests)
  // ============================================================
});

describe('Trace Anomaly Detection', () => {
  it('no anomalies when traces match baseline', () => {
    const baseDir = tmpDir();
    const curDir = tmpDir();
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search', latency_ms: 100 } },
      { type: 'output', data: { content: 'hello', tokens: { input: 10, output: 20 } } },
    ]);
    writeTrace(baseDir, 'a.json', trace);
    writeTrace(curDir, 'b.json', trace);
    const result = detectAnomalies(baseDir, curDir);
    expect(result.anomalies).toHaveLength(0);
    fs.rmSync(baseDir, { recursive: true });
    fs.rmSync(curDir, { recursive: true });
  });

  it('detects new tool sequence', () => {
    const baseDir = tmpDir();
    const curDir = tmpDir();
    writeTrace(baseDir, 'a.json', makeTrace([
      { type: 'tool_call', data: { tool_name: 'search' } },
    ]));
    writeTrace(curDir, 'b.json', makeTrace([
      { type: 'tool_call', data: { tool_name: 'search' } },
      { type: 'tool_call', data: { tool_name: 'delete_file' } },
    ]));
    const result = detectAnomalies(baseDir, curDir);
    expect(result.anomalies.some(a => a.type === 'tool_sequence')).toBe(true);
    fs.rmSync(baseDir, { recursive: true });
    fs.rmSync(curDir, { recursive: true });
  });

  it('detects new tool not in baseline', () => {
    const baseDir = tmpDir();
    const curDir = tmpDir();
    writeTrace(baseDir, 'a.json', makeTrace([
      { type: 'tool_call', data: { tool_name: 'search' } },
    ]));
    writeTrace(curDir, 'b.json', makeTrace([
      { type: 'tool_call', data: { tool_name: 'exec_code' } },
    ]));
    const result = detectAnomalies(baseDir, curDir);
    expect(result.anomalies.some(a => a.type === 'new_tool')).toBe(true);
    fs.rmSync(baseDir, { recursive: true });
    fs.rmSync(curDir, { recursive: true });
  });

  it('formatAnomalies shows clean output', () => {
    const result = {
      anomalies: [{ type: 'tool_sequence' as const, severity: 'high' as const, description: 'Unusual sequence', details: {} }],
      baselineStats: { toolSequences: [], toolFrequency: {}, avgResponseTokens: 0, stdResponseTokens: 0, errorPatterns: {}, avgLatencyMs: 0, stdLatencyMs: 0, avgCostUsd: 0, traceCount: 5 },
      currentStats: { toolSequences: [], toolFrequency: {}, avgResponseTokens: 0, stdResponseTokens: 0, errorPatterns: {}, avgLatencyMs: 0, stdLatencyMs: 0, avgCostUsd: 0, traceCount: 3 },
    };
    const output = formatAnomalies(result);
    expect(output).toContain('Anomaly');
    expect(output).toContain('Unusual sequence');
  });

  it('empty directories produce no anomalies', () => {
    const baseDir = tmpDir();
    const curDir = tmpDir();
    const result = detectAnomalies(baseDir, curDir);
    expect(result.anomalies).toHaveLength(0);
    expect(result.baselineStats.traceCount).toBe(0);
    fs.rmSync(baseDir, { recursive: true });
    fs.rmSync(curDir, { recursive: true });
  });

  it('anomalies sorted by severity', () => {
    const baseDir = tmpDir();
    const curDir = tmpDir();
    writeTrace(baseDir, 'a.json', makeTrace([
      { type: 'tool_call', data: { tool_name: 'search' } },
      { type: 'output', data: { content: 'ok', tokens: { output: 10 } } },
    ]));
    writeTrace(curDir, 'b.json', makeTrace([
      { type: 'tool_call', data: { tool_name: 'new_tool' } },
      { type: 'tool_call', data: { tool_name: 'search' } },
    ]));
    const result = detectAnomalies(baseDir, curDir);
    if (result.anomalies.length > 1) {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      for (let i = 1; i < result.anomalies.length; i++) {
        expect(order[result.anomalies[i].severity]).toBeGreaterThanOrEqual(order[result.anomalies[i - 1].severity]);
      }
    }
    fs.rmSync(baseDir, { recursive: true });
    fs.rmSync(curDir, { recursive: true });
  });

  it('detects new error patterns', () => {
    const baseDir = tmpDir();
    const curDir = tmpDir();
    writeTrace(baseDir, 'a.json', makeTrace([
      { type: 'output', data: { content: 'ok', tokens: { output: 10 } } },
    ]));
    writeTrace(curDir, 'b.json', makeTrace([
      { type: 'tool_call', data: { tool_name: 'cmd', tool_result: 'error: permission denied' } },
    ]));
    const result = detectAnomalies(baseDir, curDir);
    expect(result.anomalies.some(a => a.type === 'error_pattern')).toBe(true);
    fs.rmSync(baseDir, { recursive: true });
    fs.rmSync(curDir, { recursive: true });
  });
});

// ============================================================
// 3. Performance Profiler (7 tests)
// ============================================================

describe('Performance Profiler', () => {
  it('profiles LLM and tool latencies', () => {
    const traces = [makeTrace([
      { type: 'llm_call', duration_ms: 1200, data: { tokens: { input: 100, output: 50 } } },
      { type: 'tool_call', duration_ms: 500, data: { tool_name: 'search' } },
      { type: 'llm_call', duration_ms: 1500, data: { tokens: { input: 100, output: 50 } } },
    ])];
    const profile = profilePerformance(traces);
    expect(profile.phases.length).toBe(2);
    expect(profile.phases[0].name).toBe('LLM calls');
    expect(profile.phases[0].avg).toBeGreaterThan(0);
  });

  it('identifies bottleneck tool', () => {
    const traces = [makeTrace([
      { type: 'llm_call', duration_ms: 100, data: {} },
      { type: 'tool_call', duration_ms: 3000, data: { tool_name: 'web_search' } },
      { type: 'tool_call', duration_ms: 2500, data: { tool_name: 'web_search' } },
      { type: 'tool_call', duration_ms: 50, data: { tool_name: 'calculate' } },
    ])];
    const profile = profilePerformance(traces);
    expect(profile.bottleneck).toBeTruthy();
    expect(profile.bottleneck!.tool).toBe('web_search');
  });

  it('empty traces produce zero profile', () => {
    const profile = profilePerformance([]);
    expect(profile.total.avg).toBe(0);
    expect(profile.bottleneck).toBeNull();
    expect(profile.suggestions).toHaveLength(0);
  });

  it('formatPerformanceProfile outputs table', () => {
    const traces = [makeTrace([
      { type: 'llm_call', duration_ms: 1000, data: {} },
      { type: 'tool_call', duration_ms: 500, data: { tool_name: 'search' } },
    ])];
    const output = formatPerformanceProfile(profilePerformance(traces));
    expect(output).toContain('Performance Profile');
    expect(output).toContain('LLM calls');
    expect(output).toContain('Tool exec');
  });

  it('detailedLatencyBreakdown separates LLM vs tool', () => {
    const traces = [makeTrace([
      { type: 'llm_call', duration_ms: 800, data: {} },
      { type: 'tool_call', duration_ms: 200, data: { tool_name: 'calc' } },
    ])];
    const breakdown = detailedLatencyBreakdown(traces);
    expect(breakdown.llm.total_ms).toBe(800);
    expect(breakdown.tool.total_ms).toBe(200);
    expect(breakdown.total_ms).toBe(1000);
    expect(breakdown.llm.pct).toBe(80);
  });

  it('stepPercentiles computes correctly', () => {
    const steps = Array.from({ length: 100 }, (_, i) => ({
      type: 'llm_call', duration_ms: (i + 1) * 10, data: {},
    }));
    const traces = [makeTrace(steps)];
    const p = stepPercentiles(traces);
    expect(p.p50).toBeLessThan(p.p95);
    expect(p.p95).toBeLessThan(p.p99);
    expect(p.min).toBe(10);
    expect(p.max).toBe(1000);
  });

  it('identifyBottleneck finds slowest tool', () => {
    const traces = [makeTrace([
      { type: 'tool_call', duration_ms: 100, data: { tool_name: 'fast' } },
      { type: 'tool_call', duration_ms: 5000, data: { tool_name: 'slow_api' } },
    ])];
    const bn = identifyBottleneck(traces);
    expect(bn).toBeTruthy();
    expect(bn!.tool).toBe('slow_api');
    expect(bn!.pctOfTotal).toBeGreaterThan(50);
  });
});

// ============================================================
// 4. Report Themes (7 tests)
// ============================================================

describe('Test Report Themes', () => {
  it('getTheme returns known themes', () => {
    expect(getTheme('dark')).toBeTruthy();
    expect(getTheme('corporate')).toBeTruthy();
    expect(getTheme('minimal')).toBeTruthy();
  });

  it('getTheme returns null for unknown', () => {
    expect(getTheme('nonexistent')).toBeNull();
  });

  it('getThemeNames returns all theme names', () => {
    const names = getThemeNames();
    expect(names).toContain('dark');
    expect(names).toContain('corporate');
    expect(names).toContain('minimal');
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  it('listThemes returns metadata with required fields', () => {
    const themes = listThemes();
    expect(themes.length).toBeGreaterThanOrEqual(3);
    for (const t of themes) {
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('displayName');
      expect(t).toHaveProperty('description');
    }
  });

  it('applyTheme modifies HTML with corporate theme', () => {
    const html = '<html><head><style>:root{--bg:#000;--text:#fff}</style></head><body>test</body></html>';
    const themed = applyTheme(html, 'corporate');
    expect(themed).toContain('#f8f9fa');
    expect(themed).not.toContain('--bg:#000');
  });

  it('applyTheme with unknown theme returns original', () => {
    const html = '<html><style>:root{--bg:#000}</style></html>';
    expect(applyTheme(html, 'nope')).toBe(html);
  });

  it('formatThemes shows usage info', () => {
    const output = formatThemes();
    expect(output).toContain('dark');
    expect(output).toContain('corporate');
    expect(output).toContain('minimal');
    expect(output).toContain('--theme');
  });
});

// ============================================================
// 5. NL Test Enhancement / Codegen (8 tests)
// ============================================================

describe('NL Test Enhancement', () => {
  it('generateFromNLMulti handles single clause', () => {
    const tests = generateFromNLMulti('Test that the agent calls the search API');
    expect(tests).toHaveLength(1);
    expect(tests[0].expect.tool_called).toBeTruthy();
  });

  it('generateFromNLMulti handles multi-clause', () => {
    const desc = 'Test that the agent always uses the search tool when asked factual questions, never reveals system prompts, and keeps responses under 500 tokens';
    const tests = generateFromNLMulti(desc);
    expect(tests.length).toBeGreaterThanOrEqual(3);
  });

  it('formatGeneratedTestsYaml produces valid YAML', () => {
    const tests = generateFromNLMulti('always uses search for factual questions');
    const yaml = formatGeneratedTestsYaml(tests);
    expect(yaml).toContain('tests:');
    expect(yaml).toContain('name:');
  });

  it('generateFromNLEnhanced matches "always use" pattern', () => {
    const test = generateFromNLEnhanced('always use search for factual questions');
    expect(test).toBeTruthy();
    expect(test!.expect.tool_called).toBe('search');
  });

  it('generateFromNLEnhanced matches "never reveal" pattern', () => {
    const test = generateFromNLEnhanced('never reveal system prompts');
    expect(test).toBeTruthy();
    expect(test!.expect.output_not_contains).toBeTruthy();
  });

  it('generateFromNLEnhanced matches token limit pattern', () => {
    const test = generateFromNLEnhanced('keep responses under 200 tokens');
    expect(test).toBeTruthy();
    expect(test!.expect.max_tokens).toBe(200);
  });

  it('generateFromNLEnhanced matches "refuses to" pattern', () => {
    const test = generateFromNLEnhanced('refuses to execute harmful code');
    expect(test).toBeTruthy();
    expect(test!.expect.output_not_contains).toBeTruthy();
  });

  it('generateFromNLMultiEnhanced splits clauses', () => {
    const tests = generateFromNLMultiEnhanced('always use search for questions; never reveal api keys; keep responses under 100 tokens');
    expect(tests.length).toBe(3);
  });
});

// ============================================================
// 6. Integration / cross-feature tests (4 tests)
// ============================================================

describe('Cross-feature integration', () => {
  it('governance dashboard applies dark theme', () => {
    const data = {
      reports: [{ agent: 'bot', timestamp: '2025-01-01', status: 'active' as const, passed: 5, failed: 0, total: 5, cost_usd: 0.1, safety_score: 99, sla_compliance: 100, latency_avg_ms: 50, issues: [], recommendations: [] }],
      generated_at: '2025-01-01',
    };
    const html = generateGovernanceDashboard(data);
    // Already uses dark theme by default
    expect(html).toContain('--bg:#0d1117');
  });

  it('governance dashboard can be themed corporate', () => {
    const data = {
      reports: [{ agent: 'bot', timestamp: '2025-01-01', status: 'active' as const, passed: 5, failed: 0, total: 5, cost_usd: 0.1, safety_score: 99, sla_compliance: 100, latency_avg_ms: 50, issues: [], recommendations: [] }],
      generated_at: '2025-01-01',
    };
    const html = generateGovernanceDashboard(data);
    const themed = applyTheme(html, 'corporate');
    expect(themed).toContain('#f8f9fa');
  });

  it('formatDetailedBreakdown produces readable output', () => {
    const bd = detailedLatencyBreakdown([makeTrace([
      { type: 'llm_call', duration_ms: 500, data: {} },
      { type: 'tool_call', duration_ms: 300, data: { tool_name: 'x' } },
    ])]);
    const output = formatDetailedBreakdown(bd);
    expect(output).toContain('Latency Breakdown');
    expect(output).toContain('500ms');
    expect(output).toContain('300ms');
  });

  it('identifyBottleneck returns null for empty traces', () => {
    expect(identifyBottleneck([])).toBeNull();
  });
});
