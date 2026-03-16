/**
 * Golden Test Pattern — Record and verify golden runs.
 *
 * Record a "golden" (reference) run, then verify subsequent runs
 * match the golden in terms of tools called, output similarity, and token budget.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTrace, AssertionResult } from './types';

export interface GoldenSnapshot {
  trace_id: string;
  recorded_at: string;
  tools_called: string[];
  tool_sequence: string[];
  output: string;
  total_tokens: number;
  total_steps: number;
  metadata: Record<string, any>;
}

export interface GoldenVerifyOptions {
  /** Max allowed deviation in token count (fraction, e.g. 0.2 = 20%) */
  token_tolerance?: number;
  /** Max allowed deviation in step count */
  step_tolerance?: number;
  /** Require exact same tools (order-insensitive) */
  exact_tools?: boolean;
  /** Require exact same tool sequence (order-sensitive) */
  exact_sequence?: boolean;
  /** Require output contains same key phrases */
  check_output?: boolean;
}

const DEFAULT_OPTIONS: GoldenVerifyOptions = {
  token_tolerance: 0.3,
  step_tolerance: 5,
  exact_tools: true,
  exact_sequence: false,
  check_output: false,
};

/**
 * Record a golden snapshot from a trace.
 */
export function recordGolden(trace: AgentTrace): GoldenSnapshot {
  const toolCalls = trace.steps
    .filter((s) => s.type === 'tool_call')
    .map((s) => s.data.tool_name!);

  const output = trace.steps
    .filter((s) => s.type === 'output')
    .map((s) => s.data.content ?? '')
    .join('\n');

  const totalTokens = trace.steps.reduce((sum, s) => {
    return sum + (s.data.tokens?.input ?? 0) + (s.data.tokens?.output ?? 0);
  }, 0);

  return {
    trace_id: trace.id,
    recorded_at: new Date().toISOString(),
    tools_called: [...new Set(toolCalls)],
    tool_sequence: toolCalls,
    output,
    total_tokens: totalTokens,
    total_steps: trace.steps.length,
    metadata: trace.metadata,
  };
}

/**
 * Save golden snapshot to disk.
 */
export function saveGolden(golden: GoldenSnapshot, outputDir: string, testName: string): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const filePath = path.join(outputDir, `${safeName}.golden.json`);
  fs.writeFileSync(filePath, JSON.stringify(golden, null, 2));
  return filePath;
}

/**
 * Load golden snapshot from disk.
 */
export function loadGolden(goldenDir: string, testName: string): GoldenSnapshot | null {
  const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const filePath = path.join(goldenDir, `${safeName}.golden.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Verify a trace against a golden snapshot.
 */
export function verifyGolden(
  trace: AgentTrace,
  golden: GoldenSnapshot,
  opts?: GoldenVerifyOptions,
): AssertionResult[] {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const results: AssertionResult[] = [];
  const current = recordGolden(trace);

  // Check tools called (set comparison)
  if (options.exact_tools) {
    const goldenSet = new Set(golden.tools_called);
    const currentSet = new Set(current.tools_called);
    const missing = [...goldenSet].filter((t) => !currentSet.has(t));
    const extra = [...currentSet].filter((t) => !goldenSet.has(t));
    const passed = missing.length === 0 && extra.length === 0;

    results.push({
      name: 'golden: tools_called',
      passed,
      expected: golden.tools_called,
      actual: current.tools_called,
      message: passed
        ? undefined
        : `Tools mismatch vs golden. ` +
          (missing.length ? `Missing: ${missing.join(', ')}. ` : '') +
          (extra.length ? `Unexpected: ${extra.join(', ')}. ` : '') +
          `Suggestion: Agent behavior has drifted — verify tool usage is still correct.`,
    });
  }

  // Check tool sequence
  if (options.exact_sequence) {
    const seqMatch = JSON.stringify(golden.tool_sequence) === JSON.stringify(current.tool_sequence);
    results.push({
      name: 'golden: tool_sequence',
      passed: seqMatch,
      expected: golden.tool_sequence,
      actual: current.tool_sequence,
      message: seqMatch
        ? undefined
        : `Tool call order differs from golden. ` +
          `Expected: ${golden.tool_sequence.join(' → ')}, ` +
          `Actual: ${current.tool_sequence.join(' → ')}. ` +
          `Suggestion: Agent is calling tools in a different order than the golden run.`,
    });
  }

  // Check token budget
  if (options.token_tolerance != null) {
    const tolerance = options.token_tolerance;
    const maxTokens = Math.round(golden.total_tokens * (1 + tolerance));
    const passed = current.total_tokens <= maxTokens;
    results.push({
      name: 'golden: token_budget',
      passed,
      expected: `<= ${maxTokens} (golden ${golden.total_tokens} + ${tolerance * 100}% tolerance)`,
      actual: current.total_tokens,
      message: passed
        ? undefined
        : `Token usage ${current.total_tokens} exceeds golden budget ${maxTokens} ` +
          `(golden: ${golden.total_tokens}, tolerance: ${tolerance * 100}%). ` +
          `Suggestion: Agent is using more tokens than the reference run — check for verbose prompts or extra LLM calls.`,
    });
  }

  // Check step count
  if (options.step_tolerance != null) {
    const maxSteps = golden.total_steps + options.step_tolerance;
    const passed = current.total_steps <= maxSteps;
    results.push({
      name: 'golden: step_count',
      passed,
      expected: `<= ${maxSteps} (golden ${golden.total_steps} + ${options.step_tolerance} tolerance)`,
      actual: current.total_steps,
      message: passed
        ? undefined
        : `Step count ${current.total_steps} exceeds golden budget ${maxSteps}. ` +
          `Suggestion: Agent is taking more steps than the reference — possible retry loops or extra tool calls.`,
    });
  }

  return results;
}
