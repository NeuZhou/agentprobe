/**
 * Round 13 Tests — Explorer, Custom Assertions, Trace Compare,
 * Watch Mode, Assertion Chaining, Environment Profiles
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentTrace, SuiteResult, TestResult, ChainStep } from '../src/types';
import { loadReport, formatTestList, formatTestDetail } from '../src/explorer';
import {
  registerAssertion,
  unregisterAssertion,
  hasAssertion,
  listAssertions,
  evaluateCustomAssertion,
  clearAssertions,
} from '../src/custom-assertions';
import { compareTraces, formatComparison } from '../src/trace-compare';
import { evaluate } from '../src/assertions';
import {
  loadExtendedConfig,
  getProfile,
  listProfiles,
} from '../src/config-file';
import type { ExtendedConfig, ProfileConfig } from '../src/config-file';
import type { WatchSummary } from '../src/watcher';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Helper to create a trace
function makeTrace(overrides?: Partial<AgentTrace>): AgentTrace {
  return {
    id: 'test-trace',
    timestamp: new Date().toISOString(),
    steps: [],
    metadata: {},
    ...overrides,
  };
}

function makeSuiteResult(overrides?: Partial<SuiteResult>): SuiteResult {
  return {
    name: 'Test Suite',
    passed: 2,
    failed: 1,
    total: 3,
    duration_ms: 1500,
    results: [
      {
        name: 'Test passes',
        passed: true,
        assertions: [{ name: 'tool_called: search', passed: true }],
        duration_ms: 500,
        tags: ['smoke'],
      },
      {
        name: 'Test fails',
        passed: false,
        assertions: [
          { name: 'output_contains: "hello"', passed: false, message: 'Not found', expected: 'hello', actual: 'bye' },
        ],
        duration_ms: 800,
        tags: ['regression'],
      },
      {
        name: 'Test skipped',
        passed: false,
        assertions: [],
        duration_ms: 0,
        skipped: true,
        skipReason: 'Dependency failed',
      },
    ],
    ...overrides,
  };
}

// ====== Explorer Tests ======

describe('Explorer', () => {
  it('formatTestList shows pass/fail indicators', () => {
    const result = makeSuiteResult();
    const output = formatTestList(result, 0);
    expect(output).toContain('Test Suite');
    expect(output).toContain('2/3 passed');
    expect(output).toContain('Test passes');
    expect(output).toContain('Test fails');
    expect(output).toContain('Test skipped');
  });

  it('formatTestList highlights selected index', () => {
    const result = makeSuiteResult();
    const output = formatTestList(result, 1);
    expect(output).toContain('Test fails');
  });

  it('formatTestDetail shows assertions', () => {
    const result = makeSuiteResult();
    const output = formatTestDetail(result.results[0]);
    expect(output).toContain('Test passes');
    expect(output).toContain('tool_called: search');
  });

  it('formatTestDetail shows failure message', () => {
    const result = makeSuiteResult();
    const output = formatTestDetail(result.results[1]);
    expect(output).toContain('Not found');
    expect(output).toContain('hello');
  });

  it('formatTestDetail shows skip reason', () => {
    const result = makeSuiteResult();
    const output = formatTestDetail(result.results[2]);
    expect(output).toContain('Dependency failed');
  });

  it('formatTestDetail shows trace steps if present', () => {
    const result = makeSuiteResult();
    result.results[0].trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: { q: 'test' } } },
        { type: 'output', timestamp: '', data: { content: 'Found results' } },
      ],
    });
    const output = formatTestDetail(result.results[0]);
    expect(output).toContain('search');
    expect(output).toContain('Trace Steps');
  });

  it('loadReport parses JSON report file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-'));
    const reportPath = path.join(tmpDir, 'report.json');
    const suiteResult = makeSuiteResult();
    fs.writeFileSync(reportPath, JSON.stringify(suiteResult));

    const loaded = loadReport(reportPath);
    expect(loaded.name).toBe('Test Suite');
    expect(loaded.total).toBe(3);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('formatTestList with no results selected (-1)', () => {
    const result = makeSuiteResult();
    const output = formatTestList(result, -1);
    expect(output).toContain('Test passes');
  });
});

// ====== Custom Assertions Tests ======

describe('Custom Assertions', () => {
  beforeEach(() => clearAssertions());
  afterEach(() => clearAssertions());

  it('registerAssertion and hasAssertion', () => {
    expect(hasAssertion('test_assert')).toBe(false);
    registerAssertion('test_assert', () => ({ pass: true, message: 'ok' }));
    expect(hasAssertion('test_assert')).toBe(true);
  });

  it('listAssertions returns registered names', () => {
    registerAssertion('a1', () => ({ pass: true, message: '' }));
    registerAssertion('a2', () => ({ pass: false, message: '' }));
    expect(listAssertions()).toEqual(['a1', 'a2']);
  });

  it('unregisterAssertion removes assertion', () => {
    registerAssertion('temp', () => ({ pass: true, message: '' }));
    expect(unregisterAssertion('temp')).toBe(true);
    expect(hasAssertion('temp')).toBe(false);
  });

  it('unregisterAssertion returns false for unknown', () => {
    expect(unregisterAssertion('nonexistent')).toBe(false);
  });

  it('evaluateCustomAssertion passes', () => {
    registerAssertion('always_pass', () => ({ pass: true, message: 'All good' }));
    const trace = makeTrace();
    const result = evaluateCustomAssertion('always_pass', trace);
    expect(result.passed).toBe(true);
    expect(result.message).toBe('All good');
  });

  it('evaluateCustomAssertion fails', () => {
    registerAssertion('always_fail', () => ({ pass: false, message: 'Nope' }));
    const trace = makeTrace();
    const result = evaluateCustomAssertion('always_fail', trace);
    expect(result.passed).toBe(false);
    expect(result.message).toBe('Nope');
  });

  it('evaluateCustomAssertion for unregistered name', () => {
    const result = evaluateCustomAssertion('unknown', makeTrace());
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not registered');
  });

  it('evaluateCustomAssertion handles thrown errors', () => {
    registerAssertion('throw_err', () => { throw new Error('boom'); });
    const result = evaluateCustomAssertion('throw_err', makeTrace());
    expect(result.passed).toBe(false);
    expect(result.message).toContain('boom');
  });

  it('registerAssertion rejects duplicate name', () => {
    registerAssertion('dup', () => ({ pass: true, message: '' }));
    expect(() => registerAssertion('dup', () => ({ pass: true, message: '' }))).toThrow('already registered');
  });

  it('evaluateCustomAssertion receives params', () => {
    registerAssertion('with_params', (_trace, params) => ({
      pass: params?.threshold === 5,
      message: `threshold=${params?.threshold}`,
    }));
    const result = evaluateCustomAssertion('with_params', makeTrace(), { threshold: 5 });
    expect(result.passed).toBe(true);
  });

  it('polite response example from spec', () => {
    registerAssertion('response_polite', (trace) => {
      const output = trace.steps.find(s => s.type === 'output')?.data.content || '';
      const politeWords = ['please', 'thank', 'sorry', 'appreciate'];
      const found = politeWords.some(w => output.toLowerCase().includes(w));
      return { pass: found, message: found ? 'Response is polite' : 'No polite language found' };
    });

    const politeTrace = makeTrace({
      steps: [{ type: 'output', timestamp: '', data: { content: 'Thank you for asking!' } }],
    });
    expect(evaluateCustomAssertion('response_polite', politeTrace).passed).toBe(true);

    const rudeTrace = makeTrace({
      steps: [{ type: 'output', timestamp: '', data: { content: 'Here is the answer.' } }],
    });
    expect(evaluateCustomAssertion('response_polite', rudeTrace).passed).toBe(false);
  });

  it('clearAssertions removes all', () => {
    registerAssertion('x', () => ({ pass: true, message: '' }));
    registerAssertion('y', () => ({ pass: true, message: '' }));
    clearAssertions();
    expect(listAssertions()).toEqual([]);
  });
});

// ====== Trace Comparison Tests ======

describe('Trace Compare', () => {
  const traceA = makeTrace({
    steps: [
      { type: 'llm_call', timestamp: '', data: { model: 'gpt-4o', tokens: { input: 100, output: 50 } }, duration_ms: 200 },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: { q: 'test' } }, duration_ms: 150 },
      { type: 'output', timestamp: '', data: { content: 'Result A' } },
    ],
  });

  const traceB = makeTrace({
    steps: [
      { type: 'llm_call', timestamp: '', data: { model: 'gpt-4o', tokens: { input: 200, output: 100 } }, duration_ms: 300 },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: { q: 'test' } }, duration_ms: 100 },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'summarize', tool_args: {} }, duration_ms: 50 },
      { type: 'output', timestamp: '', data: { content: 'Result B' } },
    ],
  });

  it('compareTraces returns step counts', () => {
    const cmp = compareTraces(traceA, traceB);
    expect(cmp.stepsA).toBe(3);
    expect(cmp.stepsB).toBe(4);
    expect(cmp.stepsDiff).toBe(1);
  });

  it('compareTraces detects tool differences', () => {
    const cmp = compareTraces(traceA, traceB);
    expect(cmp.toolsOnlyB).toEqual(['summarize']);
    expect(cmp.toolsOnlyA).toEqual([]);
    expect(cmp.toolsCommon).toEqual(['search']);
  });

  it('compareTraces computes token diff', () => {
    const cmp = compareTraces(traceA, traceB);
    expect(cmp.tokensA.total).toBe(150);
    expect(cmp.tokensB.total).toBe(300);
    expect(cmp.tokensDiffPercent).toBe(100);
  });

  it('compareTraces detects output mismatch', () => {
    const cmp = compareTraces(traceA, traceB);
    expect(cmp.outputMatch).toBe(false);
    expect(cmp.outputA).toBe('Result A');
    expect(cmp.outputB).toBe('Result B');
  });

  it('compareTraces with identical traces', () => {
    const cmp = compareTraces(traceA, traceA);
    expect(cmp.stepsDiff).toBe(0);
    expect(cmp.outputMatch).toBe(true);
    expect(cmp.toolsOnlyA).toEqual([]);
    expect(cmp.toolsOnlyB).toEqual([]);
  });

  it('compareTraces computes duration diff', () => {
    const cmp = compareTraces(traceA, traceB);
    expect(cmp.durationA).toBe(350);
    expect(cmp.durationB).toBe(450);
  });

  it('compareTraces detects models', () => {
    const cmp = compareTraces(traceA, traceB);
    expect(cmp.modelsA).toEqual(['gpt-4o']);
    expect(cmp.modelsB).toEqual(['gpt-4o']);
  });

  it('compareTraces with empty traces', () => {
    const empty = makeTrace();
    const cmp = compareTraces(empty, empty);
    expect(cmp.stepsA).toBe(0);
    expect(cmp.tokensDiffPercent).toBe(0);
  });

  it('formatComparison produces readable output', () => {
    const cmp = compareTraces(traceA, traceB);
    const output = formatComparison(cmp);
    expect(output).toContain('Trace Comparison');
    expect(output).toContain('Steps');
    expect(output).toContain('Tools');
    expect(output).toContain('Tokens');
    expect(output).toContain('Cost');
    expect(output).toContain('Duration');
  });

  it('compareTraces tool counts', () => {
    const cmp = compareTraces(traceA, traceB);
    expect(cmp.toolCountsA['search']).toBe(1);
    expect(cmp.toolCountsB['search']).toBe(1);
    expect(cmp.toolCountsB['summarize']).toBe(1);
  });

  it('compareTraces step type breakdown', () => {
    const cmp = compareTraces(traceA, traceB);
    expect(cmp.stepTypesA['tool_call']).toBe(1);
    expect(cmp.stepTypesB['tool_call']).toBe(2);
  });
});

// ====== Assertion Chaining Tests ======

describe('Assertion Chaining', () => {
  const flowTrace = makeTrace({
    steps: [
      { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: { q: 'AI' } } },
      { type: 'output', timestamp: '', data: { content: 'Found some results about AI' } },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'summarize', tool_args: {} } },
      { type: 'output', timestamp: '', data: { content: 'Here is the summary' } },
    ],
  });

  it('chain passes for correct sequence', () => {
    const results = evaluate(flowTrace, {
      chain: [
        { tool_called: 'search' },
        { output_contains: 'results' },
        { tool_called: 'summarize' },
      ],
    });
    const chainResult = results.find(r => r.name.startsWith('chain'));
    expect(chainResult?.passed).toBe(true);
  });

  it('chain fails for wrong order', () => {
    const results = evaluate(flowTrace, {
      chain: [
        { tool_called: 'summarize' },
        { tool_called: 'search' },
      ],
    });
    const chainResult = results.find(r => r.name.startsWith('chain'));
    expect(chainResult?.passed).toBe(false);
  });

  it('chain fails for missing tool', () => {
    const results = evaluate(flowTrace, {
      chain: [
        { tool_called: 'search' },
        { tool_called: 'nonexistent' },
      ],
    });
    const chainResult = results.find(r => r.name.startsWith('chain'));
    expect(chainResult?.passed).toBe(false);
  });

  it('chain with nested then syntax', () => {
    const results = evaluate(flowTrace, {
      chain: [
        {
          tool_called: 'search',
          then: {
            output_contains: 'results',
            then: { tool_called: 'summarize' },
          },
        },
      ],
    });
    const chainResult = results.find(r => r.name.startsWith('chain'));
    expect(chainResult?.passed).toBe(true);
  });

  it('chain with single step', () => {
    const results = evaluate(flowTrace, {
      chain: [{ tool_called: 'search' }],
    });
    const chainResult = results.find(r => r.name.startsWith('chain'));
    expect(chainResult?.passed).toBe(true);
  });

  it('chain on empty trace fails', () => {
    const empty = makeTrace();
    const results = evaluate(empty, {
      chain: [{ tool_called: 'search' }],
    });
    const chainResult = results.find(r => r.name.startsWith('chain'));
    expect(chainResult?.passed).toBe(false);
  });

  it('chain with output_contains only', () => {
    const results = evaluate(flowTrace, {
      chain: [
        { output_contains: 'results' },
        { output_contains: 'summary' },
      ],
    });
    const chainResult = results.find(r => r.name.startsWith('chain'));
    expect(chainResult?.passed).toBe(true);
  });
});

// ====== Environment Profiles Tests ======

describe('Environment Profiles', () => {
  it('getProfile returns undefined for missing profile', () => {
    const config: ExtendedConfig = {};
    expect(getProfile(config, 'dev')).toBeUndefined();
  });

  it('getProfile returns profile config', () => {
    const config: ExtendedConfig = {
      profiles: {
        dev: { adapter: 'openai', model: 'gpt-3.5-turbo', timeout_ms: 10000 },
        prod: { adapter: 'openai', model: 'gpt-4', timeout_ms: 30000 },
      },
    };
    const dev = getProfile(config, 'dev');
    expect(dev?.model).toBe('gpt-3.5-turbo');
    expect(dev?.timeout_ms).toBe(10000);

    const prod = getProfile(config, 'prod');
    expect(prod?.model).toBe('gpt-4');
  });

  it('listProfiles returns all profile names', () => {
    const config: ExtendedConfig = {
      profiles: {
        dev: { model: 'gpt-3.5-turbo' },
        staging: { model: 'gpt-4o-mini' },
        prod: { model: 'gpt-4' },
      },
    };
    expect(listProfiles(config)).toEqual(['dev', 'staging', 'prod']);
  });

  it('listProfiles returns empty array for no profiles', () => {
    expect(listProfiles({})).toEqual([]);
  });

  it('profile with env vars', () => {
    const config: ExtendedConfig = {
      profiles: {
        test: {
          env: { API_KEY: 'test-key', BASE_URL: 'http://localhost' },
        },
      },
    };
    const prof = getProfile(config, 'test');
    expect(prof?.env?.API_KEY).toBe('test-key');
    expect(prof?.env?.BASE_URL).toBe('http://localhost');
  });

  it('profile with tags and parallel', () => {
    const config: ExtendedConfig = {
      profiles: {
        ci: {
          parallel: true,
          max_concurrency: 8,
          tags: ['smoke', 'p0'],
        },
      },
    };
    const ci = getProfile(config, 'ci');
    expect(ci?.parallel).toBe(true);
    expect(ci?.max_concurrency).toBe(8);
    expect(ci?.tags).toEqual(['smoke', 'p0']);
  });

  it('loadExtendedConfig from temp dir with profiles', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-'));
    const configPath = path.join(tmpDir, '.agentproberc.yml');
    fs.writeFileSync(configPath, `
profiles:
  dev:
    adapter: openai
    model: gpt-3.5-turbo
    timeout_ms: 10000
  prod:
    adapter: openai
    model: gpt-4
    timeout_ms: 30000
`);
    const config = loadExtendedConfig(tmpDir);
    expect(listProfiles(config)).toEqual(['dev', 'prod']);
    expect(getProfile(config, 'dev')?.model).toBe('gpt-3.5-turbo');
    expect(getProfile(config, 'prod')?.timeout_ms).toBe(30000);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ====== Watch Summary Tests ======

describe('Watch Summary', () => {
  it('WatchSummary tracks state correctly', () => {
    const summary: WatchSummary = {
      runs: 3,
      totalPassed: 7,
      totalFailed: 2,
      lastRun: '10:30:00',
      consecutiveFailures: 1,
    };
    expect(summary.runs).toBe(3);
    expect(summary.totalPassed).toBe(7);
    expect(summary.totalFailed).toBe(2);
    expect(summary.consecutiveFailures).toBe(1);
  });

  it('WatchSummary initial state', () => {
    const summary: WatchSummary = {
      runs: 0,
      totalPassed: 0,
      totalFailed: 0,
      lastRun: null,
      consecutiveFailures: 0,
    };
    expect(summary.lastRun).toBeNull();
    expect(summary.runs).toBe(0);
  });
});

// ====== Custom Assertions via evaluate() integration ======

describe('Custom Assertions Integration', () => {
  beforeEach(() => clearAssertions());
  afterEach(() => clearAssertions());

  it('evaluate runs custom_assertions', () => {
    registerAssertion('has_output', (trace) => {
      const hasOutput = trace.steps.some(s => s.type === 'output');
      return { pass: hasOutput, message: hasOutput ? 'Has output' : 'No output' };
    });

    const trace = makeTrace({
      steps: [{ type: 'output', timestamp: '', data: { content: 'hello' } }],
    });

    const results = evaluate(trace, {
      custom_assertions: [{ name: 'has_output' }],
    });
    const custom = results.find(r => r.name === 'custom:has_output');
    expect(custom?.passed).toBe(true);
  });

  it('evaluate handles missing custom assertion', () => {
    const results = evaluate(makeTrace(), {
      custom_assertions: [{ name: 'nonexistent' }],
    });
    const custom = results.find(r => r.name === 'custom:nonexistent');
    expect(custom?.passed).toBe(false);
  });
});
