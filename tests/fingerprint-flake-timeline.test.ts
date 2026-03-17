/**
 * Round 33 tests — v3.5.0: Fingerprinting, Flake Manager, Timeline, Version Registry, Webhooks
 */

import { describe, it, expect } from 'vitest';
import {
  buildFingerprint,
  compareFingerprints,
  detectDrift,
  AgentFingerprinter,
} from '../src/fingerprint';
import type { AgentFingerprint } from '../src/fingerprint';
import { FlakeManager, formatFlakeReport } from '../src/flake-manager';
import { parseTimeline, formatTimelineAscii, generateTimelineHTML } from '../src/timeline';
import { VersionRegistry, formatVersionDiff } from '../src/version-registry';
import {
  buildPayload,
  formatWebhookPayload,
  buildPagerDutyPayload,
  buildEmailBody,
} from '../src/webhooks';
import type { AgentTrace, SuiteResult } from '../src/types';

// === Helpers ===

function makeTrace(steps: AgentTrace['steps'], id = 'test-trace'): AgentTrace {
  return {
    id,
    timestamp: new Date().toISOString(),
    steps,
    metadata: {},
  };
}

function makeSuiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'test-suite',
    passed: 3,
    failed: 1,
    total: 4,
    duration_ms: 1000,
    results: [
      { name: 'test-a', passed: true, assertions: [], duration_ms: 200 },
      { name: 'test-b', passed: true, assertions: [], duration_ms: 300 },
      { name: 'test-c', passed: true, assertions: [], duration_ms: 250 },
      { name: 'test-d', passed: false, assertions: [], duration_ms: 250, error: 'timeout' },
    ],
    ...overrides,
  };
}

// ============================================================
// 1. FINGERPRINTING
// ============================================================

describe('AgentFingerprinter', () => {
  it('should create fingerprint from empty traces', () => {
    const fp = buildFingerprint([]);
    expect(fp.traceCount).toBe(0);
    expect(fp.tools).toHaveLength(0);
    expect(fp.avgSteps).toBe(0);
  });

  it('should create fingerprint with tool usage stats', () => {
    const trace = makeTrace([
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search' }, duration_ms: 100 },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search' }, duration_ms: 80 },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'write' }, duration_ms: 50 },
      { type: 'output', timestamp: '', data: { content: 'done' }, duration_ms: 10 },
    ]);
    const fp = buildFingerprint([trace]);
    expect(fp.traceCount).toBe(1);
    expect(fp.tools.find(t => t.name === 'search')?.count).toBe(2);
    expect(fp.tools.find(t => t.name === 'write')?.count).toBe(1);
    expect(fp.avgSteps).toBe(4);
  });

  it('should compute cost from tokens', () => {
    const trace = makeTrace([
      { type: 'llm_call', timestamp: '', data: { tokens: { input: 1000, output: 500 } }, duration_ms: 200 },
    ]);
    const fp = buildFingerprint([trace]);
    expect(fp.avgCost).toBeGreaterThan(0);
  });

  it('should compare identical fingerprints with similarity 1', () => {
    const trace = makeTrace([
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search' }, duration_ms: 100 },
      { type: 'output', timestamp: '', data: { content: 'ok' }, duration_ms: 10 },
    ]);
    const fp = buildFingerprint([trace]);
    expect(compareFingerprints(fp, fp)).toBeCloseTo(1, 1);
  });

  it('should compare different fingerprints with lower similarity', () => {
    const trace1 = makeTrace([
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search' }, duration_ms: 100 },
    ]);
    const trace2 = makeTrace([
      { type: 'tool_call', timestamp: '', data: { tool_name: 'write' }, duration_ms: 500 },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'write' }, duration_ms: 500 },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'write' }, duration_ms: 500 },
    ]);
    const fp1 = buildFingerprint([trace1]);
    const fp2 = buildFingerprint([trace2]);
    const sim = compareFingerprints(fp1, fp2);
    expect(sim).toBeLessThan(0.8);
    expect(sim).toBeGreaterThanOrEqual(0);
  });

  it('should return 0 similarity for empty fingerprints', () => {
    const fp = buildFingerprint([]);
    expect(compareFingerprints(fp, fp)).toBe(0);
  });

  it('should detect no drift when traces are similar', () => {
    const traces = [makeTrace([
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search' }, duration_ms: 100 },
    ])];
    const baseline = buildFingerprint(traces);
    const report = detectDrift(baseline, traces);
    expect(report.drifted).toBe(false);
    expect(report.overall).toBeCloseTo(0, 1);
  });

  it('should detect drift when behavior changes significantly', () => {
    const baseTraces = [makeTrace([
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search' }, duration_ms: 100 },
    ])];
    const currentTraces = [makeTrace([
      { type: 'tool_call', timestamp: '', data: { tool_name: 'write' }, duration_ms: 500 },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'delete' }, duration_ms: 500 },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'deploy' }, duration_ms: 500 },
    ])];
    const baseline = buildFingerprint(baseTraces);
    const report = detectDrift(baseline, currentTraces, 0.1);
    expect(report.drifted).toBe(true);
    expect(report.dimensions.length).toBeGreaterThan(0);
  });

  it('should provide drift dimensions with severity', () => {
    const baseTraces = [makeTrace([
      { type: 'llm_call', timestamp: '', data: { tokens: { input: 100, output: 50 } }, duration_ms: 100 },
    ])];
    const currentTraces = [makeTrace([
      { type: 'llm_call', timestamp: '', data: { tokens: { input: 10000, output: 5000 } }, duration_ms: 5000 },
      { type: 'llm_call', timestamp: '', data: { tokens: { input: 10000, output: 5000 } }, duration_ms: 5000 },
    ])];
    const baseline = buildFingerprint(baseTraces);
    const report = detectDrift(baseline, currentTraces, 0.01);
    const costDim = report.dimensions.find(d => d.dimension === 'cost');
    expect(costDim).toBeDefined();
    expect(costDim!.severity).not.toBe('low');
  });

  it('AgentFingerprinter class should work', () => {
    const fp = new AgentFingerprinter();
    const traces = [makeTrace([
      { type: 'tool_call', timestamp: '', data: { tool_name: 'x' }, duration_ms: 10 },
    ])];
    const fingerprint = fp.createFingerprint(traces);
    expect(fingerprint.traceCount).toBe(1);
    const sim = fp.compare(fingerprint, fingerprint);
    expect(sim).toBeCloseTo(1, 1);
    const drift = fp.detectDrift(fingerprint, traces);
    expect(drift.drifted).toBe(false);
  });
});

