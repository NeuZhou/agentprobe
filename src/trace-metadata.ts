/**
 * Trace Metadata Tags - Add custom metadata to traces for filtering and querying.
 */

import type { AgentTrace } from './types';

export interface TraceMetadata {
  environment?: string;
  version?: string;
  user_segment?: string;
  feature_flags?: string[];
  [key: string]: any;
}

export interface MetadataFilter {
  /** Key must equal value */
  equals?: Record<string, any>;
  /** Key must contain value (for arrays) */
  contains?: Record<string, string>;
  /** Key must exist */
  exists?: string[];
  /** Key must not exist */
  notExists?: string[];
}

/**
 * Tag a trace with metadata, merging into existing metadata.
 */
export function tagTrace(trace: AgentTrace, metadata: TraceMetadata): AgentTrace {
  return {
    ...trace,
    metadata: { ...trace.metadata, ...metadata },
  };
}

/**
 * Filter traces by metadata criteria.
 */
export function filterByMetadata(traces: AgentTrace[], filter: MetadataFilter): AgentTrace[] {
  return traces.filter(trace => matchesFilter(trace.metadata, filter));
}

function matchesFilter(metadata: Record<string, any>, filter: MetadataFilter): boolean {
  if (filter.equals) {
    for (const [key, value] of Object.entries(filter.equals)) {
      if (metadata[key] !== value) return false;
    }
  }

  if (filter.contains) {
    for (const [key, value] of Object.entries(filter.contains)) {
      const arr = metadata[key];
      if (!Array.isArray(arr) || !arr.includes(value)) return false;
    }
  }

  if (filter.exists) {
    for (const key of filter.exists) {
      if (!(key in metadata)) return false;
    }
  }

  if (filter.notExists) {
    for (const key of filter.notExists) {
      if (key in metadata) return false;
    }
  }

  return true;
}

/**
 * Merge metadata from multiple sources (later sources override).
 */
export function mergeMetadata(...sources: TraceMetadata[]): TraceMetadata {
  const result: TraceMetadata = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (Array.isArray(value) && Array.isArray(result[key])) {
        // Merge arrays, deduplicate
        result[key] = [...new Set([...result[key], ...value])];
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

/**
 * Validate metadata against expected keys.
 */
export function validateMetadata(
  metadata: TraceMetadata,
  requiredKeys: string[],
): { valid: boolean; missing: string[] } {
  const missing = requiredKeys.filter(k => !(k in metadata));
  return { valid: missing.length === 0, missing };
}

/**
 * Build an index of metadata values across multiple traces.
 */
export function extractMetadataIndex(traces: AgentTrace[]): Record<string, Set<any>> {
  const index: Record<string, Set<any>> = {};
  for (const trace of traces) {
    for (const [key, value] of Object.entries(trace.metadata)) {
      if (!index[key]) index[key] = new Set();
      if (Array.isArray(value)) {
        for (const v of value) index[key].add(v);
      } else {
        index[key].add(value);
      }
    }
  }
  return index;
}
