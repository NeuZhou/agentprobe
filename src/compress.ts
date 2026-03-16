/**
 * Trace Compression — Compress and decompress traces for storage.
 *
 * @example
 * ```bash
 * agentprobe trace compress traces/ --output traces.gz
 * agentprobe trace decompress traces.gz --output traces/
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { AgentTrace } from './types';

// ===== Types =====

export interface CompressedArchive {
  version: 1;
  count: number;
  traces: CompressedEntry[];
}

export interface CompressedEntry {
  filename: string;
  data: string; // base64 of gzip'd JSON
}

export interface CompressionStats {
  fileCount: number;
  originalBytes: number;
  compressedBytes: number;
  ratio: number;
}

// ===== Core Functions =====

/**
 * Compress a single trace to a gzipped buffer.
 */
export function compressTrace(trace: AgentTrace): Buffer {
  const json = JSON.stringify(trace);
  return zlib.gzipSync(Buffer.from(json, 'utf-8'));
}

/**
 * Decompress a gzipped buffer back to a trace.
 */
export function decompressTrace(compressed: Buffer): AgentTrace {
  const json = zlib.gunzipSync(compressed).toString('utf-8');
  return JSON.parse(json) as AgentTrace;
}

/**
 * Compress a directory of trace JSON files into a single archive.
 */
export function compressDirectory(inputDir: string): { archive: Buffer; stats: CompressionStats } {
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Directory not found: ${inputDir}`);
  }

  const files = fs.readdirSync(inputDir).filter((f) => f.endsWith('.json'));
  const entries: CompressedEntry[] = [];
  let originalBytes = 0;

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    const raw = fs.readFileSync(filePath);
    originalBytes += raw.length;
    const compressed = zlib.gzipSync(raw);
    entries.push({
      filename: file,
      data: compressed.toString('base64'),
    });
  }

  const archive: CompressedArchive = {
    version: 1,
    count: entries.length,
    traces: entries,
  };

  const archiveJson = JSON.stringify(archive);
  const archiveBuffer = zlib.gzipSync(Buffer.from(archiveJson, 'utf-8'));

  return {
    archive: archiveBuffer,
    stats: {
      fileCount: files.length,
      originalBytes,
      compressedBytes: archiveBuffer.length,
      ratio: originalBytes > 0 ? archiveBuffer.length / originalBytes : 0,
    },
  };
}

/**
 * Decompress an archive back to individual trace files in a directory.
 */
export function decompressDirectory(archiveBuffer: Buffer, outputDir: string): CompressionStats {
  const archiveJson = zlib.gunzipSync(archiveBuffer).toString('utf-8');
  const archive: CompressedArchive = JSON.parse(archiveJson);

  if (archive.version !== 1) {
    throw new Error(`Unsupported archive version: ${archive.version}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let originalBytes = 0;
  for (const entry of archive.traces) {
    const compressed = Buffer.from(entry.data, 'base64');
    const raw = zlib.gunzipSync(compressed);
    originalBytes += raw.length;
    fs.writeFileSync(path.join(outputDir, entry.filename), raw);
  }

  return {
    fileCount: archive.count,
    originalBytes,
    compressedBytes: archiveBuffer.length,
    ratio: originalBytes > 0 ? archiveBuffer.length / originalBytes : 0,
  };
}

// ===== Enhanced Compression: Dedup & Strip =====

/**
 * Strip embedding vectors from trace data to reduce size.
 */
export function stripEmbeddings(trace: AgentTrace): AgentTrace {
  return {
    ...trace,
    steps: trace.steps.map(step => ({
      ...step,
      data: {
        ...step.data,
        tool_result: stripEmbeddingsFromValue(step.data.tool_result),
        tool_args: step.data.tool_args ? stripEmbeddingsFromRecord(step.data.tool_args) : undefined,
      },
    })),
  };
}

