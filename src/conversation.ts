import type { AgentTrace, Expectations, AssertionResult } from './types';
import { evaluate } from './assertions';

/**
 * A single turn in a multi-turn conversation test.
 */
export interface ConversationTurn {
  user: string;
  expect: Expectations;
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
