/**
 * Trace Diff — Compare two traces to detect behavioral drift.
 */

import type { AgentTrace } from './types';

export interface TraceDiff {
  stepsOld: number;
  stepsNew: number;
  stepsDelta: number;
  tokensOld: { input: number; output: number };
  tokensNew: { input: number; output: number };
  tokensDeltaPercent: number;
  toolsOld: string[];
  toolsNew: string[];
  toolsAdded: string[];
  toolsRemoved: string[];
  outputOld: string;
  outputNew: string;
  outputChanged: boolean;
  warnings: string[];
}

function getTokens(trace: AgentTrace): { input: number; output: number } {
  return trace.steps.reduce(
    (acc, s) => ({
      input: acc.input + (s.data.tokens?.input ?? 0),
      output: acc.output + (s.data.tokens?.output ?? 0),
    }),
    { input: 0, output: 0 }
  );
}

function getTools(trace: AgentTrace): string[] {
  return [...new Set(
    trace.steps.filter(s => s.type === 'tool_call').map(s => s.data.tool_name!)
  )];
}

function getOutput(trace: AgentTrace): string {
  return trace.steps
    .filter(s => s.type === 'output')
    .map(s => s.data.content ?? '')
    .join('\n')
    .trim();
}

/**
 * Compare two traces and return structured diff.
 */
export function diffTraces(oldTrace: AgentTrace, newTrace: AgentTrace): TraceDiff {
  const tokensOld = getTokens(oldTrace);
  const tokensNew = getTokens(newTrace);
  const totalOld = tokensOld.input + tokensOld.output;
  const totalNew = tokensNew.input + tokensNew.output;
  const tokensDeltaPercent = totalOld > 0 ? Math.round(((totalNew - totalOld) / totalOld) * 100) : 0;

  const toolsOld = getTools(oldTrace);
  const toolsNew = getTools(newTrace);
  const toolsAdded = toolsNew.filter(t => !toolsOld.includes(t));
  const toolsRemoved = toolsOld.filter(t => !toolsNew.includes(t));

  const outputOld = getOutput(oldTrace);
  const outputNew = getOutput(newTrace);

  const warnings: string[] = [];
  if (Math.abs(tokensDeltaPercent) > 50) {
    warnings.push('Token usage changed significantly');
  }
  if (newTrace.steps.length > oldTrace.steps.length * 2) {
    warnings.push('Step count more than doubled');
  }
  if (toolsAdded.length > 0) {
    warnings.push(`New tools used: ${toolsAdded.join(', ')}`);
  }

  return {
    stepsOld: oldTrace.steps.length,
    stepsNew: newTrace.steps.length,
    stepsDelta: newTrace.steps.length - oldTrace.steps.length,
    tokensOld,
    tokensNew,
    tokensDeltaPercent,
    toolsOld,
    toolsNew,
    toolsAdded,
    toolsRemoved,
    outputOld,
    outputNew,
    outputChanged: outputOld !== outputNew,
    warnings,
  };
}

/**
 * Format a trace diff for terminal display.
 */
export function formatDiff(diff: TraceDiff): string {
  const lines: string[] = [];

  const sign = (n: number) => n > 0 ? `+${n}` : String(n);

  lines.push(`  Steps:   ${diff.stepsOld} → ${diff.stepsNew} (${sign(diff.stepsDelta)})`);
  lines.push(`  Tokens:  ${diff.tokensOld.input + diff.tokensOld.output} → ${diff.tokensNew.input + diff.tokensNew.output} (${sign(diff.tokensDeltaPercent)}%)`);
  lines.push(`  Tools:   [${diff.toolsOld.join(', ')}] → [${diff.toolsNew.join(', ')}]`);

  if (diff.toolsAdded.length > 0) {
    for (const t of diff.toolsAdded) lines.push(`  + New tool: ${t}`);
  }
  if (diff.toolsRemoved.length > 0) {
    for (const t of diff.toolsRemoved) lines.push(`  - Removed tool: ${t}`);
  }

  if (diff.outputChanged) {
    const oldSnip = diff.outputOld.slice(0, 60);
    const newSnip = diff.outputNew.slice(0, 60);
    lines.push(`  ~ Output changed: "${oldSnip}" → "${newSnip}"`);
  }

  for (const w of diff.warnings) {
    lines.push(`  ⚠ ${w}`);
  }

  return lines.join('\n');
}