function stripEmbeddingsFromValue(val: any): any {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    // If it looks like an embedding (array of numbers, length > 10)
    if (val.length > 10 && val.every((v: any) => typeof v === 'number')) {
      return `[embedding:${val.length}d]`;
    }
    return val.map(stripEmbeddingsFromValue);
  }
  if (typeof val === 'object') return stripEmbeddingsFromRecord(val);
  return val;
}

function stripEmbeddingsFromRecord(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'embedding' || k === 'embeddings' || k === 'vector' || k === 'vectors') {
      result[k] = Array.isArray(v) ? `[embedding:${v.length}d]` : '[stripped]';
    } else {
      result[k] = stripEmbeddingsFromValue(v);
    }
  }
  return result;
}

/**
 * Deduplicate identical tool responses across steps.
 */
export function deduplicateResponses(trace: AgentTrace): AgentTrace {
  const seen = new Map<string, string>(); // hash -> ref id
  let refCounter = 0;

  const steps = trace.steps.map(step => {
    if (step.type === 'tool_result' && step.data.tool_result) {
      const hash = JSON.stringify(step.data.tool_result);
      if (seen.has(hash)) {
        return {
          ...step,
          data: { ...step.data, tool_result: `[ref:${seen.get(hash)}]` },
        };
      }
      const refId = `r${refCounter++}`;
      seen.set(hash, refId);
    }
    return step;
  });

  return { ...trace, steps };
}

/**
 * Apply all compression optimizations to a trace.
 */
export function optimizeTrace(trace: AgentTrace): AgentTrace {
  let optimized = stripEmbeddings(trace);
  optimized = deduplicateResponses(optimized);
  return optimized;
}

/**
 * Compress a directory with optimization (dedup + strip + gzip).
 */
export function compressDirectoryOptimized(inputDir: string): { archive: Buffer; stats: CompressionStats } {
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Directory not found: ${inputDir}`);
  }

  const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
  const entries: CompressedEntry[] = [];
  let originalBytes = 0;

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    const raw = fs.readFileSync(filePath);
    originalBytes += raw.length;

    // Parse, optimize, then compress
    try {
      const trace = JSON.parse(raw.toString('utf-8')) as AgentTrace;
      const optimized = optimizeTrace(trace);
      const optimizedJson = JSON.stringify(optimized);
      const compressed = zlib.gzipSync(Buffer.from(optimizedJson, 'utf-8'));
      entries.push({ filename: file, data: compressed.toString('base64') });
    } catch {
      // Fallback: compress as-is
      const compressed = zlib.gzipSync(raw);
      entries.push({ filename: file, data: compressed.toString('base64') });
    }
  }

  const archive: CompressedArchive = { version: 1, count: entries.length, traces: entries };
  const archiveJson = JSON.stringify(archive);
  const archiveBuffer = zlib.gzipSync(Buffer.from(archiveJson, 'utf-8'));

  return {
    archive: archiveBuffer,
    stats: {
      fileCount: files.length,
      originalBytes,
      compressedBytes: archiveBuffer.length,
      ratio: originalBytes > 0 ? archiveBuffer.length / originalBytes : 0,
    },
  };
}

/**
 * Format compression stats for display.
 */
export function formatCompressionStats(stats: CompressionStats): string {
  const pct = ((1 - stats.ratio) * 100).toFixed(1);
  const origKB = (stats.originalBytes / 1024).toFixed(1);
  const compKB = (stats.compressedBytes / 1024).toFixed(1);
  return `${stats.fileCount} file(s): ${origKB}KB → ${compKB}KB (${pct}% reduction)`;
}

/**
 * Compress a directory and write to output file.
 */
export function compressToFile(inputDir: string, outputPath: string): CompressionStats {
  const { archive, stats } = compressDirectory(inputDir);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, archive);
  return stats;
}

/**
 * Decompress from a file to a directory.
 */
export function decompressFromFile(archivePath: string, outputDir: string): CompressionStats {
  const archiveBuffer = fs.readFileSync(archivePath);
  return decompressDirectory(archiveBuffer, outputDir);
}
