/**
 * Snapshot Testing - Like Jest snapshots for agent behavior
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace } from './types';

export interface SnapshotConfig {
  updateSnapshots: boolean;
  snapshotDir: string;
}

export interface BehaviorSnapshot {
  toolsCalled: string[];
  toolCallOrder: string[];
  hasOutput: boolean;
  stepCount: number;
  stepTypes: string[];
}

/**
 * Extract a behavior snapshot from a trace (structural, not exact content).
 */
export function extractSnapshot(trace: AgentTrace): BehaviorSnapshot {
  const toolCalls = trace.steps.filter((s) => s.type === 'tool_call').map((s) => s.data.tool_name!);

  return {
    toolsCalled: [...new Set(toolCalls)].sort(),
    toolCallOrder: toolCalls,
    hasOutput: trace.steps.some((s) => s.type === 'output'),
    stepCount: trace.steps.length,
    stepTypes: trace.steps.map((s) => s.type),
  };
}

function snapshotKey(testName: string): string {
  return testName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Compare or update a snapshot. Returns { match, diff? }.
 */
export function matchSnapshot(
  trace: AgentTrace,
  testName: string,
  config: SnapshotConfig,
): { match: boolean; diff?: string; created?: boolean; updated?: boolean } {
  const snap = extractSnapshot(trace);
  const key = snapshotKey(testName);
  const snapFile = path.join(config.snapshotDir, `${key}.snap.json`);

  if (!fs.existsSync(config.snapshotDir)) {
    fs.mkdirSync(config.snapshotDir, { recursive: true });
  }

  if (!fs.existsSync(snapFile) || config.updateSnapshots) {
    fs.writeFileSync(snapFile, JSON.stringify(snap, null, 2));
    return { match: true, created: !fs.existsSync(snapFile), updated: config.updateSnapshots };
  }

  const existing: BehaviorSnapshot = JSON.parse(fs.readFileSync(snapFile, 'utf-8'));
  const diffs: string[] = [];

  // Compare tools called (set)
  if (JSON.stringify(existing.toolsCalled) !== JSON.stringify(snap.toolsCalled)) {
    diffs.push(`Tools called: expected [${existing.toolsCalled}], got [${snap.toolsCalled}]`);
  }

  // Compare tool order
  if (JSON.stringify(existing.toolCallOrder) !== JSON.stringify(snap.toolCallOrder)) {
    diffs.push(`Tool order: expected [${existing.toolCallOrder}], got [${snap.toolCallOrder}]`);
  }

  // Compare step count (allow ±20% range)
  const minSteps = Math.floor(existing.stepCount * 0.8);
  const maxSteps = Math.ceil(existing.stepCount * 1.2);
  if (snap.stepCount < minSteps || snap.stepCount > maxSteps) {
    diffs.push(`Step count: expected ~${existing.stepCount} (±20%), got ${snap.stepCount}`);
  }

  // Compare output presence
  if (existing.hasOutput !== snap.hasOutput) {
    diffs.push(`Output: expected ${existing.hasOutput}, got ${snap.hasOutput}`);
  }

  if (diffs.length > 0) {
    return { match: false, diff: diffs.join('\n') };
  }

  return { match: true };
}
