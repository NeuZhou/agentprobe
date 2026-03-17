/**
 * Tests for src/trace-store.ts - Local JSON file-based trace storage
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TraceStore } from '../src/trace-store';
import type { AgentTrace } from '../src/types';

function makeTrace(id: string, overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id,
    timestamp: '2026-01-15T10:00:00Z',
    steps: [
      {
        type: 'tool_call',
        timestamp: '2026-01-15T10:00:00Z',
        data: { tool_name: 'search', tool_args: { q: 'test' } },
        duration_ms: 100,
      },
      {
        type: 'output',
        timestamp: '2026-01-15T10:00:01Z',
        data: { content: 'result' },
        duration_ms: 10,
      },
    ],
    metadata: {},
    ...overrides,
  };
}

describe('TraceStore', () => {
  let tmpDir: string;
  let dbPath: string;
  let store: TraceStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracestore-test-'));
    dbPath = path.join(tmpDir, 'traces.db.json');
    store = new TraceStore(dbPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('should save a trace and return a UUID', () => {
      const trace = makeTrace('trace-1');
      const id = store.save(trace);
      expect(id).toBeDefined();
      expect(id.length).toBeGreaterThan(0);
    });

    it('should persist to disk', () => {
      store.save(makeTrace('trace-1'));
      expect(fs.existsSync(dbPath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      expect(data.entries).toHaveLength(1);
    });

    it('should save with tags', () => {
      store.save(makeTrace('trace-1'), { tags: ['integration', 'fast'] });
      expect(store.count()).toBe(1);
    });

    it('should save with adapter metadata', () => {
      store.save(makeTrace('trace-1'), { adapter: 'openai', cost: 0.05 });
      const stats = store.stats();
      expect(stats.byAdapter['openai']).toBe(1);
      expect(stats.totalCost).toBeCloseTo(0.05);
    });
  });

  describe('get', () => {
    it('should retrieve a saved trace by ID', () => {
      const trace = makeTrace('trace-1');
      const id = store.save(trace);
      const retrieved = store.get(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('trace-1');
    });

    it('should return null for unknown ID', () => {
      expect(store.get('nonexistent-id')).toBeNull();
    });
  });

  describe('search', () => {
    it('should search by tool name', () => {
      store.save(makeTrace('t1'));
      store.save(makeTrace('t2', {
        steps: [
          { type: 'tool_call', timestamp: '', data: { tool_name: 'write_file' }, duration_ms: 50 },
        ],
      }));

      const results = store.search({ tool: 'search' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('t1');
    });

    it('should search by date range', () => {
      store.save(makeTrace('t1', { timestamp: '2026-01-10T00:00:00Z' }));
      store.save(makeTrace('t2', { timestamp: '2026-01-20T00:00:00Z' }));

      const results = store.search({
        dateRange: [new Date('2026-01-15'), new Date('2026-01-25')],
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('t2');
    });

    it('should search by tags', () => {
      store.save(makeTrace('t1'), { tags: ['fast', 'integration'] });
      store.save(makeTrace('t2'), { tags: ['slow'] });

      const results = store.search({ tags: ['fast'] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('t1');
    });

    it('should require all tags to match', () => {
      store.save(makeTrace('t1'), { tags: ['fast', 'integration'] });
      store.save(makeTrace('t2'), { tags: ['fast'] });

      const results = store.search({ tags: ['fast', 'integration'] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('t1');
    });

    it('should return all traces with empty query', () => {
      store.save(makeTrace('t1'));
      store.save(makeTrace('t2'));
      const results = store.search({});
      expect(results).toHaveLength(2);
    });
  });

  describe('stats', () => {
    it('should compute aggregate statistics', () => {
      store.save(makeTrace('t1'), { adapter: 'openai', cost: 0.03 });
      store.save(makeTrace('t2'), { adapter: 'anthropic', cost: 0.05 });
      store.save(makeTrace('t3'), { adapter: 'openai', cost: 0.02 });

      const stats = store.stats();
      expect(stats.total).toBe(3);
      expect(stats.byAdapter['openai']).toBe(2);
      expect(stats.byAdapter['anthropic']).toBe(1);
      expect(stats.totalCost).toBeCloseTo(0.10);
    });

    it('should handle empty store', () => {
      const stats = store.stats();
      expect(stats.total).toBe(0);
      expect(stats.totalCost).toBe(0);
    });
  });

  describe('prune', () => {
    it('should delete traces older than given date', () => {
      store.save(makeTrace('t1'));
      // Wait a bit to have different savedAt
      const before = store.count();
      const deleted = store.prune(new Date(Date.now() + 100000)); // future date
      expect(deleted).toBe(before);
      expect(store.count()).toBe(0);
    });

    it('should keep traces newer than given date', () => {
      store.save(makeTrace('t1'));
      const deleted = store.prune(new Date('2020-01-01'));
      expect(deleted).toBe(0);
      expect(store.count()).toBe(1);
    });
  });

  describe('count', () => {
    it('should return the number of stored traces', () => {
      expect(store.count()).toBe(0);
      store.save(makeTrace('t1'));
      expect(store.count()).toBe(1);
      store.save(makeTrace('t2'));
      expect(store.count()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      store.save(makeTrace('t1'));
      store.save(makeTrace('t2'));
      store.clear();
      expect(store.count()).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should reload data from file across instances', () => {
      store.save(makeTrace('t1'));
      const store2 = new TraceStore(dbPath);
      expect(store2.count()).toBe(1);
      const retrieved = store2.get(store.search({})[0].id);
      // IDs are UUIDs so we can't match directly
      expect(store2.search({}).length).toBe(1);
    });

    it('should handle corrupt file gracefully', () => {
      fs.writeFileSync(dbPath, 'CORRUPT DATA');
      const store2 = new TraceStore(dbPath);
      expect(store2.count()).toBe(0);
    });

    it('should create directory if needed', () => {
      const nestedPath = path.join(tmpDir, 'nested', 'deep', 'traces.db.json');
      const nestedStore = new TraceStore(nestedPath);
      nestedStore.save(makeTrace('t1'));
      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });
});
