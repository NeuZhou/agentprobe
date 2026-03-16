import type { AgentTrace } from './types';

export interface SamplingOptions {
  /** Fixed number of traces to sample */
  count?: number;
  /** Percentage of traces to sample (0-100) */
  percentage?: number;
  /** Random seed for reproducible sampling */
  seed?: number;
}

/**
 * Sample a subset of traces from an array.
 */
export function sampleTraces(traces: AgentTrace[], options: SamplingOptions): AgentTrace[] {
  if (traces.length === 0) return [];

  let targetCount: number;

  if (options.count != null) {
    targetCount = Math.min(Math.max(1, options.count), traces.length);
  } else if (options.percentage != null) {
    const pct = Math.min(100, Math.max(0, options.percentage));
    targetCount = Math.max(1, Math.round((traces.length * pct) / 100));
  } else {
    return traces; // no sampling
  }

  if (targetCount >= traces.length) return [...traces];

  // Seeded pseudo-random for reproducibility
  const rng = options.seed != null ? seededRng(options.seed) : Math.random;

  // Fisher-Yates shuffle on indices, take first targetCount
  const indices = Array.from({ length: traces.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, targetCount).sort((a, b) => a - b).map((i) => traces[i]);
}

/**
 * Sample file paths (for lazy loading - don't load all traces into memory).
 */
export function sampleFiles(files: string[], options: SamplingOptions): string[] {
  if (files.length === 0) return [];

  let targetCount: number;

  if (options.count != null) {
    targetCount = Math.min(Math.max(1, options.count), files.length);
  } else if (options.percentage != null) {
    const pct = Math.min(100, Math.max(0, options.percentage));
    targetCount = Math.max(1, Math.round((files.length * pct) / 100));
  } else {
    return [...files];
  }

  if (targetCount >= files.length) return [...files];

  const rng = options.seed != null ? seededRng(options.seed) : Math.random;
  const indices = Array.from({ length: files.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, targetCount).sort((a, b) => a - b).map((i) => files[i]);
}

/**
 * Simple seeded PRNG (mulberry32).
 */
function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
