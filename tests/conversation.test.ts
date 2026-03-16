import { describe, it, expect } from 'vitest';
import { evaluateConversation, splitTraceByTurns, formatConversationResult } from '../src/conversation';
import type { ConversationTest } from '../src/conversation';
import { makeTrace, toolCall, output, llmCall } from './helpers';

describe('conversation', () => {
  it('single turn conversation passes', () => {
    const trace = makeTrace([toolCall('search'), output('hello world')]);
    const conv: ConversationTest = {
      name: 'single turn',
      turns: [{ user: 'hi', expect: { output_contains: 'hello' } }],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.passed).toBe(true);
    expect(result.turns).toHaveLength(1);
  });

  it('multi-turn (3 turns) conversation', () => {
    const trace = makeTrace([
      output('reply1'),
      output('reply2'),
      output('reply3'),
    ]);
    const conv: ConversationTest = {
      name: 'multi',
      turns: [
        { user: 'q1', expect: { output_contains: 'reply1' } },
        { user: 'q2', expect: { output_contains: 'reply2' } },
        { user: 'q3', expect: { output_contains: 'reply3' } },
      ],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.passed).toBe(true);
    expect(result.turns).toHaveLength(3);
  });

  it('turn with tool calls', () => {
    const trace = makeTrace([toolCall('search'), output('found it')]);
    const conv: ConversationTest = {
      name: 'tool turn',
      turns: [{ user: 'find X', expect: { tool_called: 'search' } }],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.passed).toBe(true);
  });

  it('turn with no tool calls', () => {
    const trace = makeTrace([output('just text')]);
    const conv: ConversationTest = {
      name: 'no tools',
      turns: [{ user: 'hi', expect: { output_contains: 'just text' } }],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.passed).toBe(true);
  });

  it('per-turn assertion passes', () => {
    const trace = makeTrace([toolCall('a'), output('out1'), toolCall('b'), output('out2')]);
    const conv: ConversationTest = {
      name: 'per-turn',
      turns: [
        { user: 'q1', expect: { tool_called: 'a' } },
        { user: 'q2', expect: { tool_called: 'b' } },
      ],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.turns[0].passed).toBe(true);
    expect(result.turns[1].passed).toBe(true);
  });

  it('per-turn assertion fails', () => {
    const trace = makeTrace([output('out1'), output('out2')]);
    const conv: ConversationTest = {
      name: 'fail turn',
      turns: [
        { user: 'q1', expect: { output_contains: 'out1' } },
        { user: 'q2', expect: { tool_called: 'missing_tool' } },
      ],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.turns[0].passed).toBe(true);
    expect(result.turns[1].passed).toBe(false);
  });

  it('conversation with all turns passing', () => {
    const trace = makeTrace([output('a'), output('b')]);
    const conv: ConversationTest = {
      name: 'all pass',
      turns: [
        { user: 'q1', expect: { output_contains: 'a' } },
        { user: 'q2', expect: { output_contains: 'b' } },
      ],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.passed).toBe(true);
    expect(result.failed_at_turn).toBeUndefined();
  });

  it('conversation with middle turn failing', () => {
    const trace = makeTrace([output('a'), output('b'), output('c')]);
    const conv: ConversationTest = {
      name: 'mid fail',
      turns: [
        { user: 'q1', expect: { output_contains: 'a' } },
        { user: 'q2', expect: { output_contains: 'MISSING' } },
        { user: 'q3', expect: { output_contains: 'c' } },
      ],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.passed).toBe(false);
    expect(result.failed_at_turn).toBe(2);
  });

  it('empty turns array', () => {
    const trace = makeTrace([output('hello')]);
    const conv: ConversationTest = { name: 'empty', turns: [] };
    const result = evaluateConversation(trace, conv);
    expect(result.passed).toBe(true);
    expect(result.turns).toHaveLength(0);
  });

  it('turn with multiple expectations', () => {
    const trace = makeTrace([toolCall('search'), output('hello world')]);
    const conv: ConversationTest = {
      name: 'multi-expect',
      turns: [{ user: 'hi', expect: { tool_called: 'search', output_contains: 'hello' } }],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.passed).toBe(true);
  });

  it('splitTraceByTurns returns single trace for turnCount=1', () => {
    const trace = makeTrace([output('a'), output('b')]);
    const splits = splitTraceByTurns(trace, 1);
    expect(splits).toHaveLength(1);
    expect(splits[0].steps).toHaveLength(2);
  });

  it('splitTraceByTurns returns empty for turnCount=0', () => {
    const trace = makeTrace([output('a')]);
    const splits = splitTraceByTurns(trace, 0);
    expect(splits).toHaveLength(0);
  });

  it('splitTraceByTurns splits by output boundaries', () => {
    const trace = makeTrace([toolCall('a'), output('out1'), toolCall('b'), output('out2')]);
    const splits = splitTraceByTurns(trace, 2);
    expect(splits).toHaveLength(2);
  });

  it('formatConversationResult includes turn info', () => {
    const trace = makeTrace([output('hello')]);
    const conv: ConversationTest = {
      name: 'fmt test',
      turns: [{ user: 'hi', expect: { output_contains: 'hello' } }],
    };
    const result = evaluateConversation(trace, conv);
    const formatted = formatConversationResult(result);
    expect(formatted).toContain('fmt test');
    expect(formatted).toContain('Turn 1');
  });

  it('formatConversationResult shows failure info', () => {
    const trace = makeTrace([output('hello')]);
    const conv: ConversationTest = {
      name: 'fail fmt',
      turns: [{ user: 'hi', expect: { output_contains: 'MISSING' } }],
    };
    const result = evaluateConversation(trace, conv);
    const formatted = formatConversationResult(result);
    expect(formatted).toContain('Failed at turn 1');
  });

  it('more turns than trace steps creates trace-missing assertions', () => {
    const trace = makeTrace([output('only one')]);
    const conv: ConversationTest = {
      name: 'overflow',
      turns: [
        { user: 'q1', expect: { output_contains: 'only one' } },
        { user: 'q2', expect: { output_contains: 'anything' } },
        { user: 'q3', expect: { output_contains: 'anything' } },
      ],
    };
    const result = evaluateConversation(trace, conv);
    expect(result.passed).toBe(false);
  });
});
