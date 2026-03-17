import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentTrace } from '../src/types';
import {
  SnapshotManager,
  extractSnapshot,
  matchSnapshot,
  diffTraceSnapshots,
  formatTraceDiff,
  formatSnapshotDetail,
} from '../src/snapshot';
import type { SnapshotConfig } from '../src/snapshot';

function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'test-trace-1',
    timestamp: new Date().toISOString(),
    steps: [
      {
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        data: { tool_name: 'search', tool_args: { query: 'hello' } },
        duration_ms: 120,
      },
      {
        type: 'output',
        timestamp: new Date().toISOString(),
        data: { content: 'Found results for hello' },
        duration_ms: 5,
      },
    ],
    metadata: { model: 'gpt-4' },
    ...overrides,
  };
}

describe('SnapshotManager', () => {
  let tmpDir: string;
  let mgr: SnapshotManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-snap-'));
    mgr = new SnapshotManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('capture creates a snapshot file', () => {
    const trace = makeTrace();
    mgr.capture('my-test', {
      output: 'Found results for hello',
      toolCalls: [{ name: 'search', args: { query: 'hello' } }],
      steps: trace.steps,
    });

    expect(mgr.exists('my-test')).toBe(true);
    expect(mgr.list()).toContain('my-test');
  });

  it('compare detects matching snapshots', () => {
    const response = {
      output: 'Found results for hello',
      toolCalls: [{ name: 'search', args: { query: 'hello' } }],
      steps: makeTrace().steps,
    };
    mgr.capture('match-test', response);
    const diff = mgr.compare('match-test', response);
    expect(diff.match).toBe(true);
  });

  it('compare detects mismatches', () => {
    mgr.capture('mismatch-test', {
      output: 'hello',
      toolCalls: [{ name: 'search' }],
      steps: makeTrace().steps,
    });
    const diff = mgr.compare('mismatch-test', {
      output: 'different output',
      toolCalls: [{ name: 'different_tool' }],
      steps: [makeTrace().steps[0]],
    });
    expect(diff.match).toBe(false);
    expect(diff.addedTools.length + diff.removedTools.length + diff.changedResponses.length + diff.newBehaviors.length).toBeGreaterThan(0);
  });

  it('compare returns not found for missing snapshot', () => {
    const diff = mgr.compare('nonexistent', {
      output: 'x',
      toolCalls: [],
      steps: [],
    });
    expect(diff.match).toBe(false);
    expect(diff.newBehaviors).toContain('snapshot_not_found');
  });

  it('update re-timestamps a snapshot', () => {
    mgr.capture('update-test', {
      output: 'x',
      toolCalls: [],
      steps: [],
    });
    mgr.update('update-test');
    expect(mgr.exists('update-test')).toBe(true);
  });

  it('delete removes a snapshot', () => {
    mgr.capture('to-delete', { output: 'x', toolCalls: [], steps: [] });
    expect(mgr.delete('to-delete')).toBe(true);
    expect(mgr.exists('to-delete')).toBe(false);
  });

  it('delete returns false for missing', () => {
    expect(mgr.delete('nope')).toBe(false);
  });

  it('list returns all snapshot names', () => {
    mgr.capture('snap-a', { output: 'a', toolCalls: [], steps: [] });
    mgr.capture('snap-b', { output: 'b', toolCalls: [], steps: [] });
    const names = mgr.list();
    expect(names).toContain('snap-a');
    expect(names).toContain('snap-b');
  });

  it('formatDiff shows match or mismatch', () => {
    const matchDiff = { testId: 'test', match: true, addedTools: [], removedTools: [], changedResponses: [], newBehaviors: [] };
    expect(mgr.formatDiff(matchDiff)).toContain('matches');

    const failDiff = { testId: 'test', match: false, addedTools: ['new_tool'], removedTools: ['old_tool'], changedResponses: [], newBehaviors: [] };
    expect(mgr.formatDiff(failDiff)).toContain('mismatch');
    expect(mgr.formatDiff(failDiff)).toContain('new_tool');
  });
});

