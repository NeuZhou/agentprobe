/**
 * Tests for src/validate.ts - Input validation with "did you mean?" suggestions
 */
import { describe, it, expect } from 'vitest';
import {
  validateSuite,
  validateExpectations,
  validateTrace,
  formatValidationErrors,
} from '../src/validate';

describe('Validate', () => {
  describe('validateSuite', () => {
    it('should pass for a valid minimal suite', () => {
      const result = validateSuite({
        name: 'Test Suite',
        tests: [
          { name: 'test1', input: 'hello', expect: { output_contains: 'hi' } },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for non-object input', () => {
      expect(validateSuite(null).valid).toBe(false);
      expect(validateSuite(undefined).valid).toBe(false);
      expect(validateSuite('string').valid).toBe(false);
    });

    it('should fail when name is missing', () => {
      const result = validateSuite({
        tests: [{ name: 'test1', input: 'hi', expect: { output_contains: 'x' } }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'name')).toBe(true);
    });

    it('should fail when tests is missing', () => {
      const result = validateSuite({ name: 'Test' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'tests')).toBe(true);
    });

    it('should fail when tests is not an array', () => {
      const result = validateSuite({ name: 'Test', tests: 'not-array' });
      expect(result.valid).toBe(false);
    });

    it('should detect unknown suite keys with suggestion', () => {
      const result = validateSuite({
        name: 'Test',
        tets: [], // typo for "tests"
      });
      expect(result.valid).toBe(false);
      const unknownKey = result.errors.find(e => e.message.includes("Unknown suite key 'tets'"));
      expect(unknownKey).toBeDefined();
      expect(unknownKey!.suggestion).toContain('tests');
    });

    it('should detect unknown test keys with suggestion', () => {
      const result = validateSuite({
        name: 'Test',
        tests: [
          { name: 'test1', inpt: 'hello', expect: { output_contains: 'x' } },
        ],
      });
      expect(result.valid).toBe(false);
      const unknownKey = result.errors.find(e => e.message.includes("Unknown test key 'inpt'"));
      expect(unknownKey).toBeDefined();
      expect(unknownKey!.suggestion).toContain('input');
    });

    it('should fail when test has no name', () => {
      const result = validateSuite({
        name: 'Suite',
        tests: [{ input: 'hi', expect: { output_contains: 'x' } }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('name'))).toBe(true);
    });

    it('should fail when test has neither input nor trace', () => {
      const result = validateSuite({
        name: 'Suite',
        tests: [{ name: 'test1', expect: { output_contains: 'x' } }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes("'input' or 'trace'"))).toBe(true);
    });

    it('should allow test with trace instead of input', () => {
      const result = validateSuite({
        name: 'Suite',
        tests: [{ name: 'test1', trace: 'path/to/trace.json', expect: { max_steps: 5 } }],
      });
      expect(result.valid).toBe(true);
    });

    it('should fail when test has no expect and no template', () => {
      const result = validateSuite({
        name: 'Suite',
        tests: [{ name: 'test1', input: 'hi' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('expect'))).toBe(true);
    });

    it('should allow test with template instead of expect', () => {
      const result = validateSuite({
        name: 'Suite',
        tests: [{ name: 'test1', input: 'hi', template: 'security_scan' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate nested expectations', () => {
      const result = validateSuite({
        name: 'Suite',
        tests: [
          {
            name: 'test1',
            input: 'hi',
            expect: { max_stips: 5 }, // typo
          },
        ],
      });
      expect(result.valid).toBe(false);
      const err = result.errors.find(e => e.message.includes("Unknown assertion 'max_stips'"));
      expect(err).toBeDefined();
      expect(err!.suggestion).toContain('max_steps');
    });
  });

  describe('validateExpectations', () => {
    it('should pass for valid assertions', () => {
      const errors = validateExpectations({
        tool_called: 'search',
        max_steps: 10,
        output_contains: 'result',
      });
      expect(errors).toHaveLength(0);
    });

    it('should detect unknown assertion keys', () => {
      const errors = validateExpectations({ tool_caled: 'search' });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].suggestion).toContain('tool_called');
    });

    it('should validate max_steps is a number', () => {
      const errors = validateExpectations({ max_steps: 'five' });
      expect(errors.some(e => e.message.includes('max_steps must be a number'))).toBe(true);
    });

    it('should validate max_tokens is a number', () => {
      const errors = validateExpectations({ max_tokens: '100' });
      expect(errors.some(e => e.message.includes('max_tokens must be a number'))).toBe(true);
    });

    it('should validate max_duration_ms is a number', () => {
      const errors = validateExpectations({ max_duration_ms: true });
      expect(errors.some(e => e.message.includes('max_duration_ms must be a number'))).toBe(true);
    });

    it('should validate max_cost_usd is a number', () => {
      const errors = validateExpectations({ max_cost_usd: 'cheap' });
      expect(errors.some(e => e.message.includes('max_cost_usd must be a number'))).toBe(true);
    });

    it('should validate snapshot is a boolean', () => {
      const errors = validateExpectations({ snapshot: 'yes' });
      expect(errors.some(e => e.message.includes('snapshot must be a boolean'))).toBe(true);
    });

    it('should validate tool_sequence is an array', () => {
      const errors = validateExpectations({ tool_sequence: 'search' });
      expect(errors.some(e => e.message.includes('tool_sequence must be an array'))).toBe(true);
    });

    it('should accept valid tool_sequence array', () => {
      const errors = validateExpectations({ tool_sequence: ['search', 'write'] });
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateTrace', () => {
    it('should pass for a valid trace', () => {
      const result = validateTrace({
        id: 'trace-1',
        timestamp: '2026-01-01T00:00:00Z',
        steps: [
          { type: 'llm_call', timestamp: '2026-01-01T00:00:00Z', data: { model: 'gpt-4' } },
        ],
        metadata: {},
      });
      expect(result.valid).toBe(true);
    });

    it('should fail for non-object input', () => {
      expect(validateTrace(null).valid).toBe(false);
      expect(validateTrace(42).valid).toBe(false);
    });

    it('should fail when id is missing', () => {
      const result = validateTrace({
        timestamp: '2026-01-01T00:00:00Z',
        steps: [],
        metadata: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'id')).toBe(true);
    });

    it('should fail when timestamp is missing', () => {
      const result = validateTrace({
        id: 'trace-1',
        steps: [],
        metadata: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'timestamp')).toBe(true);
    });

    it('should fail when steps is not an array', () => {
      const result = validateTrace({
        id: 'trace-1',
        timestamp: '2026-01-01T00:00:00Z',
        steps: 'not-array',
        metadata: {},
      });
      expect(result.valid).toBe(false);
    });

    it('should detect invalid step types', () => {
      const result = validateTrace({
        id: 'trace-1',
        timestamp: '2026-01-01T00:00:00Z',
        steps: [
          { type: 'invalid_type', timestamp: '2026-01-01T00:00:00Z', data: {} },
        ],
        metadata: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid step type'))).toBe(true);
    });

    it('should detect steps without data', () => {
      const result = validateTrace({
        id: 'trace-1',
        timestamp: '2026-01-01T00:00:00Z',
        steps: [
          { type: 'llm_call', timestamp: '2026-01-01T00:00:00Z' },
        ],
        metadata: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('data object'))).toBe(true);
    });

    it('should accept all valid step types', () => {
      const validTypes = ['llm_call', 'tool_call', 'tool_result', 'thought', 'output'];
      const steps = validTypes.map(type => ({
        type,
        timestamp: '2026-01-01T00:00:00Z',
        data: {},
      }));
      const result = validateTrace({
        id: 'trace-1',
        timestamp: '2026-01-01T00:00:00Z',
        steps,
        metadata: {},
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('formatValidationErrors', () => {
    it('should format errors with path and message', () => {
      const output = formatValidationErrors([
        { path: 'tests[0].name', message: 'Test must have a name' },
      ]);
      expect(output).toContain('❌');
      expect(output).toContain('tests[0].name');
      expect(output).toContain('Test must have a name');
    });

    it('should include suggestion when present', () => {
      const output = formatValidationErrors([
        { path: 'expect.max_stips', message: "Unknown assertion 'max_stips'", suggestion: "Did you mean 'max_steps'?" },
      ]);
      expect(output).toContain('max_steps');
    });

    it('should handle errors without path', () => {
      const output = formatValidationErrors([
        { path: '', message: 'Suite must be an object' },
      ]);
      expect(output).toContain('Suite must be an object');
    });

    it('should handle empty errors array', () => {
      const output = formatValidationErrors([]);
      expect(output).toBe('');
    });
  });
});
