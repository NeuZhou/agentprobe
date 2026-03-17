/**
 * Snapshot Testing — v4.9.0 Enhanced
 *
 * Full snapshot manager with capture, compare, update, and diff.
 * Snapshots stored in __snapshots__/ as JSON.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace, TraceStep } from './types';

// ===== Types =====

export interface AgentResponse {
  output: string;
  toolCalls: Array<{ name: string; args?: Record<string, any>; result?: any }>;
  steps: TraceStep[];
  metadata?: Record<string, any>;
}

export interface SnapshotData {
  testId: string;
  timestamp: string;
  toolsCalled: string[];
  toolCallOrder: string[];
  outputHash: string;
  stepCount: number;
  stepTypes: string[];
  hasOutput: boolean;
}

export interface SnapshotFieldDiff {
  field: string;
  expected: any;
  actual: any;
}

export interface SnapshotDiff {
  testId: string;
  match: boolean;
  addedTools: string[];
  removedTools: string[];
  changedResponses: SnapshotFieldDiff[];
  newBehaviors: string[];
}

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

// ===== SnapshotManager =====

export class SnapshotManager {
  private snapshotDir: string;

  constructor(snapshotDir: string = '__snapshots__') {
    this.snapshotDir = snapshotDir;
    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  private _path(testId: string): string {
    const key = testId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.snapshotDir, `${key}.snap.json`);
  }

  private _responseToData(testId: string, response: AgentResponse): SnapshotData {
    return {
      testId,
      timestamp: new Date().toISOString(),
      toolsCalled: [...new Set(response.toolCalls.map(t => t.name))].sort(),
      toolCallOrder: response.toolCalls.map(t => t.name),
      outputHash: simpleHash(response.output),
      stepCount: response.steps.length,
      stepTypes: response.steps.map(s => s.type),
      hasOutput: response.output.length > 0,
    };
  }

  capture(testId: string, response: AgentResponse): void {
    const data = this._responseToData(testId, response);
    fs.writeFileSync(this._path(testId), JSON.stringify(data, null, 2));
  }

  compare(testId: string, response: AgentResponse): SnapshotDiff {
    const snapFile = this._path(testId);
    const current = this._responseToData(testId, response);

    if (!fs.existsSync(snapFile)) {
      return {
        testId,
        match: false,
        addedTools: current.toolsCalled,
        removedTools: [],
        changedResponses: [],
        newBehaviors: ['snapshot_not_found'],
      };
    }

    const existing: SnapshotData = JSON.parse(fs.readFileSync(snapFile, 'utf-8'));
    const addedTools = current.toolsCalled.filter(t => !existing.toolsCalled.includes(t));
    const removedTools = existing.toolsCalled.filter(t => !current.toolsCalled.includes(t));
    const changedResponses: SnapshotFieldDiff[] = [];
    const newBehaviors: string[] = [];

    if (existing.outputHash !== current.outputHash) {
      changedResponses.push({ field: 'output', expected: existing.outputHash, actual: current.outputHash });
    }
    if (JSON.stringify(existing.toolCallOrder) !== JSON.stringify(current.toolCallOrder)) {
      changedResponses.push({ field: 'toolCallOrder', expected: existing.toolCallOrder, actual: current.toolCallOrder });
    }

    const minSteps = Math.floor(existing.stepCount * 0.8);
    const maxSteps = Math.ceil(existing.stepCount * 1.2);
    if (current.stepCount < minSteps || current.stepCount > maxSteps) {
      newBehaviors.push(`step_count_changed: ${existing.stepCount} → ${current.stepCount}`);
    }

    if (JSON.stringify(existing.stepTypes) !== JSON.stringify(current.stepTypes)) {
      newBehaviors.push('step_types_changed');
    }

    const match = addedTools.length === 0 && removedTools.length === 0 &&
      changedResponses.length === 0 && newBehaviors.length === 0;

    return { testId, match, addedTools, removedTools, changedResponses, newBehaviors };
  }

  update(testId: string): void {
    // Reads current snap and re-timestamps it (or called after capture to accept new baseline)
    const snapFile = this._path(testId);
    if (fs.existsSync(snapFile)) {
      const data = JSON.parse(fs.readFileSync(snapFile, 'utf-8'));
      data.timestamp = new Date().toISOString();
      fs.writeFileSync(snapFile, JSON.stringify(data, null, 2));
    }
  }

  exists(testId: string): boolean {
    return fs.existsSync(this._path(testId));
  }

  delete(testId: string): boolean {
    const p = this._path(testId);
    if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
    return false;
  }

  list(): string[] {
    if (!fs.existsSync(this.snapshotDir)) return [];
    return fs.readdirSync(this.snapshotDir)
      .filter(f => f.endsWith('.snap.json'))
      .map(f => f.replace('.snap.json', ''));
  }

  formatDiff(diff: SnapshotDiff): string {
    if (diff.match) return `✅ ${diff.testId}: snapshot matches`;
    const lines = [`❌ ${diff.testId}: snapshot mismatch`];
    if (diff.addedTools.length) lines.push(`  + Added tools: ${diff.addedTools.join(', ')}`);
    if (diff.removedTools.length) lines.push(`  - Removed tools: ${diff.removedTools.join(', ')}`);
    for (const c of diff.changedResponses) lines.push(`  ~ ${c.field}: ${c.expected} → ${c.actual}`);
    for (const b of diff.newBehaviors) lines.push(`  ⚡ ${b}`);
    return lines.join('\n');
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return 'h' + Math.abs(hash).toString(36);
}

// ===== Trace-level Diff Engine (v5.0) =====

export interface StepDiff {
  kind: 'added' | 'removed' | 'changed';
  index: number;
  expected?: TraceStep;
  actual?: TraceStep;
  changes?: FieldChange[];
}

export interface FieldChange {
  field: string;
  expected: any;
  actual: any;
}

export interface TraceDiffResult {
  identical: boolean;
  stepDiffs: StepDiff[];
  metadataChanges: FieldChange[];
  summary: { added: number; removed: number; changed: number };
}

export interface DiffOptions {
  /** Field paths to ignore during comparison (e.g. 'duration_ms', 'data.tokens'). */
  ignorePatterns?: string[];
}

