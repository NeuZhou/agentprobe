import type { AgentTrace, Expectations, AssertionResult } from './types';
import { evaluate } from './assertions';

// ===== Tone analysis =====

export type ToneLabel = 'friendly' | 'formal' | 'neutral' | 'assertive' | 'empathetic' | 'humorous';

const TONE_SIGNALS: Record<ToneLabel, { positive: string[]; negative: string[] }> = {
  friendly: {
    positive: ['hi', 'hello', 'hey', 'glad', 'happy', 'welcome', 'great', 'thanks', 'sure', 'absolutely', '!', '😊', 'pleased'],
    negative: ['error', 'denied', 'forbidden', 'unauthorized', 'impossible'],
  },
  formal: {
    positive: ['please', 'kindly', 'regarding', 'therefore', 'accordingly', 'sincerely', 'respectfully'],
    negative: ['hey', 'yeah', 'nah', 'gonna', 'wanna', 'lol', 'haha'],
  },
  neutral: {
    positive: ['the', 'is', 'are', 'this', 'that', 'result', 'output', 'data'],
    negative: [],
  },
  assertive: {
    positive: ['must', 'should', 'need', 'require', 'important', 'critical', 'essential'],
    negative: ['maybe', 'perhaps', 'possibly', 'might'],
  },
  empathetic: {
    positive: ['understand', 'sorry', 'appreciate', 'feel', 'help', 'concern', 'care'],
    negative: ['irrelevant', 'not my problem', 'deal with it'],
  },
  humorous: {
    positive: ['haha', 'lol', 'funny', 'joke', '😄', '😂', 'laugh'],
    negative: [],
  },
};

/**
 * Detect if text matches a target tone via keyword heuristics.
 */
export function detectTone(text: string, target: ToneLabel): { matches: boolean; score: number } {
  const lower = text.toLowerCase();
  const signals = TONE_SIGNALS[target];
  if (!signals) return { matches: false, score: 0 };

  let positiveHits = 0;
  let negativeHits = 0;

  for (const word of signals.positive) {
    if (lower.includes(word)) positiveHits++;
  }
  for (const word of signals.negative) {
    if (lower.includes(word)) negativeHits++;
  }

  const score = signals.positive.length > 0
    ? (positiveHits - negativeHits) / signals.positive.length
    : 0;

  return { matches: score > 0.05, score };
}

// ===== Enhanced conversation types =====

export interface ConversationExpectations extends Expectations {
  /** Expected tone of the response */
  tone?: ToneLabel;
  /** Agent should maintain context from previous turns */
  context_maintained?: boolean;
  /** Output length constraints */
  output_length?: { min?: number; max?: number };
  /** Specific context keys that should be retained from prior turns */
  context_retained?: string[];
  /** Tool args must contain these key-value pairs (context carry-forward) */
  args_contain?: Record<string, any>;
}

/**
 * A single turn in a multi-turn conversation test.
 */
export interface ConversationTurn {
  user: string;
  expect: ConversationExpectations;
}

/**
 * A multi-turn conversation test definition.
 */
export interface ConversationTest {
  name: string;
  turns: ConversationTurn[];
  tags?: string[];
}

/**
 * Result of evaluating a single turn.
 */
export interface TurnResult {
  turn: number;
  user: string;
  assertions: AssertionResult[];
  passed: boolean;
}

/**
 * Result of evaluating an entire conversation.
 */
export interface ConversationResult {
  name: string;
  turns: TurnResult[];
  passed: boolean;
  failed_at_turn?: number;
}

/**
 * Split a full trace into per-turn sub-traces based on user messages.
 *
 * The strategy: each time we see an output step that follows an llm_call
 * sequence, we consider it a new "turn boundary". We use a simpler heuristic —
 * split trace.steps into N segments where N = number of turns requested.
 * Steps are divided roughly by looking for sequential groups of
 * tool_call/tool_result/llm_call/output patterns.
 */
