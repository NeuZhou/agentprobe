/**
 * Trace Lineage — track trace provenance and usage.
 */

import * as fs from 'fs';
import type { AgentTrace } from './types';

export interface LineageEntry {
  action: string;
  timestamp: string;
  details?: string;
}

export interface TraceLineage {
  traceId: string;
  source: string;
  recorded: string;
  modifications: LineageEntry[];
  usedIn: string[];
}

export function extractLineage(trace: AgentTrace): TraceLineage {
  const meta = trace.metadata || {};
  return {
    traceId: trace.id,
    source: meta.source || meta.session || 'unknown',
    recorded: trace.timestamp || meta.recorded || 'unknown',
    modifications: Array.isArray(meta.lineage) ? meta.lineage : [],
    usedIn: Array.isArray(meta.used_in) ? meta.used_in : [],
  };
}

export function addLineageEntry(trace: AgentTrace, action: string, details?: string): AgentTrace {
  const entry: LineageEntry = {
    action,
    timestamp: new Date().toISOString(),
    details,
  };
  const lineage = Array.isArray(trace.metadata.lineage) ? [...trace.metadata.lineage, entry] : [entry];
  return {
    ...trace,
    metadata: { ...trace.metadata, lineage },
  };
}

export function recordUsage(trace: AgentTrace, usedIn: string): AgentTrace {
  const existing = Array.isArray(trace.metadata.used_in) ? trace.metadata.used_in : [];
  if (existing.includes(usedIn)) return trace;
  return {
    ...trace,
    metadata: { ...trace.metadata, used_in: [...existing, usedIn] },
  };
}

export function formatLineage(lineage: TraceLineage): string {
  const lines = [
    'Lineage:',
    `  Source: ${lineage.source}`,
    `  Recorded: ${lineage.recorded}`,
  ];
  if (lineage.modifications.length > 0) {
    const mods = lineage.modifications.map(m =>
      `${m.action}(${m.timestamp}${m.details ? `, ${m.details}` : ''})`
    ).join(', ');
    lines.push(`  Modified: ${mods}`);
  }
  if (lineage.usedIn.length > 0) {
    lines.push(`  Used in: ${lineage.usedIn.join(', ')}`);
  }
  return lines.join('\n');
}

export function loadTraceLineage(filePath: string): TraceLineage {
  const content = fs.readFileSync(filePath, 'utf-8');
  const trace: AgentTrace = JSON.parse(content);
  return extractLineage(trace);
}
