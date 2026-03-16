/**
 * Agent Version Registry — Track and diff agent versions over time
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AgentMeta {
  model?: string;
  systemPrompt?: string;
  tools?: string[];
  temperature?: number;
  maxTokens?: number;
  config?: Record<string, any>;
  [key: string]: any;
}

export interface VersionEntry {
  name: string;
  version: string;
  metadata: AgentMeta;
  registeredAt: string;
}

export interface VersionDiff {
  name: string;
  v1: string;
  v2: string;
  changes: DiffChange[];
}

export interface DiffChange {
  field: string;
  from: any;
  to: any;
}

/**
 * Compare two values deeply and return a list of changes.
 */
function diffObjects(a: Record<string, any>, b: Record<string, any>, prefix = ''): DiffChange[] {
  const changes: DiffChange[] = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of allKeys) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const va = a[key];
    const vb = b[key];

    if (va === vb) continue;

    if (
      typeof va === 'object' && va !== null && !Array.isArray(va) &&
      typeof vb === 'object' && vb !== null && !Array.isArray(vb)
    ) {
      changes.push(...diffObjects(va, vb, fullKey));
    } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
      changes.push({ field: fullKey, from: va, to: vb });
    }
  }

  return changes;
}

export class VersionRegistry {
  private entries: Map<string, VersionEntry[]> = new Map();

  /**
   * Register a new agent version.
   */
  register(name: string, version: string, metadata: AgentMeta): void {
    let list = this.entries.get(name);
    if (!list) {
      list = [];
      this.entries.set(name, list);
    }
    // Don't allow duplicate version
    if (list.some(e => e.version === version)) {
      throw new Error(`Version ${version} already registered for agent "${name}"`);
    }
    list.push({ name, version, metadata, registeredAt: new Date().toISOString() });
  }

  /**
   * Get version history for an agent.
   */
  getHistory(name: string): VersionEntry[] {
    return this.entries.get(name) || [];
  }

  /**
   * Get a specific version entry.
   */
  getVersion(name: string, version: string): VersionEntry | undefined {
    return this.entries.get(name)?.find(e => e.version === version);
  }

  /**
   * Get the latest version for an agent.
   */
  getLatest(name: string): VersionEntry | undefined {
    const list = this.entries.get(name);
    return list && list.length > 0 ? list[list.length - 1] : undefined;
  }

  /**
   * Diff two versions of an agent.
   */
  diff(name: string, v1: string, v2: string): VersionDiff {
    const e1 = this.getVersion(name, v1);
    const e2 = this.getVersion(name, v2);
    if (!e1) throw new Error(`Version ${v1} not found for agent "${name}"`);
    if (!e2) throw new Error(`Version ${v2} not found for agent "${name}"`);

    const changes = diffObjects(e1.metadata as Record<string, any>, e2.metadata as Record<string, any>);
    return { name, v1, v2, changes };
  }

  /**
   * Rollback to a previous version (returns the metadata for that version).
   */
  rollback(name: string, version: string): AgentMeta {
    const entry = this.getVersion(name, version);
    if (!entry) throw new Error(`Version ${version} not found for agent "${name}"`);
    return { ...entry.metadata };
  }

  /**
   * List all registered agent names.
   */
  listAgents(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Save registry to disk.
   */
  save(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = Object.fromEntries(this.entries);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load registry from disk.
   */
  load(filePath: string): void {
    if (!fs.existsSync(filePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      for (const [name, entries] of Object.entries(raw)) {
        this.entries.set(name, entries as VersionEntry[]);
      }
    } catch { /* skip */ }
  }

  /** Number of agents tracked */
  get size(): number {
    return this.entries.size;
  }

  /** Total versions across all agents */
  get totalVersions(): number {
    let count = 0;
    for (const list of this.entries.values()) count += list.length;
    return count;
  }
}

/**
 * Format a version diff for console display.
 */
export function formatVersionDiff(diff: VersionDiff): string {
  const lines: string[] = [];
  lines.push(`Agent: ${diff.name}  ${diff.v1} → ${diff.v2}`);
  if (diff.changes.length === 0) {
    lines.push('  No changes');
  } else {
    for (const c of diff.changes) {
      const from = JSON.stringify(c.from) ?? 'undefined';
      const to = JSON.stringify(c.to) ?? 'undefined';
      lines.push(`  ${c.field}: ${from} → ${to}`);
    }
  }
  return lines.join('\n');
}
