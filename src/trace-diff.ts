/**
 * Trace Diff — Compare two traces side-by-side.
 *
 * Useful for identifying behavioral regressions between agent versions,
 * or understanding how changes to prompts/tools affect agent behavior.
 */

import type { AgentTrace, TraceStep } from './types';

export interface TraceDiffChange {
  type: 'added' | 'removed' | 'modified';
  index: number;
  stepA?: TraceStep;
  stepB?: TraceStep;
  details?: string;
}

export interface TraceDiffSummary {
  stepsA: number;
  stepsB: number;
  added: number;
  removed: number;
  modified: number;
  toolSequenceChanged: boolean;
}

export interface TraceDiffResult {
  identical: boolean;
  changes: TraceDiffChange[];
  summary: TraceDiffSummary;
}

function stepsEqual(a: TraceStep, b: TraceStep): boolean {
  if (a.type !== b.type) return false;
  if (a.data.tool_name !== b.data.tool_name) return false;
  if (a.data.model !== b.data.model) return false;
  if (a.data.content !== b.data.content) return false;
  if (JSON.stringify(a.data.tool_args) !== JSON.stringify(b.data.tool_args)) return false;
  return true;
}

function getToolSequence(trace: AgentTrace): string[] {
  return trace.steps
    .filter((s) => s.type === 'tool_call')
    .map((s) => s.data.tool_name!)
    .filter(Boolean);
}

/**
 * Compare two traces and produce a diff.
 */
export function diffTraces(a: AgentTrace, b: AgentTrace): TraceDiffResult {
  const changes: TraceDiffChange[] = [];
  const maxLen = Math.max(a.steps.length, b.steps.length);

  for (let i = 0; i < maxLen; i++) {
    const stepA = a.steps[i];
    const stepB = b.steps[i];

    if (!stepA && stepB) {
      changes.push({
        type: 'added',
        index: i,
        stepB,
        details: `Added step: ${stepB.type}${stepB.data.tool_name ? ` (${stepB.data.tool_name})` : ''}`,
      });
    } else if (stepA && !stepB) {
      changes.push({
        type: 'removed',
        index: i,
        stepA,
        details: `Removed step: ${stepA.type}${stepA.data.tool_name ? ` (${stepA.data.tool_name})` : ''}`,
      });
    } else if (stepA && stepB && !stepsEqual(stepA, stepB)) {
      changes.push({
        type: 'modified',
        index: i,
        stepA,
        stepB,
        details: `Modified step ${i}: ${stepA.type} → ${stepB.type}`,
      });
    }
  }

  const seqA = getToolSequence(a);
  const seqB = getToolSequence(b);
  const toolSequenceChanged = JSON.stringify(seqA) !== JSON.stringify(seqB);

  return {
    identical: changes.length === 0,
    changes,
    summary: {
      stepsA: a.steps.length,
      stepsB: b.steps.length,
      added: changes.filter((c) => c.type === 'added').length,
      removed: changes.filter((c) => c.type === 'removed').length,
      modified: changes.filter((c) => c.type === 'modified').length,
      toolSequenceChanged,
    },
  };
}
