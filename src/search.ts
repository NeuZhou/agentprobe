import type { AgentTrace } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { loadTrace } from './recorder';
import { calculateCost } from './cost';

export interface SearchOptions {
  query?: string;
  tool?: string;
  minCost?: number;
  maxCost?: number;
  minSteps?: number;
  maxSteps?: number;
  model?: string;
  hasOutput?: string;
  stepType?: string;
}

export interface SearchMatch {
  file: string;
  trace: AgentTrace;
  matchedSteps: number[];
  reason: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  totalFiles: number;
  searchedFiles: number;
}

/**
 * Search across multiple trace files for matching criteria.
 */
export function searchTraces(traceDir: string, options: SearchOptions): SearchResult {
  const files = findTraceFiles(traceDir);
  const matches: SearchMatch[] = [];

  for (const file of files) {
    let trace: AgentTrace;
    try {
      trace = loadTrace(file);
    } catch {
      continue;
    }

    const match = matchTrace(trace, file, options);
    if (match) {
      matches.push(match);
    }
  }

  return {
    matches,
    totalFiles: files.length,
    searchedFiles: files.length,
  };
}

/**
 * Search a single trace against criteria, returning match or null.
 */
export function matchTrace(
  trace: AgentTrace,
  file: string,
  options: SearchOptions,
): SearchMatch | null {
  const matchedSteps: number[] = [];
  const reasons: string[] = [];

  // Query: free-text search across tool names, content, and args
  if (options.query) {
    const q = options.query.toLowerCase();
    trace.steps.forEach((step, i) => {
      const searchable = [
        step.data.tool_name,
        step.data.content,
        JSON.stringify(step.data.tool_args ?? {}),
        step.data.model,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (searchable.includes(q)) {
        matchedSteps.push(i);
      }
    });
    if (matchedSteps.length === 0) return null;
    reasons.push(`query "${options.query}" matched ${matchedSteps.length} step(s)`);
  }

  // Tool filter
  if (options.tool) {
    const toolSteps: number[] = [];
    trace.steps.forEach((step, i) => {
      if (step.type === 'tool_call' && step.data.tool_name === options.tool) {
        toolSteps.push(i);
      }
    });
    if (toolSteps.length === 0) return null;
    matchedSteps.push(...toolSteps);
    reasons.push(`tool "${options.tool}" at step(s) ${toolSteps.join(', ')}`);
  }

  // Cost filter
  if (options.minCost != null || options.maxCost != null) {
    const cost = calculateCost(trace);
    if (options.minCost != null && cost.total_cost < options.minCost) return null;
    if (options.maxCost != null && cost.total_cost > options.maxCost) return null;
    reasons.push(`cost $${cost.total_cost.toFixed(4)}`);
  }

  // Step count filter
  if (options.minSteps != null && trace.steps.length < options.minSteps) return null;
  if (options.maxSteps != null && trace.steps.length > options.maxSteps) return null;

  // Model filter
  if (options.model) {
    const hasModel = trace.steps.some(
      (s) => s.data.model && s.data.model.includes(options.model!),
    );
    if (!hasModel) return null;
    reasons.push(`model "${options.model}"`);
  }

  // Output contains
  if (options.hasOutput) {
    const outputs = trace.steps
      .filter((s) => s.type === 'output')
      .map((s) => s.data.content ?? '')
      .join('\n');
    if (!outputs.toLowerCase().includes(options.hasOutput.toLowerCase())) return null;
    reasons.push(`output contains "${options.hasOutput}"`);
  }

  // Step type filter
  if (options.stepType) {
    const typeSteps: number[] = [];
    trace.steps.forEach((step, i) => {
      if (step.type === options.stepType) typeSteps.push(i);
    });
    if (typeSteps.length === 0) return null;
    matchedSteps.push(...typeSteps);
    reasons.push(`${typeSteps.length} ${options.stepType} step(s)`);
  }

  // If no criteria matched anything, only match if at least one filter was applied
  if (reasons.length === 0) {
    // No filters applied - shouldn't normally happen
    return null;
  }

  return {
    file,
    trace,
    matchedSteps: [...new Set(matchedSteps)].sort((a, b) => a - b),
    reason: reasons.join(', '),
  };
}

/**
 * Format search results for display.
 */
export function formatSearchResults(result: SearchResult, options: SearchOptions): string {
  const lines: string[] = [];
  const criteria = Object.entries(options)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  lines.push(`Found in ${result.matches.length}/${result.totalFiles} traces (${criteria}):`);

  for (const match of result.matches) {
    const baseName = path.basename(match.file);
    const stepInfo =
      match.matchedSteps.length > 0
        ? ` (step ${match.matchedSteps.join(', ')})`
        : '';
    lines.push(`  ${baseName}${stepInfo}`);
  }

  return lines.join('\n');
}

function findTraceFiles(dir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) return results;

  const stat = fs.statSync(dir);
  if (stat.isFile() && dir.endsWith('.json')) return [dir];

  if (!stat.isDirectory()) return results;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      const s = fs.statSync(full);
      if (s.isFile() && entry.endsWith('.json')) {
        results.push(full);
      } else if (s.isDirectory()) {
        results.push(...findTraceFiles(full));
      }
    } catch {
      // skip unreadable
    }
  }

  return results;
}
