/**
 * Trace Comparison — Compare two traces side-by-side with detailed diffs.
 */

import chalk from 'chalk';
import type { AgentTrace } from './types';
import { calculateCost } from './cost';

export interface TraceComparison {
  // Steps
  stepsA: number;
  stepsB: number;
  stepsDiff: number;

  // Step type breakdown
  stepTypesA: Record<string, number>;
  stepTypesB: Record<string, number>;

  // Tool usage
  toolsA: string[];
  toolsB: string[];
  toolsOnlyA: string[];
  toolsOnlyB: string[];
  toolsCommon: string[];

  // Tool call counts
  toolCountsA: Record<string, number>;
  toolCountsB: Record<string, number>;

  // Tokens
  tokensA: { input: number; output: number; total: number };
  tokensB: { input: number; output: number; total: number };
  tokensDiffPercent: number;

  // Cost
  costA: number;
  costB: number;
  costDiffPercent: number;

  // Duration
  durationA: number;
  durationB: number;
  durationDiffPercent: number;

  // Output
  outputA: string;
  outputB: string;
  outputMatch: boolean;

  // Models
  modelsA: string[];
  modelsB: string[];
}

function countStepTypes(trace: AgentTrace): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const step of trace.steps) {
    counts[step.type] = (counts[step.type] ?? 0) + 1;
  }
  return counts;
}

function getToolCounts(trace: AgentTrace): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const step of trace.steps) {
    if (step.type === 'tool_call' && step.data.tool_name) {
      counts[step.data.tool_name] = (counts[step.data.tool_name] ?? 0) + 1;
    }
  }
  return counts;
}

function getTokens(trace: AgentTrace): { input: number; output: number; total: number } {
  let input = 0;
  let output = 0;
  for (const step of trace.steps) {
    input += step.data.tokens?.input ?? 0;
    output += step.data.tokens?.output ?? 0;
  }
  return { input, output, total: input + output };
}

function getOutput(trace: AgentTrace): string {
  return trace.steps
    .filter((s) => s.type === 'output')
    .map((s) => s.data.content ?? '')
    .join('\n')
    .trim();
}

function getModels(trace: AgentTrace): string[] {
  return [...new Set(trace.steps.filter((s) => s.data.model).map((s) => s.data.model!))];
}

function getTotalDuration(trace: AgentTrace): number {
  return trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
}

function pctDiff(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100;
  return Math.round(((b - a) / a) * 100);
}

/**
 * Compare two traces and return a structured comparison.
 */
export function compareTraces(traceA: AgentTrace, traceB: AgentTrace): TraceComparison {
  const toolCountsA = getToolCounts(traceA);
  const toolCountsB = getToolCounts(traceB);
  const toolsA = Object.keys(toolCountsA);
  const toolsB = Object.keys(toolCountsB);

  const tokensA = getTokens(traceA);
  const tokensB = getTokens(traceB);

  const costA = calculateCost(traceA).total_cost;
  const costB = calculateCost(traceB).total_cost;

  const durationA = getTotalDuration(traceA);
  const durationB = getTotalDuration(traceB);

  const outputA = getOutput(traceA);
  const outputB = getOutput(traceB);

  return {
    stepsA: traceA.steps.length,
    stepsB: traceB.steps.length,
    stepsDiff: traceB.steps.length - traceA.steps.length,
    stepTypesA: countStepTypes(traceA),
    stepTypesB: countStepTypes(traceB),
    toolsA,
    toolsB,
    toolsOnlyA: toolsA.filter((t) => !toolsB.includes(t)),
    toolsOnlyB: toolsB.filter((t) => !toolsA.includes(t)),
    toolsCommon: toolsA.filter((t) => toolsB.includes(t)),
    toolCountsA,
    toolCountsB,
    tokensA,
    tokensB,
    tokensDiffPercent: pctDiff(tokensA.total, tokensB.total),
    costA,
    costB,
    costDiffPercent: pctDiff(costA, costB),
    durationA,
    durationB,
    durationDiffPercent: pctDiff(durationA, durationB),
    outputA,
    outputB,
    outputMatch: outputA === outputB,
    modelsA: getModels(traceA),
    modelsB: getModels(traceB),
  };
}

