/**
 * Trace Search Engine — full-text search with scoring across traces.
 * @module search-engine
 */
import type { AgentTrace, TraceStep } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { loadTrace } from './recorder';

export interface SearchEngineOptions {
  /** Search query (natural language or keywords) */
  query: string;
  /** Directory containing trace JSON files */
  tracesDir: string;
  /** Max results to return */
  limit?: number;
  /** Minimum relevance score (0-1) */
  minScore?: number;
}

export interface SearchHit {
  file: string;
  score: number;
  preview: string;
  matchedSteps: number[];
  trace: AgentTrace;
}

export interface SearchEngineResult {
  hits: SearchHit[];
  totalSearched: number;
  queryTerms: string[];
  elapsed_ms: number;
}

/**
 * Tokenize a query into search terms (lowercased, deduplicated).
 */
export function tokenize(query: string): string[] {
  return [...new Set(
    query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1)
  )];
}

/**
 * Score a single trace step against query terms using TF-based relevance.
 */
export function scoreStep(step: TraceStep, terms: string[]): number {
  const text = [
    step.data.content,
    step.data.tool_name,
    step.data.model,
    step.data.tool_args ? JSON.stringify(step.data.tool_args) : '',
    step.data.messages?.map(m => m.content).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();

  if (text.length === 0) return 0;

  let matches = 0;
  for (const term of terms) {
    if (text.includes(term)) matches++;
  }
  return terms.length > 0 ? matches / terms.length : 0;
}

/**
 * Score and rank a trace against the query.
 */
export function scoreTrace(trace: AgentTrace, terms: string[]): { score: number; matchedSteps: number[]; preview: string } {
  let totalScore = 0;
  const matchedSteps: number[] = [];
  let bestPreview = '';
  let bestStepScore = 0;

  for (let i = 0; i < trace.steps.length; i++) {
    const s = scoreStep(trace.steps[i], terms);
    if (s > 0) {
      totalScore += s;
      matchedSteps.push(i);
      if (s > bestStepScore) {
        bestStepScore = s;
        bestPreview = extractPreview(trace.steps[i]);
      }
    }
  }

  // Also check metadata
  const metaText = JSON.stringify(trace.metadata ?? {}).toLowerCase();
  for (const term of terms) {
    if (metaText.includes(term)) totalScore += 0.5;
  }

  // Normalize by step count to avoid long trace bias
  const normalizedScore = trace.steps.length > 0
    ? totalScore / Math.sqrt(trace.steps.length)
    : 0;

  return { score: Math.min(1, normalizedScore), matchedSteps, preview: bestPreview };
}

/**
 * Extract a short preview string from a step.
 */
export function extractPreview(step: TraceStep): string {
  if (step.data.content) {
    return step.data.content.slice(0, 100);
  }
  if (step.data.tool_name) {
    return `[tool: ${step.data.tool_name}]`;
  }
  if (step.data.messages?.length) {
    const last = step.data.messages[step.data.messages.length - 1];
    return last.content.slice(0, 100);
  }
  return `[${step.type}]`;
}

/**
 * Find trace files recursively.
 */
export function findTraceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const stat = fs.statSync(dir);
  if (stat.isFile() && dir.endsWith('.json')) return [dir];
  if (!stat.isDirectory()) return results;

  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    try {
      const s = fs.statSync(full);
      if (s.isFile() && entry.endsWith('.json')) results.push(full);
      else if (s.isDirectory()) results.push(...findTraceFiles(full));
    } catch { /* skip */ }
  }
  return results;
}

/**
 * Full-text search across trace files.
 */
export function searchEngine(options: SearchEngineOptions): SearchEngineResult {
  const start = Date.now();
  const terms = tokenize(options.query);
  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? 0.1;
  const files = findTraceFiles(options.tracesDir);

  const hits: SearchHit[] = [];

  for (const file of files) {
    let trace: AgentTrace;
    try { trace = loadTrace(file); } catch { continue; }

    const { score, matchedSteps, preview } = scoreTrace(trace, terms);
    if (score >= minScore) {
      hits.push({ file, score, preview, matchedSteps, trace });
    }
  }

  hits.sort((a, b) => b.score - a.score);

  return {
    hits: hits.slice(0, limit),
    totalSearched: files.length,
    queryTerms: terms,
    elapsed_ms: Date.now() - start,
  };
}

/**
 * Format search engine results for console output.
 */
export function formatSearchEngineResult(result: SearchEngineResult): string {
  const lines: string[] = [];
  lines.push(`Found ${result.hits.length} matching traces (searched ${result.totalSearched}):`);
  for (let i = 0; i < result.hits.length; i++) {
    const hit = result.hits[i];
    const basename = path.basename(hit.file);
    lines.push(`  ${i + 1}. ${basename} (score: ${hit.score.toFixed(2)}) — "${hit.preview}"`);
  }
  if (result.hits.length === 0) {
    lines.push('  No matching traces found.');
  }
  return lines.join('\n');
}
