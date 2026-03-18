/**
 * Tests for src/similarity.ts - Trace similarity calculation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  toolSequenceSimilarity,
  outputSimilarity,
  traceSimilarity,
  findSimilarTraces,
  formatSimilarityResults,
} from '../src/similarity';
import type { AgentTrace } from '../src/types';

function makeTrace(tools: string[], outputs: string[] = []): AgentTrace {
  const steps = [
    ...tools.map(t => ({
      type: 'tool_call' as const,
      timestamp: '2026-01-01T00:00:00Z',
      data: { tool_name: t },
    })),
    ...outputs.map(o => ({
      type: 'output' as const,
      timestamp: '2026-01-01T00:00:01Z',
      data: { content: o },
    })),
  ];
  return {
    id: 'trace-sim',
    timestamp: '2026-01-01T00:00:00Z',
    steps,
    metadata: {},
  };
}

describe('Similarity', () => {
  describe('toolSequenceSimilarity', () => {
    it('should return 1 for identical tool sequences', () => {
      const a = makeTrace(['search', 'write', 'publish']);
      const b = makeTrace(['search', 'write', 'publish']);
      expect(toolSequenceSimilarity(a, b)).toBe(1);
    });

    it('should return 0 for completely different sequences', () => {
      const a = makeTrace(['search', 'write']);
      const b = makeTrace(['delete', 'format']);
      expect(toolSequenceSimilarity(a, b)).toBe(0);
    });

    it('should handle empty tool sequences', () => {
      const a = makeTrace([]);
      const b = makeTrace([]);
      expect(toolSequenceSimilarity(a, b)).toBe(1);
    });

    it('should handle one empty sequence', () => {
      const a = makeTrace(['search']);
      const b = makeTrace([]);
      expect(toolSequenceSimilarity(a, b)).toBe(0);
    });

    it('should handle partial overlap', () => {
      const a = makeTrace(['search', 'process', 'write']);
      const b = makeTrace(['search', 'write']);
      const sim = toolSequenceSimilarity(a, b);
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });
  });

  describe('outputSimilarity', () => {
    it('should return 1 for identical outputs', () => {
      const a = makeTrace([], ['hello world']);
      const b = makeTrace([], ['hello world']);
      expect(outputSimilarity(a, b)).toBe(1);
    });

    it('should return 0 for completely different outputs', () => {
      const a = makeTrace([], ['alpha bravo charlie']);
      const b = makeTrace([], ['delta echo foxtrot']);
      expect(outputSimilarity(a, b)).toBe(0);
    });

    it('should handle empty outputs', () => {
      const a = makeTrace([]);
      const b = makeTrace([]);
      expect(outputSimilarity(a, b)).toBe(1);
    });

    it('should handle partial overlap', () => {
      const a = makeTrace([], ['the quick brown fox']);
      const b = makeTrace([], ['the slow brown dog']);
      const sim = outputSimilarity(a, b);
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });
  });

  describe('traceSimilarity', () => {
    it('should combine tool and output similarity', () => {
      const a = makeTrace(['search'], ['hello world']);
      const b = makeTrace(['search'], ['hello world']);
      expect(traceSimilarity(a, b)).toBe(1);
    });

    it('should respect custom weights', () => {
      const a = makeTrace(['search', 'write'], ['hello world']);
      const b = makeTrace(['search'], ['hello world']);
      const toolHeavy = traceSimilarity(a, b, { toolWeight: 0.9, outputWeight: 0.1 });
      const outputHeavy = traceSimilarity(a, b, { toolWeight: 0.1, outputWeight: 0.9 });
      // Output is identical (1.0), tools are partially similar
      // outputHeavy should be higher because output similarity is 1.0
      expect(outputHeavy).toBeGreaterThan(toolHeavy);
    });
  });

  describe('findSimilarTraces', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should find similar traces in corpus', () => {
      const corpus1 = makeTrace(['search', 'write'], ['hello world']);
      const corpus2 = makeTrace(['delete', 'format'], ['goodbye moon']);
      fs.writeFileSync(path.join(tmpDir, 'c1.json'), JSON.stringify(corpus1));
      fs.writeFileSync(path.join(tmpDir, 'c2.json'), JSON.stringify(corpus2));

      const target = makeTrace(['search', 'write'], ['hello there']);
      const results = findSimilarTraces(target, tmpDir);

      expect(results.length).toBe(2);
      // c1 should be more similar
      expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    });

    it('should return empty for nonexistent directory', () => {
      const target = makeTrace(['search']);
      const results = findSimilarTraces(target, '/nonexistent/path');
      expect(results).toHaveLength(0);
    });

    it('should respect topN', () => {
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(tmpDir, `t${i}.json`), JSON.stringify(makeTrace([`tool_${i}`])));
      }
      const target = makeTrace(['tool_0']);
      const results = findSimilarTraces(target, tmpDir, { topN: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('formatSimilarityResults', () => {
    it('should format results for display', () => {
      const results = [
        { tracePath: '/path/trace1.json', similarity: 0.95, reason: 'same tool pattern' },
        { tracePath: '/path/trace2.json', similarity: 0.72, reason: 'similar output' },
      ];
      const output = formatSimilarityResults(results);
      expect(output).toContain('trace1.json');
      expect(output).toContain('0.95');
    });

    it('should handle empty results', () => {
      const output = formatSimilarityResults([]);
      expect(output).toContain('No similar traces');
    });
  });
});