// ============================================================
// 2. FLAKE MANAGER
// ============================================================

describe('FlakeManager', () => {
  it('should track test results', () => {
    const fm = new FlakeManager({ minRuns: 2 });
    fm.record('test-a', true, 100);
    fm.record('test-a', false, 150);
    fm.record('test-a', true, 120);
    expect(fm.size).toBe(1);
    expect(fm.getFlakeRate('test-a')).toBeCloseTo(1 / 3, 2);
  });

  it('should return null flake rate for insufficient runs', () => {
    const fm = new FlakeManager({ minRuns: 5 });
    fm.record('test-a', true);
    fm.record('test-a', false);
    expect(fm.getFlakeRate('test-a')).toBeNull();
  });

  it('should generate a report', () => {
    const fm = new FlakeManager({ minRuns: 2 });
    for (let i = 0; i < 10; i++) {
      fm.record('stable-test', true, 100);
      fm.record('flaky-test', i % 3 === 0, 200);
    }
    const report = fm.report();
    expect(report.totalTests).toBe(2);
    expect(report.records.length).toBe(2);
    // Flaky test should have higher flake rate
    const flaky = report.records.find(r => r.testName === 'flaky-test');
    expect(flaky).toBeDefined();
    expect(flaky!.flakeRate).toBeGreaterThan(0);
  });

  it('should detect improving trend', () => {
    const fm = new FlakeManager({ minRuns: 2 });
    // Old: mostly failing
    for (let i = 0; i < 5; i++) fm.record('t', false, 100);
    // Recent: mostly passing
    for (let i = 0; i < 5; i++) fm.record('t', true, 100);
    const report = fm.report();
    expect(report.records[0].trend).toBe('improving');
  });

  it('should detect degrading trend', () => {
    const fm = new FlakeManager({ minRuns: 2 });
    for (let i = 0; i < 5; i++) fm.record('t', true, 100);
    for (let i = 0; i < 5; i++) fm.record('t', false, 100);
    const report = fm.report();
    expect(report.records[0].trend).toBe('degrading');
  });

  it('should provide suggestions for highly flaky tests', () => {
    const fm = new FlakeManager({ minRuns: 2 });
    for (let i = 0; i < 10; i++) fm.record('bad-test', i % 2 === 0, 100);
    const report = fm.report();
    expect(report.records[0].suggestions.length).toBeGreaterThan(0);
  });

  it('should record suite results', () => {
    const fm = new FlakeManager({ minRuns: 1 });
    fm.recordSuite([
      { name: 'a', passed: true, duration_ms: 100 },
      { name: 'b', passed: false, duration_ms: 200 },
    ]);
    expect(fm.size).toBe(2);
  });

  it('should clear data', () => {
    const fm = new FlakeManager();
    fm.record('x', true);
    fm.clear();
    expect(fm.size).toBe(0);
  });

  it('should format flake report', () => {
    const fm = new FlakeManager({ minRuns: 2 });
    fm.record('t', true); fm.record('t', false); fm.record('t', true);
    const report = fm.report();
    const output = formatFlakeReport(report);
    expect(output).toContain('Flaky Test Report');
  });
});

