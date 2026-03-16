import type { AgentTrace } from './types';
import * as fs from 'fs';
import * as path from 'path';

export interface SimilarityResult {
  tracePath: string;
  similarity: number;
  reason: string;
}

/**
 * Compute tool-call sequence similarity between two traces using
 * longest common subsequence (LCS) ratio.
 */
export function toolSequenceSimilarity(traceA: AgentTrace, traceB: AgentTrace): number {
  const seqA = extractToolSequence(traceA);
  const seqB = extractToolSequence(traceB);

  if (seqA.length === 0 && seqB.length === 0) return 1;
  if (seqA.length === 0 || seqB.length === 0) return 0;

  const lcsLen = lcs(seqA, seqB);
  return (2 * lcsLen) / (seqA.length + seqB.length);
}

/**
 * Compute output similarity based on simple token overlap (Jaccard).
 */
export function outputSimilarity(traceA: AgentTrace, traceB: AgentTrace): number {
  const tokensA = new Set(extractOutputTokens(traceA));
  const tokensB = new Set(extractOutputTokens(traceB));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  return intersection / (tokensA.size + tokensB.size - intersection);
}

/**
 * Compute overall similarity (weighted average of tool + output similarity).
 */
export function traceSimilarity(
  traceA: AgentTrace,
  traceB: AgentTrace,
  weights?: { toolWeight?: number; outputWeight?: number },
): number {
  const tw = weights?.toolWeight ?? 0.6;
  const ow = weights?.outputWeight ?? 0.4;
  const toolSim = toolSequenceSimilarity(traceA, traceB);
  const outSim = outputSimilarity(traceA, traceB);
  return tw * toolSim + ow * outSim;
}

/**
 * Find top-N similar traces from a corpus.
 */
export function findSimilarTraces(
  target: AgentTrace,
  corpusDir: string,
  options?: { topN?: number },
): SimilarityResult[] {
  const topN = options?.topN ?? 5;
  const results: SimilarityResult[] = [];

  if (!fs.existsSync(corpusDir)) return results;

  const files = fs.readdirSync(corpusDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(corpusDir, file), 'utf-8');
      const corpus = JSON.parse(raw) as AgentTrace;
      const toolSim = toolSequenceSimilarity(target, corpus);
      const outSim = outputSimilarity(target, corpus);
      const sim = 0.6 * toolSim + 0.4 * outSim;

      let reason = 'general similarity';
      if (toolSim > 0.8) reason = 'same tool pattern';
      else if (outSim > 0.8) reason = 'similar output';
      else if (toolSim > 0.5) reason = 'similar tool usage';

      results.push({ tracePath: path.join(corpusDir, file), similarity: Math.round(sim * 100) / 100, reason });
    } catch {
      // skip invalid
    }
  }

  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);
}

/**
 * Format similarity results for display.
 */
export function formatSimilarityResults(results: SimilarityResult[]): string {
  if (results.length === 0) return 'No similar traces found.';
  const lines = [`Top ${results.length} similar traces:`, ''];
  results.forEach((r, i) => {
    lines.push(`  ${i + 1}. ${path.basename(r.tracePath)} (similarity: ${r.similarity.toFixed(2)}) — ${r.reason}`);
  });
  return lines.join('\n');
}

// --- Helpers ---

function extractToolSequence(trace: AgentTrace): string[] {
  return trace.steps
    .filter(s => s.type === 'tool_call' && s.data.tool_name)
    .map(s => s.data.tool_name!);
}

function extractOutputTokens(trace: AgentTrace): string[] {
  const tokens: string[] = [];
  for (const step of trace.steps) {
    if (step.data.content) {
      tokens.push(...step.data.content.toLowerCase().split(/\s+/).filter(Boolean));
    }
  }
  return tokens;
}

function lcs(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}
