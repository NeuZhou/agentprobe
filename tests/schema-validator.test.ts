/**
 * New Feature: YAML Schema Validation
 * Validate YAML test files against the expected schema before running.
 */
import { describe, it, expect } from 'vitest';
import { validateTestSuiteSchema, type SchemaValidationResult } from '../src/schema-validator';

describe('Schema Validator', () => {
  it('should accept valid test suite', () => {
    const valid = {
      name: 'My Suite',
      tests: [
        {
          name: 'test-1',
          input: 'hello',
          expect: { output_contains: 'hi' },
        },
      ],
    };
    const result = validateTestSuiteSchema(valid);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('should reject suite without name', () => {
    const invalid = {
      tests: [
        { name: 'test-1', input: 'hello', expect: { output_contains: 'hi' } },
      ],
    };
    const result = validateTestSuiteSchema(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('should reject suite without tests array', () => {
    const invalid = { name: 'Suite' };
    const result = validateTestSuiteSchema(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('tests'))).toBe(true);
  });

  it('should reject test without name', () => {
    const invalid = {
      name: 'Suite',
      tests: [{ input: 'hello', expect: { output_contains: 'hi' } }],
    };
    const result = validateTestSuiteSchema(invalid);
    expect(result.valid).toBe(false);
  });

  it('should reject test without input', () => {
    const invalid = {
      name: 'Suite',
      tests: [{ name: 'test-1', expect: { output_contains: 'hi' } }],
    };
    const result = validateTestSuiteSchema(invalid);
    expect(result.valid).toBe(false);
  });

  it('should reject test without expect', () => {
    const invalid = {
      name: 'Suite',
      tests: [{ name: 'test-1', input: 'hello' }],
    };
    const result = validateTestSuiteSchema(invalid);
    expect(result.valid).toBe(false);
  });

  it('should accept valid config', () => {
    const valid = {
      name: 'Suite',
      config: { timeout_ms: 30000, parallel: true, max_concurrency: 4 },
      tests: [
        { name: 'test-1', input: 'hello', expect: { max_steps: 5 } },
      ],
    };
    const result = validateTestSuiteSchema(valid);
    expect(result.valid).toBe(true);
  });

  it('should warn on unknown expect fields', () => {
    const suite = {
      name: 'Suite',
      tests: [
        {
          name: 'test-1',
          input: 'hello',
          expect: { output_contains: 'hi', unknown_field: true },
        },
      ],
    };
    const result = validateTestSuiteSchema(suite);
    // Should have warnings for unknown fields
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should validate expect field types', () => {
    const invalid = {
      name: 'Suite',
      tests: [
        {
          name: 'test-1',
          input: 'hello',
          expect: { max_steps: 'not a number' },
        },
      ],
    };
    const result = validateTestSuiteSchema(invalid);
    expect(result.valid).toBe(false);
  });

  it('should accept templates in expect', () => {
    const valid = {
      name: 'Suite',
      tests: [
        {
          name: 'test-1',
          input: 'hello',
          template: 'safety_basic',
          expect: { max_steps: 5 },
        },
      ],
    };
    const result = validateTestSuiteSchema(valid);
    expect(result.valid).toBe(true);
  });

  it('should validate tags as string arrays', () => {
    const valid = {
      name: 'Suite',
      tests: [
        {
          name: 'test-1',
          input: 'hello',
          tags: ['smoke', 'security'],
          expect: { max_steps: 5 },
        },
      ],
    };
    const result = validateTestSuiteSchema(valid);
    expect(result.valid).toBe(true);
  });

  it('should return all errors at once', () => {
    const invalid = {
      // missing name
      tests: [
        { expect: { output_contains: 'hi' } }, // missing name and input
        { name: 'test-2' }, // missing input and expect
      ],
    };
    const result = validateTestSuiteSchema(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