// ============================================================
// 3. TIMELINE
// ============================================================

describe('Timeline', () => {
  const trace = makeTrace([
    { type: 'llm_call', timestamp: '', data: { model: 'gpt-4', tokens: { input: 500, output: 200 } }, duration_ms: 1200 },
    { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: { q: 'test' } }, duration_ms: 500 },
    { type: 'tool_result', timestamp: '', data: { tool_result: 'found it' }, duration_ms: 0 },
    { type: 'llm_call', timestamp: '', data: { model: 'gpt-4', tokens: { input: 800, output: 300 } }, duration_ms: 800 },
    { type: 'output', timestamp: '', data: { content: 'Here is the answer' }, duration_ms: 10 },
  ]);

  it('should parse timeline events', () => {
    const summary = parseTimeline(trace);
    expect(summary.events).toHaveLength(5);
    expect(summary.total_ms).toBe(2510);
    expect(summary.step_count).toBe(5);
  });

  it('should compute total cost', () => {
    const summary = parseTimeline(trace);
    expect(summary.total_cost).toBeGreaterThan(0);
  });

  it('should label LLM calls with model name', () => {
    const summary = parseTimeline(trace);
    expect(summary.events[0].label).toContain('gpt-4');
  });

  it('should label tool calls with tool name', () => {
    const summary = parseTimeline(trace);
    expect(summary.events[1].label).toBe('search');
  });

  it('should generate ASCII timeline', () => {
    const summary = parseTimeline(trace);
    const ascii = formatTimelineAscii(summary);
    expect(ascii).toContain('Timeline:');
    expect(ascii).toContain('█');
  });

  it('should generate HTML timeline', () => {
    const html = generateTimelineHTML(trace);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('AgentProbe');
    expect(html).toContain('timeline');
  });

  it('should handle empty trace', () => {
    const empty = makeTrace([]);
    const summary = parseTimeline(empty);
    expect(summary.events).toHaveLength(0);
    expect(summary.total_ms).toBe(0);
  });
});

// ============================================================
// 4. VERSION REGISTRY
// ============================================================

