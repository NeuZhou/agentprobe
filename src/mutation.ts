/**
 * Mutation Testing - Inject faults into test assertions to verify test quality.
 *
 * Tests the tests: mutate assertions and check if the test suite catches the mutations.
 */

import type { TestCase } from './types';

export type MutationType =
  | 'remove_assertion'
  | 'change_expected_output'
  | 'weaken_threshold'
  | 'swap_tool_name'
  | 'remove_tool_sequence'
  | 'negate_assertion';

export interface Mutation {
  type: MutationType;
  description: string;
  testName: string;
  field: string;
  original: any;
  mutated: any;
}

export interface MutationResult {
  mutation: Mutation;
  caught: boolean; // true = test failed (good), false = test still passed (bad)
  message?: string;
}

export interface MutationReport {
  total: number;
  caught: number;
  escaped: number;
  score: number; // percentage of caught mutations
  results: MutationResult[];
}

/**
 * Generate mutations for a test case.
 */
export function generateMutations(test: TestCase): Mutation[] {
  const mutations: Mutation[] = [];
  const expect = test.expect;
  if (!expect) return mutations;

  // Remove tool_called assertion
  if (expect.tool_called) {
    mutations.push({
      type: 'remove_assertion',
      description: `Remove tool_called assertion`,
      testName: test.name,
      field: 'tool_called',
      original: expect.tool_called,
      mutated: undefined,
    });
  }

  // Remove output_contains
  if (expect.output_contains) {
    mutations.push({
      type: 'remove_assertion',
      description: `Remove output_contains assertion`,
      testName: test.name,
      field: 'output_contains',
      original: expect.output_contains,
      mutated: undefined,
    });
  }

  // Change expected output
  if (expect.output_contains) {
    const original = Array.isArray(expect.output_contains)
      ? expect.output_contains[0]
      : expect.output_contains;
    mutations.push({
      type: 'change_expected_output',
      description: `Change expected output to nonsense`,
      testName: test.name,
      field: 'output_contains',
      original,
      mutated: '__MUTATED_IMPOSSIBLE_OUTPUT_XYZ__',
    });
  }

  // Weaken max_steps threshold
  if (expect.max_steps) {
    mutations.push({
      type: 'weaken_threshold',
      description: `Increase max_steps from ${expect.max_steps} to 999`,
      testName: test.name,
      field: 'max_steps',
      original: expect.max_steps,
      mutated: 999,
    });
  }

  // Weaken max_tokens threshold
  if (expect.max_tokens) {
    mutations.push({
      type: 'weaken_threshold',
      description: `Increase max_tokens from ${expect.max_tokens} to 999999`,
      testName: test.name,
      field: 'max_tokens',
      original: expect.max_tokens,
      mutated: 999999,
    });
  }

  // Swap tool name
  if (expect.tool_called) {
    const toolName = Array.isArray(expect.tool_called)
      ? expect.tool_called[0]
      : expect.tool_called;
    mutations.push({
      type: 'swap_tool_name',
      description: `Swap tool_called from "${toolName}" to "nonexistent_tool"`,
      testName: test.name,
      field: 'tool_called',
      original: toolName,
      mutated: 'nonexistent_tool',
    });
  }

  // Remove tool_sequence
  if (expect.tool_sequence) {
    mutations.push({
      type: 'remove_tool_sequence',
      description: `Remove tool_sequence assertion`,
      testName: test.name,
      field: 'tool_sequence',
      original: expect.tool_sequence,
      mutated: undefined,
    });
  }

  // Negate output_matches
  if (expect.output_matches) {
    mutations.push({
      type: 'negate_assertion',
      description: `Change output_matches pattern to never-match`,
      testName: test.name,
      field: 'output_matches',
      original: expect.output_matches,
      mutated: '^$IMPOSSIBLE_NEVER_MATCHES$',
    });
  }

  // Remove max_duration_ms
  if (expect.max_duration_ms) {
    mutations.push({
      type: 'remove_assertion',
      description: `Remove max_duration_ms assertion`,
      testName: test.name,
      field: 'max_duration_ms',
      original: expect.max_duration_ms,
      mutated: undefined,
    });
  }

  // Remove max_cost_usd
  if (expect.max_cost_usd) {
    mutations.push({
      type: 'remove_assertion',
      description: `Remove max_cost_usd assertion`,
      testName: test.name,
      field: 'max_cost_usd',
      original: expect.max_cost_usd,
      mutated: undefined,
    });
  }

  return mutations;
}

/**
 * Apply a mutation to a test case, returning a mutated copy.
 */
export function applyMutation(test: TestCase, mutation: Mutation): TestCase {
  const mutated = JSON.parse(JSON.stringify(test));
  if (mutation.mutated === undefined) {
    delete mutated.expect[mutation.field];
  } else {
    mutated.expect[mutation.field] = mutation.mutated;
  }
  return mutated;
}

/**
 * Run mutation analysis on a set of test cases.
 * Accepts a test runner function that returns pass/fail for a test.
 */
export async function runMutationAnalysis(
  tests: TestCase[],
  runTest: (test: TestCase) => Promise<boolean>,
): Promise<MutationReport> {
  const results: MutationResult[] = [];

  for (const test of tests) {
    const mutations = generateMutations(test);
    for (const mutation of mutations) {
      const mutatedTest = applyMutation(test, mutation);
      try {
        const passed = await runTest(mutatedTest);
        results.push({
          mutation,
          caught: !passed, // If mutated test fails, mutation was caught
          message: passed ? 'Test still passes with mutation (ESCAPED)' : 'Test correctly fails (CAUGHT)',
        });
      } catch (err) {
        results.push({
          mutation,
          caught: true,
          message: `Test threw error (CAUGHT): ${err}`,
        });
      }
    }
  }

  const caught = results.filter(r => r.caught).length;
  const escaped = results.filter(r => !r.caught).length;

  return {
    total: results.length,
    caught,
    escaped,
    score: results.length > 0 ? Math.round((caught / results.length) * 100) : 100,
    results,
  };
}

/**
 * Format mutation report for terminal display.
 */
export function formatMutationReport(report: MutationReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('🧬 Mutation Testing Report');
  lines.push('═'.repeat(60));
  lines.push(`  Mutation score: ${report.score}% (${report.caught}/${report.total} caught)`);
  lines.push('');

  for (const result of report.results) {
    const icon = result.caught ? '✓' : '✗';
    const status = result.caught ? 'CAUGHT' : 'ESCAPED';
    lines.push(`  ${icon} ${result.mutation.description} → ${status}`);
  }

  lines.push('');

  if (report.escaped > 0) {
    lines.push('  ⚠️  Escaped mutations indicate weak test assertions.');
    lines.push('  Consider adding more specific assertions to catch these cases.');
    lines.push('');
  }

  return lines.join('\n');
}
