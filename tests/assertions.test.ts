import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/assertions';
import { makeTrace, toolCall, output, llmCall } from './helpers';

describe('assertions', () => {
  describe('tool_called', () => {
    it('passes when tool is present', () => {
      const trace = makeTrace([toolCall('search')]);
      const results = evaluate(trace, { tool_called: 'search' });
      expect(results[0].passed).toBe(true);
    });

    it('fails when tool is absent', () => {
      const trace = makeTrace([toolCall('read')]);
      const results = evaluate(trace, { tool_called: 'search' });
      expect(results[0].passed).toBe(false);
    });

    it('handles multiple tools', () => {
      const trace = makeTrace([toolCall('search'), toolCall('write')]);
      const results = evaluate(trace, { tool_called: ['search', 'write'] });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.passed)).toBe(true);
    });
  });

  describe('tool_not_called', () => {
    it('passes when tool is absent', () => {
      const trace = makeTrace([toolCall('read')]);
      const results = evaluate(trace, { tool_not_called: 'exec' });
      expect(results[0].passed).toBe(true);
    });

    it('fails when tool is present', () => {
      const trace = makeTrace([toolCall('exec')]);
      const results = evaluate(trace, { tool_not_called: 'exec' });
      expect(results[0].passed).toBe(false);
    });
  });

  describe('output_contains', () => {
    it('passes on match', () => {
      const trace = makeTrace([output('Hello world')]);
      const results = evaluate(trace, { output_contains: 'Hello' });
      expect(results[0].passed).toBe(true);
    });

    it('fails on no match', () => {
      const trace = makeTrace([output('Hello world')]);
      const results = evaluate(trace, { output_contains: 'Goodbye' });
      expect(results[0].passed).toBe(false);
    });

    it('handles multiple needles', () => {
      const trace = makeTrace([output('Hello world foo')]);
      const results = evaluate(trace, { output_contains: ['Hello', 'foo'] });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.passed)).toBe(true);
    });
  });

  describe('output_not_contains', () => {
    it('passes when absent', () => {
      const trace = makeTrace([output('Hello')]);
      const results = evaluate(trace, { output_not_contains: 'secret' });
      expect(results[0].passed).toBe(true);
    });

    it('fails when present', () => {
      const trace = makeTrace([output('secret data')]);
      const results = evaluate(trace, { output_not_contains: 'secret' });
      expect(results[0].passed).toBe(false);
    });
  });

  describe('output_matches', () => {
    it('passes on regex match', () => {
      const trace = makeTrace([output('Order #12345 confirmed')]);
      const results = evaluate(trace, { output_matches: '#\\d+' });
      expect(results[0].passed).toBe(true);
    });

    it('fails on no regex match', () => {
      const trace = makeTrace([output('No numbers here')]);
      const results = evaluate(trace, { output_matches: '#\\d+' });
      expect(results[0].passed).toBe(false);
    });
  });

  describe('max_steps', () => {
    it('passes when under', () => {
      const trace = makeTrace([toolCall('a'), toolCall('b')]);
      const results = evaluate(trace, { max_steps: 5 });
      expect(results[0].passed).toBe(true);
    });

    it('fails when over', () => {
      const trace = makeTrace([toolCall('a'), toolCall('b'), toolCall('c')]);
      const results = evaluate(trace, { max_steps: 2 });
      expect(results[0].passed).toBe(false);
    });

    it('passes when exact', () => {
      const trace = makeTrace([toolCall('a'), toolCall('b')]);
      const results = evaluate(trace, { max_steps: 2 });
      expect(results[0].passed).toBe(true);
    });
  });

  describe('max_tokens', () => {
    it('passes when under', () => {
      const trace = makeTrace([llmCall({ input: 50, output: 30 })]);
      const results = evaluate(trace, { max_tokens: 100 });
      expect(results[0].passed).toBe(true);
    });

    it('fails when over', () => {
      const trace = makeTrace([llmCall({ input: 50, output: 60 })]);
      const results = evaluate(trace, { max_tokens: 100 });
      expect(results[0].passed).toBe(false);
    });
  });

  describe('max_duration_ms', () => {
    it('passes when under', () => {
      const trace = makeTrace([toolCall('a', {}, 100), toolCall('b', {}, 200)]);
      const results = evaluate(trace, { max_duration_ms: 500 });
      expect(results[0].passed).toBe(true);
    });

    it('fails when over', () => {
      const trace = makeTrace([toolCall('a', {}, 300), toolCall('b', {}, 300)]);
      const results = evaluate(trace, { max_duration_ms: 500 });
      expect(results[0].passed).toBe(false);
    });
  });

  describe('tool_sequence', () => {
    it('passes on correct order', () => {
      const trace = makeTrace([toolCall('search'), toolCall('read'), toolCall('write')]);
      const results = evaluate(trace, { tool_sequence: ['search', 'read', 'write'] });
      expect(results[0].passed).toBe(true);
    });

    it('fails on wrong order', () => {
      const trace = makeTrace([toolCall('write'), toolCall('search'), toolCall('read')]);
      const results = evaluate(trace, { tool_sequence: ['search', 'read', 'write'] });
      expect(results[0].passed).toBe(false);
    });

    it('passes with partial matches (subsequence)', () => {
      const trace = makeTrace([toolCall('init'), toolCall('search'), toolCall('log'), toolCall('write')]);
      const results = evaluate(trace, { tool_sequence: ['search', 'write'] });
      expect(results[0].passed).toBe(true);
    });
  });

  describe('tool_args_match', () => {
    it('matches exact args', () => {
      const trace = makeTrace([toolCall('search', { query: 'test', limit: 10 })]);
      const results = evaluate(trace, { tool_args_match: { search: { query: 'test', limit: 10 } } });
      expect(results[0].passed).toBe(true);
    });

    it('matches partial args', () => {
      const trace = makeTrace([toolCall('search', { query: 'test', limit: 10, extra: true })]);
      const results = evaluate(trace, { tool_args_match: { search: { query: 'test' } } });
      expect(results[0].passed).toBe(true);
    });

    it('matches nested args', () => {
      const trace = makeTrace([toolCall('api', { config: { url: 'http://x', headers: { auth: 'tok' } } })]);
      const results = evaluate(trace, { tool_args_match: { api: { config: { url: 'http://x' } } } });
      expect(results[0].passed).toBe(true);
    });

    it('fails when tool not called', () => {
      const trace = makeTrace([toolCall('read')]);
      const results = evaluate(trace, { tool_args_match: { search: { query: 'test' } } });
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('not called');
    });
  });

  describe('custom', () => {
    it('passes on true expression', () => {
      const trace = makeTrace([toolCall('search')]);
      const results = evaluate(trace, { custom: 'toolCalls.length === 1' });
      expect(results[0].passed).toBe(true);
    });

    it('fails on false expression', () => {
      const trace = makeTrace([toolCall('search')]);
      const results = evaluate(trace, { custom: 'toolCalls.length === 5' });
      expect(results[0].passed).toBe(false);
    });

    it('fails on error expression', () => {
      const trace = makeTrace([]);
      const results = evaluate(trace, { custom: 'undefined.foo.bar' });
      expect(results[0].passed).toBe(false);
      expect(results[0].message).toContain('Error');
    });
  });
});
