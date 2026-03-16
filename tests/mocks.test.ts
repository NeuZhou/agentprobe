import { describe, it, expect, beforeEach } from 'vitest';
import { MockToolkit } from '../src/mocks';

describe('MockToolkit', () => {
  let toolkit: MockToolkit;

  beforeEach(() => {
    toolkit = new MockToolkit();
  });

  describe('mock()', () => {
    it('returns value and tracks calls', () => {
      toolkit.mock('search', (args) => ({ results: [args.query] }));
      const r = toolkit.invoke('search', { query: 'test' });
      expect(r.mocked).toBe(true);
      expect(r.result).toEqual({ results: ['test'] });
      expect(toolkit.getCallCount('search')).toBe(1);
      expect(toolkit.getCalls('search')).toHaveLength(1);
      expect(toolkit.getCalls('search')[0].args).toEqual({ query: 'test' });
    });

    it('returns empty object with default handler', () => {
      toolkit.mock('noop');
      const r = toolkit.invoke('noop', {});
      expect(r.mocked).toBe(true);
      expect(r.result).toEqual({});
    });

    it('returns not mocked for unknown tools', () => {
      const r = toolkit.invoke('unknown', {});
      expect(r.mocked).toBe(false);
    });
  });

  describe('mockOnce()', () => {
    it('returns once then undefined', () => {
      toolkit.mockOnce('fetch', { data: 'hello' });
      const r1 = toolkit.invoke('fetch', {});
      expect(r1.result).toEqual({ data: 'hello' });
      const r2 = toolkit.invoke('fetch', {});
      expect(r2.result).toBeUndefined();
    });
  });

  describe('mockSequence()', () => {
    it('returns in order', () => {
      toolkit.mockSequence('api', ['first', 'second', 'third']);
      expect(toolkit.invoke('api', {}).result).toBe('first');
      expect(toolkit.invoke('api', {}).result).toBe('second');
      expect(toolkit.invoke('api', {}).result).toBe('third');
      expect(toolkit.invoke('api', {}).result).toBeUndefined();
    });
  });

  describe('mockError()', () => {
    it('throws error', () => {
      toolkit.mockError('fail', 'Boom!');
      expect(() => toolkit.invoke('fail', {})).toThrow('Boom!');
    });
  });

  describe('restore()', () => {
    it('clears all mocks', () => {
      toolkit.mock('a');
      toolkit.mock('b');
      expect(toolkit.getMockedTools()).toHaveLength(2);
      toolkit.restore();
      expect(toolkit.getMockedTools()).toHaveLength(0);
      expect(toolkit.invoke('a', {}).mocked).toBe(false);
    });

    it('clears specific mock', () => {
      toolkit.mock('a');
      toolkit.mock('b');
      toolkit.restore('a');
      expect(toolkit.hasMock('a')).toBe(false);
      expect(toolkit.hasMock('b')).toBe(true);
    });
  });

  describe('callCount tracking', () => {
    it('tracks multiple calls', () => {
      toolkit.mock('tool');
      toolkit.invoke('tool', { a: 1 });
      toolkit.invoke('tool', { a: 2 });
      toolkit.invoke('tool', { a: 3 });
      expect(toolkit.getCallCount('tool')).toBe(3);
      expect(toolkit.getCalls('tool')).toHaveLength(3);
    });

    it('returns 0 for unmocked tool', () => {
      expect(toolkit.getCallCount('none')).toBe(0);
      expect(toolkit.getCalls('none')).toEqual([]);
    });
  });
});
