/**
 * Snapshot Update — Update expected values in test files based on current results.
 *
 * @example
 * ```bash
 * agentprobe update-snapshots tests.yaml
 * # Updates expected values in test files based on current results
 * # Shows diff before applying, asks for confirmation
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SuiteResult } from './types';
import { extractSnapshot, type BehaviorSnapshot } from './snapshots';

// ===== Types =====

export interface SnapshotDiff {
  testName: string;
  field: string;
  oldValue: any;
  newValue: any;
}

export interface SnapshotUpdatePlan {
  suitePath: string;
  diffs: SnapshotDiff[];
  snapshotFiles: SnapshotFileUpdate[];
}

export interface SnapshotFileUpdate {
  filePath: string;
  oldSnapshot: BehaviorSnapshot | null;
  newSnapshot: BehaviorSnapshot;
}

// ===== Core Functions =====

/**
 * Generate a plan of snapshot updates based on suite results.
 */
export function planSnapshotUpdate(
  suitePath: string,
  results: SuiteResult,
  snapshotDir: string,
): SnapshotUpdatePlan {
  const diffs: SnapshotDiff[] = [];
  const snapshotFiles: SnapshotFileUpdate[] = [];

  for (const result of results.results) {
    if (!result.trace) continue;

    const newSnap = extractSnapshot(result.trace);
    const key = result.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const snapFile = path.join(snapshotDir, `${key}.snap.json`);

    let oldSnap: BehaviorSnapshot | null = null;
    if (fs.existsSync(snapFile)) {
      try {
        oldSnap = JSON.parse(fs.readFileSync(snapFile, 'utf-8'));
      } catch {
        oldSnap = null;
      }
    }

    if (oldSnap === null) {
      diffs.push({
        testName: result.name,
        field: 'snapshot',
        oldValue: null,
        newValue: newSnap,
      });
    } else {
      if (JSON.stringify(oldSnap.toolsCalled) !== JSON.stringify(newSnap.toolsCalled)) {
        diffs.push({
          testName: result.name,
          field: 'toolsCalled',
          oldValue: oldSnap.toolsCalled,
          newValue: newSnap.toolsCalled,
        });
      }
      if (JSON.stringify(oldSnap.toolCallOrder) !== JSON.stringify(newSnap.toolCallOrder)) {
        diffs.push({
          testName: result.name,
          field: 'toolCallOrder',
          oldValue: oldSnap.toolCallOrder,
          newValue: newSnap.toolCallOrder,
        });
      }
      if (oldSnap.stepCount !== newSnap.stepCount) {
        diffs.push({
          testName: result.name,
          field: 'stepCount',
          oldValue: oldSnap.stepCount,
          newValue: newSnap.stepCount,
        });
      }
    }

    snapshotFiles.push({ filePath: snapFile, oldSnapshot: oldSnap, newSnapshot: newSnap });
  }

  return { suitePath, diffs, snapshotFiles };
}

/**
 * Format the update plan as a human-readable diff.
 */
export function formatUpdatePlan(plan: SnapshotUpdatePlan): string {
  if (plan.diffs.length === 0) {
    return 'No snapshot changes detected.';
  }

  const lines: string[] = [];
  lines.push(`Snapshot updates for: ${plan.suitePath}`);
  lines.push(`${'─'.repeat(50)}`);

  for (const d of plan.diffs) {
    lines.push(`  ${d.testName}`);
    if (d.oldValue === null) {
      lines.push(`    + NEW: ${d.field} = ${JSON.stringify(d.newValue)}`);
    } else {
      lines.push(`    ~ ${d.field}:`);
      lines.push(`      - ${JSON.stringify(d.oldValue)}`);
      lines.push(`      + ${JSON.stringify(d.newValue)}`);
    }
  }

  lines.push(`${'─'.repeat(50)}`);
  lines.push(`${plan.diffs.length} change(s) across ${plan.snapshotFiles.length} file(s)`);
  return lines.join('\n');
}

/**
 * Apply the snapshot update plan — write new snapshots to disk.
 */
export function applySnapshotUpdate(plan: SnapshotUpdatePlan): number {
  let updated = 0;
  for (const file of plan.snapshotFiles) {
    const dir = path.dirname(file.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file.filePath, JSON.stringify(file.newSnapshot, null, 2));
    updated++;
  }
  return updated;
}

/**
 * Check if snapshots are outdated for a given suite result.
 */
export function hasOutdatedSnapshots(
  results: SuiteResult,
  snapshotDir: string,
): boolean {
  const plan = planSnapshotUpdate('', results, snapshotDir);
  return plan.diffs.length > 0;
}
