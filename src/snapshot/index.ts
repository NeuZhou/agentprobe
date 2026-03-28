/**
 * Snapshot barrel — re-exports all snapshot-related modules.
 *
 * `snapshot.ts` (v4.9.0 Enhanced) is the primary module and is re-exported in full.
 * The other modules export additional utilities that supplement it; only their
 * non-colliding exports are re-exported here.
 */

// Primary snapshot module — everything
export * from '../snapshot';

// snapshots.ts duplicates SnapshotConfig, BehaviorSnapshot, extractSnapshot,
// matchSnapshot which already come from snapshot.ts — skip it entirely.

// snapshot-approval.ts — unique exports only (SnapshotFieldDiff collides)
export type { SnapshotStatus, SnapshotRecord, ApprovalState, ApprovalSummary } from '../snapshot-approval';
export {
  loadApprovalState,
  saveApprovalState,
  diffSnapshots,
  submitForReview,
  approveSnapshot,
  rejectSnapshot,
  getApprovalSummary,
  getPendingReviews,
  formatApprovalState,
} from '../snapshot-approval';

// snapshot-update.ts — unique exports only (SnapshotDiff collides)
export type { SnapshotUpdatePlan, SnapshotFileUpdate } from '../snapshot-update';
export {
  planSnapshotUpdate,
  formatUpdatePlan,
  applySnapshotUpdate,
  hasOutdatedSnapshots,
} from '../snapshot-update';
