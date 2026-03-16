/**
 * Agent Version Tracking — Rich version tracking with change categorization
 * @module
 */

import * as fs from 'fs';
import type { AgentMeta, VersionEntry, VersionDiff, DiffChange } from './version-registry';
import { VersionRegistry, formatVersionDiff } from './version-registry';

export { VersionRegistry, formatVersionDiff };
export type { AgentMeta, VersionEntry, VersionDiff, DiffChange };

export type ChangeCategory = 'model' | 'prompt' | 'tools' | 'config' | 'unknown';

export interface CategorizedChange extends DiffChange {
  category: ChangeCategory;
}

export interface VersionRecord {
  agentId: string;
  version: string;
  metadata: AgentMeta;
  registeredAt: string;
  changeCategories?: ChangeCategory[];
}

/**
 * Categorize a diff change field into a known category.
 */
export function categorizeChange(field: string): ChangeCategory {
  if (/^model$/i.test(field) || /temperature|maxTokens|max_tokens/i.test(field)) return 'model';
  if (/prompt|systemPrompt|system_prompt|instruction/i.test(field)) return 'prompt';
  if (/^tools/i.test(field) || /tool_|function/i.test(field)) return 'tools';
  if (/^config/i.test(field) || /timeout|retries|endpoint/i.test(field)) return 'config';
  return 'unknown';
}

/**
 * Categorize all changes in a VersionDiff.
 */
export function categorizeChanges(diff: VersionDiff): CategorizedChange[] {
  return diff.changes.map(c => ({
    ...c,
    category: categorizeChange(c.field),
  }));
}

/**
 * Summarize categories present in a diff.
 */
export function summarizeCategories(changes: CategorizedChange[]): Record<ChangeCategory, number> {
  const counts: Record<ChangeCategory, number> = { model: 0, prompt: 0, tools: 0, config: 0, unknown: 0 };
  for (const c of changes) counts[c.category]++;
  return counts;
}

/**
 * High-level wrapper — AgentVersionTracker
 */
export class AgentVersionTracker {
  private registry: VersionRegistry;
  private storePath?: string;

  constructor(storePath?: string) {
    this.registry = new VersionRegistry();
    this.storePath = storePath;
    if (storePath && fs.existsSync(storePath)) {
      this.registry.load(storePath);
    }
  }

  recordVersion(agentId: string, version: string, metadata: AgentMeta): void {
    this.registry.register(agentId, version, metadata);
    if (this.storePath) this.registry.save(this.storePath);
  }

  getHistory(agentId: string): VersionRecord[] {
    return this.registry.getHistory(agentId).map(e => ({
      agentId: e.name,
      version: e.version,
      metadata: e.metadata,
      registeredAt: e.registeredAt,
    }));
  }

  diff(agentId: string, v1: string, v2: string): VersionDiff {
    return this.registry.diff(agentId, v1, v2);
  }

  categorizedDiff(agentId: string, v1: string, v2: string): CategorizedChange[] {
    return categorizeChanges(this.diff(agentId, v1, v2));
  }

  getLatest(agentId: string): VersionRecord | undefined {
    const e = this.registry.getLatest(agentId);
    if (!e) return undefined;
    return { agentId: e.name, version: e.version, metadata: e.metadata, registeredAt: e.registeredAt };
  }

  listAgents(): string[] {
    return this.registry.listAgents();
  }
}

/**
 * Format a categorized change summary for display.
 */
export function formatCategorySummary(categories: Record<ChangeCategory, number>): string {
  const parts: string[] = [];
  for (const [cat, count] of Object.entries(categories)) {
    if (count > 0) parts.push(`${cat}: ${count}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'no changes';
}
