/**
 * Schema Validator — Validate YAML test suite structure before running.
 *
 * Catches common mistakes early: missing fields, wrong types, unknown keys.
 */

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const KNOWN_EXPECT_FIELDS = new Set([
  'tool_called',
  'tool_not_called',
  'tool_sequence',
  'tool_args_match',
  'output_contains',
  'output_not_contains',
  'output_matches',
  'max_steps',
  'max_tokens',
  'max_cost_usd',
  'max_duration_ms',
  'snapshot',
  'custom',
  'judge',
  'judge_rubric',
  'not',
  'all_of',
  'any_of',
  'none_of',
  'chain',
  'custom_assertions',
  'weighted',
  'pass_threshold',
]);

const NUMERIC_EXPECT_FIELDS = new Set([
  'max_steps',
  'max_tokens',
  'max_cost_usd',
  'max_duration_ms',
]);

/**
 * Validate a parsed test suite object against the expected schema.
 */
export function validateTestSuiteSchema(suite: any): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Top-level checks
  if (!suite.name && typeof suite.name !== 'string') {
    errors.push('Suite is missing required field: "name"');
  }

  if (!suite.tests || !Array.isArray(suite.tests)) {
    errors.push('Suite is missing required field: "tests" (array)');
    return { valid: false, errors, warnings };
  }

  // Validate each test
  for (let i = 0; i < suite.tests.length; i++) {
    const test = suite.tests[i];
    const prefix = `tests[${i}]`;

    if (!test.name) {
      errors.push(`${prefix}: missing required field "name"`);
    }

    if (test.input === undefined && test.input !== '') {
      errors.push(`${prefix}: missing required field "input"`);
    }

    if (!test.expect) {
      errors.push(`${prefix}: missing required field "expect"`);
    } else {
      // Validate expect field types
      for (const key of Object.keys(test.expect)) {
        if (!KNOWN_EXPECT_FIELDS.has(key)) {
          warnings.push(`${prefix}.expect: unknown field "${key}"`);
        }
      }

      // Validate numeric fields
      for (const field of NUMERIC_EXPECT_FIELDS) {
        if (test.expect[field] !== undefined && typeof test.expect[field] !== 'number') {
          errors.push(`${prefix}.expect.${field}: expected number, got ${typeof test.expect[field]}`);
        }
      }
    }

    // Validate tags
    if (test.tags !== undefined) {
      if (!Array.isArray(test.tags)) {
        errors.push(`${prefix}.tags: expected array of strings`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