const DEFAULT_IGNORE = ['duration_ms', 'data.tokens', 'timestamp'];

function deepEqual(a: any, b: any, currentPath = '', ignore: Set<string> = new Set()): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i], `${currentPath}[${i}]`, ignore));
  }

  const keysA = Object.keys(a).filter(k => !ignore.has(currentPath ? `${currentPath}.${k}` : k));
  const keysB = Object.keys(b).filter(k => !ignore.has(currentPath ? `${currentPath}.${k}` : k));
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => {
    const p = currentPath ? `${currentPath}.${k}` : k;
    return deepEqual(a[k], b[k], p, ignore);
  });
}

function fieldChanges(expected: Record<string, any>, actual: Record<string, any>, ignore: Set<string>, prefix = ''): FieldChange[] {
  const changes: FieldChange[] = [];
  const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of allKeys) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (ignore.has(p)) continue;
    if (!deepEqual(expected[key], actual[key], p, ignore)) {
      changes.push({ field: p, expected: expected[key], actual: actual[key] });
    }
  }
  return changes;
}

/**
 * Deep diff two traces step-by-step, producing structured results
 * that highlight added/removed/changed steps and metadata changes.
 */
export function diffTraceSnapshots(
  expected: AgentTrace,
  actual: AgentTrace,
  options: DiffOptions = {},
): TraceDiffResult {
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignorePatterns ?? [])]);
  const stepDiffs: StepDiff[] = [];
  const maxLen = Math.max(expected.steps.length, actual.steps.length);

  for (let i = 0; i < maxLen; i++) {
    const exp = expected.steps[i];
    const act = actual.steps[i];

    if (!exp) {
      stepDiffs.push({ kind: 'added', index: i, actual: act });
    } else if (!act) {
      stepDiffs.push({ kind: 'removed', index: i, expected: exp });
    } else {
      const changes = fieldChanges(
        { type: exp.type, ...exp.data },
        { type: act.type, ...act.data },
        ignore,
      );
      if (changes.length > 0) {
        stepDiffs.push({ kind: 'changed', index: i, expected: exp, actual: act, changes });
      }
    }
  }

  const metadataChanges = fieldChanges(expected.metadata, actual.metadata, ignore);

  return {
    identical: stepDiffs.length === 0 && metadataChanges.length === 0,
    stepDiffs,
    metadataChanges,
    summary: {
      added: stepDiffs.filter(d => d.kind === 'added').length,
      removed: stepDiffs.filter(d => d.kind === 'removed').length,
      changed: stepDiffs.filter(d => d.kind === 'changed').length,
    },
  };
}

