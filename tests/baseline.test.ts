/**
 * Tests for src/baseline.ts - Baseline management
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaselineManager, formatBaselineList, type BaselineInfo } from '../src/baseline';
import type { SuiteResult } from '../src/types';

function makeSuiteResult(name: string, testCount: number): SuiteResult {
  const results = Array.from({ length: testCount }, (_, i) => ({
    name: `test-${i + 1}`,
    passed: true,
    duration_ms: 100,
    assertions: [{ key: 'max_steps', passed: true, message: 'ok' }],
    trace: {
      id: `trace-${i}`,
      timestamp: '2026-01-01T00:00:00Z',
      steps: [
        { type: 'llm_call' as const, timestamp: '2026-01-01T00:00:00Z', data: {}, duration_ms: 50 },
      ],
      metadata: {},
    },
  }));

  return {
    suite: name,
    passed: testCount,
    failed: 0,
    total: testCount,
    duration_ms: testCount * 100,
    results,
  };
}

describe('Baseline Manager', () => {
  let tmpDir: string;
  let manager: BaselineManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-test-'));
    manager = new BaselineManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('should save a baseline and return file path', () => {
      const result = makeSuiteResult('my-suite', 3);
      const filePath = manager.save('my-suite', result);
      expect(filePath).toContain('my-suite.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should sanitize name for filesystem safety', () => {
      const result = makeSuiteResult('test/suite:v1', 2);
      const filePath = manager.save('test/suite:v1', result);
      expect(filePath).not.toContain('/suite:v1');
      expect(filePath).toContain('test_suite_v1');
    });

    it('should create directory if it does not exist', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'dir');
      const nestedManager = new BaselineManager(nestedDir);
      const result = makeSuiteResult('test', 1);
      const filePath = nestedManager.save('test', result);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('load', () => {
    it('should load a previously saved baseline', () => {
      const result = makeSuiteResult('my-suite', 3);
      manager.save('my-suite', result);
      const loaded = manager.load('my-suite');
      expect(loaded).not.toBeNull();
      expect(loaded!.suite).toBe('my-suite');
      expect(loaded!.tests).toHaveLength(3);
    });

    it('should return null for nonexistent baseline', () => {
      expect(manager.load('nonexistent')).toBeNull();
    });
  });

  describe('list', () => {
    it('should list saved baselines', () => {
      manager.save('suite-1', makeSuiteResult('suite-1', 2));
      manager.save('suite-2', makeSuiteResult('suite-2', 3));
      const list = manager.list();
      expect(list).toHaveLength(2);
      expect(list.map(b => b.name)).toContain('suite-1');
      expect(list.map(b => b.name)).toContain('suite-2');
    });

    it('should return empty array when no baselines exist', () => {
      expect(manager.list()).toHaveLength(0);
    });

    it('should return empty for nonexistent directory', () => {
      const noManager = new BaselineManager('/nonexistent/dir');
      expect(noManager.list()).toHaveLength(0);
    });

    it('should include test count and save time', () => {
      manager.save('suite', makeSuiteResult('suite', 5));
      const list = manager.list();
      expect(list[0].testCount).toBe(5);
      expect(list[0].savedAt).toBeDefined();
    });

    it('should mark promoted baseline', () => {
      manager.save('suite-1', makeSuiteResult('suite-1', 2));
      manager.promote('suite-1');
      const list = manager.list();
      expect(list.find(b => b.name === 'suite-1')!.isPromoted).toBe(true);
    });
  });

  describe('promote', () => {
    it('should promote a baseline', () => {
      manager.save('suite-1', makeSuiteResult('suite-1', 2));
      manager.promote('suite-1');
      expect(manager.getPromotedName()).toBe('suite-1');
    });

    it('should throw for nonexistent baseline', () => {
      expect(() => manager.promote('nonexistent')).toThrow('not found');
    });

    it('should return promoted baseline via getPromoted', () => {
      manager.save('suite-1', makeSuiteResult('suite-1', 2));
      manager.promote('suite-1');
      const promoted = manager.getPromoted();
      expect(promoted).not.toBeNull();
      expect(promoted!.suite).toBe('suite-1');
    });
  });

  describe('getPromotedName', () => {
    it('should return null when nothing is promoted', () => {
      expect(manager.getPromotedName()).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a baseline', () => {
      manager.save('suite-1', makeSuiteResult('suite-1', 2));
      expect(manager.delete('suite-1')).toBe(true);
      expect(manager.load('suite-1')).toBeNull();
    });

    it('should return false for nonexistent baseline', () => {
      expect(manager.delete('nonexistent')).toBe(false);
    });

    it('should clear promoted if deleted baseline was promoted', () => {
      manager.save('suite-1', makeSuiteResult('suite-1', 2));
      manager.promote('suite-1');
      manager.delete('suite-1');
      expect(manager.getPromotedName()).toBeNull();
    });
  });
});

describe('formatBaselineList', () => {
  it('should format baseline list for console', () => {
    const list: BaselineInfo[] = [
      { name: 'suite-1', savedAt: '2026-01-01T00:00:00Z', suite: 'suite-1', testCount: 5, filePath: '/path/suite-1.json', isPromoted: true },
      { name: 'suite-2', savedAt: '2026-01-02T00:00:00Z', suite: 'suite-2', testCount: 3, filePath: '/path/suite-2.json', isPromoted: false },
    ];
    const output = formatBaselineList(list);
    expect(output).toContain('★');
    expect(output).toContain('suite-1');
    expect(output).toContain('suite-2');
    expect(output).toContain('5 tests');
    expect(output).toContain('3 tests');
  });

  it('should handle empty list', () => {
    expect(formatBaselineList([])).toContain('No baselines');
  });
});
