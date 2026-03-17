import { describe, it, expect } from 'vitest';
import { evaluateConversation, splitTraceByTurns, formatConversationResult } from '../src/conversation';
import { evaluateScoring, formatScoringResult } from '../src/scoring';
import { generateFromNL, formatGeneratedTestsYaml } from '../src/nlgen';
import { anonymize, anonymizeString, anonymizeTrace } from '../src/anonymize';
import { profile, formatProfile } from '../src/profiler';
import { makeTrace, toolCall, output, llmCall } from './helpers';

// ===== Conversation Testing =====
describe('conversation', () => {
  it('evaluates multi-turn conversation', () => {
    const trace = makeTrace([
      toolCall('lookup_subscription'),
      output('I\'m sorry to hear that you want to cancel.'),
      toolCall('cancel_subscription'),
      output('Your subscription has been cancelled.'),
      toolCall('check_refund_policy'),
      output('Based on our refund policy, you are eligible.'),
    ]);

    const result = evaluateConversation(trace, {
      name: 'Customer support flow',
      turns: [
        { user: 'I want to cancel', expect: { tool_called: 'lookup_subscription', output_contains: 'sorry to hear' } },
        { user: 'Yes, cancel it', expect: { tool_called: 'cancel_subscription', output_contains: 'cancelled' } },
        { user: 'Can I get a refund?', expect: { tool_called: 'check_refund_policy' } },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.turns).toHaveLength(3);
    expect(result.turns.every(t => t.passed)).toBe(true);
  });

  it('detects failure at specific turn', () => {
    const trace = makeTrace([
      toolCall('lookup_subscription'),
      output('sorry to hear'),
      toolCall('wrong_tool'),
      output('done'),
    ]);

    const result = evaluateConversation(trace, {
      name: 'Fails at turn 2',
      turns: [
        { user: 'Cancel', expect: { tool_called: 'lookup_subscription' } },
        { user: 'Yes', expect: { tool_called: 'cancel_subscription' } },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failed_at_turn).toBe(2);
  });

  it('splitTraceByTurns handles single turn', () => {
    const trace = makeTrace([toolCall('a'), output('b')]);
    const splits = splitTraceByTurns(trace, 1);
    expect(splits).toHaveLength(1);
    expect(splits[0].steps).toHaveLength(2);
  });

  it('formats conversation result', () => {
    const result = evaluateConversation(
      makeTrace([toolCall('a'), output('hello')]),
      { name: 'Test', turns: [{ user: 'hi', expect: { output_contains: 'hello' } }] },
    );
    const formatted = formatConversationResult(result);
    expect(formatted).toContain('Test');
    expect(formatted).toContain('✅');
  });
});

// ===== Scoring =====
describe('scoring', () => {
  it('evaluates weighted scoring above threshold', () => {
    const trace = makeTrace([
      toolCall('search'),
      output('Here is a comprehensive answer with plenty of detail to exceed fifty characters easily.'),
    ]);

    const result = evaluateScoring(trace, {
      tool_called_search: { weight: 0.3 },
      output_quality: { weight: 0.5 },
      efficiency: { weight: 0.2 },
    }, 0.7);

    expect(result.score).toBeGreaterThan(0);
    expect(result.details).toHaveLength(3);
  });

  it('fails when below threshold', () => {
    const trace = makeTrace([output('short')]);

    const result = evaluateScoring(trace, {
      tool_called_search: { weight: 0.5 },
      output_quality: { weight: 0.5 },
    }, 0.9);

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(0.9);
  });

  it('formats scoring result', () => {
    const trace = makeTrace([toolCall('search'), output('x'.repeat(60))]);
    const result = evaluateScoring(trace, { tool_called_search: { weight: 1 } }, 0.5);
    const formatted = formatScoringResult(result);
    expect(formatted).toContain('Score:');
  });
});

// ===== NL Generation =====
describe('nlgen', () => {
  it('generates test for weather agent', () => {
    const test = generateFromNL('Test that my weather agent calls the weather API and returns temperature');
    expect(test.name).toBeTruthy();
    expect(test.expect.tool_called).toBeDefined();
    expect(test.expect.output_matches).toContain('°');
  });

  it('generates test for "does not call"', () => {
    const test = generateFromNL('Test that my agent does not call exec');
    expect(test.expect.tool_not_called).toBeDefined();
  });

  it('generates test for output contains', () => {
    const test = generateFromNL('Test that output contains hello world');
    expect(test.expect.output_contains).toBe('hello world');
  });

  it('generates test for max steps', () => {
    const test = generateFromNL('Test that my agent completes in under 5 steps');
    expect(test.expect.max_steps).toBe(5);
  });

  it('generates test for max cost', () => {
    const test = generateFromNL('Test that my agent costs less than $0.01');
    expect(test.expect.max_cost_usd).toBe(0.01);
  });

  it('formats as YAML', () => {
    const test = generateFromNL('Test that my search agent calls the search API');
    const yaml = formatGeneratedTestsYaml([test]);
    expect(yaml).toContain('tests:');
    expect(yaml).toContain('name:');
  });

  it('handles unknown descriptions gracefully', () => {
    const test = generateFromNL('Something completely random');
    expect(test.name).toBeTruthy();
    expect(test.expect).toBeDefined();
  });
});

// ===== Anonymizer =====
describe('anonymize', () => {
  it('replaces email addresses', () => {
    const result = anonymizeString('Contact john@company.com for help');
    expect(result).toContain('user@example.com');
    expect(result).not.toContain('john@company.com');
  });

  it('replaces IP addresses', () => {
    const result = anonymizeString('Server at 10.0.1.5 is down');
    expect(result).not.toContain('10.0.1.5');
    expect(result).toContain('192.168.x.');
  });

  it('preserves localhost', () => {
    const result = anonymizeString('Running on 127.0.0.1');
    expect(result).toContain('127.0.0.1');
  });

  it('replaces OpenAI keys', () => {
    const result = anonymizeString('Using key sk-abc123def456ghi789jkl012mno');
    expect(result).toContain('[REDACTED]');
  });

  it('replaces names with title', () => {
    const result = anonymizeString('Contact Mr. John Smith');
    expect(result).toContain('[NAME]');
  });

  it('deep-anonymizes objects', () => {
    const data = {
      user: 'test@test.com',
      password: 'supersecret',
      nested: { ip: '10.0.0.1' },
    };
    const result = anonymize(data);
    expect(result.user).toBe('user@example.com');
    expect(result.password).toBe('[REDACTED]');
    expect(result.nested.ip).not.toBe('10.0.0.1');
  });

  it('anonymizes trace data', () => {
    const trace = {
      id: 'test',
      steps: [{ data: { content: 'Email me at admin@corp.com' } }],
    };
    const result = anonymizeTrace(trace);
    expect(JSON.stringify(result)).not.toContain('admin@corp.com');
  });
});

// ===== Profiler =====
describe('profiler', () => {
  it('computes latency percentiles', () => {
    const traces = [
      makeTrace([
        { type: 'llm_call', data: { model: 'gpt-4o', tokens: { input: 100, output: 50 } }, duration_ms: 800 },
        toolCall('search', {}, 200),
        { type: 'llm_call', data: { model: 'gpt-4o', tokens: { input: 100, output: 50 } }, duration_ms: 1200 },
        toolCall('search', {}, 500),
        output('result'),
      ]),
    ];

    const result = profile(traces);
    expect(result.trace_count).toBe(1);
    expect(result.llm_latency.count).toBe(2);
    expect(result.tool_latency.count).toBe(2);
    expect(result.token_efficiency).toBeGreaterThan(0);
    expect(result.bottleneck).toBeDefined();
    expect(result.bottleneck!.name).toBe('search');
  });

  it('handles empty traces', () => {
    const result = profile([makeTrace([])]);
    expect(result.llm_latency.count).toBe(0);
    expect(result.tool_breakdown).toHaveLength(0);
  });

  it('formats profile output', () => {
    const result = profile([
      makeTrace([
        { type: 'llm_call', data: { model: 'gpt-4o', tokens: { input: 100, output: 50 } }, duration_ms: 800 },
        toolCall('web_search', {}, 300),
      ]),
    ]);
    const formatted = formatProfile(result);
    expect(formatted).toContain('Performance Profile');
    expect(formatted).toContain('LLM latency');
    expect(formatted).toContain('tool latency');
  });

  it('computes cost per query', () => {
    const traces = [
      makeTrace([
        { type: 'llm_call', data: { model: 'gpt-4o', tokens: { input: 1000, output: 500 } }, duration_ms: 500 },
      ]),
      makeTrace([
        { type: 'llm_call', data: { model: 'gpt-4o', tokens: { input: 2000, output: 1000 } }, duration_ms: 700 },
      ]),
    ];
    const result = profile(traces);
    expect(result.trace_count).toBe(2);
    expect(result.cost_per_query).toBeGreaterThan(0);
    expect(result.total_cost).toBeGreaterThan(result.cost_per_query);
  });
});