export function splitTraceByTurns(trace: AgentTrace, turnCount: number): AgentTrace[] {
  if (turnCount <= 0) return [];
  if (turnCount === 1) return [trace];

  // Find output step indices as turn boundaries
  const outputIndices: number[] = [];
  for (let i = 0; i < trace.steps.length; i++) {
    if (trace.steps[i].type === 'output') {
      outputIndices.push(i);
    }
  }

  // If we have enough output steps, use them as boundaries
  if (outputIndices.length >= turnCount) {
    const subTraces: AgentTrace[] = [];
    let start = 0;
    for (let t = 0; t < turnCount; t++) {
      const end = t < turnCount - 1 ? outputIndices[t] + 1 : trace.steps.length;
      subTraces.push({
        id: `${trace.id}-turn-${t + 1}`,
        timestamp: trace.steps[start]?.timestamp ?? trace.timestamp,
        steps: trace.steps.slice(start, end),
        metadata: { ...trace.metadata, turn: t + 1 },
      });
      start = end;
    }
    return subTraces;
  }

  // Fallback: evenly divide steps
  const chunkSize = Math.ceil(trace.steps.length / turnCount);
  const subTraces: AgentTrace[] = [];
  for (let t = 0; t < turnCount; t++) {
    const start = t * chunkSize;
    const end = Math.min(start + chunkSize, trace.steps.length);
    if (start >= trace.steps.length) break;
    subTraces.push({
      id: `${trace.id}-turn-${t + 1}`,
      timestamp: trace.steps[start]?.timestamp ?? trace.timestamp,
      steps: trace.steps.slice(start, end),
      metadata: { ...trace.metadata, turn: t + 1 },
    });
  }
  return subTraces;
}

/**
 * Evaluate a multi-turn conversation against a trace.
 */