describe('VersionRegistry', () => {
  it('should register and retrieve versions', () => {
    const reg = new VersionRegistry();
    reg.register('agent-a', '1.0.0', { model: 'gpt-4' });
    reg.register('agent-a', '1.1.0', { model: 'gpt-4o' });
    expect(reg.getHistory('agent-a')).toHaveLength(2);
  });

  it('should reject duplicate versions', () => {
    const reg = new VersionRegistry();
    reg.register('a', '1.0.0', { model: 'gpt-4' });
    expect(() => reg.register('a', '1.0.0', { model: 'gpt-4' })).toThrow('already registered');
  });

  it('should get latest version', () => {
    const reg = new VersionRegistry();
    reg.register('a', '1.0', { model: 'gpt-3' });
    reg.register('a', '2.0', { model: 'gpt-4' });
    expect(reg.getLatest('a')?.version).toBe('2.0');
  });

  it('should diff two versions', () => {
    const reg = new VersionRegistry();
    reg.register('a', '1.0', { model: 'gpt-3', temperature: 0.7, tools: ['search'] });
    reg.register('a', '2.0', { model: 'gpt-4', temperature: 0.5, tools: ['search', 'write'] });
    const d = reg.diff('a', '1.0', '2.0');
    expect(d.changes.length).toBeGreaterThan(0);
    expect(d.changes.find(c => c.field === 'model')?.to).toBe('gpt-4');
  });

  it('should throw on diff with missing version', () => {
    const reg = new VersionRegistry();
    reg.register('a', '1.0', {});
    expect(() => reg.diff('a', '1.0', '2.0')).toThrow('not found');
  });

  it('should rollback to a previous version', () => {
    const reg = new VersionRegistry();
    reg.register('a', '1.0', { model: 'gpt-3', temperature: 0.7 });
    reg.register('a', '2.0', { model: 'gpt-4' });
    const meta = reg.rollback('a', '1.0');
    expect(meta.model).toBe('gpt-3');
    expect(meta.temperature).toBe(0.7);
  });

  it('should list agents', () => {
    const reg = new VersionRegistry();
    reg.register('alpha', '1.0', {});
    reg.register('beta', '1.0', {});
    expect(reg.listAgents()).toEqual(['alpha', 'beta']);
  });

  it('should return empty history for unknown agent', () => {
    const reg = new VersionRegistry();
    expect(reg.getHistory('nope')).toHaveLength(0);
  });

  it('should format version diff', () => {
    const reg = new VersionRegistry();
    reg.register('a', '1.0', { model: 'gpt-3' });
    reg.register('a', '2.0', { model: 'gpt-4' });
    const d = reg.diff('a', '1.0', '2.0');
    const output = formatVersionDiff(d);
    expect(output).toContain('gpt-3');
    expect(output).toContain('gpt-4');
  });

  it('should track size correctly', () => {
    const reg = new VersionRegistry();
    expect(reg.size).toBe(0);
    reg.register('a', '1.0', {});
    expect(reg.size).toBe(1);
    expect(reg.totalVersions).toBe(1);
    reg.register('a', '2.0', {});
    expect(reg.totalVersions).toBe(2);
  });
});

// ============================================================
// 5. WEBHOOKS (enhanced)
// ============================================================

describe('Webhooks (v3.5.0)', () => {
  const result = makeSuiteResult();

  it('should build payload from suite result', () => {
    const payload = buildPayload('on_complete', result);
    expect(payload.event).toBe('on_complete');
    expect(payload.passed).toBe(3);
    expect(payload.failed).toBe(1);
    expect(payload.failures).toHaveLength(1);
  });

  it('should include regressions in payload', () => {
    const payload = buildPayload('on_regression', result, { regressions: ['test-x'] });
    expect(payload.regressions).toContain('test-x');
  });

  it('should format Slack payload', () => {
    const payload = buildPayload('on_failure', result);
    const formatted = formatWebhookPayload(payload, 'slack');
    const parsed = JSON.parse(formatted);
    expect(parsed.blocks).toBeDefined();
  });

  it('should format Discord payload', () => {
    const payload = buildPayload('on_failure', result);
    const formatted = formatWebhookPayload(payload, 'discord');
    const parsed = JSON.parse(formatted);
    expect(parsed.embeds).toBeDefined();
  });

  it('should format Teams payload', () => {
    const payload = buildPayload('on_complete', result);
    const formatted = formatWebhookPayload(payload, 'teams');
    const parsed = JSON.parse(formatted);
    expect(parsed['@type']).toBe('MessageCard');
  });

  it('should format generic payload', () => {
    const payload = buildPayload('on_complete', result);
    const formatted = formatWebhookPayload(payload, 'generic');
    const parsed = JSON.parse(formatted);
    expect(parsed.event).toBe('on_complete');
  });

  it('should build PagerDuty payload', () => {
    const payload = buildPayload('on_failure', result);
    const pd = buildPagerDutyPayload(payload, 'routing-key-123', 'critical');
    expect((pd as any).routing_key).toBe('routing-key-123');
    expect((pd as any).payload.severity).toBe('critical');
  });

  it('should build email body', () => {
    const payload = buildPayload('on_failure', result);
    const email = buildEmailBody(payload);
    expect(email.subject).toContain('AgentProbe');
    expect(email.text).toContain('Failed: 1');
    expect(email.html).toContain('Failed: 1');
  });
});
