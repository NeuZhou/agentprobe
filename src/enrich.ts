/**
 * Trace Enrichment - Auto-enrich traces with computed data
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace } from './types';
import chalk from 'chalk';

export interface EnrichedMetadata {
  cost_usd: number;
  duration_ms: number;
  tool_count: number;
  llm_call_count: number;
  token_total: number;
}

/**
 * Compute enrichment data for a trace.
 */
export function computeEnrichment(trace: AgentTrace): EnrichedMetadata {
  let totalTokens = 0;
  let toolCount = 0;
  let llmCallCount = 0;
  let totalDuration = 0;
  let totalCost = 0;

  for (const step of trace.steps) {
    if (step.duration_ms) totalDuration += step.duration_ms;

    if (step.type === 'tool_call') toolCount++;
    if (step.type === 'llm_call') llmCallCount++;

    if (step.data.tokens) {
      const input = step.data.tokens.input || 0;
      const output = step.data.tokens.output || 0;
      totalTokens += input + output;
      // Rough cost estimate based on GPT-4 pricing
      totalCost += input * 0.00003 + output * 0.00006;
    }
  }

  // Use trace timestamps for duration if step durations missing
  if (totalDuration === 0 && trace.steps.length >= 2) {
    const first = new Date(trace.steps[0].timestamp).getTime();
    const last = new Date(trace.steps[trace.steps.length - 1].timestamp).getTime();
    if (!isNaN(first) && !isNaN(last)) {
      totalDuration = last - first;
    }
  }

  return {
    cost_usd: totalCost,
    duration_ms: totalDuration,
    tool_count: toolCount,
    llm_call_count: llmCallCount,
    token_total: totalTokens,
  };
}

/**
 * Enrich a single trace in-place and return it.
 */
export function enrichTrace(trace: AgentTrace): AgentTrace {
  const enrichment = computeEnrichment(trace);
  trace.metadata = {
    ...trace.metadata,
    ...enrichment,
  };
  return trace;
}

/**
 * Enrich all trace files in a directory, writing back to disk.
 */
export function enrichTraceDir(dir: string): { enriched: number; errors: number } {
  let enriched = 0;
  let errors = 0;

  if (!fs.existsSync(dir)) {
    return { enriched: 0, errors: 0 };
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const filePath = path.join(dir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (data.id && data.steps) {
        const enrichedTrace = enrichTrace(data as AgentTrace);
        fs.writeFileSync(filePath, JSON.stringify(enrichedTrace, null, 2));
        enriched++;
      }
    } catch {
      errors++;
    }
  }

  return { enriched, errors };
}

/**
 * Format enrichment results for console output.
 */
export function formatEnrichment(result: { enriched: number; errors: number }): string {
  const lines: string[] = [];
  lines.push(chalk.bold('\n📝 Trace Enrichment\n'));
  lines.push(`  Enriched: ${result.enriched} traces`);
  if (result.errors > 0) {
    lines.push(chalk.yellow(`  Errors: ${result.errors}`));
  }
  lines.push('  Added: cost_usd, duration_ms, tool_count, llm_call_count, token_total');
  return lines.join('\n');
}
