/**
 * Agent Diff Report — Compare two versions of an agent based on traces.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace } from './types';

export interface AgentVersion {
  traces: AgentTrace[];
  tools: Set<string>;
  avgSteps: number;
  avgCost: number;
  avgDuration: number;
}

export interface AgentDiff {
  addedTools: string[];
  removedTools: string[];
  unchangedTools: string[];
  stepsChange: { v1: number; v2: number; pct: number };
  costChange: { v1: number; v2: number; pct: number };
  durationChange: { v1: number; v2: number; pct: number };
  qualityEstimate: { v1: number; v2: number; pct: number };
  newBehaviors: string[];
  lostBehaviors: string[];
}

/**
 * Load traces from a directory.
 */
export function loadTraces(dir: string): AgentTrace[] {
  if (!fs.existsSync(dir)) return [];
  const traces: AgentTrace[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.json')) {
      try {
        traces.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')));
      } catch { /* skip */ }
    }
  }
  return traces;
}

/**
 * Analyze a set of traces into an AgentVersion summary.
 */
export function analyzeVersion(traces: AgentTrace[]): AgentVersion {
  const tools = new Set<string>();
  let totalSteps = 0;
  let totalCost = 0;
  let totalDuration = 0;

  for (const trace of traces) {
    totalSteps += trace.steps.length;
    for (const step of trace.steps) {
      if (step.type === 'tool_call' && step.data.tool_name) {
        tools.add(step.data.tool_name);
      }
      totalDuration += step.duration_ms ?? 0;
      if (step.data.tokens) {
        const input = step.data.tokens.input ?? 0;
        const output = step.data.tokens.output ?? 0;
        totalCost += (input * 0.000003 + output * 0.000006); // rough estimate
      }
    }
  }

  const n = traces.length || 1;
  return {
    traces,
    tools,
    avgSteps: totalSteps / n,
    avgCost: totalCost / n,
    avgDuration: totalDuration / n,
  };
}

/**
 * Compute diff between two agent versions.
 */
export function diffVersions(v1: AgentVersion, v2: AgentVersion): AgentDiff {
  const addedTools = [...v2.tools].filter((t) => !v1.tools.has(t));
  const removedTools = [...v1.tools].filter((t) => !v2.tools.has(t));
  const unchangedTools = [...v1.tools].filter((t) => v2.tools.has(t));

  const pct = (a: number, b: number) => (a === 0 ? (b === 0 ? 0 : 100) : ((b - a) / a) * 100);

  // Quality estimate: based on fewer steps (efficiency) and presence of output steps
  const v1OutputRatio = v1.traces.length > 0
    ? v1.traces.reduce((s, t) => s + t.steps.filter((st) => st.type === 'output').length, 0) / v1.traces.length
    : 0;
  const v2OutputRatio = v2.traces.length > 0
    ? v2.traces.reduce((s, t) => s + t.steps.filter((st) => st.type === 'output').length, 0) / v2.traces.length
    : 0;
  const v1Quality = Math.min(100, Math.round(70 + v1OutputRatio * 10 - v1.avgSteps * 0.5));
  const v2Quality = Math.min(100, Math.round(70 + v2OutputRatio * 10 - v2.avgSteps * 0.5));

  // Detect behaviors
  const newBehaviors: string[] = [];
  const lostBehaviors: string[] = [];
  for (const tool of addedTools) {
    newBehaviors.push(`Uses ${tool}`);
  }
  for (const tool of removedTools) {
    lostBehaviors.push(`No longer uses ${tool}`);
  }
  if (v2.avgSteps < v1.avgSteps * 0.9) {
    newBehaviors.push('More efficient execution (fewer steps)');
  }
  if (v2.avgCost < v1.avgCost * 0.9) {
    newBehaviors.push('Lower cost per execution');
  }
  if (v2.avgSteps > v1.avgSteps * 1.1) {
    lostBehaviors.push('Less efficient (more steps)');
  }

  return {
    addedTools,
    removedTools,
    unchangedTools,
    stepsChange: { v1: v1.avgSteps, v2: v2.avgSteps, pct: pct(v1.avgSteps, v2.avgSteps) },
    costChange: { v1: v1.avgCost, v2: v2.avgCost, pct: pct(v1.avgCost, v2.avgCost) },
    durationChange: { v1: v1.avgDuration, v2: v2.avgDuration, pct: pct(v1.avgDuration, v2.avgDuration) },
    qualityEstimate: { v1: v1Quality, v2: v2Quality, pct: pct(v1Quality, v2Quality) },
    newBehaviors,
    lostBehaviors,
  };
}

/**
 * Compare two sets of traces directly.
 */
export function compareTraces(v1Traces: AgentTrace[], v2Traces: AgentTrace[]): AgentDiff {
  return diffVersions(analyzeVersion(v1Traces), analyzeVersion(v2Traces));
}

/**
 * Format the diff report.
 */
export function formatAgentDiff(diff: AgentDiff): string {
  const lines: string[] = ['', '📊 Agent Behavior Diff: v1 → v2', ''];

  // Tools
  const toolParts: string[] = [];
  for (const t of diff.addedTools) toolParts.push(`+${t} (new)`);
  for (const t of diff.removedTools) toolParts.push(`-${t} (removed)`);
  if (toolParts.length > 0) {
    lines.push(`  Tools: ${toolParts.join(', ')}`);
  } else {
    lines.push(`  Tools: no changes (${diff.unchangedTools.length} tools)`);
  }

  // Metrics
  const fmtPct = (p: number) => (p >= 0 ? `+${p.toFixed(0)}%` : `${p.toFixed(0)}%`);
  lines.push(`  Avg steps: ${diff.stepsChange.v1.toFixed(1)} → ${diff.stepsChange.v2.toFixed(1)} (${fmtPct(diff.stepsChange.pct)})`);
  lines.push(`  Cost: $${diff.costChange.v1.toFixed(4)} → $${diff.costChange.v2.toFixed(4)} (${fmtPct(diff.costChange.pct)})`);
  lines.push(`  Quality: ${diff.qualityEstimate.v1}% → ${diff.qualityEstimate.v2}% (${fmtPct(diff.qualityEstimate.pct)})`);

  if (diff.newBehaviors.length > 0) {
    lines.push(`  New behaviors: ${diff.newBehaviors.join('; ')}`);
  }
  if (diff.lostBehaviors.length > 0) {
    lines.push(`  Lost behaviors: ${diff.lostBehaviors.join('; ')}`);
  }

  lines.push('');
  return lines.join('\n');
}
