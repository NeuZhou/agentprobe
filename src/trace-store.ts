/**
 * Trace Store - Local JSON file-based trace storage.
 * Stores traces in a JSON file for persistence across sessions.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace } from './types';
import { randomUUID } from 'crypto';

export interface TraceSearchQuery {
  tool?: string;
  dateRange?: [Date, Date];
  tags?: string[];
}

export interface TraceStoreStats {
  total: number;
  byAdapter: Record<string, number>;
  totalCost: number;
}

interface StoreEntry {
  id: string;
  trace: AgentTrace;
  savedAt: string;
  tags: string[];
  adapter?: string;
  cost?: number;
}

interface StoreData {
  version: number;
  entries: StoreEntry[];
}

export class TraceStore {
  private dbPath: string;
  private data: StoreData;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.join(process.cwd(), '.agentprobe', 'traces.db.json');
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // corrupt file, start fresh
    }
    return { version: 1, entries: [] };
  }

  private persist(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
  }

  /**
   * Save a trace and return its unique ID.
   */
  save(trace: AgentTrace, opts?: { tags?: string[]; adapter?: string; cost?: number }): string {
    const id = randomUUID();
    const entry: StoreEntry = {
      id,
      trace,
      savedAt: new Date().toISOString(),
      tags: opts?.tags ?? (trace.metadata?.tags as string[]) ?? [],
      adapter: opts?.adapter ?? (trace.metadata?.adapter as string),
      cost: opts?.cost,
    };
    this.data.entries.push(entry);
    this.persist();
    return id;
  }

  /**
   * Get a trace by ID.
   */
  get(id: string): AgentTrace | null {
    const entry = this.data.entries.find((e) => e.id === id);
    return entry?.trace ?? null;
  }

  /**
   * Search traces by tool, date range, or tags.
   */
  search(query: TraceSearchQuery): AgentTrace[] {
    return this.data.entries
      .filter((entry) => {
        if (query.tool) {
          const hasToolCall = entry.trace.steps.some(
            (s) => s.type === 'tool_call' && s.data.tool_name === query.tool,
          );
          if (!hasToolCall) return false;
        }

        if (query.dateRange) {
          const ts = new Date(entry.trace.timestamp);
          if (ts < query.dateRange[0] || ts > query.dateRange[1]) return false;
        }

        if (query.tags && query.tags.length > 0) {
          const hasAllTags = query.tags.every((t) => entry.tags.includes(t));
          if (!hasAllTags) return false;
        }

        return true;
      })
      .map((e) => e.trace);
  }

  /**
   * Get aggregate statistics.
   */
  stats(): TraceStoreStats {
    const byAdapter: Record<string, number> = {};
    let totalCost = 0;

    for (const entry of this.data.entries) {
      const adapter = entry.adapter ?? 'unknown';
      byAdapter[adapter] = (byAdapter[adapter] ?? 0) + 1;
      totalCost += entry.cost ?? 0;
    }

    return {
      total: this.data.entries.length,
      byAdapter,
      totalCost,
    };
  }

  /**
   * Delete traces older than a given date. Returns deleted count.
   */
  prune(olderThan: Date): number {
    const before = this.data.entries.length;
    this.data.entries = this.data.entries.filter(
      (e) => new Date(e.savedAt) >= olderThan,
    );
    const deleted = before - this.data.entries.length;
    if (deleted > 0) this.persist();
    return deleted;
  }

  /**
   * Total number of stored traces.
   */
  count(): number {
    return this.data.entries.length;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.data.entries = [];
    this.persist();
  }
}