describe('matchSnapshot (legacy)', () => {
  let tmpDir: string;
  let config: SnapshotConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-legacy-'));
    config = { updateSnapshots: false, snapshotDir: tmpDir };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates snapshot on first run', () => {
    const result = matchSnapshot(makeTrace(), 'first', { ...config, updateSnapshots: true });
    expect(result.match).toBe(true);
  });

  it('matches identical traces', () => {
    const trace = makeTrace();
    matchSnapshot(trace, 'same', { ...config, updateSnapshots: true });
    const result = matchSnapshot(trace, 'same', config);
    expect(result.match).toBe(true);
  });

  it('detects mismatches', () => {
    matchSnapshot(makeTrace(), 'differ', { ...config, updateSnapshots: true });
    const trace2 = makeTrace({
      steps: [{
        type: 'tool_call',
        timestamp: '',
        data: { tool_name: 'other' },
        duration_ms: 1,
      }],
    });
    const result = matchSnapshot(trace2, 'differ', config);
    expect(result.match).toBe(false);
    expect(result.diff).toBeDefined();
  });
});

describe('diffTraceSnapshots', () => {
  it('reports identical traces', () => {
    const trace = makeTrace();
    const result = diffTraceSnapshots(trace, trace);
    expect(result.identical).toBe(true);
    expect(result.stepDiffs).toHaveLength(0);
  });

  it('detects added steps', () => {
    const trace1 = makeTrace();
    const trace2 = makeTrace({
      steps: [
        ...makeTrace().steps,
        { type: 'tool_call', timestamp: '', data: { tool_name: 'extra' }, duration_ms: 10 },
      ],
    });
    const result = diffTraceSnapshots(trace1, trace2);
    expect(result.identical).toBe(false);
    expect(result.summary.added).toBe(1);
  });

  it('detects removed steps', () => {
    const trace1 = makeTrace();
    const trace2 = makeTrace({ steps: [makeTrace().steps[0]] });
    const result = diffTraceSnapshots(trace1, trace2);
    expect(result.identical).toBe(false);
    expect(result.summary.removed).toBe(1);
  });

  it('detects changed steps', () => {
    const trace1 = makeTrace();
    const trace2Modified = makeTrace();
    trace2Modified.steps[0].data.tool_name = 'different';
    const result = diffTraceSnapshots(trace1, trace2Modified);
    expect(result.identical).toBe(false);
    expect(result.summary.changed).toBeGreaterThanOrEqual(1);
  });

  it('ignores timestamps by default', () => {
    const trace1 = makeTrace();
    const trace2 = makeTrace();
    trace2.steps[0].timestamp = '2099-01-01T00:00:00Z';
    const result = diffTraceSnapshots(trace1, trace2);
    expect(result.identical).toBe(true);
  });

  it('ignores duration_ms by default', () => {
    const trace1 = makeTrace();
    const trace2 = makeTrace();
    trace2.steps[0].duration_ms = 9999;
    const result = diffTraceSnapshots(trace1, trace2);
    expect(result.identical).toBe(true);
  });

  it('respects custom ignorePatterns', () => {
    const trace1 = makeTrace();
    const trace2 = makeTrace();
    trace2.steps[0].data.tool_name = 'changed';

    const r1 = diffTraceSnapshots(trace1, trace2);
    expect(r1.identical).toBe(false);

    const r2 = diffTraceSnapshots(trace1, trace2, { ignorePatterns: ['tool_name'] });
    expect(r2.identical).toBe(true);
  });
});

describe('Snapshot Reporter', () => {
  it('formatTraceDiff shows match message', () => {
    const trace = makeTrace();
    const diff = diffTraceSnapshots(trace, trace);
    const output = formatTraceDiff(diff, 'test');
    expect(output).toContain('matches');
  });

  it('formatTraceDiff shows mismatch details', () => {
    const trace1 = makeTrace();
    const trace2 = makeTrace({ steps: [] });
    const diff = diffTraceSnapshots(trace1, trace2);
    const output = formatTraceDiff(diff, 'test');
    expect(output).toContain('does not match');
    expect(output).toContain('removed');
  });

  it('formatSnapshotDetail shows info', () => {
    const data = {
      testId: 'info-test',
      timestamp: '2025-01-01T00:00:00Z',
      toolsCalled: ['search'],
      toolCallOrder: ['search'],
      outputHash: 'h123',
      stepCount: 2,
      stepTypes: ['tool_call', 'output'],
      hasOutput: true,
    };
    const output = formatSnapshotDetail(data);
    expect(output).toContain('info-test');
    expect(output).toContain('Steps: 2');
  });
});

describe('extractSnapshot', () => {
  it('extracts behavior from trace', () => {
    const snap = extractSnapshot(makeTrace());
    expect(snap.toolsCalled).toEqual(['search']);
    expect(snap.toolCallOrder).toEqual(['search']);
    expect(snap.hasOutput).toBe(true);
    expect(snap.stepCount).toBe(2);
  });
});
