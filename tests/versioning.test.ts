/**
 * Tests for src/versioning.ts - Agent version tracking with change categorization
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  categorizeChange,
  categorizeChanges,
  summarizeCategories,
  AgentVersionTracker,
  formatCategorySummary,
} from '../src/versioning';
import type { VersionDiff, DiffChange } from '../src/version-registry';

describe('Versioning', () => {
  describe('categorizeChange', () => {
    it('should categorize "model" field as model', () => {
      expect(categorizeChange('model')).toBe('model');
    });

    it('should categorize temperature as model', () => {
      expect(categorizeChange('temperature')).toBe('model');
    });

    it('should categorize maxTokens as model', () => {
      expect(categorizeChange('maxTokens')).toBe('model');
    });

    it('should categorize max_tokens as model', () => {
      expect(categorizeChange('max_tokens')).toBe('model');
    });

    it('should categorize prompt as prompt', () => {
      expect(categorizeChange('prompt')).toBe('prompt');
    });

    it('should categorize systemPrompt as prompt', () => {
      expect(categorizeChange('systemPrompt')).toBe('prompt');
    });

    it('should categorize system_prompt as prompt', () => {
      expect(categorizeChange('system_prompt')).toBe('prompt');
    });

    it('should categorize instruction as prompt', () => {
      expect(categorizeChange('instruction')).toBe('prompt');
    });

    it('should categorize tools as tools', () => {
      expect(categorizeChange('tools')).toBe('tools');
    });

    it('should categorize tool_ prefixed as tools', () => {
      expect(categorizeChange('tool_timeout')).toBe('tools');
    });

    it('should categorize function as tools', () => {
      expect(categorizeChange('function')).toBe('tools');
    });

    it('should categorize config as config', () => {
      expect(categorizeChange('config')).toBe('config');
    });

    it('should categorize timeout as config', () => {
      expect(categorizeChange('timeout')).toBe('config');
    });

    it('should categorize retries as config', () => {
      expect(categorizeChange('retries')).toBe('config');
    });

    it('should categorize endpoint as config', () => {
      expect(categorizeChange('endpoint')).toBe('config');
    });

    it('should categorize unknown fields as unknown', () => {
      expect(categorizeChange('randomField')).toBe('unknown');
      expect(categorizeChange('xyz')).toBe('unknown');
    });
  });

  describe('categorizeChanges', () => {
    it('should categorize all changes in a diff', () => {
      const diff: VersionDiff = {
        agentId: 'test-agent',
        from: '1.0',
        to: '2.0',
        changes: [
          { field: 'model', from: 'gpt-3.5', to: 'gpt-4' },
          { field: 'prompt', from: 'old', to: 'new' },
          { field: 'tools', from: '[]', to: '[search]' },
        ],
      };
      const categorized = categorizeChanges(diff);
      expect(categorized).toHaveLength(3);
      expect(categorized[0].category).toBe('model');
      expect(categorized[1].category).toBe('prompt');
      expect(categorized[2].category).toBe('tools');
    });
  });

  describe('summarizeCategories', () => {
    it('should count changes per category', () => {
      const categorized = [
        { field: 'model', from: 'a', to: 'b', category: 'model' as const },
        { field: 'prompt', from: 'a', to: 'b', category: 'prompt' as const },
        { field: 'temperature', from: '0.5', to: '0.7', category: 'model' as const },
      ];
      const summary = summarizeCategories(categorized);
      expect(summary.model).toBe(2);
      expect(summary.prompt).toBe(1);
      expect(summary.tools).toBe(0);
      expect(summary.config).toBe(0);
      expect(summary.unknown).toBe(0);
    });
  });

  describe('formatCategorySummary', () => {
    it('should format non-zero categories', () => {
      const result = formatCategorySummary({
        model: 2, prompt: 1, tools: 0, config: 0, unknown: 0,
      });
      expect(result).toContain('model: 2');
      expect(result).toContain('prompt: 1');
      expect(result).not.toContain('tools');
    });

    it('should say "no changes" when all zero', () => {
      const result = formatCategorySummary({
        model: 0, prompt: 0, tools: 0, config: 0, unknown: 0,
      });
      expect(result).toBe('no changes');
    });
  });

  describe('AgentVersionTracker', () => {
    let tmpDir: string;
    let storePath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'versioning-test-'));
      storePath = path.join(tmpDir, 'versions.json');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should record and retrieve version history', () => {
      const tracker = new AgentVersionTracker(storePath);
      tracker.recordVersion('agent-1', '1.0', { model: 'gpt-3.5', prompt: 'Do stuff' });
      tracker.recordVersion('agent-1', '2.0', { model: 'gpt-4', prompt: 'Do stuff better' });

      const history = tracker.getHistory('agent-1');
      expect(history).toHaveLength(2);
      expect(history[0].version).toBe('1.0');
      expect(history[1].version).toBe('2.0');
    });

    it('should get latest version', () => {
      const tracker = new AgentVersionTracker(storePath);
      tracker.recordVersion('agent-1', '1.0', { model: 'gpt-3.5' });
      tracker.recordVersion('agent-1', '2.0', { model: 'gpt-4' });

      const latest = tracker.getLatest('agent-1');
      expect(latest).toBeDefined();
      expect(latest!.version).toBe('2.0');
    });

    it('should return undefined for nonexistent agent', () => {
      const tracker = new AgentVersionTracker(storePath);
      expect(tracker.getLatest('nonexistent')).toBeUndefined();
    });

    it('should diff between versions', () => {
      const tracker = new AgentVersionTracker(storePath);
      tracker.recordVersion('agent-1', '1.0', { model: 'gpt-3.5', prompt: 'old' });
      tracker.recordVersion('agent-1', '2.0', { model: 'gpt-4', prompt: 'new' });

      const diff = tracker.diff('agent-1', '1.0', '2.0');
      expect(diff.changes.length).toBeGreaterThan(0);
    });

    it('should produce categorized diffs', () => {
      const tracker = new AgentVersionTracker(storePath);
      tracker.recordVersion('agent-1', '1.0', { model: 'gpt-3.5', prompt: 'old' });
      tracker.recordVersion('agent-1', '2.0', { model: 'gpt-4', prompt: 'new' });

      const categorized = tracker.categorizedDiff('agent-1', '1.0', '2.0');
      expect(categorized.length).toBeGreaterThan(0);
      expect(categorized.every(c => c.category)).toBe(true);
    });

    it('should list agents', () => {
      const tracker = new AgentVersionTracker(storePath);
      tracker.recordVersion('agent-1', '1.0', { model: 'gpt-4' });
      tracker.recordVersion('agent-2', '1.0', { model: 'claude-3' });

      const agents = tracker.listAgents();
      expect(agents).toContain('agent-1');
      expect(agents).toContain('agent-2');
    });

    it('should persist and reload from file', () => {
      const tracker1 = new AgentVersionTracker(storePath);
      tracker1.recordVersion('agent-1', '1.0', { model: 'gpt-4' });

      const tracker2 = new AgentVersionTracker(storePath);
      const history = tracker2.getHistory('agent-1');
      expect(history).toHaveLength(1);
      expect(history[0].metadata.model).toBe('gpt-4');
    });

    it('should handle nonexistent store path gracefully', () => {
      const noPath = path.join(tmpDir, 'nonexistent', 'versions.json');
      const tracker = new AgentVersionTracker(noPath);
      expect(tracker.listAgents()).toHaveLength(0);
    });
  });
});