// ===== Snapshot Reporter =====

function stepSummary(step: { type: string; data: Record<string, any> }): string {
  if (step.data.tool_name) return step.data.tool_name as string;
  if (step.data.content) return (step.data.content as string).slice(0, 60);
  return JSON.stringify(step.data).slice(0, 60);
}

export function formatTraceDiff(diff: TraceDiffResult, name: string): string {
  if (diff.identical) return `✅ Snapshot "${name}" matches`;

  const lines: string[] = [];
  lines.push(`❌ Snapshot "${name}" does not match`);
  lines.push('');

  const { added, removed, changed } = diff.summary;
  lines.push(`  +${added} added  -${removed} removed  ~${changed} changed`);
  lines.push('');

  for (const sd of diff.stepDiffs) {
    switch (sd.kind) {
      case 'added':
        lines.push(`  + [${sd.index}] ${sd.actual!.type}: ${stepSummary(sd.actual!)}`);
        break;
      case 'removed':
        lines.push(`  - [${sd.index}] ${sd.expected!.type}: ${stepSummary(sd.expected!)}`);
        break;
      case 'changed':
        lines.push(`  ~ [${sd.index}] ${sd.expected!.type}:`);
        for (const c of sd.changes ?? []) {
          lines.push(`      ${c.field}: ${JSON.stringify(c.expected)} → ${JSON.stringify(c.actual)}`);
        }
        break;
    }
  }

  if (diff.metadataChanges.length > 0) {
    lines.push('  metadata:');
    for (const c of diff.metadataChanges) {
      lines.push(`      ${c.field}: ${JSON.stringify(c.expected)} → ${JSON.stringify(c.actual)}`);
    }
  }

  return lines.join('\n');
}

export function formatSnapshotDetail(data: SnapshotData): string {
  const lines: string[] = [];
  lines.push(`Snapshot: ${data.testId}`);
  lines.push(`  Captured: ${data.timestamp}`);
  lines.push(`  Steps: ${data.stepCount}`);
  lines.push(`  Tools: ${data.toolsCalled.join(', ') || '(none)'}`);
  lines.push(`  Output hash: ${data.outputHash}`);
  return lines.join('\n');
}

// ===== Legacy functions (backward compatible) =====

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

  if (JSON.stringify(existing.toolsCalled) !== JSON.stringify(snap.toolsCalled)) {
    diffs.push(`Tools called: expected [${existing.toolsCalled}], got [${snap.toolsCalled}]`);
  }
  if (JSON.stringify(existing.toolCallOrder) !== JSON.stringify(snap.toolCallOrder)) {
    diffs.push(`Tool order: expected [${existing.toolCallOrder}], got [${snap.toolCallOrder}]`);
  }
  const minSteps = Math.floor(existing.stepCount * 0.8);
  const maxSteps = Math.ceil(existing.stepCount * 1.2);
  if (snap.stepCount < minSteps || snap.stepCount > maxSteps) {
    diffs.push(`Step count: expected ~${existing.stepCount} (±20%), got ${snap.stepCount}`);
  }
  if (existing.hasOutput !== snap.hasOutput) {
    diffs.push(`Output: expected ${existing.hasOutput}, got ${snap.hasOutput}`);
  }

  if (diffs.length > 0) {
    return { match: false, diff: diffs.join('\n') };
  }
  return { match: true };
}
