/**
 * Round 42 Tests — v4.5.0 Features
 * - Agent Playground (playground.ts)
 * - Test Reporter Plugins (reporters/json.ts, markdown.ts, github.ts)
 * - Fixture Manager (fixtures.ts — FixtureManager class)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTrace, toolCall, output, llmCall } from './helpers';
import {
  AgentPlayground, formatTranscript, getSessionStats,
} from '../src/playground';
import type { PlaygroundSession, ReplayAssertion } from '../src/playground';
import { FixtureManager } from '../src/fixtures';
import { reportJSON } from '../src/reporters/json';
import type { JSONReport } from '../src/reporters/json';
import { reportMarkdownDetailed } from '../src/reporters/markdown';
import {
  reportGitHub, formatAnnotation, generateStepSummary, parseAnnotations,
} from '../src/reporters/github';
import type { SuiteResult } from '../src/types';

// ─── Fixtures ────────────────────────────────────────────────────────

const sampleTrace = makeTrace([
  { type: 'llm_call', data: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }], tokens: { input: 20, output: 15 } }, duration_ms: 100 },
  { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'test' } }, duration_ms: 50 },
  { type: 'tool_result', data: { tool_name: 'search', tool_result: { results: [] } }, duration_ms: 2 },
  { type: 'output', data: { content: 'Here are the results' }, duration_ms: 10 },
]);

function makeSuiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'Test Suite',
    passed: 2,
    failed: 1,
    total: 3,
    duration_ms: 500,
    results: [
      { name: 'test-pass-1', passed: true, assertions: [{ name: 'a1', passed: true }], duration_ms: 100, tags: ['fast'] },
      { name: 'test-pass-2', passed: true, assertions: [{ name: 'a2', passed: true }], duration_ms: 150, trace: sampleTrace },
      {
        name: 'test-fail', passed: false, duration_ms: 250,
        assertions: [
          { name: 'a3', passed: true },
          { name: 'a4', passed: false, expected: 'foo', actual: 'bar', message: 'expected foo, got bar' },
        ],
        error: 'Something went wrong',
        tags: ['slow'],
      },
    ],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Agent Playground Tests
// ═══════════════════════════════════════════════════════════════════════

describe('AgentPlayground', () => {
  let playground: AgentPlayground;

  beforeEach(() => {
    playground = new AgentPlayground({
      name: 'Test Playground',
      model: 'gpt-4o',
      tools: [
        { name: 'search', description: 'Search the web' },
        { name: 'calculator', handler: (args: any) => ({ result: (args.a ?? 0) + (args.b ?? 0) }) },
      ],
      systemPrompt: 'You are helpful.',
    });
  });

  it('creates a session with config', () => {
    const session = playground.startSession();
    expect(session.id).toContain('session-');
    expect(session.mode).toBe('interactive');
    expect(session.messages.length).toBe(1); // system prompt
    expect(session.messages[0].role).toBe('system');
    expect(session.turnCount).toBe(0);
  });

  it('starts session in specified mode', () => {
    const session = playground.startSession('record');
    expect(session.mode).toBe('record');
  });

  it('sends a message and gets response', () => {
    const session = playground.startSession();
    const response = playground.sendMessage(session, 'Hello world');
    expect(response.role).toBe('assistant');
    expect(response.content).toContain('Hello world');
    expect(session.turnCount).toBe(1);
    expect(session.messages.length).toBe(3); // system + user + assistant
  });

  it('tracks tokens', () => {
    const session = playground.startSession();
    playground.sendMessage(session, 'Test message');
    expect(session.totalTokens).toBeGreaterThan(0);
  });

  it('enforces max turns', () => {
    const pg = new AgentPlayground({ maxTurns: 2 });
    const session = pg.startSession();
    pg.sendMessage(session, 'one');
    pg.sendMessage(session, 'two');
    expect(() => pg.sendMessage(session, 'three')).toThrow('Max turns');
  });

  it('calls tools with handler', () => {
    const session = playground.startSession();
    const result = playground.callTool(session, 'calculator', { a: 3, b: 4 });
    expect(result.result).toEqual({ result: 7 });
    expect(result.name).toBe('calculator');
    expect(session.trace.steps.some(s => s.type === 'tool_call' && s.data.tool_name === 'calculator')).toBe(true);
  });

  it('calls tools without handler (mock)', () => {
    const session = playground.startSession();
    const result = playground.callTool(session, 'search', { q: 'test' });
    expect(result.result.mock).toBe(true);
  });

  it('ends session', () => {
    const session = playground.startSession();
    playground.endSession(session);
    expect(session.endedAt).toBeDefined();
  });

  it('records to YAML', () => {
    const session = playground.startSession();
    playground.sendMessage(session, 'Find flights to Paris');
    playground.callTool(session, 'search', { q: 'flights' });
    playground.endSession(session);

    const yaml = playground.recordToYAML(session);
    expect(yaml).toContain('Turn 1');
    expect(yaml).toContain('Find flights to Paris');
  });

  it('replays a session', () => {
    const session = playground.startSession();
    playground.sendMessage(session, 'Hello');
    playground.sendMessage(session, 'World');
    playground.endSession(session);

    const assertions: ReplayAssertion[] = [
      { afterTurn: 1, name: 'has messages', check: (s) => s.messages.length > 0 },
      { afterTurn: 2, name: 'two turns', check: (s) => s.turnCount === 2 },
    ];

    const result = playground.replay({ session, assertions });
    expect(result.passed).toBe(true);
    expect(result.assertions.length).toBe(2);
  });

  it('replay detects failures', () => {
    const session = playground.startSession();
    playground.sendMessage(session, 'Hi');
    playground.endSession(session);

    const result = playground.replay({
      session,
      assertions: [
        { afterTurn: 1, name: 'impossible', check: () => false },
      ],
    });
    expect(result.passed).toBe(false);
  });
});

describe('formatTranscript', () => {
  it('formats messages as transcript', () => {
    const pg = new AgentPlayground();
    const session = pg.startSession();
    pg.sendMessage(session, 'Hello');
    const transcript = formatTranscript(session);
    expect(transcript).toContain('[User] Hello');
    expect(transcript).toContain('[Assistant]');
  });
});

describe('getSessionStats', () => {
  it('returns session statistics', () => {
    const pg = new AgentPlayground({ tools: [{ name: 'calc' }] });
    const session = pg.startSession();
    pg.sendMessage(session, 'Test');
    pg.callTool(session, 'calc', {});
    pg.endSession(session);

    const stats = getSessionStats(session);
    expect(stats.turns).toBe(1);
    expect(stats.toolCalls).toBe(1);
    expect(stats.tokens).toBeGreaterThan(0);
    expect(stats.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Fixture Manager Tests
// ═══════════════════════════════════════════════════════════════════════

describe('FixtureManager', () => {
  let manager: FixtureManager;

  beforeEach(() => {
    manager = new FixtureManager();
  });

  it('has built-in fixtures', () => {
    expect(manager.has('mockLLM')).toBe(true);
    expect(manager.has('mockTools')).toBe(true);
    expect(manager.has('traceCapture')).toBe(true);
    expect(manager.has('costTracker')).toBe(true);
  });

  it('lists all fixtures', () => {
    const list = manager.list();
    expect(list).toContain('mockLLM');
    expect(list).toContain('mockTools');
    expect(list.length).toBeGreaterThanOrEqual(4);
  });

  it('uses mockLLM fixture', () => {
    const llm = manager.use('mockLLM');
    llm.addResponse('Hello world');
    expect(llm.getResponse()).toBe('Hello world');
    expect(llm.getResponse()).toBe('Mock LLM response'); // default fallback
  });

  it('uses mockTools fixture', () => {
    const tools = manager.use('mockTools');
    tools.mock('search', { results: ['a', 'b'] });
    expect(tools.call('search')).toEqual({ results: ['a', 'b'] });
    expect(tools.call('unknown')).toEqual({ error: 'Not mocked' });
  });

  it('uses traceCapture fixture', () => {
    const capture = manager.use('traceCapture');
    capture.capture({ type: 'llm_call', data: {} });
    capture.capture({ type: 'tool_call', data: { tool_name: 'x' } });
    expect(capture.count()).toBe(2);
    capture.clear();
    expect(capture.count()).toBe(0);
  });

  it('uses costTracker fixture', () => {
    const tracker = manager.use('costTracker');
    tracker.record(100, 50, 0.005);
    tracker.record(200, 100, 0.01);
    expect(tracker.inputTokens).toBe(300);
    expect(tracker.outputTokens).toBe(150);
    expect(tracker.cost).toBeCloseTo(0.015);
    tracker.reset();
    expect(tracker.cost).toBe(0);
  });

  it('defines custom fixtures', () => {
    manager.define('myFixture', () => ({ value: 42 }));
    expect(manager.has('myFixture')).toBe(true);
    const ctx = manager.use('myFixture');
    expect(ctx.value).toBe(42);
  });

  it('runs teardown', () => {
    let tornDown = false;
    manager.define('tearable', () => ({ active: true }), () => { tornDown = true; });
    manager.use('tearable');
    expect(manager.active()).toContain('tearable');
    manager.teardown('tearable');
    expect(tornDown).toBe(true);
    expect(manager.active()).not.toContain('tearable');
  });

  it('teardownAll cleans everything', () => {
    manager.use('mockLLM');
    manager.use('mockTools');
    expect(manager.active().length).toBe(2);
    manager.teardownAll();
    expect(manager.active().length).toBe(0);
  });

  it('throws on unknown fixture', () => {
    expect(() => manager.use('nonexistent')).toThrow('not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// JSON Reporter Tests
// ═══════════════════════════════════════════════════════════════════════

describe('JSON Reporter', () => {
  it('generates valid JSON', () => {
    const json = reportJSON(makeSuiteResult());
    const parsed = JSON.parse(json) as JSONReport;
    expect(parsed.version).toBe('4.5.0');
    expect(parsed.suite.name).toBe('Test Suite');
  });

  it('includes correct counts', () => {
    const parsed = JSON.parse(reportJSON(makeSuiteResult())) as JSONReport;
    expect(parsed.suite.total).toBe(3);
    expect(parsed.suite.passed).toBe(2);
    expect(parsed.suite.failed).toBe(1);
    expect(parsed.suite.passRate).toBe(67);
  });

  it('includes test entries with assertions', () => {
    const parsed = JSON.parse(reportJSON(makeSuiteResult())) as JSONReport;
    expect(parsed.tests.length).toBe(3);
    const fail = parsed.tests.find(t => t.name === 'test-fail');
    expect(fail?.error).toBe('Something went wrong');
    expect(fail?.assertions.some(a => !a.passed)).toBe(true);
  });

  it('includes token data from traces', () => {
    const parsed = JSON.parse(reportJSON(makeSuiteResult())) as JSONReport;
    const withTrace = parsed.tests.find(t => t.name === 'test-pass-2');
    expect(withTrace?.tokens).toBeDefined();
    expect(withTrace?.steps).toBeGreaterThan(0);
  });

  it('includes summary stats', () => {
    const parsed = JSON.parse(reportJSON(makeSuiteResult())) as JSONReport;
    expect(parsed.summary.slowest?.name).toBe('test-fail');
    expect(parsed.summary.totalAssertions).toBe(4);
    expect(parsed.summary.failedAssertions).toBe(1);
  });

  it('handles empty suite', () => {
    const parsed = JSON.parse(reportJSON({
      name: 'Empty', passed: 0, failed: 0, total: 0, duration_ms: 0, results: [],
    })) as JSONReport;
    expect(parsed.suite.passRate).toBe(0);
    expect(parsed.tests.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Markdown Reporter Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Markdown Reporter', () => {
  it('generates markdown with heading', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('# 🔬 AgentProbe Report');
    expect(md).toContain('Test Suite');
  });

  it('includes summary table', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('| Total | 3 |');
    expect(md).toContain('| ✅ Passed | 2 |');
    expect(md).toContain('| ❌ Failed | 1 |');
  });

  it('includes test results table', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('test-pass-1');
    expect(md).toContain('test-fail');
    expect(md).toContain('✅');
    expect(md).toContain('❌');
  });

  it('shows failures section', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('## ❌ Failures');
    expect(md).toContain('expected foo, got bar');
    expect(md).toContain('Something went wrong');
  });

  it('omits failures section when all pass', () => {
    const md = reportMarkdownDetailed({
      name: 'All Pass', passed: 1, failed: 0, total: 1, duration_ms: 10,
      results: [{ name: 'ok', passed: true, assertions: [{ name: 'a', passed: true }], duration_ms: 10 }],
    });
    expect(md).not.toContain('## ❌ Failures');
  });

  it('includes footer', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('AgentProbe');
    expect(md).toContain('v4.5.0');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GitHub Reporter Tests
// ═══════════════════════════════════════════════════════════════════════

describe('GitHub Reporter', () => {
  it('generates error annotations for failures', () => {
    const output = reportGitHub(makeSuiteResult());
    expect(output).toContain('::error');
    expect(output).toContain('test-fail');
  });

  it('generates notice annotations for skipped', () => {
    const suite = makeSuiteResult();
    suite.results.push({ name: 'skip-test', passed: false, skipped: true, skipReason: 'Not ready', assertions: [], duration_ms: 0 });
    const output = reportGitHub(suite);
    expect(output).toContain('::notice');
    expect(output).toContain('Skipped');
  });

  it('includes summary annotation', () => {
    const output = reportGitHub(makeSuiteResult());
    expect(output).toContain('2/3 passed');
    expect(output).toContain('67%');
  });

  it('includes step summary markdown', () => {
    const output = reportGitHub(makeSuiteResult());
    expect(output).toContain('### 🔬 AgentProbe Results');
    expect(output).toContain('Failed Tests');
  });
});

describe('formatAnnotation', () => {
  it('formats error annotation', () => {
    const line = formatAnnotation({ level: 'error', message: 'Test failed', title: 'Fail' });
    expect(line).toContain('::error');
    expect(line).toContain('title=Fail');
    expect(line).toContain('Test failed');
  });

  it('formats with file and line', () => {
    const line = formatAnnotation({ level: 'warning', message: 'warn', file: 'test.ts', line: 42 });
    expect(line).toContain('file=test.ts');
    expect(line).toContain('line=42');
  });

  it('escapes newlines in message', () => {
    const line = formatAnnotation({ level: 'error', message: 'line1\nline2' });
    expect(line).not.toContain('\n');
    expect(line).toContain('%0A');
  });
});

describe('parseAnnotations', () => {
  it('parses annotations from output', () => {
    const output = `::error title=Fail::Test failed
::warning file=a.ts,line=10::something
::notice ::all good`;
    const annotations = parseAnnotations(output);
    expect(annotations.length).toBe(3);
    expect(annotations[0].level).toBe('error');
    expect(annotations[0].title).toBe('Fail');
    expect(annotations[1].file).toBe('a.ts');
    expect(annotations[1].line).toBe(10);
    expect(annotations[2].level).toBe('notice');
  });

  it('returns empty for no annotations', () => {
    expect(parseAnnotations('just some text')).toEqual([]);
  });
});

describe('generateStepSummary', () => {
  it('generates markdown summary', () => {
    const summary = generateStepSummary(makeSuiteResult());
    expect(summary).toContain('### 🔬 AgentProbe Results');
    expect(summary).toContain('| Tests | 3 |');
    expect(summary).toContain('| Pass Rate | 67% |');
  });

  it('includes failed test details', () => {
    const summary = generateStepSummary(makeSuiteResult());
    expect(summary).toContain('test-fail');
    expect(summary).toContain('expected foo, got bar');
  });

  it('omits failed section when all pass', () => {
    const summary = generateStepSummary({
      name: 'OK', passed: 1, failed: 0, total: 1, duration_ms: 10,
      results: [{ name: 'ok', passed: true, assertions: [], duration_ms: 10 }],
    });
    expect(summary).not.toContain('Failed Tests');
  });
});