export function evaluateConversation(
  trace: AgentTrace,
  conversation: ConversationTest,
): ConversationResult {
  const turnTraces = splitTraceByTurns(trace, conversation.turns.length);
  const turnResults: TurnResult[] = [];
  let failed_at_turn: number | undefined;

  for (let i = 0; i < conversation.turns.length; i++) {
    const turn = conversation.turns[i];
    const turnTrace = turnTraces[i];

    if (!turnTrace) {
      turnResults.push({
        turn: i + 1,
        user: turn.user,
        assertions: [{
          name: `turn ${i + 1}: trace missing`,
          passed: false,
          message: `No trace data for turn ${i + 1}`,
        }],
        passed: false,
      });
      if (failed_at_turn === undefined) failed_at_turn = i + 1;
      continue;
    }

    const assertions = evaluate(turnTrace, turn.expect);

    // Enhanced: tone check
    if (turn.expect.tone) {
      const output = turnTrace.steps
        .filter(s => s.type === 'output')
        .map(s => s.data.content ?? '')
        .join('\n');
      const { matches, score } = detectTone(output, turn.expect.tone);
      assertions.push({
        name: `tone: ${turn.expect.tone}`,
        passed: matches,
        expected: turn.expect.tone,
        actual: `score=${score.toFixed(2)}`,
        message: matches ? undefined : `Response tone does not match "${turn.expect.tone}"`,
      });
    }

    // Enhanced: context_maintained check
    if (turn.expect.context_maintained && i > 0) {
      // Check that previous user messages' keywords appear in output or tool args
      const output = turnTrace.steps
        .filter(s => s.type === 'output')
        .map(s => s.data.content ?? '')
        .join('\n')
        .toLowerCase();
      const toolArgs = turnTrace.steps
        .filter(s => s.type === 'tool_call')
        .map(s => JSON.stringify(s.data.tool_args ?? {}))
        .join(' ')
        .toLowerCase();
      const combined = output + ' ' + toolArgs;

      // Extract significant words from previous turn's user message
      const prevUser = conversation.turns[i - 1].user.toLowerCase();
      const keywords = prevUser.split(/\s+/).filter(w => w.length > 3);
      const contextPresent = keywords.length === 0 || keywords.some(kw => combined.includes(kw));

      assertions.push({
        name: 'context_maintained',
        passed: contextPresent,
        expected: 'references to previous turn',
        actual: contextPresent ? 'context found' : 'no context from previous turn',
        message: contextPresent ? undefined : 'Agent does not appear to maintain context from previous turn',
      });
    }

    // Enhanced: context_retained — check specific context keys are present
    if (turn.expect.context_retained && turn.expect.context_retained.length > 0) {
      const allToolArgs = turnTrace.steps
        .filter(s => s.type === 'tool_call')
        .map(s => JSON.stringify(s.data.tool_args ?? {}))
        .join(' ')
        .toLowerCase();
      const allOutput = turnTrace.steps
        .filter(s => s.type === 'output')
        .map(s => s.data.content ?? '')
        .join('\n')
        .toLowerCase();
      const combined = allToolArgs + ' ' + allOutput;

      for (const key of turn.expect.context_retained) {
        const found = combined.includes(key.toLowerCase());
        assertions.push({
          name: `context_retained: ${key}`,
          passed: found,
          expected: `context key "${key}" retained`,
          actual: found ? 'found' : 'missing',
          message: found ? undefined : `Context key "${key}" not found in agent response or tool args`,
        });
      }
    }

    // Enhanced: args_contain — check tool call args contain specific values
    if (turn.expect.args_contain) {
      const toolCalls = turnTrace.steps.filter(s => s.type === 'tool_call');
      for (const [key, expectedVal] of Object.entries(turn.expect.args_contain)) {
        const found = toolCalls.some(tc => {
          const args = tc.data.tool_args ?? {};
          if (typeof expectedVal === 'string') {
            return String(args[key] ?? '').toLowerCase() === expectedVal.toLowerCase();
          }
          return args[key] === expectedVal;
        });
        assertions.push({
          name: `args_contain: ${key}=${JSON.stringify(expectedVal)}`,
          passed: found,
          expected: `${key}=${JSON.stringify(expectedVal)}`,
          actual: found ? 'found' : `not found in ${toolCalls.length} tool calls`,
          message: found ? undefined : `No tool call has ${key}=${JSON.stringify(expectedVal)}`,
        });
      }
    }

    // Enhanced: output_length check
    if (turn.expect.output_length) {
      const output = turnTrace.steps
        .filter(s => s.type === 'output')
        .map(s => s.data.content ?? '')
        .join('\n');
      const len = output.length;
      if (turn.expect.output_length.min !== undefined) {
        assertions.push({
          name: `output_length >= ${turn.expect.output_length.min}`,
          passed: len >= turn.expect.output_length.min,
          expected: `>= ${turn.expect.output_length.min}`,
          actual: `${len}`,
        });
      }
      if (turn.expect.output_length.max !== undefined) {
        assertions.push({
          name: `output_length <= ${turn.expect.output_length.max}`,
          passed: len <= turn.expect.output_length.max,
          expected: `<= ${turn.expect.output_length.max}`,
          actual: `${len}`,
        });
      }
    }

    const passed = assertions.every(a => a.passed);
    turnResults.push({
      turn: i + 1,
      user: turn.user,
      assertions,
      passed,
    });

    if (!passed && failed_at_turn === undefined) {
      failed_at_turn = i + 1;
    }
  }

  return {
    name: conversation.name,
    turns: turnResults,
    passed: failed_at_turn === undefined,
    failed_at_turn,
  };
}

/**
 * Format conversation result for display.
 */
export function formatConversationResult(result: ConversationResult): string {
  const lines: string[] = [];
  const icon = result.passed ? '✅' : '❌';
  lines.push(`${icon} ${result.name}`);

  for (const turn of result.turns) {
    const tIcon = turn.passed ? '✓' : '✗';
    lines.push(`   Turn ${turn.turn}: "${turn.user}" ${tIcon}`);
    for (const a of turn.assertions) {
      if (!a.passed) {
        lines.push(`     ❌ ${a.name}: ${a.message ?? 'failed'}`);
      }
    }
  }

  if (result.failed_at_turn) {
    lines.push(`   ⚠ Failed at turn ${result.failed_at_turn}`);
  }

  return lines.join('\n');
}
