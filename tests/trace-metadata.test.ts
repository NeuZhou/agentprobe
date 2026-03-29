import { describe, it, expect } from 'vitest';
import { tagTrace, filterByMetadata } from '../src/trace-metadata';
import type { AgentTrace } from '../src/types';

function makeTrace(id: string, metadata: Record<string, any> = {}): AgentTrace {
  return {
    id,
    timestamp: new Date().toISOString(),
    steps: [],
    metadata,
  };
}

describe('Trace Metadata', () => {
  describe('tagTrace', () => {
    it('adds metadata to an empty trace', () => {
      const trace = makeTrace('t1');
      const tagged = tagTrace(trace, { environment: 'prod' });
      expect(tagged.metadata.environment).toBe('prod');
    });

    it('merges with existing metadata', () => {
      const trace = makeTrace('t1', { existing: 'value' });
      const tagged = tagTrace(trace, { environment: 'prod' });
      expect(tagged.metadata.existing).toBe('value');
      expect(tagged.metadata.environment).toBe('prod');
    });

    it('overwrites existing keys on conflict', () => {
      const trace = makeTrace('t1', { environment: 'dev' });
      const tagged = tagTrace(trace, { environment: 'prod' });
      expect(tagged.metadata.environment).toBe('prod');
    });

    it('does not mutate original trace', () => {
      const trace = makeTrace('t1');
      tagTrace(trace, { environment: 'prod' });
      expect(trace.metadata.environment).toBeUndefined();
    });

    it('handles feature_flags array', () => {
      const trace = makeTrace('t1');
      const tagged = tagTrace(trace, { feature_flags: ['dark-mode', 'beta'] });
      expect(tagged.metadata.feature_flags).toEqual(['dark-mode', 'beta']);
    });
  });

  describe('filterByMetadata', () => {
    const traces = [
      makeTrace('t1', { environment: 'prod', version: '1.0', feature_flags: ['beta'] }),
      makeTrace('t2', { environment: 'staging', version: '1.0' }),
      makeTrace('t3', { environment: 'prod', version: '2.0', feature_flags: ['dark-mode'] }),
    ];

    it('filters by equals criterion', () => {
      const result = filterByMetadata(traces, { equals: { environment: 'prod' } });
      expect(result).toHaveLength(2);
      expect(result.map(t => t.id)).toEqual(['t1', 't3']);
    });

    it('filters by multiple equals criteria (AND)', () => {
      const result = filterByMetadata(traces, {
        equals: { environment: 'prod', version: '2.0' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t3');
    });

    it('filters by contains criterion', () => {
      const result = filterByMetadata(traces, { contains: { feature_flags: 'beta' } });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t1');
    });

    it('filters by exists criterion', () => {
      const result = filterByMetadata(traces, { exists: ['feature_flags'] });
      expect(result).toHaveLength(2);
    });

    it('filters by notExists criterion', () => {
      const result = filterByMetadata(traces, { notExists: ['feature_flags'] });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t2');
    });

    it('returns all traces with empty filter', () => {
      const result = filterByMetadata(traces, {});
      expect(result).toHaveLength(3);
    });

    it('returns empty on impossible filter', () => {
      const result = filterByMetadata(traces, {
        equals: { environment: 'nonexistent' },
      });
      expect(result).toHaveLength(0);
    });

    it('combines equals and exists filters', () => {
      const result = filterByMetadata(traces, {
        equals: { environment: 'prod' },
        exists: ['feature_flags'],
      });
      expect(result).toHaveLength(2);
    });
  });
});
