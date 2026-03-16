import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractSnapshot, matchSnapshot } from '../src/snapshots';
import { makeTrace, toolCall, output } from './helpers';

const SNAP_DIR = path.join(__dirname, '__test_snapshots__');

function cleanup() {
  if (fs.existsSync(SNAP_DIR)) {
    for (const f of fs.readdirSync(SNAP_DIR)) fs.unlinkSync(path.join(SNAP_DIR, f));
    fs.rmdirSync(SNAP_DIR);
  }
}

describe('snapshots', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('first run creates snapshot', () => {
    const trace = makeTrace([toolCall('search'), output('result')]);
    const result = matchSnapshot(trace, 'test-create', { updateSnapshots: false, snapshotDir: SNAP_DIR });
    expect(result.match).toBe(true);
    expect(fs.existsSync(path.join(SNAP_DIR, 'test-create.snap.json'))).toBe(true);
  });

  it('second run matches identical trace', () => {
    const trace = makeTrace([toolCall('search'), output('result')]);
    matchSnapshot(trace, 'test-match', { updateSnapshots: false, snapshotDir: SNAP_DIR });
    const result = matchSnapshot(trace, 'test-match', { updateSnapshots: false, snapshotDir: SNAP_DIR });
    expect(result.match).toBe(true);
  });

  it('detects behavioral diff (new tool)', () => {
    const trace1 = makeTrace([toolCall('search'), output('result')]);
    matchSnapshot(trace1, 'test-diff', { updateSnapshots: false, snapshotDir: SNAP_DIR });

    const trace2 = makeTrace([toolCall('search'), toolCall('write'), output('result')]);
    const result = matchSnapshot(trace2, 'test-diff', { updateSnapshots: false, snapshotDir: SNAP_DIR });
    expect(result.match).toBe(false);
    expect(result.diff).toContain('Tools called');
  });

  it('detects different tool order', () => {
    const trace1 = makeTrace([toolCall('a'), toolCall('b')]);
    matchSnapshot(trace1, 'test-order', { updateSnapshots: false, snapshotDir: SNAP_DIR });

    const trace2 = makeTrace([toolCall('b'), toolCall('a')]);
    const result = matchSnapshot(trace2, 'test-order', { updateSnapshots: false, snapshotDir: SNAP_DIR });
    expect(result.match).toBe(false);
    expect(result.diff).toContain('Tool order');
  });

  it('--update-snapshots overwrites', () => {
    const trace1 = makeTrace([toolCall('search')]);
    matchSnapshot(trace1, 'test-update', { updateSnapshots: false, snapshotDir: SNAP_DIR });

    const trace2 = makeTrace([toolCall('search'), toolCall('write')]);
    const result = matchSnapshot(trace2, 'test-update', { updateSnapshots: true, snapshotDir: SNAP_DIR });
    expect(result.match).toBe(true);
    expect(result.updated).toBe(true);
  });

  it('extractSnapshot returns correct structure', () => {
    const trace = makeTrace([toolCall('a'), toolCall('b'), toolCall('a'), output('hi')]);
    const snap = extractSnapshot(trace);
    expect(snap.toolsCalled).toEqual(['a', 'b']);
    expect(snap.toolCallOrder).toEqual(['a', 'b', 'a']);
    expect(snap.hasOutput).toBe(true);
    expect(snap.stepCount).toBe(4);
  });
});
