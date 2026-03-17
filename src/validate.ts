/**
 * Input Validation — Schema validation for test YAML, trace JSON, config files, and CLI arguments.
 *
 * Provides user-friendly error messages with "did you mean?" suggestions.
 */

// Types referenced for documentation; runtime validation uses string keys

/** Known assertion keys in the Expectations type. */
const KNOWN_ASSERTION_KEYS: readonly string[] = [
  'tool_called',
  'tool_not_called',
  'output_contains',
  'output_not_contains',
  'output_matches',
  'max_steps',
  'max_tokens',
  'max_duration_ms',
  'tool_args_match',
  'tool_sequence',
  'snapshot',
  'max_cost_usd',
  'custom',
  'judge',
  'judge_rubric',
  'not',
  'all_of',
  'any_of',
  'none_of',
  'chain',
  'custom_assertions',
] as const;

/** Known top-level test case keys. */
const KNOWN_TEST_KEYS: readonly string[] = [
  'name',
  'id',
  'input',
  'context',
  'trace',
  'agent',
  'fixture',
  'mocks',
  'faults',
  'tags',
  'each',
  'retries',
  'retry_delay_ms',
  'depends_on',
  'env',
  'template',
  'template_params',
  'timeout_ms',
  'replay_overrides',
  'expect',
] as const;

/** Known suite-level keys. */
const KNOWN_SUITE_KEYS: readonly string[] = [
  'name',
  'description',
  'config',
  'hooks',
  'tests',
  'conversations',
] as const;

/**
 * Validation error with location context.
 */
export interface ValidationError {
  path: string;
  message: string;
  suggestion?: string;
}

/**
 * Result of validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Find the closest match for a string among candidates.
 */
function findClosest(input: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(input.toLowerCase(), c.toLowerCase());
    if (d < bestDist && d <= Math.max(2, Math.floor(c.length / 3))) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * Validate a test suite YAML structure.
 */
export function validateSuite(data: any): ValidationResult {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== 'object') {
    errors.push({ path: '', message: 'Suite must be an object' });
    return { valid: false, errors };
  }

  // Check unknown top-level keys
  for (const key of Object.keys(data)) {
    if (!KNOWN_SUITE_KEYS.includes(key)) {
      const suggestion = findClosest(key, KNOWN_SUITE_KEYS);
      errors.push({
        path: key,
        message: `Unknown suite key '${key}'`,
        suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
      });
    }
  }

  if (!data.name || typeof data.name !== 'string') {
    errors.push({ path: 'name', message: "Suite must have a 'name' field (string)" });
  }

  if (!data.tests || !Array.isArray(data.tests)) {
    errors.push({ path: 'tests', message: "Suite must have a 'tests' array" });
    return { valid: errors.length === 0, errors };
  }

  for (let i = 0; i < data.tests.length; i++) {
    const test = data.tests[i];
    const prefix = `tests[${i}]`;

    if (!test.name) {
      errors.push({ path: `${prefix}.name`, message: 'Test must have a name' });
    }
    if (test.input === undefined && !test.trace) {
      errors.push({
        path: `${prefix}.input`,
        message: "Test must have 'input' or 'trace'",
      });
    }

    // Check unknown test keys
    for (const key of Object.keys(test)) {
      if (!KNOWN_TEST_KEYS.includes(key)) {
        const suggestion = findClosest(key, KNOWN_TEST_KEYS);
        errors.push({
          path: `${prefix}.${key}`,
          message: `Unknown test key '${key}'`,
          suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
        });
      }
    }

    if ((!test.expect || typeof test.expect !== 'object') && !test.template) {
      errors.push({ path: `${prefix}.expect`, message: 'Test must have an expect block (or use a template)' });
      continue;
    }

    if (!test.expect) {
      continue;
    }

    // Validate expectations
    const expectErrors = validateExpectations(test.expect, `${prefix}.expect`);
    errors.push(...expectErrors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an expectations object for unknown/misspelled assertion keys.
 */
export function validateExpectations(expect: any, pathPrefix = 'expect'): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const key of Object.keys(expect)) {
    if (!KNOWN_ASSERTION_KEYS.includes(key)) {
      const suggestion = findClosest(key, KNOWN_ASSERTION_KEYS);
      errors.push({
        path: `${pathPrefix}.${key}`,
        message: `Unknown assertion '${key}'`,
        suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
      });
    }
  }

  // Type checks for known fields
  if (expect.max_steps !== undefined && typeof expect.max_steps !== 'number') {
    errors.push({ path: `${pathPrefix}.max_steps`, message: 'max_steps must be a number' });
  }
  if (expect.max_tokens !== undefined && typeof expect.max_tokens !== 'number') {
    errors.push({ path: `${pathPrefix}.max_tokens`, message: 'max_tokens must be a number' });
  }
  if (expect.max_duration_ms !== undefined && typeof expect.max_duration_ms !== 'number') {
    errors.push({
      path: `${pathPrefix}.max_duration_ms`,
      message: 'max_duration_ms must be a number',
    });
  }
  if (expect.max_cost_usd !== undefined && typeof expect.max_cost_usd !== 'number') {
    errors.push({ path: `${pathPrefix}.max_cost_usd`, message: 'max_cost_usd must be a number' });
  }
  if (expect.snapshot !== undefined && typeof expect.snapshot !== 'boolean') {
    errors.push({ path: `${pathPrefix}.snapshot`, message: 'snapshot must be a boolean' });
  }
  if (expect.tool_sequence !== undefined && !Array.isArray(expect.tool_sequence)) {
    errors.push({
      path: `${pathPrefix}.tool_sequence`,
      message: 'tool_sequence must be an array of strings',
    });
  }

  return errors;
}

/**
 * Validate a trace JSON structure.
 */
export function validateTrace(data: any): ValidationResult {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== 'object') {
    errors.push({ path: '', message: 'Trace must be an object' });
    return { valid: false, errors };
  }

  if (!data.id || typeof data.id !== 'string') {
    errors.push({ path: 'id', message: "Trace must have an 'id' (string)" });
  }
  if (!data.timestamp || typeof data.timestamp !== 'string') {
    errors.push({ path: 'timestamp', message: "Trace must have a 'timestamp' (ISO string)" });
  }
  if (!Array.isArray(data.steps)) {
    errors.push({ path: 'steps', message: "Trace must have a 'steps' array" });
    return { valid: errors.length === 0, errors };
  }

  const validStepTypes = ['llm_call', 'tool_call', 'tool_result', 'thought', 'output'];
  for (let i = 0; i < data.steps.length; i++) {
    const step = data.steps[i];
    if (!step.type || !validStepTypes.includes(step.type)) {
      errors.push({
        path: `steps[${i}].type`,
        message: `Invalid step type '${step.type}'. Must be one of: ${validStepTypes.join(', ')}`,
      });
    }
    if (!step.data || typeof step.data !== 'object') {
      errors.push({ path: `steps[${i}].data`, message: 'Step must have a data object' });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format validation errors for CLI output.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => {
      let msg = `❌ ${e.path ? `[${e.path}] ` : ''}${e.message}`;
      if (e.suggestion) msg += ` — ${e.suggestion}`;
      return msg;
    })
    .join('\n');
}
