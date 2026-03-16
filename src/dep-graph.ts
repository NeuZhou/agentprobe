/**
 * Agent Dependency Graph - Map and visualize agent tool/sub-agent dependencies from traces.
 *
 * @example
 * ```bash
 * agentprobe deps trace.json
 * agentprobe deps traces/ --format mermaid
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace } from './types';

// ===== Types =====

export interface ToolDependency {
  name: string;
  type: 'tool' | 'sub-agent';
  required: boolean;       // appears in >50% of traces
  avgCallsPerTrace: number;
  totalCalls: number;
  errorRate: number;
  avgLatencyMs: number;
  conditional: boolean;    // appears in <50% of traces
}

export interface DependencyNode {
  agentName: string;
  dependencies: ToolDependency[];
  traceCount: number;
  avgStepsPerTrace: number;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: Array<{ from: string; to: string; weight: number }>;
}

// ===== Core Functions =====

/**
 * Analyze a single trace to extract tool call info.
 */
export function analyzeTrace(trace: AgentTrace): Map<string, { calls: number; errors: number; totalMs: number }> {
  const toolStats = new Map<string, { calls: number; errors: number; totalMs: number }>();

  for (const step of trace.steps) {
    if (step.type === 'tool_call' && step.data.tool_name) {
      const name = step.data.tool_name;
      const existing = toolStats.get(name) || { calls: 0, errors: 0, totalMs: 0 };
      existing.calls++;
      existing.totalMs += step.duration_ms || 0;
      toolStats.set(name, existing);
    }
    if (step.type === 'tool_result' && step.data.tool_name) {
      const name = step.data.tool_name;
      const existing = toolStats.get(name) || { calls: 0, errors: 0, totalMs: 0 };
      if (step.data.tool_result?.error) {
        existing.errors++;
      }
      toolStats.set(name, existing);
    }
  }

  return toolStats;
}

/**
 * Build a dependency graph from multiple traces.
 */
export function buildDependencyGraph(traces: AgentTrace[], agentName?: string): DependencyNode {
  const toolAgg = new Map<string, { traceCount: number; totalCalls: number; errors: number; totalMs: number }>();
  let totalSteps = 0;

  for (const trace of traces) {
    const stats = analyzeTrace(trace);
    totalSteps += trace.steps.length;

    for (const [tool, info] of stats) {
      const agg = toolAgg.get(tool) || { traceCount: 0, totalCalls: 0, errors: 0, totalMs: 0 };
      agg.traceCount++;
      agg.totalCalls += info.calls;
      agg.errors += info.errors;
      agg.totalMs += info.totalMs;
      toolAgg.set(tool, agg);
    }
  }

  const traceCount = traces.length || 1;
  const dependencies: ToolDependency[] = [];

  for (const [name, agg] of toolAgg) {
    const frequency = agg.traceCount / traceCount;
    const isSubAgent = name.includes('agent') || name.includes('delegate') || name.includes('escalat');

    dependencies.push({
      name,
      type: isSubAgent ? 'sub-agent' : 'tool',
      required: frequency > 0.5,
      avgCallsPerTrace: agg.totalCalls / traceCount,
      totalCalls: agg.totalCalls,
      errorRate: agg.totalCalls > 0 ? agg.errors / agg.totalCalls : 0,
      avgLatencyMs: agg.totalCalls > 0 ? agg.totalMs / agg.totalCalls : 0,
      conditional: frequency < 0.5,
    });
  }

  // Sort: required first, then by frequency
  dependencies.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return b.avgCallsPerTrace - a.avgCallsPerTrace;
  });

  const resolvedName = agentName || traces[0]?.metadata?.agent || 'unknown-agent';

  return {
    agentName: resolvedName,
    dependencies,
    traceCount,
    avgStepsPerTrace: totalSteps / traceCount,
  };
}

/**
 * Load traces from a file or directory.
 */
export function loadTraces(inputPath: string): AgentTrace[] {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) {
    const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    return Array.isArray(data) ? data : [data];
  }
  if (stat.isDirectory()) {
    const files = fs.readdirSync(inputPath).filter(f => f.endsWith('.json'));
    const traces: AgentTrace[] = [];
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(inputPath, file), 'utf-8'));
        if (Array.isArray(data)) traces.push(...data);
        else traces.push(data);
      } catch { /* skip invalid */ }
    }
    return traces;
  }
  return [];
}

/**
 * Format dependency node as a tree string.
 */
export function formatDependencyTree(node: DependencyNode): string {
  const lines: string[] = [
    `Agent: ${node.agentName}`,
    `  (${node.traceCount} traces, avg ${node.avgStepsPerTrace.toFixed(1)} steps/trace)`,
  ];

  for (let i = 0; i < node.dependencies.length; i++) {
    const dep = node.dependencies[i];
    const isLast = i === node.dependencies.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    const reqLabel = dep.required ? 'required' : dep.conditional ? 'conditional' : 'optional';
    const typeLabel = dep.type === 'sub-agent' ? 'Sub-agent' : 'Tool';
    lines.push(`  ${prefix}${typeLabel}: ${dep.name} (${reqLabel}, ${dep.avgCallsPerTrace.toFixed(1)} calls/avg)`);
  }

  return lines.join('\n');
}

/**
 * Generate Mermaid diagram of dependencies.
 */
export function generateDepMermaid(node: DependencyNode): string {
  const lines: string[] = ['graph TD'];
  const agentId = sanitize(node.agentName);
  lines.push(`  ${agentId}["🤖 ${node.agentName}"]`);

  for (const dep of node.dependencies) {
    const depId = sanitize(dep.name);
    const icon = dep.type === 'sub-agent' ? '🤖' : '🔧';
    lines.push(`  ${depId}["${icon} ${dep.name}"]`);
    const style = dep.required ? '-->' : '-.->';
    const label = `${dep.avgCallsPerTrace.toFixed(1)} calls/avg`;
    lines.push(`  ${agentId} ${style}|"${label}"| ${depId}`);
  }

  return lines.join('\n');
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}
