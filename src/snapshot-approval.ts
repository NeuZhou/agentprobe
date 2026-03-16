/**
 * Snapshot Approval Workflow — Interactive review and approval of snapshot changes.
 *
 * @example
 * ```bash
 * agentprobe snapshot update   # Update all snapshots
 * agentprobe snapshot review   # Interactive review of changes
 * agentprobe snapshot approve test-name  # Approve specific snapshot
 * agentprobe snapshot reject test-name   # Reject and keep old
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BehaviorSnapshot } from './snapshots';

// ===== Types =====

export type SnapshotStatus = 'pending' | 'approved' | 'rejected';

export interface SnapshotRecord {
  testName: string;
  status: SnapshotStatus;
  current: BehaviorSnapshot | null;
  proposed: BehaviorSnapshot;
  diff: SnapshotFieldDiff[];
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface SnapshotFieldDiff {
  field: string;
  oldValue: any;
  newValue: any;
}

export interface ApprovalState {
  snapshotDir: string;
  records: SnapshotRecord[];
}

export interface ApprovalSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

// ===== Constants =====

const APPROVAL_FILE = '.snapshot-approvals.json';

// ===== Core Functions =====

/** Load approval state from disk. */
export function loadApprovalState(snapshotDir: string): ApprovalState {
  const filePath = path.join(snapshotDir, APPROVAL_FILE);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return { snapshotDir, records: data.records ?? [] };
    } catch {
      return { snapshotDir, records: [] };
    }
  }
  return { snapshotDir, records: [] };
}

/** Save approval state to disk. */
export function saveApprovalState(state: ApprovalState): void {
  const filePath = path.join(state.snapshotDir, APPROVAL_FILE);
  if (!fs.existsSync(state.snapshotDir)) {
    fs.mkdirSync(state.snapshotDir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify({ records: state.records }, null, 2));
}

/** Compute diff between two snapshots. */
export function diffSnapshots(
  current: BehaviorSnapshot | null,
  proposed: BehaviorSnapshot,
): SnapshotFieldDiff[] {
  if (!current) {
    return [{ field: 'snapshot', oldValue: null, newValue: proposed }];
  }

  const diffs: SnapshotFieldDiff[] = [];

  if (JSON.stringify(current.toolsCalled) !== JSON.stringify(proposed.toolsCalled)) {
    diffs.push({ field: 'toolsCalled', oldValue: current.toolsCalled, newValue: proposed.toolsCalled });
  }
  if (JSON.stringify(current.toolCallOrder) !== JSON.stringify(proposed.toolCallOrder)) {
    diffs.push({ field: 'toolCallOrder', oldValue: current.toolCallOrder, newValue: proposed.toolCallOrder });
  }
  if (current.stepCount !== proposed.stepCount) {
    diffs.push({ field: 'stepCount', oldValue: current.stepCount, newValue: proposed.stepCount });
  }

  return diffs;
}

/** Submit a proposed snapshot for review. */
export function submitForReview(
  state: ApprovalState,
  testName: string,
  current: BehaviorSnapshot | null,
  proposed: BehaviorSnapshot,
): SnapshotRecord {
  const diff = diffSnapshots(current, proposed);
  const record: SnapshotRecord = {
    testName,
    status: 'pending',
    current,
    proposed,
    diff,
  };

  // Replace existing record for this test
  const idx = state.records.findIndex(r => r.testName === testName);
  if (idx >= 0) {
    state.records[idx] = record;
  } else {
    state.records.push(record);
  }

  return record;
}

/** Approve a specific snapshot by test name. */
export function approveSnapshot(
  state: ApprovalState,
  testName: string,
  reviewer?: string,
): boolean {
  const record = state.records.find(r => r.testName === testName);
  if (!record || record.status !== 'pending') return false;

  record.status = 'approved';
  record.reviewedAt = new Date().toISOString();
  record.reviewedBy = reviewer;

  // Write the approved snapshot to disk
  const key = testName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const snapFile = path.join(state.snapshotDir, `${key}.snap.json`);
  fs.writeFileSync(snapFile, JSON.stringify(record.proposed, null, 2));

  return true;
}

/** Reject a specific snapshot by test name. */
export function rejectSnapshot(
  state: ApprovalState,
  testName: string,
  reviewer?: string,
): boolean {
  const record = state.records.find(r => r.testName === testName);
  if (!record || record.status !== 'pending') return false;

  record.status = 'rejected';
  record.reviewedAt = new Date().toISOString();
  record.reviewedBy = reviewer;

  return true;
}

/** Get summary of approval state. */
export function getApprovalSummary(state: ApprovalState): ApprovalSummary {
  return {
    total: state.records.length,
    pending: state.records.filter(r => r.status === 'pending').length,
    approved: state.records.filter(r => r.status === 'approved').length,
    rejected: state.records.filter(r => r.status === 'rejected').length,
  };
}

/** Get all pending reviews. */
export function getPendingReviews(state: ApprovalState): SnapshotRecord[] {
  return state.records.filter(r => r.status === 'pending');
}

/** Format approval state for console output. */
export function formatApprovalState(state: ApprovalState): string {
  const summary = getApprovalSummary(state);
  const lines: string[] = [];
  lines.push(`\n📸 Snapshot Approval Status`);
  lines.push(`   Total: ${summary.total} | Pending: ${summary.pending} | Approved: ${summary.approved} | Rejected: ${summary.rejected}`);
  lines.push('');

  for (const record of state.records) {
    const icon = record.status === 'approved' ? '✅' : record.status === 'rejected' ? '❌' : '⏳';
    lines.push(`   ${icon} ${record.testName} [${record.status}]`);
    if (record.diff.length > 0 && record.status === 'pending') {
      for (const d of record.diff) {
        lines.push(`      ~ ${d.field}: ${JSON.stringify(d.oldValue)} → ${JSON.stringify(d.newValue)}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}