/**
 * Format a trace comparison for terminal display.
 */
export function formatComparison(cmp: TraceComparison): string {
  const lines: string[] = [];
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const signPct = (n: number) => (n > 0 ? chalk.red(`+${n}%`) : n < 0 ? chalk.green(`${n}%`) : chalk.gray('0%'));

  lines.push(chalk.bold('\n  📊 Trace Comparison\n'));

  // Steps
  lines.push(chalk.bold('  Steps'));
  lines.push(`    Total:    ${cmp.stepsA} → ${cmp.stepsB} (${sign(cmp.stepsDiff)})`);
  const allTypes = new Set([...Object.keys(cmp.stepTypesA), ...Object.keys(cmp.stepTypesB)]);
  for (const type of allTypes) {
    const a = cmp.stepTypesA[type] ?? 0;
    const b = cmp.stepTypesB[type] ?? 0;
    if (a !== b) {
      lines.push(`    ${type}: ${a} → ${b} (${sign(b - a)})`);
    }
  }

  // Tools
  lines.push('');
  lines.push(chalk.bold('  Tools'));
  for (const tool of cmp.toolsCommon) {
    const a = cmp.toolCountsA[tool] ?? 0;
    const b = cmp.toolCountsB[tool] ?? 0;
    const diff = a === b ? '' : ` (${sign(b - a)})`;
    lines.push(`    ${tool}: ${a} → ${b}${diff}`);
  }
  for (const tool of cmp.toolsOnlyA) {
    lines.push(chalk.red(`    - ${tool}: ${cmp.toolCountsA[tool]} → 0 (removed)`));
  }
  for (const tool of cmp.toolsOnlyB) {
    lines.push(chalk.green(`    + ${tool}: 0 → ${cmp.toolCountsB[tool]} (added)`));
  }

  // Tokens
  lines.push('');
  lines.push(chalk.bold('  Tokens'));
  lines.push(`    Input:  ${cmp.tokensA.input} → ${cmp.tokensB.input}`);
  lines.push(`    Output: ${cmp.tokensA.output} → ${cmp.tokensB.output}`);
  lines.push(`    Total:  ${cmp.tokensA.total} → ${cmp.tokensB.total} ${signPct(cmp.tokensDiffPercent)}`);

  // Cost
  lines.push('');
  lines.push(chalk.bold('  Cost'));
  lines.push(`    $${cmp.costA.toFixed(4)} → $${cmp.costB.toFixed(4)} ${signPct(cmp.costDiffPercent)}`);

  // Duration
  lines.push('');
  lines.push(chalk.bold('  Duration'));
  lines.push(`    ${cmp.durationA}ms → ${cmp.durationB}ms ${signPct(cmp.durationDiffPercent)}`);

  // Models
  if (cmp.modelsA.join(',') !== cmp.modelsB.join(',')) {
    lines.push('');
    lines.push(chalk.bold('  Models'));
    lines.push(`    [${cmp.modelsA.join(', ')}] → [${cmp.modelsB.join(', ')}]`);
  }

  // Output
  lines.push('');
  lines.push(chalk.bold('  Output'));
  if (cmp.outputMatch) {
    lines.push(chalk.green('    ✓ Identical'));
  } else {
    lines.push(chalk.yellow('    ✗ Different'));
    if (cmp.outputA) lines.push(chalk.red(`    A: "${cmp.outputA.slice(0, 80)}"`));
    if (cmp.outputB) lines.push(chalk.green(`    B: "${cmp.outputB.slice(0, 80)}"`));
  }

  lines.push('');
  return lines.join('\n');
}
