/**
 * Round 40 Tests — v4.2.0
 *
 * Tests for:
 * 1. Compliance Framework (ComplianceFramework class, built-in regulations)
 * 2. Performance Profiler (enhanced profiling)
 * 3. Test Dependency Analyzer (TestDependencyAnalyzer)
 * 4. Snapshot Approval Workflow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentTrace, TestSuite } from '../src/types';
import {
  ComplianceFramework, formatFrameworkReport,
} from '../src/compliance-framework';
import type { ComplianceRule } from '../src/compliance-framework';
import {
  TestDependencyAnalyzer, formatExecutionPlan,
} from '../src/test-deps';
import {
  loadApprovalState, saveApprovalState, submitForReview,
  approveSnapshot, rejectSnapshot, getApprovalSummary,
  getPendingReviews, formatApprovalState, diffSnapshots,
} from '../src/snapshot-approval';
import type { ApprovalState } from '../src/snapshot-approval';
import { profile, formatProfile } from '../src/profiler';

// ===== Helpers =====

function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'test-trace-1',
    timestamp: new Date().toISOString(),
    metadata: { agent: 'test-agent', model: 'gpt-4' },
    steps: [
      { type: 'input', data: { content: 'Hello' }, timestamp: '2024-01-01T00:00:00Z' },
      { type: 'llm_call', data: { tokens: { input: 100, output: 50 } }, duration_ms: 500, timestamp: '2024-01-01T00:00:01Z' },
      { type: 'tool_call', data: { tool_name: 'search', tool_input: { q: 'test' } }, duration_ms: 200, timestamp: '2024-01-01T00:00:02Z' },
      { type: 'tool_result', data: { tool_name: 'search', tool_result: { results: [] } }, timestamp: '2024-01-01T00:00:03Z' },
      { type: 'output', data: { content: 'Here are the results.' }, timestamp: '2024-01-01T00:00:04Z' },
    ],
    ...overrides,
  } as any;
}

function makeTraceWithPII(): AgentTrace {
  return makeTrace({
    steps: [
      { type: 'input', data: { content: 'Find info' }, timestamp: '2024-01-01T00:00:00Z' },
      { type: 'output', data: { content: 'SSN: 123-45-6789 and email john@example.com' }, timestamp: '2024-01-01T00:00:01Z' },
    ],
  } as any);
}

function makeTraceWithCC(): AgentTrace {
  return makeTrace({
    steps: [
      { type: 'input', data: { content: 'Process payment' }, timestamp: '2024-01-01T00:00:00Z' },
      { type: 'tool_call', data: { tool_name: 'payment', tool_input: { card: '4111-1111-1111-1111' } }, duration_ms: 100, timestamp: '2024-01-01T00:00:01Z' },
      { type: 'output', data: { content: 'Card 4111-1111-1111-1111 processed' }, timestamp: '2024-01-01T00:00:02Z' },
    ],
  } as any);
}

function makeSuite(tests: Array<{ name: string; depends_on?: string | string[]; timeout_ms?: number; tags?: string[] }>): TestSuite {
  return {
    name: 'Test Suite',
    tests: tests.map(t => ({
      name: t.name,
      input: `test ${t.name}`,
      depends_on: t.depends_on,
      timeout_ms: t.timeout_ms,
      tags: t.tags,
      expect: {},
    })),
  } as any;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-r40-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ==============================
// 1. Compliance Framework Tests
// ==============================

describe('ComplianceFramework', () => {
  it('should have built-in GDPR, SOC2, HIPAA, PCI-DSS regulations', () => {
    const fw = new ComplianceFramework();
    const regs = fw.listRegulations();
    expect(regs).toContain('GDPR');
    expect(regs).toContain('SOC2');
    expect(regs).toContain('HIPAA');
    expect(regs).toContain('PCI-DSS');
  });

  it('should pass audit for clean trace', () => {
    const fw = new ComplianceFramework();
    const report = fw.audit([makeTrace()]);
    expect(report.traces_audited).toBe(1);
    expect(report.overall_passed).toBe(true);
    expect(report.summary.failed).toBe(0);
  });

  it('should detect PII in output (GDPR)', () => {
    const fw = new ComplianceFramework();
    const report = fw.audit([makeTraceWithPII()], ['GDPR']);
    expect(report.overall_passed).toBe(false);
    const piiFindings = report.findings.filter(f => f.rule_id === 'GDPR-001' && !f.passed);
    expect(piiFindings.length).toBeGreaterThan(0);
    expect(piiFindings[0].evidence).toContain('SSN');
  });

  it('should detect credit card numbers (PCI-DSS)', () => {
    const fw = new ComplianceFramework();
    const report = fw.audit([makeTraceWithCC()], ['PCI-DSS']);
    const ccFindings = report.findings.filter(f => f.rule_id === 'PCI-001' && !f.passed);
    expect(ccFindings.length).toBeGreaterThan(0);
  });

  it('should detect suspicious tools (SOC2)', () => {
    const fw = new ComplianceFramework();
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', data: { tool_name: 'shell_exec' }, duration_ms: 100, timestamp: '2024-01-01T00:00:00Z' },
        { type: 'output', data: { content: 'done' }, timestamp: '2024-01-01T00:00:01Z' },
      ],
    } as any);
    const report = fw.audit([trace], ['SOC2']);
    const findings = report.findings.filter(f => f.rule_id === 'SOC2-001' && !f.passed);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('should add custom regulation', () => {
    const fw = new ComplianceFramework();
    const customRule: ComplianceRule = {
      id: 'CUSTOM-001', name: 'No Yelling', severity: 'low',
      category: 'style', description: 'Output should not be all caps',
      check: (trace) => {
        const output = trace.steps.filter(s => s.type === 'output').map(s => s.data.content ?? '').join('');
        const isAllCaps = output.length > 10 && output === output.toUpperCase();
        return { passed: !isAllCaps, message: isAllCaps ? 'Output is all caps' : 'Output is fine' };
      },
    };
    fw.addRegulation('STYLE', [customRule]);
    expect(fw.listRegulations()).toContain('STYLE');
  });

  it('should audit only specified regulations', () => {
    const fw = new ComplianceFramework();
    const report = fw.audit([makeTrace()], ['GDPR']);
    expect(report.regulations_checked).toEqual(['GDPR']);
    expect(report.regulation_results.length).toBe(1);
  });

  it('should remove regulation', () => {
    const fw = new ComplianceFramework();
    expect(fw.removeRegulation('HIPAA')).toBe(true);
    expect(fw.listRegulations()).not.toContain('HIPAA');
  });

  it('should get rules for a regulation', () => {
    const fw = new ComplianceFramework();
    const rules = fw.getRules('GDPR');
    expect(rules).toBeDefined();
    expect(rules!.length).toBeGreaterThan(0);
    expect(rules![0].id).toMatch(/^GDPR/);
  });

  it('should report timestamp in audit report', () => {
    const fw = new ComplianceFramework();
    const report = fw.audit([makeTrace()]);
    expect(report.timestamp).toBeTruthy();
    expect(new Date(report.timestamp).getTime()).toBeGreaterThan(0);
  });

  it('should count critical failures', () => {
    const fw = new ComplianceFramework();
    const report = fw.audit([makeTraceWithPII()]);
    expect(report.summary.critical_failures).toBeGreaterThanOrEqual(1);
  });

  it('should handle empty trace list', () => {
    const fw = new ComplianceFramework();
    const report = fw.audit([]);
    expect(report.traces_audited).toBe(0);
    expect(report.overall_passed).toBe(true);
  });

  it('should format report as string', () => {
    const fw = new ComplianceFramework();
    const report = fw.audit([makeTraceWithPII()]);
    const formatted = formatFrameworkReport(report);
    expect(formatted).toContain('Compliance Audit Report');
    expect(formatted).toContain('GDPR');
  });

  it('should detect missing timestamps (GDPR audit trail)', () => {
    const fw = new ComplianceFramework();
    const trace = makeTrace({
      steps: [
        { type: 'output', data: { content: 'ok' } },
      ],
    } as any);
    const report = fw.audit([trace], ['GDPR']);
    const auditFindings = report.findings.filter(f => f.rule_id === 'GDPR-003');
    expect(auditFindings.length).toBeGreaterThan(0);
  });

  it('should handle multiple traces in single audit', () => {
    const fw = new ComplianceFramework();
    const report = fw.audit([makeTrace(), makeTrace({ id: 'trace-2' } as any)]);
    expect(report.traces_audited).toBe(2);
  });
});

// ==============================
// 2. Performance Profiler Tests
// ==============================

describe('Performance Profiler', () => {
  it('should profile traces with tool breakdown', () => {
    const result = profile([makeTrace()]);
    expect(result.trace_count).toBe(1);
    expect(result.tool_breakdown.length).toBeGreaterThan(0);
    expect(result.tool_breakdown[0].name).toBe('search');
  });

  it('should compute percentiles', () => {
    const result = profile([makeTrace()]);
    expect(result.llm_latency.p50).toBeGreaterThanOrEqual(0);
    expect(result.llm_latency.count).toBe(1);
  });

  it('should calculate cost per query', () => {
    const result = profile([makeTrace()]);
    expect(result.cost_per_query).toBeGreaterThanOrEqual(0);
  });

  it('should identify bottleneck', () => {
    const result = profile([makeTrace()]);
    expect(result.bottleneck).not.toBeNull();
  });

  it('should handle empty traces', () => {
    const result = profile([]);
    expect(result.trace_count).toBe(0);
    expect(result.total_steps).toBe(0);
  });

  it('should format profile output', () => {
    const result = profile([makeTrace()]);
    const output = formatProfile(result);
    expect(output).toContain('Performance Profile');
    expect(output).toContain('p50');
  });

  it('should compute token efficiency', () => {
    const result = profile([makeTrace()]);
    expect(result.token_efficiency).toBeGreaterThanOrEqual(0);
    expect(result.token_efficiency).toBeLessThanOrEqual(1);
  });
});

// ==============================
// 3. Test Dependency Analyzer Tests
// ==============================

describe('TestDependencyAnalyzer', () => {
  it('should analyze basic dependency graph', () => {
    const suite = makeSuite([
      { name: 'a' },
      { name: 'b', depends_on: 'a' },
      { name: 'c', depends_on: 'a' },
    ]);
    const analyzer = new TestDependencyAnalyzer(suite);
    const graph = analyzer.analyze();
    expect(graph.nodes.size).toBe(3);
    expect(graph.edges.length).toBe(2);
  });

  it('should find parallel groups', () => {
    const suite = makeSuite([
      { name: 'a' },
      { name: 'b' },
      { name: 'c', depends_on: ['a', 'b'] },
    ]);
    const analyzer = new TestDependencyAnalyzer(suite);
    const groups = analyzer.findParallelGroups();
    expect(groups.length).toBe(2);
    expect(groups[0].tests).toContain('a');
    expect(groups[0].tests).toContain('b');
    expect(groups[1].tests).toContain('c');
  });

  it('should find critical path', () => {
    const suite = makeSuite([
      { name: 'a', timeout_ms: 1000 },
      { name: 'b', timeout_ms: 2000, depends_on: 'a' },
      { name: 'c', timeout_ms: 3000, depends_on: 'b' },
    ]);
    const analyzer = new TestDependencyAnalyzer(suite);
    const critical = analyzer.findCriticalPath();
    expect(critical.path).toEqual(['a', 'b', 'c']);
    expect(critical.totalEstimatedMs).toBe(6000);
  });

  it('should detect circular dependencies', () => {
    const suite = makeSuite([
      { name: 'a', depends_on: 'b' },
      { name: 'b', depends_on: 'a' },
    ]);
    const analyzer = new TestDependencyAnalyzer(suite);
    const cycles = analyzer.detectCircular();
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('should optimize execution plan', () => {
    const suite = makeSuite([
      { name: 'a', timeout_ms: 1000 },
      { name: 'b', timeout_ms: 1000 },
      { name: 'c', timeout_ms: 1000, depends_on: ['a', 'b'] },
    ]);
    const analyzer = new TestDependencyAnalyzer(suite);
    const plan = analyzer.optimize();
    expect(plan.phases.length).toBe(2);
    expect(plan.parallelEfficiency).toBeLessThan(1);
  });

  it('should handle suite with no dependencies', () => {
    const suite = makeSuite([
      { name: 'a' }, { name: 'b' }, { name: 'c' },
    ]);
    const analyzer = new TestDependencyAnalyzer(suite);
    const groups = analyzer.findParallelGroups();
    expect(groups.length).toBe(1);
    expect(groups[0].tests.length).toBe(3);
  });

  it('should handle single test', () => {
    const suite = makeSuite([{ name: 'only' }]);
    const analyzer = new TestDependencyAnalyzer(suite);
    const plan = analyzer.optimize();
    expect(plan.phases.length).toBe(1);
    expect(plan.criticalPath.path).toEqual(['only']);
  });

  it('should format execution plan', () => {
    const suite = makeSuite([
      { name: 'a' },
      { name: 'b', depends_on: 'a' },
    ]);
    const analyzer = new TestDependencyAnalyzer(suite);
    const plan = analyzer.optimize();
    const output = formatExecutionPlan(plan);
    expect(output).toContain('Test Execution Plan');
    expect(output).toContain('Phase');
  });

  it('should handle deep chain', () => {
    const suite = makeSuite([
      { name: 'a', timeout_ms: 100 },
      { name: 'b', timeout_ms: 100, depends_on: 'a' },
      { name: 'c', timeout_ms: 100, depends_on: 'b' },
      { name: 'd', timeout_ms: 100, depends_on: 'c' },
    ]);
    const analyzer = new TestDependencyAnalyzer(suite);
    const critical = analyzer.findCriticalPath();
    expect(critical.path).toEqual(['a', 'b', 'c', 'd']);
    expect(critical.totalEstimatedMs).toBe(400);
  });
});

// ==============================
// 4. Snapshot Approval Workflow Tests
// ==============================

describe('Snapshot Approval Workflow', () => {
  it('should load empty approval state from new dir', () => {
    const state = loadApprovalState(tmpDir);
    expect(state.records).toEqual([]);
  });

  it('should save and reload approval state', () => {
    const state: ApprovalState = { snapshotDir: tmpDir, records: [] };
    submitForReview(state, 'test-1', null, { toolsCalled: ['a'], toolCallOrder: ['a'], stepCount: 3 } as any);
    saveApprovalState(state);

    const reloaded = loadApprovalState(tmpDir);
    expect(reloaded.records.length).toBe(1);
    expect(reloaded.records[0].testName).toBe('test-1');
  });

  it('should submit for review with pending status', () => {
    const state: ApprovalState = { snapshotDir: tmpDir, records: [] };
    const record = submitForReview(state, 'test-1', null, { toolsCalled: ['a'], toolCallOrder: ['a'], stepCount: 3 } as any);
    expect(record.status).toBe('pending');
    expect(state.records.length).toBe(1);
  });

  it('should approve snapshot', () => {
    const state: ApprovalState = { snapshotDir: tmpDir, records: [] };
    submitForReview(state, 'test-1', null, { toolsCalled: ['a'], toolCallOrder: ['a'], stepCount: 3 } as any);
    const ok = approveSnapshot(state, 'test-1', 'reviewer');
    expect(ok).toBe(true);
    expect(state.records[0].status).toBe('approved');
    expect(state.records[0].reviewedBy).toBe('reviewer');

    // Snapshot file should exist
    const snapFile = path.join(tmpDir, 'test-1.snap.json');
    expect(fs.existsSync(snapFile)).toBe(true);
  });

  it('should reject snapshot', () => {
    const state: ApprovalState = { snapshotDir: tmpDir, records: [] };
    submitForReview(state, 'test-1', null, { toolsCalled: ['a'], toolCallOrder: ['a'], stepCount: 3 } as any);
    const ok = rejectSnapshot(state, 'test-1');
    expect(ok).toBe(true);
    expect(state.records[0].status).toBe('rejected');
  });

  it('should not approve already approved snapshot', () => {
    const state: ApprovalState = { snapshotDir: tmpDir, records: [] };
    submitForReview(state, 'test-1', null, { toolsCalled: ['a'], toolCallOrder: ['a'], stepCount: 3 } as any);
    approveSnapshot(state, 'test-1');
    const ok = approveSnapshot(state, 'test-1');
    expect(ok).toBe(false);
  });

  it('should get approval summary', () => {
    const state: ApprovalState = { snapshotDir: tmpDir, records: [] };
    submitForReview(state, 'a', null, { toolsCalled: [], toolCallOrder: [], stepCount: 1 } as any);
    submitForReview(state, 'b', null, { toolsCalled: [], toolCallOrder: [], stepCount: 1 } as any);
    approveSnapshot(state, 'a');

    const summary = getApprovalSummary(state);
    expect(summary.total).toBe(2);
    expect(summary.approved).toBe(1);
    expect(summary.pending).toBe(1);
  });

  it('should get pending reviews', () => {
    const state: ApprovalState = { snapshotDir: tmpDir, records: [] };
    submitForReview(state, 'a', null, { toolsCalled: [], toolCallOrder: [], stepCount: 1 } as any);
    submitForReview(state, 'b', null, { toolsCalled: [], toolCallOrder: [], stepCount: 1 } as any);
    approveSnapshot(state, 'a');

    const pending = getPendingReviews(state);
    expect(pending.length).toBe(1);
    expect(pending[0].testName).toBe('b');
  });

  it('should compute diff between snapshots', () => {
    const old = { toolsCalled: ['a'], toolCallOrder: ['a'], stepCount: 3 } as any;
    const proposed = { toolsCalled: ['a', 'b'], toolCallOrder: ['a', 'b'], stepCount: 5 } as any;
    const diffs = diffSnapshots(old, proposed);
    expect(diffs.length).toBeGreaterThan(0);
  });

  it('should diff null current as new snapshot', () => {
    const proposed = { toolsCalled: ['a'], toolCallOrder: ['a'], stepCount: 3 } as any;
    const diffs = diffSnapshots(null, proposed);
    expect(diffs.length).toBe(1);
    expect(diffs[0].field).toBe('snapshot');
  });

  it('should format approval state', () => {
    const state: ApprovalState = { snapshotDir: tmpDir, records: [] };
    submitForReview(state, 'test-1', null, { toolsCalled: ['a'], toolCallOrder: ['a'], stepCount: 3 } as any);
    const output = formatApprovalState(state);
    expect(output).toContain('Snapshot Approval Status');
    expect(output).toContain('test-1');
    expect(output).toContain('pending');
  });

  it('should replace existing review on resubmit', () => {
    const state: ApprovalState = { snapshotDir: tmpDir, records: [] };
    submitForReview(state, 'test-1', null, { toolsCalled: ['a'], toolCallOrder: ['a'], stepCount: 3 } as any);
    submitForReview(state, 'test-1', null, { toolsCalled: ['b'], toolCallOrder: ['b'], stepCount: 5 } as any);
    expect(state.records.length).toBe(1);
    expect(state.records[0].proposed.toolsCalled).toEqual(['b']);
  });
});
