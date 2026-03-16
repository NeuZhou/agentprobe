/**
 * Built-in Plugin: LLM Response Cache
 *
 * Cache LLM responses for deterministic replay during testing.
 * Uses a content-addressable store keyed by model + messages hash.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { AgentProbePlugin } from '../plugins';

export interface CacheConfig {
  /** Directory to store cached responses */
  cacheDir?: string;
  /** TTL in milliseconds (default: 24h) */
  ttlMs?: number;
  /** Maximum cache size in entries */
  maxEntries?: number;
  /** Enable/disable cache */
  enabled?: boolean;
}

export interface CacheEntry {
  key: string;
  model: string;
  response: any;
  timestamp: number;
  hits: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  sizeBytes: number;
}

export class LLMCache {
  private cache = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  readonly config: CacheConfig;

  constructor(config: CacheConfig = {}) {
    this.config = {
      ttlMs: 24 * 60 * 60 * 1000,
      maxEntries: 1000,
      enabled: true,
      ...config,
    };
  }

  private hash(model: string, messages: any): string {
    const content = JSON.stringify({ model, messages });
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  get(model: string, messages: any): any | null {
    if (!this.config.enabled) return null;
    const key = this.hash(model, messages);
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (this.config.ttlMs && Date.now() - entry.timestamp > this.config.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    entry.hits++;
    this.hits++;
    return entry.response;
  }

  set(model: string, messages: any, response: any): void {
    if (!this.config.enabled) return;
    const key = this.hash(model, messages);

    if (this.config.maxEntries && this.cache.size >= this.config.maxEntries) {
      // Evict oldest entry
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }

    this.cache.set(key, { key, model, response, timestamp: Date.now(), hits: 0 });
  }

  has(model: string, messages: any): boolean {
    const key = this.hash(model, messages);
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      sizeBytes: JSON.stringify([...this.cache.values()]).length,
    };
  }

  /** Save cache to disk */
  saveToDisk(dir?: string): void {
    const cacheDir = dir ?? this.config.cacheDir;
    if (!cacheDir) return;
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const data = JSON.stringify([...this.cache.entries()]);
    fs.writeFileSync(path.join(cacheDir, 'llm-cache.json'), data, 'utf-8');
  }

  /** Load cache from disk */
  loadFromDisk(dir?: string): number {
    const cacheDir = dir ?? this.config.cacheDir;
    if (!cacheDir) return 0;
    const fp = path.join(cacheDir, 'llm-cache.json');
    if (!fs.existsSync(fp)) return 0;
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as [string, CacheEntry][];
    this.cache = new Map(data);
    return data.length;
  }

  formatReport(): string {
    const stats = this.getStats();
    return [
      'LLM Cache Report',
      '='.repeat(40),
      `  Entries: ${stats.entries}`,
      `  Hits: ${stats.hits}`,
      `  Misses: ${stats.misses}`,
      `  Hit Rate: ${(stats.hitRate * 100).toFixed(1)}%`,
    ].join('\n');
  }
}

/**
 * Create the cache plugin instance.
 */
export function createCachePlugin(config: CacheConfig = {}): AgentProbePlugin & { cache: LLMCache } {
  const cache = new LLMCache(config);

  return {
    name: 'llm-cache',
    version: '1.0.0',
    type: 'lifecycle',
    hooks: {
      onSuiteStart() {
        cache.loadFromDisk();
      },
      onSuiteComplete() {
        cache.saveToDisk();
      },
    },
    cache,
  };
}

export default createCachePlugin;
