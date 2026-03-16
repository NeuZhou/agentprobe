/**
 * Round 20 Tests — v2.1.0
 * SDK programmatic API, streaming progress, snapshot updates,
 * error catalog, trace compression.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// SDK
import { AgentProbe } from '../src/sdk';
import type { AgentProbeOptions, DiffResult } from '../src/sdk';

// Progress
import {
  ProgressTracker,
  renderProgressBar,
  formatEntry,
  formatProgress,
  fromSuiteResult,
} from '../src/progress';
import type { ProgressEntry, ProgressState } from '../src/progress';

// Snapshot Update
import {
  planSnapshotUpdate,
  formatUpdatePlan,
  applySnapshotUpdate,
  hasOutdatedSnapshots,
} from '../src/snapshot-update';

// Error Catalog
import {
  AgentProbeError,
  getError,
  getAllErrors,
  getErrorsByCategory,
  formatError,
  formatErrorCatalog,
} from '../src/errors';

// Compression
import {
  compressTrace,
  decompressTrace,
  compressDirectory,
  decompressDirectory,
  formatCompressionStats,
  compressToFile,
  decompressFromFile,
} from '../src/compress';

import type { AgentTrace, SuiteResult } from '../src/types';

// ===== Helpers =====

function makeTrace(steps: AgentTrace['steps'] = [], id = 'test-001'): AgentTrace {
  return { id, timestamp: '2026-03-16T00:00:00Z', steps, metadata: {} };
}

function makeToolCallStep(name: string, args: Record<string, any> = {}) {
  return {
    type: 'tool_call' as const,
    timestamp: new Date().toISOString(),
    data: { tool_name: name, tool_args: args },
    duration_ms: 100,
  };
}

function makeOutputStep(content: string) {
  return {
    type: 'output' as const,
    timestamp: new Date().toISOString(),
    data: { content },
  };
}

function makeLLMStep(msg: string) {
  return {
    type: 'llm_call' as const,
    timestamp: new Date().toISOString(),
    data: { model: 'gpt-4', messages: [{ role: 'user' as const, content: msg }], tokens: { input: 50, output: 100 } },
    duration_ms: 500,
  };
}

function makeSuiteResult(results: Array<{ name: string; passed: boolean; trace?: AgentTrace }>): SuiteResult {
  return {
    name: 'test-suite',
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    total: results.length,
    duration_ms: 1000,
    results: results.map((r) => ({
      name: r.name,
      passed: r.passed,
      assertions: r.passed ? [{ name: 'check', passed: true }] : [{ name: 'check', passed: false, message: 'failed' }],
      duration_ms: 100,
      trace: r.trace,
    })),
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-r20-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ===== 1. SDK Tests =====

describe('SDK — AgentProbe Class', () => {
  it('should create instance with defaults', () => {
    const probe = new AgentProbe();
    expect(probe.adapter).toBe('openai');
    expect(probe.model).toBeUndefined();
  });

  it('should accept custom options', () => {
    const probe = new AgentProbe({ adapter: 'anthropic', model: 'claude-3-opus' });
    expect(probe.adapter).toBe('anthropic');
    expect(probe.model).toBe('claude-3-opus');
  });

  it('should record a trace from input', async () => {
    const probe = new AgentProbe({ model: 'gpt-4' });
    const trace = await probe.record('What is the weather?');
    expect(trace.id).toBeDefined();
    expect(trace.steps.length).toBeGreaterThan(0);
    expect(trace.steps[0].type).toBe('llm_call');
    expect(trace.steps[0].data.messages![0].content).toBe('What is the weather?');
  });

  it('should record with system prompt', async () => {
    const probe = new AgentProbe({ model: 'gpt-4' });
    const trace = await probe.record('Hello', { systemPrompt: 'You are helpful.' });
    const msgs = trace.steps[0].data.messages!;
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe('You are helpful.');
    expect(msgs[1].role).toBe('user');
  });

  it('should test a trace against expectations', async () => {
    const probe = new AgentProbe();
    const trace = makeTrace([
      makeToolCallStep('get_weather', { city: 'Tokyo' }),
      makeOutputStep('The temperature is 22°C'),
    ]);
    const result = await probe.test(trace, {
      tool_called: 'get_weather',
      output_contains: 'temperature',
    });
    expect(result.passed).toBe(true);
    expect(result.assertions.length).toBeGreaterThan(0);
  });

  it('should fail test when expectations not met', async () => {
    const probe = new AgentProbe();
    const trace = makeTrace([makeOutputStep('Hello world')]);
    const result = await probe.test(trace, { tool_called: 'search' });
    expect(result.passed).toBe(false);
  });

  it('should diff two traces', async () => {
    const probe = new AgentProbe();
    const t1 = makeTrace([makeToolCallStep('search', { q: 'cats' }), makeOutputStep('cats info')]);
    const t2 = makeTrace([makeToolCallStep('search', { q: 'cats' }), makeToolCallStep('fetch', { url: 'x' }), makeOutputStep('more cats info')]);
    const diff = await probe.diff(t1, t2);
    expect(diff.diff.toolsAdded).toContain('fetch');
    expect(diff.hasDrift).toBe(true);
    expect(diff.formatted).toContain('fetch');
  });

  it('should create a recorder', () => {
    const probe = new AgentProbe({ adapter: 'gemini', model: 'gemini-pro' });
    const rec = probe.createRecorder({ extra: 'data' });
    expect(rec).toBeDefined();
    const trace = rec.getTrace();
    expect(trace.metadata.adapter).toBe('gemini');
  });

  it('should load trace from file', () => {
    const probe = new AgentProbe();
    const trace = makeTrace([makeOutputStep('hello')]);
    const fp = path.join(tmpDir, 'trace.json');
    fs.writeFileSync(fp, JSON.stringify(trace));
    const loaded = probe.loadTrace(fp);
    expect(loaded.id).toBe(trace.id);
  });
});

// ===== 2. Progress Tests =====

describe('Streaming Progress', () => {
  it('should render empty progress bar', () => {
    const bar = renderProgressBar(0, 10);
    expect(bar).toContain('0%');
    expect(bar).toContain('0/10');
  });

  it('should render partial progress bar', () => {
    const bar = renderProgressBar(5, 10);
    expect(bar).toContain('50%');
    expect(bar).toContain('5/10');
    expect(bar).toContain('█');
    expect(bar).toContain('░');
  });

  it('should render full progress bar', () => {
    const bar = renderProgressBar(10, 10);
    expect(bar).toContain('100%');
    expect(bar).not.toContain('░');
  });

  it('should handle zero total', () => {
    const bar = renderProgressBar(0, 0);
    expect(bar).toContain('0%');
  });

  it('should format passed entry', () => {
    const entry: ProgressEntry = { name: 'test-1', status: 'passed', duration_ms: 500, cost_usd: 0.002 };
    const formatted = formatEntry(entry);
    expect(formatted).toContain('✓');
    expect(formatted).toContain('test-1');
    expect(formatted).toContain('0.5s');
    expect(formatted).toContain('$0.0020');
  });

  it('should format failed entry with error', () => {
    const entry: ProgressEntry = { name: 'test-2', status: 'failed', error: 'expected tool_called:search', duration_ms: 800 };
    const formatted = formatEntry(entry);
    expect(formatted).toContain('✗');
    expect(formatted).toContain('FAILED');
    expect(formatted).toContain('expected tool_called:search');
  });

  it('should format running entry', () => {
    const entry: ProgressEntry = { name: 'test-3', status: 'running' };
    expect(formatEntry(entry)).toContain('⏳');
  });

  it('should format skipped entry', () => {
    const entry: ProgressEntry = { name: 'test-4', status: 'skipped' };
    expect(formatEntry(entry)).toContain('SKIPPED');
  });

  it('should track progress lifecycle', () => {
    const tracker = new ProgressTracker(3);
    tracker.addTest('a');
    tracker.addTest('b');
    tracker.addTest('c');
    tracker.startTest('a');
    tracker.passTest('a', 100, 0.001);
    tracker.startTest('b');
    tracker.failTest('b', 'oops', 200);
    tracker.skipTest('c');
    const state = tracker.getState();
    expect(state.completed).toBe(3);
    expect(state.entries[0].status).toBe('passed');
    expect(state.entries[1].status).toBe('failed');
    expect(state.entries[2].status).toBe('skipped');
  });

  it('should render full progress display', () => {
    const tracker = new ProgressTracker(2);
    tracker.addTest('t1');
    tracker.addTest('t2');
    tracker.passTest('t1', 500);
    tracker.startTest('t2');
    const rendered = tracker.render();
    expect(rendered).toContain('Running tests...');
    expect(rendered).toContain('✓');
    expect(rendered).toContain('⏳');
  });

  it('should generate summary', () => {
    const tracker = new ProgressTracker(2);
    tracker.passTest('a', 100, 0.001);
    tracker.failTest('b', 'err', 200, 0.002);
    const summary = tracker.summary();
    expect(summary).toContain('1 passed');
    expect(summary).toContain('1 failed');
  });

  it('should create tracker from suite result', () => {
    const result = makeSuiteResult([
      { name: 'test-a', passed: true },
      { name: 'test-b', passed: false },
    ]);
    const tracker = fromSuiteResult(result);
    const state = tracker.getState();
    expect(state.completed).toBe(2);
    expect(state.entries[0].status).toBe('passed');
    expect(state.entries[1].status).toBe('failed');
  });

  it('should emit progress callback', () => {
    const states: ProgressState[] = [];
    const tracker = new ProgressTracker(1);
    tracker.onProgress((s) => states.push(s));
    tracker.addTest('x');
    tracker.passTest('x', 100);
    expect(states.length).toBe(2);
  });
});

// ===== 3. Snapshot Update Tests =====

describe('Snapshot Update', () => {
  it('should plan update for new snapshots', () => {
    const trace = makeTrace([makeToolCallStep('search')]);
    const result = makeSuiteResult([{ name: 'new-test', passed: true, trace }]);
    const plan = planSnapshotUpdate('tests.yaml', result, path.join(tmpDir, 'snaps'));
    expect(plan.diffs.length).toBe(1);
    expect(plan.diffs[0].field).toBe('snapshot');
    expect(plan.diffs[0].oldValue).toBeNull();
  });

  it('should detect changes in existing snapshots', () => {
    const snapDir = path.join(tmpDir, 'snaps');
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(
      path.join(snapDir, 'my_test.snap.json'),
      JSON.stringify({ toolsCalled: ['old_tool'], toolCallOrder: ['old_tool'], hasOutput: false, stepCount: 1, stepTypes: ['tool_call'] }),
    );
    const trace = makeTrace([makeToolCallStep('new_tool'), makeOutputStep('out')]);
    const result = makeSuiteResult([{ name: 'my_test', passed: true, trace }]);
    const plan = planSnapshotUpdate('tests.yaml', result, snapDir);
    expect(plan.diffs.length).toBeGreaterThan(0);
    expect(plan.diffs.some((d) => d.field === 'toolsCalled')).toBe(true);
  });

  it('should format update plan', () => {
    const trace = makeTrace([makeToolCallStep('search')]);
    const result = makeSuiteResult([{ name: 'test-x', passed: true, trace }]);
    const plan = planSnapshotUpdate('suite.yaml', result, path.join(tmpDir, 'snaps'));
    const formatted = formatUpdatePlan(plan);
    expect(formatted).toContain('suite.yaml');
    expect(formatted).toContain('test-x');
  });

  it('should show no changes message', () => {
    const result = makeSuiteResult([{ name: 'no-trace', passed: true }]);
    const plan = planSnapshotUpdate('suite.yaml', result, path.join(tmpDir, 'snaps'));
    expect(formatUpdatePlan(plan)).toContain('No snapshot changes');
  });

  it('should apply snapshot updates to disk', () => {
    const trace = makeTrace([makeToolCallStep('api')]);
    const result = makeSuiteResult([{ name: 'apply-test', passed: true, trace }]);
    const snapDir = path.join(tmpDir, 'apply-snaps');
    const plan = planSnapshotUpdate('suite.yaml', result, snapDir);
    const count = applySnapshotUpdate(plan);
    expect(count).toBe(1);
    expect(fs.existsSync(path.join(snapDir, 'apply-test.snap.json'))).toBe(true);
  });

  it('should detect outdated snapshots', () => {
    const snapDir = path.join(tmpDir, 'outdated');
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(
      path.join(snapDir, 'stale.snap.json'),
      JSON.stringify({ toolsCalled: ['x'], toolCallOrder: ['x'], hasOutput: false, stepCount: 1, stepTypes: ['tool_call'] }),
    );
    const trace = makeTrace([makeToolCallStep('y')]);
    const result = makeSuiteResult([{ name: 'stale', passed: true, trace }]);
    expect(hasOutdatedSnapshots(result, snapDir)).toBe(true);
  });
});

// ===== 4. Error Catalog Tests =====

describe('Error Catalog', () => {
  it('should get error by code', () => {
    const err = getError('AP001');
    expect(err).toBeDefined();
    expect(err!.title).toContain('Adapter connection');
    expect(err!.category).toBe('adapter');
  });

  it('should return undefined for unknown code', () => {
    expect(getError('AP999')).toBeUndefined();
  });

  it('should list all errors', () => {
    const all = getAllErrors();
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(all.every((e) => e.code.startsWith('AP'))).toBe(true);
  });

  it('should filter by category', () => {
    const adapterErrors = getErrorsByCategory('adapter');
    expect(adapterErrors.length).toBeGreaterThan(0);
    expect(adapterErrors.every((e) => e.category === 'adapter')).toBe(true);
  });

  it('should create AgentProbeError with code', () => {
    const err = new AgentProbeError('AP002');
    expect(err.code).toBe('AP002');
    expect(err.message).toContain('Trace format invalid');
    expect(err.hint).toContain('steps');
    expect(err.category).toBe('trace');
  });

  it('should interpolate budget context', () => {
    const err = new AgentProbeError('AP003', { spend: 5.23, limit: 5.0 });
    expect(err.hint).toContain('$5.23');
    expect(err.hint).toContain('$5.00');
  });

  it('should handle unknown error code gracefully', () => {
    const err = new AgentProbeError('AP999');
    expect(err.code).toBe('AP999');
    expect(err.category).toBe('internal');
  });

  it('should format error for CLI', () => {
    const err = new AgentProbeError('AP004');
    const formatted = err.format();
    expect(formatted).toContain('AP004');
    expect(formatted).toContain('→');
  });

  it('should format full error catalog', () => {
    const catalog = formatErrorCatalog();
    expect(catalog).toContain('Error Catalog');
    expect(catalog).toContain('AP001');
    expect(catalog).toContain('[ADAPTER]');
    expect(catalog).toContain('[TEST]');
  });

  it('should format single error info', () => {
    const info = getError('AP005')!;
    const formatted = formatError(info);
    expect(formatted).toContain('AP005');
    expect(formatted).toContain('YAML');
  });
});

// ===== 5. Compression Tests =====

describe('Trace Compression', () => {
  it('should compress and decompress a single trace', () => {
    const trace = makeTrace([makeToolCallStep('search', { q: 'test' }), makeOutputStep('result')]);
    const compressed = compressTrace(trace);
    expect(compressed.length).toBeLessThan(JSON.stringify(trace).length);
    const decompressed = decompressTrace(compressed);
    expect(decompressed.id).toBe(trace.id);
    expect(decompressed.steps).toHaveLength(2);
  });

  it('should compress a directory of traces', () => {
    const traceDir = path.join(tmpDir, 'traces');
    fs.mkdirSync(traceDir);
    for (let i = 0; i < 5; i++) {
      const trace = makeTrace([makeToolCallStep(`tool-${i}`), makeOutputStep(`result-${i}`)], `trace-${i}`);
      fs.writeFileSync(path.join(traceDir, `trace-${i}.json`), JSON.stringify(trace, null, 2));
    }
    const { archive, stats } = compressDirectory(traceDir);
    expect(stats.fileCount).toBe(5);
    expect(stats.compressedBytes).toBeLessThan(stats.originalBytes);
    expect(stats.ratio).toBeLessThan(1);
    expect(archive.length).toBeGreaterThan(0);
  });

  it('should decompress directory from archive', () => {
    const traceDir = path.join(tmpDir, 'src-traces');
    fs.mkdirSync(traceDir);
    const trace = makeTrace([makeToolCallStep('api')], 'decomp-test');
    fs.writeFileSync(path.join(traceDir, 'test.json'), JSON.stringify(trace));
    const { archive } = compressDirectory(traceDir);

    const outDir = path.join(tmpDir, 'out-traces');
    const stats = decompressDirectory(archive, outDir);
    expect(stats.fileCount).toBe(1);
    expect(fs.existsSync(path.join(outDir, 'test.json'))).toBe(true);
    const restored = JSON.parse(fs.readFileSync(path.join(outDir, 'test.json'), 'utf-8'));
    expect(restored.id).toBe('decomp-test');
  });

  it('should compress to file and decompress from file', () => {
    const traceDir = path.join(tmpDir, 'file-traces');
    fs.mkdirSync(traceDir);
    fs.writeFileSync(path.join(traceDir, 'a.json'), JSON.stringify(makeTrace([], 'a')));
    fs.writeFileSync(path.join(traceDir, 'b.json'), JSON.stringify(makeTrace([], 'b')));

    const archivePath = path.join(tmpDir, 'traces.gz');
    const compStats = compressToFile(traceDir, archivePath);
    expect(compStats.fileCount).toBe(2);
    expect(fs.existsSync(archivePath)).toBe(true);

    const outDir = path.join(tmpDir, 'restored');
    const decStats = decompressFromFile(archivePath, outDir);
    expect(decStats.fileCount).toBe(2);
    expect(fs.existsSync(path.join(outDir, 'a.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'b.json'))).toBe(true);
  });

  it('should format compression stats', () => {
    const stats = { fileCount: 10, originalBytes: 50000, compressedBytes: 5000, ratio: 0.1 };
    const formatted = formatCompressionStats(stats);
    expect(formatted).toContain('10 file(s)');
    expect(formatted).toContain('90.0% reduction');
  });

  it('should throw on missing directory', () => {
    expect(() => compressDirectory('/nonexistent/path')).toThrow('Directory not found');
  });

  it('should handle empty directory', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir);
    const { stats } = compressDirectory(emptyDir);
    expect(stats.fileCount).toBe(0);
  });
});
