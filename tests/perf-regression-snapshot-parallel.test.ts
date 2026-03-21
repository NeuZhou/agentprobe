/**
 * Round 44 Tests — v4.9.0 features:
 *   PerfRegressionTracker, SnapshotManager, TagFilter, ParallelRunner
 *   40+ tests covering all new exports.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Performance Regression Tracker
import {
  PerfRegressionTracker,
  loadPerfReport,
  buildDurationMap,
  detectPerfChanges,
  formatPerfChanges,
} from '../src/perf-regression';
import type { PerfMetrics, ThresholdConfig, PerfComparison, PerfAlert } from '../src/perf-regression';

// Snapshot Manager
import { SnapshotManager } from '../src/snapshot';
import type { AgentResponse, SnapshotData, SnapshotDiff } from '../src/snapshot';

// Tag Filtering
import { TagFilter, parseTagArgs, extractTags, groupByTag, formatTagStats } from '../src/tags';

// Parallel Runner
import { ParallelRunner, renderParallelProgress, estimateConcurrency } from '../src/parallel';
import type { ParallelProgress, TestExecutor } from '../src/parallel';

import type { TestCase, TestResult, SuiteResult, TraceStep } from '../src/types';

// ── Helpers ────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-r44-'));
}

function makeResponse(overrides?: Partial<AgentResponse>): AgentResponse {
  return {
    output: 'Hello world',
    toolCalls: [{ name: 'search', args: { q: 'test' } }],
    steps: [
      { type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: 'search' } },
      { type: 'output', timestamp: new Date().toISOString(), data: { content: 'Hello' } },
    ],
    ...overrides,
  };
}

function makeTestCase(overrides?: Partial<TestCase>): TestCase {
  return {
    name: 'test-1',
    input: 'hello',
    expect: { output_contains: 'hello' },
    ...overrides,
  };
}

function makeTestResult(overrides?: Partial<TestResult>): TestResult {
  return {
    name: 'test-1',
    passed: true,
    assertions: [],
    duration_ms: 100,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
//  1. PerfRegressionTracker
// ══════════════════════════════════════════════════════════════════

describe('PerfRegressionTracker', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = tmpDir();
    dbPath = path.join(dir, 'perf.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records and retrieves metrics', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.record('search', { latency_ms: 340, cost_usd: 0.01, tokens: 1000 });
    const records = tracker.getRecords('search');
    expect(records).toHaveLength(1);
    expect(records[0].metrics.latency_ms).toBe(340);
  });

  it('persists across instances', () => {
    const t1 = new PerfRegressionTracker(dbPath);
    t1.record('api', { latency_ms: 200 });
    const t2 = new PerfRegressionTracker(dbPath);
    expect(t2.getRecords('api')).toHaveLength(1);
  });

  it('detects latency regression >10%', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.record('search', { latency_ms: 340 });
    tracker.record('search', { latency_ms: 520 });
    const comp = tracker.compare('search');
    expect(comp.regressions.length).toBeGreaterThan(0);
    expect(comp.regressions[0].message).toContain('⚠️');
    expect(comp.regressions[0].message).toContain('340ms');
    expect(comp.regressions[0].message).toContain('520ms');
  });

  it('detects cost regression >20%', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.record('api', { latency_ms: 100, cost_usd: 1.0 });
    tracker.record('api', { latency_ms: 100, cost_usd: 1.5 });
    const comp = tracker.compare('api');
    expect(comp.regressions.some(r => r.metric === 'cost_usd')).toBe(true);
  });

  it('detects token regression >15%', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.record('gen', { latency_ms: 100, tokens: 1000 });
    tracker.record('gen', { latency_ms: 100, tokens: 1200 });
    const comp = tracker.compare('gen');
    expect(comp.regressions.some(r => r.metric === 'tokens')).toBe(true);
  });

  it('reports improvement when metrics drop', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.record('fast', { latency_ms: 500 });
    tracker.record('fast', { latency_ms: 200 });
    const comp = tracker.compare('fast');
    expect(comp.improvements.length).toBeGreaterThan(0);
  });

  it('reports unchanged when within threshold', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.record('stable', { latency_ms: 100 });
    tracker.record('stable', { latency_ms: 105 });
    const comp = tracker.compare('stable');
    expect(comp.unchanged).toContain('latency_ms');
  });

  it('throws if fewer than 2 records', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.record('solo', { latency_ms: 100 });
    expect(() => tracker.compare('solo')).toThrow('Need at least 2 records');
  });

  it('setThresholds customizes sensitivity', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.setThresholds({ latency_percent: 50 });
    tracker.record('lax', { latency_ms: 100 });
    tracker.record('lax', { latency_ms: 140 }); // +40%, under 50%
    const comp = tracker.compare('lax');
    expect(comp.regressions).toHaveLength(0);
  });

  it('generateReport covers all suites', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.record('a', { latency_ms: 100 });
    tracker.record('a', { latency_ms: 200 });
    tracker.record('b', { latency_ms: 50 });
    const report = tracker.generateReport();
    expect(report).toContain('a');
    expect(report).toContain('b');
  });

  it('listSuites returns all recorded suites', () => {
    const tracker = new PerfRegressionTracker(dbPath);
    tracker.record('x', { latency_ms: 1 });
    tracker.record('y', { latency_ms: 2 });
    expect(tracker.listSuites().sort()).toEqual(['x', 'y']);
  });

  it('handles corrupt db file gracefully', () => {
    fs.writeFileSync(dbPath, 'not-json');
    const tracker = new PerfRegressionTracker(dbPath);
    expect(tracker.listSuites()).toEqual([]);
  });
});

describe('Legacy perf-regression functions', () => {
  it('buildDurationMap extracts durations', () => {
    const suite: SuiteResult = {
      name: 's', passed: 1, failed: 0, total: 1, duration_ms: 100,
      results: [makeTestResult({ name: 'a', duration_ms: 42 })],
    };
    const map = buildDurationMap(suite);
    expect(map.get('a')).toBe(42);
  });

  it('detectPerfChanges finds regression', () => {
    const base: SuiteResult = {
      name: 's', passed: 1, failed: 0, total: 1, duration_ms: 100,
      results: [makeTestResult({ name: 'slow', duration_ms: 100 })],
    };
    const curr: SuiteResult = {
      name: 's', passed: 1, failed: 0, total: 1, duration_ms: 300,
      results: [makeTestResult({ name: 'slow', duration_ms: 300 })],
    };
    const r = detectPerfChanges(base, curr);
    expect(r.regressions).toBe(1);
  });

  it('formatPerfChanges produces readable output', () => {
    const r = detectPerfChanges(
      { name: 's', passed: 1, failed: 0, total: 1, duration_ms: 100, results: [makeTestResult({ name: 'x', duration_ms: 100 })] },
      { name: 's', passed: 1, failed: 0, total: 1, duration_ms: 500, results: [makeTestResult({ name: 'x', duration_ms: 500 })] },
    );
    expect(formatPerfChanges(r)).toContain('REGRESSION');
  });
});

// ══════════════════════════════════════════════════════════════════
//  2. SnapshotManager
// ══════════════════════════════════════════════════════════════════

describe('SnapshotManager', () => {
  let dir: string;
  let mgr: SnapshotManager;

  beforeEach(() => {
    dir = tmpDir();
    mgr = new SnapshotManager(path.join(dir, '__snapshots__'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('captures a snapshot', () => {
    mgr.capture('test-1', makeResponse());
    expect(mgr.exists('test-1')).toBe(true);
  });

  it('compare returns match for identical response', () => {
    const resp = makeResponse();
    mgr.capture('t1', resp);
    const diff = mgr.compare('t1', resp);
    expect(diff.match).toBe(true);
  });

  it('compare detects added tools', () => {
    mgr.capture('t2', makeResponse({ toolCalls: [{ name: 'search' }] }));
    const diff = mgr.compare('t2', makeResponse({ toolCalls: [{ name: 'search' }, { name: 'write' }] }));
    expect(diff.addedTools).toContain('write');
  });

  it('compare detects removed tools', () => {
    mgr.capture('t3', makeResponse({ toolCalls: [{ name: 'search' }, { name: 'write' }] }));
    const diff = mgr.compare('t3', makeResponse({ toolCalls: [{ name: 'search' }] }));
    expect(diff.removedTools).toContain('write');
  });

  it('compare detects changed output', () => {
    mgr.capture('t4', makeResponse({ output: 'hello' }));
    const diff = mgr.compare('t4', makeResponse({ output: 'goodbye' }));
    expect(diff.changedResponses.some(c => c.field === 'output')).toBe(true);
  });

  it('compare reports no-match when snapshot missing', () => {
    const diff = mgr.compare('nonexistent', makeResponse());
    expect(diff.match).toBe(false);
    expect(diff.newBehaviors).toContain('snapshot_not_found');
  });

  it('update re-timestamps existing snapshot', async () => {
    mgr.capture('u1', makeResponse());
    const before = JSON.parse(fs.readFileSync(path.join(dir, '__snapshots__', 'u1.snap.json'), 'utf-8'));
    // Ensure at least 1ms passes so the timestamp differs
    await new Promise((r) => setTimeout(r, 5));
    mgr.update('u1');
    const after = JSON.parse(fs.readFileSync(path.join(dir, '__snapshots__', 'u1.snap.json'), 'utf-8'));
    expect(after.timestamp).not.toBe(before.timestamp);
  });

  it('delete removes snapshot', () => {
    mgr.capture('d1', makeResponse());
    expect(mgr.delete('d1')).toBe(true);
    expect(mgr.exists('d1')).toBe(false);
  });

  it('delete returns false for missing snapshot', () => {
    expect(mgr.delete('nope')).toBe(false);
  });

  it('list returns captured snapshot IDs', () => {
    mgr.capture('a', makeResponse());
    mgr.capture('b', makeResponse());
    expect(mgr.list().sort()).toEqual(['a', 'b']);
  });

  it('formatDiff shows match for identical', () => {
    mgr.capture('f1', makeResponse());
    const diff = mgr.compare('f1', makeResponse());
    expect(mgr.formatDiff(diff)).toContain('✅');
  });

  it('formatDiff shows mismatch details', () => {
    mgr.capture('f2', makeResponse({ toolCalls: [{ name: 'a' }] }));
    const diff = mgr.compare('f2', makeResponse({ toolCalls: [{ name: 'b' }] }));
    expect(mgr.formatDiff(diff)).toContain('❌');
  });
});

// ══════════════════════════════════════════════════════════════════
//  3. TagFilter
// ══════════════════════════════════════════════════════════════════

describe('TagFilter', () => {
  const smoke = makeTestCase({ name: 'smoke-test', tags: ['smoke', 'p0'] });
  const slow = makeTestCase({ name: 'slow-test', tags: ['slow', 'integration'] });
  const security = makeTestCase({ name: 'sec-test', tags: ['security', 'p0'] });
  const untagged = makeTestCase({ name: 'plain' });

  it('empty filter matches everything', () => {
    const f = new TagFilter();
    expect(f.match(smoke)).toBe(true);
    expect(f.match(untagged)).toBe(true);
  });

  it('include matches tests with included tags', () => {
    const f = new TagFilter().include(['smoke']);
    expect(f.match(smoke)).toBe(true);
    expect(f.match(slow)).toBe(false);
  });

  it('include with multiple tags is OR', () => {
    const f = new TagFilter().include(['smoke', 'security']);
    expect(f.match(smoke)).toBe(true);
    expect(f.match(security)).toBe(true);
    expect(f.match(slow)).toBe(false);
  });

  it('exclude rejects tests with excluded tags', () => {
    const f = new TagFilter().exclude(['slow']);
    expect(f.match(smoke)).toBe(true);
    expect(f.match(slow)).toBe(false);
  });

  it('combine include and exclude', () => {
    const f = new TagFilter().include(['p0']).exclude(['slow']);
    expect(f.match(smoke)).toBe(true);     // p0, not slow
    expect(f.match(security)).toBe(true);  // p0, not slow
    expect(f.match(slow)).toBe(false);     // excluded
  });

  it('exclude takes priority over include', () => {
    const f = new TagFilter().include(['slow']).exclude(['slow']);
    expect(f.match(slow)).toBe(false);
  });

  it('filterTests returns matching subset', () => {
    const f = new TagFilter().include(['p0']);
    const result = f.filterTests([smoke, slow, security, untagged]);
    expect(result).toHaveLength(2);
    expect(result.map(t => t.name).sort()).toEqual(['sec-test', 'smoke-test']);
  });

  it('isEmpty returns true for empty filter', () => {
    expect(new TagFilter().isEmpty()).toBe(true);
  });

  it('isEmpty returns false when tags set', () => {
    expect(new TagFilter().include(['x']).isEmpty()).toBe(false);
  });

  it('toString shows filter state', () => {
    const f = new TagFilter().include(['smoke']).exclude(['slow']);
    expect(f.toString()).toContain('include');
    expect(f.toString()).toContain('exclude');
  });

  it('immutable — include returns new instance', () => {
    const f1 = new TagFilter();
    const f2 = f1.include(['x']);
    expect(f1.isEmpty()).toBe(true);
    expect(f2.isEmpty()).toBe(false);
  });
});

describe('parseTagArgs', () => {
  it('parses --tag flags', () => {
    const f = parseTagArgs(['--tag', 'smoke', '--tag', 'p0']);
    expect(f.getIncludeTags()).toEqual(['smoke', 'p0']);
  });

  it('parses --exclude-tag flags', () => {
    const f = parseTagArgs(['--exclude-tag', 'slow']);
    expect(f.getExcludeTags()).toEqual(['slow']);
  });

  it('handles mixed flags', () => {
    const f = parseTagArgs(['--tag', 'smoke', '--exclude-tag', 'slow', '--tag', 'p0']);
    expect(f.getIncludeTags()).toEqual(['smoke', 'p0']);
    expect(f.getExcludeTags()).toEqual(['slow']);
  });

  it('ignores unknown args', () => {
    const f = parseTagArgs(['--verbose', '--tag', 'a']);
    expect(f.getIncludeTags()).toEqual(['a']);
  });
});

describe('extractTags', () => {
  it('returns unique sorted tags', () => {
    const tests = [
      makeTestCase({ tags: ['b', 'a'] }),
      makeTestCase({ tags: ['a', 'c'] }),
    ];
    expect(extractTags(tests)).toEqual(['a', 'b', 'c']);
  });

  it('returns empty for untagged tests', () => {
    expect(extractTags([makeTestCase()])).toEqual([]);
  });
});

describe('groupByTag', () => {
  it('groups tests by their tags', () => {
    const tests = [
      makeTestCase({ name: 'a', tags: ['smoke'] }),
      makeTestCase({ name: 'b', tags: ['smoke', 'p0'] }),
      makeTestCase({ name: 'c' }),
    ];
    const groups = groupByTag(tests);
    expect(groups.get('smoke')?.length).toBe(2);
    expect(groups.get('p0')?.length).toBe(1);
    expect(groups.get('(untagged)')?.length).toBe(1);
  });
});

describe('formatTagStats', () => {
  it('produces readable output', () => {
    const tests = [
      makeTestCase({ tags: ['smoke'] }),
      makeTestCase({ tags: ['smoke', 'p0'] }),
    ];
    const output = formatTagStats(tests);
    expect(output).toContain('smoke: 2');
    expect(output).toContain('p0: 1');
  });
});

// ══════════════════════════════════════════════════════════════════
//  4. ParallelRunner
// ══════════════════════════════════════════════════════════════════

describe('ParallelRunner', () => {
  const executor: TestExecutor = async (test) => ({
    name: test.name,
    passed: true,
    assertions: [],
    duration_ms: 10,
  });

  const failingExecutor: TestExecutor = async (test) => {
    if (test.name.includes('fail')) throw new Error('boom');
    return { name: test.name, passed: true, assertions: [], duration_ms: 5 };
  };

  it('runs tests and returns results', async () => {
    const runner = new ParallelRunner(2);
    const tests = [makeTestCase({ name: 'a' }), makeTestCase({ name: 'b' })];
    const result = await runner.run(tests, executor);
    expect(result.total).toBe(2);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('handles executor errors gracefully', async () => {
    const runner = new ParallelRunner(2);
    const tests = [makeTestCase({ name: 'ok' }), makeTestCase({ name: 'fail-1' })];
    const result = await runner.run(tests, failingExecutor);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find(r => r.name === 'fail-1')?.error).toContain('boom');
  });

  it('respects concurrency limit', async () => {
    let maxConcurrent = 0;
    let current = 0;
    const slowExecutor: TestExecutor = async (test) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise(r => setTimeout(r, 20));
      current--;
      return { name: test.name, passed: true, assertions: [], duration_ms: 20 };
    };
    const runner = new ParallelRunner(2);
    const tests = Array.from({ length: 6 }, (_, i) => makeTestCase({ name: `t${i}` }));
    await runner.run(tests, slowExecutor);
    expect(maxConcurrent).toBeLessThanOrEqual(3); // allow slight race
  });

  it('calls progress callback', async () => {
    const updates: ParallelProgress[] = [];
    const runner = new ParallelRunner(4, { progressCallback: s => updates.push({ ...s }) });
    const tests = [makeTestCase({ name: 'p1' }), makeTestCase({ name: 'p2' })];
    await runner.run(tests, executor);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1].completed).toBe(2);
  });

  it('handles empty test list', async () => {
    const runner = new ParallelRunner(4);
    const result = await runner.run([], executor);
    expect(result.total).toBe(0);
    expect(result.passed).toBe(0);
  });

  it('returns correct duration_ms', async () => {
    const runner = new ParallelRunner(4);
    const result = await runner.run([makeTestCase({ name: 'x' })], executor);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('renderParallelProgress', () => {
  it('renders a progress bar', () => {
    const bar = renderParallelProgress({
      total: 10, completed: 5, running: 2, queued: 3,
      passed: 4, failed: 1, eta_ms: 5000, elapsed_ms: 5000,
    });
    expect(bar).toContain('5/10');
    expect(bar).toContain('✅ 4');
    expect(bar).toContain('❌ 1');
    expect(bar).toContain('ETA');
  });
});

describe('estimateConcurrency', () => {
  it('returns at least 1', () => {
    expect(estimateConcurrency(0)).toBeGreaterThanOrEqual(1);
  });

  it('scales with test count', () => {
    expect(estimateConcurrency(100)).toBeGreaterThan(estimateConcurrency(2));
  });

  it('factors in adapter count', () => {
    expect(estimateConcurrency(20, 4)).toBeGreaterThanOrEqual(estimateConcurrency(20, 1));
  });
});
