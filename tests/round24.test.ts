/**
 * Round 24 Tests — Multi-Agent, Cost Optimizer, Regression Detector, Plugins Enhancement, Profiles
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  AgentRegistry, parseMultiAgentConfig, detectDelegation,
  evaluateConversationStep, formatMultiAgentResult,
} from '../src/multi-agent';
import type {
  MultiAgentTest, MultiAgentResult, DelegationEvent,
  ConversationExpectation,
} from '../src/multi-agent';
import {
  analyzeTestCosts, findDuplicateTests, suggestModelDowngrades,
  suggestCaching, suggestBatching, optimizeCosts, formatCostOptimization,
} from '../src/cost-optimizer';
import {
  createSnapshot, compareSnapshots, formatRegressionReport,
  DEFAULT_THRESHOLDS, saveSnapshot, loadSnapshot,
} from '../src/regression-detector';
import type { ReportSnapshot, RegressionThresholds } from '../src/regression-detector';
import {
  registerPlugin, unregisterPlugin, loadPlugins, getRegisteredPlugins,
  getPlugin, clearAllPlugins, runPluginHook, getPluginAssertionNames,
  getPluginReporterNames, runPluginAssertion, getPluginReporter,
  watchPlugin, unwatchPlugin, unwatchAll,
} from '../src/plugins';
import type { AgentProbePlugin, PluginHooks } from '../src/plugins';
import {
  parseProfile, resolveProfile, validateProfile, validateProfiles,
  loadProfiles, formatProfiles, listProfileNames, scaffoldProfiles,
  applyProfile,
} from '../src/profiles';
import type { ProfilesConfig, EnvironmentProfile } from '../src/profiles';
import type { AgentTrace, TraceStep, SuiteResult, TestResult } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Helpers ──

function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return { id: 'test-1', timestamp: '2026-03-16T10:00:00Z', steps: [], metadata: {}, ...overrides };
}

function makeStep(overrides: Partial<TraceStep> = {}): TraceStep {
  return {
    type: 'llm_call', timestamp: '2026-03-16T10:00:00Z',
    data: {}, ...overrides,
  };
}

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return { name: 'test', passed: true, assertions: [], duration_ms: 100, ...overrides };
}

function makeSuiteResult(tests: Partial<TestResult>[] = []): SuiteResult {
  const results = tests.map(t => makeResult(t));
  return {
    name: 'test-suite', passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length, total: results.length,
    duration_ms: results.reduce((s, r) => s + r.duration_ms, 0), results,
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-r24-'));
}

// ═══════════════════════════════════════════════
// Multi-Agent Testing
// ═══════════════════════════════════════════════

describe('Multi-Agent - AgentRegistry', () => {
  test('registers and retrieves agents', () => {
    const reg = new AgentRegistry();
    reg.register('planner', { name: 'planner', adapter: 'openai', model: 'gpt-4' });
    expect(reg.has('planner')).toBe(true);
    expect(reg.get('planner')?.model).toBe('gpt-4');
    expect(reg.list()).toEqual(['planner']);
  });

  test('clear removes all agents', () => {
    const reg = new AgentRegistry();
    reg.register('a', { name: 'a', adapter: 'x', model: 'y' });
    reg.clear();
    expect(reg.list()).toEqual([]);
  });
});

describe('Multi-Agent - Config Parsing', () => {
  test('parses valid multi-agent config', () => {
    const config = parseMultiAgentConfig({
      name: 'delegation test',
      agents: {
        planner: { adapter: 'openai', model: 'gpt-4' },
        executor: { adapter: 'anthropic', model: 'claude-3' },
      },
      conversation: [
        { to: 'planner', message: 'Plan a trip', expect: { delegates_to: 'executor' } },
        { to: 'executor', expect: { tool_called: 'search_flights' } },
      ],
    });
    expect(config.name).toBe('delegation test');
    expect(Object.keys(config.agents)).toHaveLength(2);
    expect(config.conversation).toHaveLength(2);
  });

  test('rejects config without name', () => {
    expect(() => parseMultiAgentConfig({ agents: {}, conversation: [{ to: 'x' }] }))
      .toThrow('name');
  });

  test('rejects config without agents', () => {
    expect(() => parseMultiAgentConfig({ name: 'x', conversation: [{ to: 'x' }] }))
      .toThrow('agents');
  });

  test('rejects empty conversation', () => {
    expect(() => parseMultiAgentConfig({ name: 'x', agents: { a: {} }, conversation: [] }))
      .toThrow('conversation');
  });

  test('rejects reference to unknown agent', () => {
    expect(() => parseMultiAgentConfig({
      name: 'x',
      agents: { a: { adapter: 'x', model: 'y' } },
      conversation: [{ to: 'nonexistent' }],
    })).toThrow('nonexistent');
  });

  test('rejects delegation to unknown agent', () => {
    expect(() => parseMultiAgentConfig({
      name: 'x',
      agents: { a: { adapter: 'x', model: 'y' } },
      conversation: [{ to: 'a', expect: { delegates_to: 'ghost' } }],
    })).toThrow('ghost');
  });
});

describe('Multi-Agent - Delegation Detection', () => {
  test('detects delegation via tool call', () => {
    const trace = makeTrace({
      metadata: { agent: 'planner' },
      steps: [makeStep({
        type: 'tool_call',
        data: { tool_name: 'delegate', tool_args: { agent: 'executor' } },
      })],
    });
    const d = detectDelegation(trace, ['planner', 'executor']);
    expect(d).toHaveLength(1);
    expect(d[0].to).toBe('executor');
  });

  test('detects delegation via direct agent name as tool', () => {
    const trace = makeTrace({
      metadata: { agent: 'planner' },
      steps: [makeStep({ type: 'tool_call', data: { tool_name: 'executor', tool_args: {} } })],
    });
    const d = detectDelegation(trace, ['planner', 'executor']);
    expect(d).toHaveLength(1);
  });

  test('returns empty for no delegations', () => {
    const trace = makeTrace({
      steps: [makeStep({ type: 'tool_call', data: { tool_name: 'search', tool_args: {} } })],
    });
    expect(detectDelegation(trace, ['a', 'b'])).toHaveLength(0);
  });
});

describe('Multi-Agent - Expectation Evaluation', () => {
  test('validates tool_called expectation', () => {
    const trace = makeTrace({
      steps: [makeStep({ type: 'tool_call', data: { tool_name: 'search_flights' } })],
    });
    const result = evaluateConversationStep(trace, { tool_called: 'search_flights' }, []);
    expect(result.passed).toBe(true);
    expect(result.met).toContain('tool_called:search_flights');
  });

  test('fails when expected tool not called', () => {
    const trace = makeTrace({ steps: [] });
    const result = evaluateConversationStep(trace, { tool_called: 'book_hotel' }, []);
    expect(result.passed).toBe(false);
    expect(result.failed).toContain('tool_called:book_hotel');
  });

  test('validates output_contains', () => {
    const trace = makeTrace({
      steps: [makeStep({ type: 'output', data: { content: 'Your flight to Paris is booked' } })],
    });
    const result = evaluateConversationStep(trace, { output_contains: 'Paris' }, []);
    expect(result.passed).toBe(true);
  });

  test('validates max_steps', () => {
    const trace = makeTrace({ steps: [makeStep(), makeStep(), makeStep()] });
    expect(evaluateConversationStep(trace, { max_steps: 5 }, []).passed).toBe(true);
    expect(evaluateConversationStep(trace, { max_steps: 2 }, []).passed).toBe(false);
  });

  test('validates response_not_empty', () => {
    const trace = makeTrace({
      steps: [makeStep({ type: 'output', data: { content: 'hello' } })],
    });
    expect(evaluateConversationStep(trace, { response_not_empty: true }, []).passed).toBe(true);

    const empty = makeTrace({ steps: [] });
    expect(evaluateConversationStep(empty, { response_not_empty: true }, []).passed).toBe(false);
  });
});

describe('Multi-Agent - Formatting', () => {
  test('formats passed result', () => {
    const result: MultiAgentResult = {
      test_name: 'delegation', passed: true, agents_used: ['planner', 'executor'],
      delegations: [{ from: 'planner', to: 'executor', timestamp: '' }],
      step_results: [{ step_index: 0, agent: 'planner', passed: true, expectations_met: ['delegates_to:executor'], expectations_failed: [] }],
      duration_ms: 500,
    };
    const out = formatMultiAgentResult(result);
    expect(out).toContain('PASSED');
    expect(out).toContain('planner');
    expect(out).toContain('executor');
  });
});

// ═══════════════════════════════════════════════
// Cost Optimizer
// ═══════════════════════════════════════════════

describe('Cost Optimizer - Test Cost Analysis', () => {
  test('analyzes test costs from suite result', () => {
    const suite = makeSuiteResult([
      { name: 'test-1', trace: makeTrace({ steps: [makeStep({
        type: 'llm_call', data: { model: 'gpt-4', tokens: { input: 1000, output: 500 } },
      })] }) },
    ]);
    const entries = analyzeTestCosts(suite, 30);
    expect(entries).toHaveLength(1);
    expect(entries[0].model).toBe('gpt-4');
    expect(entries[0].monthly_estimate).toBeGreaterThan(0);
  });

  test('skips tests without traces', () => {
    const suite = makeSuiteResult([{ name: 'no-trace' }]);
    expect(analyzeTestCosts(suite)).toHaveLength(0);
  });
});

describe('Cost Optimizer - Duplicate Detection', () => {
  test('finds tests with identical tool sequences', () => {
    const mkTest = (name: string, tools: string[]) => ({
      name,
      trace: makeTrace({
        steps: tools.map(t => makeStep({ type: 'tool_call' as const, data: { tool_name: t } })),
      }),
    });
    const suite = makeSuiteResult([
      mkTest('test-1', ['search', 'book']),
      mkTest('test-2', ['search', 'book']),
      mkTest('test-3', ['search']),
    ]);
    const dups = findDuplicateTests(suite);
    expect(dups).toHaveLength(1);
    expect(dups[0]).toContain('test-1');
    expect(dups[0]).toContain('test-2');
  });
});

describe('Cost Optimizer - Recommendations', () => {
  test('suggests model downgrades for expensive models', () => {
    const entries = [
      { name: 'test-1', model: 'gpt-4', cost_per_run: 0.1, monthly_estimate: 3, input_tokens: 5000, output_tokens: 2000, runs_per_month: 30 },
    ];
    const recs = suggestModelDowngrades(entries);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].type).toBe('model_downgrade');
  });

  test('suggests caching for high-input tests', () => {
    const entries = [
      { name: 'test-1', model: 'gpt-4o', cost_per_run: 0.01, monthly_estimate: 0.3, input_tokens: 5000, output_tokens: 200, runs_per_month: 30 },
    ];
    const rec = suggestCaching(entries);
    expect(rec).not.toBeNull();
    expect(rec!.type).toBe('caching');
  });

  test('returns null caching for low-input tests', () => {
    const entries = [
      { name: 'test-1', model: 'gpt-4o', cost_per_run: 0.001, monthly_estimate: 0.03, input_tokens: 100, output_tokens: 50, runs_per_month: 30 },
    ];
    expect(suggestCaching(entries)).toBeNull();
  });

  test('suggests batching for 3+ same-model tests', () => {
    const entries = [
      { name: 'a', model: 'gpt-4o', cost_per_run: 0.01, monthly_estimate: 0.3, input_tokens: 1000, output_tokens: 200, runs_per_month: 30 },
      { name: 'b', model: 'gpt-4o', cost_per_run: 0.01, monthly_estimate: 0.3, input_tokens: 1000, output_tokens: 200, runs_per_month: 30 },
      { name: 'c', model: 'gpt-4o', cost_per_run: 0.01, monthly_estimate: 0.3, input_tokens: 1000, output_tokens: 200, runs_per_month: 30 },
    ];
    expect(suggestBatching(entries)).not.toBeNull();
  });
});

describe('Cost Optimizer - Full Report', () => {
  test('generates full optimization report', () => {
    const suite = makeSuiteResult([
      { name: 'expensive', trace: makeTrace({ steps: [makeStep({
        type: 'llm_call', data: { model: 'gpt-4', tokens: { input: 10000, output: 5000 } },
      })] }) },
    ]);
    const report = optimizeCosts(suite);
    expect(report.current_monthly_estimate).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  test('formats optimization report', () => {
    const report = {
      current_monthly_estimate: 142.50,
      recommendations: [
        { type: 'model_downgrade' as const, description: 'Switch to cheaper models', affected_tests: ['t1'], estimated_savings: 28.50, confidence: 'medium' as const },
      ],
      estimated_after_optimization: 114,
      savings_percentage: 20,
      test_costs: [],
    };
    const out = formatCostOptimization(report);
    expect(out).toContain('$142.50');
    expect(out).toContain('Switch to cheaper');
  });
});

// ═══════════════════════════════════════════════
// Regression Detector
// ═══════════════════════════════════════════════

describe('Regression Detector - Snapshots', () => {
  test('creates snapshot from suite result', () => {
    const suite = makeSuiteResult([{ name: 'test-1', duration_ms: 200 }]);
    const snap = createSnapshot(suite);
    expect(snap.tests).toHaveLength(1);
    expect(snap.tests[0].name).toBe('test-1');
    expect(snap.tests[0].duration_ms).toBe(200);
  });

  test('saves and loads snapshot', () => {
    const dir = tmpDir();
    const snap: ReportSnapshot = {
      suite_name: 'v2.3', timestamp: new Date().toISOString(),
      tests: [{ name: 'test-1', passed: true, duration_ms: 2100, cost_usd: 0.01, total_tokens: 1000, pass_rate: 1, attempts: 1 }],
    };
    const fp = path.join(dir, 'snap.json');
    saveSnapshot(snap, fp);
    const loaded = loadSnapshot(fp);
    expect(loaded.suite_name).toBe('v2.3');
    expect(loaded.tests[0].duration_ms).toBe(2100);
  });
});

describe('Regression Detector - Comparison', () => {
  test('detects latency regression', () => {
    const baseline: ReportSnapshot = {
      suite_name: 'v2.3', timestamp: '', tests: [
        { name: 'test-5', passed: true, duration_ms: 2100, cost_usd: 0, total_tokens: 0, pass_rate: 1, attempts: 1 },
      ],
    };
    const current: ReportSnapshot = {
      suite_name: 'v2.4', timestamp: '', tests: [
        { name: 'test-5', passed: true, duration_ms: 4620, cost_usd: 0, total_tokens: 0, pass_rate: 1, attempts: 1 },
      ],
    };
    const report = compareSnapshots(baseline, current);
    expect(report.regressions.length).toBeGreaterThan(0);
    expect(report.regressions[0].dimension).toBe('latency');
    expect(report.regressions[0].test).toBe('test-5');
  });

  test('detects pass rate regression', () => {
    const baseline: ReportSnapshot = {
      suite_name: 'v2.3', timestamp: '', tests: [
        { name: 'test-8', passed: true, duration_ms: 100, cost_usd: 0, total_tokens: 0, pass_rate: 1.0, attempts: 1 },
      ],
    };
    const current: ReportSnapshot = {
      suite_name: 'v2.4', timestamp: '', tests: [
        { name: 'test-8', passed: false, duration_ms: 100, cost_usd: 0, total_tokens: 0, pass_rate: 0.8, attempts: 1 },
      ],
    };
    const report = compareSnapshots(baseline, current);
    expect(report.regressions.some(r => r.dimension === 'pass_rate')).toBe(true);
  });

  test('detects cost improvement', () => {
    const baseline: ReportSnapshot = {
      suite_name: 'v2.3', timestamp: '', tests: [
        { name: 'test-3', passed: true, duration_ms: 100, cost_usd: 0.10, total_tokens: 0, pass_rate: 1, attempts: 1 },
      ],
    };
    const current: ReportSnapshot = {
      suite_name: 'v2.4', timestamp: '', tests: [
        { name: 'test-3', passed: true, duration_ms: 100, cost_usd: 0.03, total_tokens: 0, pass_rate: 1, attempts: 1 },
      ],
    };
    const report = compareSnapshots(baseline, current);
    expect(report.improvements.some(i => i.dimension === 'cost')).toBe(true);
  });

  test('reports unchanged tests', () => {
    const snap: ReportSnapshot = {
      suite_name: 'v1', timestamp: '', tests: [
        { name: 'stable', passed: true, duration_ms: 100, cost_usd: 0, total_tokens: 0, pass_rate: 1, attempts: 1 },
      ],
    };
    const report = compareSnapshots(snap, snap);
    expect(report.unchanged).toContain('stable');
    expect(report.regressions).toHaveLength(0);
  });

  test('skips new tests not in baseline', () => {
    const baseline: ReportSnapshot = { suite_name: 'v1', timestamp: '', tests: [] };
    const current: ReportSnapshot = {
      suite_name: 'v2', timestamp: '', tests: [
        { name: 'new-test', passed: true, duration_ms: 100, cost_usd: 0, total_tokens: 0, pass_rate: 1, attempts: 1 },
      ],
    };
    const report = compareSnapshots(baseline, current);
    expect(report.regressions).toHaveLength(0);
    expect(report.unchanged).toHaveLength(0);
  });
});

describe('Regression Detector - Formatting', () => {
  test('formats report with regressions and improvements', () => {
    const report = {
      baseline_label: 'v2.3', current_label: 'v2.4',
      regressions: [{ test: 't-5', dimension: 'latency' as const, severity: 'critical' as const, direction: 'regression' as const, baseline_value: 2100, current_value: 4600, change_percent: 119, message: 'latency +119%' }],
      improvements: [{ test: 't-3', dimension: 'cost' as const, severity: 'info' as const, direction: 'improvement' as const, baseline_value: 0.1, current_value: 0.07, change_percent: -30, message: 'cost -30%' }],
      unchanged: ['t-1'], summary: { total_tests: 3, regressed: 1, improved: 1, unchanged: 1 },
    };
    const out = formatRegressionReport(report);
    expect(out).toContain('Regressions detected');
    expect(out).toContain('Improvements');
    expect(out).toContain('t-5');
    expect(out).toContain('t-3');
  });
});

// ═══════════════════════════════════════════════
// Enhanced Plugin System
// ═══════════════════════════════════════════════

describe('Plugins - Registration', () => {
  beforeEach(() => clearAllPlugins());

  test('registers and retrieves plugin', () => {
    const plugin: AgentProbePlugin = { name: 'test-plugin', type: 'reporter' };
    registerPlugin(plugin);
    expect(getPlugin('test-plugin')).toBeDefined();
    expect(getRegisteredPlugins()).toHaveLength(1);
  });

  test('unregisters plugin', () => {
    registerPlugin({ name: 'p1', assertions: { check_x: () => ({ name: 'check_x', passed: true }) } });
    expect(getPluginAssertionNames()).toContain('check_x');
    unregisterPlugin('p1');
    expect(getPlugin('p1')).toBeUndefined();
    expect(getPluginAssertionNames()).not.toContain('check_x');
  });

  test('re-registration replaces old plugin', () => {
    registerPlugin({ name: 'p1', assertions: { old: () => ({ name: 'old', passed: true }) } });
    registerPlugin({ name: 'p1', assertions: { new_assert: () => ({ name: 'new_assert', passed: true }) } });
    expect(getPluginAssertionNames()).not.toContain('old');
    expect(getPluginAssertionNames()).toContain('new_assert');
  });

  test('clearAllPlugins removes everything', () => {
    registerPlugin({ name: 'a' });
    registerPlugin({ name: 'b' });
    clearAllPlugins();
    expect(getRegisteredPlugins()).toHaveLength(0);
  });
});

describe('Plugins - Hooks', () => {
  beforeEach(() => clearAllPlugins());

  test('runs onTestComplete hooks', async () => {
    let called = false;
    registerPlugin({
      name: 'hook-plugin',
      hooks: { onTestComplete: () => { called = true; } },
    });
    await runPluginHook('onTestComplete', makeResult());
    expect(called).toBe(true);
  });

  test('hook errors do not propagate', async () => {
    registerPlugin({
      name: 'bad-hook',
      hooks: { onSuiteComplete: () => { throw new Error('boom'); } },
    });
    // Should not throw
    await runPluginHook('onSuiteComplete', makeSuiteResult());
  });
});

describe('Plugins - Assertions & Reporters', () => {
  beforeEach(() => clearAllPlugins());

  test('runs plugin assertion', () => {
    registerPlugin({
      name: 'assert-plugin',
      assertions: {
        has_output: (trace) => ({
          name: 'has_output',
          passed: trace.steps.some(s => s.type === 'output'),
        }),
      },
    });
    const trace = makeTrace({ steps: [makeStep({ type: 'output', data: { content: 'hi' } })] });
    const result = runPluginAssertion('has_output', trace, null);
    expect(result?.passed).toBe(true);
  });

  test('returns null for unknown assertion', () => {
    expect(runPluginAssertion('nonexistent', makeTrace(), null)).toBeNull();
  });

  test('registers and retrieves reporters', () => {
    registerPlugin({
      name: 'report-plugin',
      reporters: { slack: (result) => `Passed: ${result.passed}` },
    });
    expect(getPluginReporterNames()).toContain('slack');
    const reporter = getPluginReporter('slack');
    expect(reporter).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════
// Environment Profiles
// ═══════════════════════════════════════════════

describe('Profiles - Parsing', () => {
  test('parses profile from raw object', () => {
    const p = parseProfile({ adapter: 'openai', model: 'gpt-4', budget: 50 });
    expect(p.adapter).toBe('openai');
    expect(p.model).toBe('gpt-4');
    expect(p.budget).toBe(50);
  });

  test('handles missing optional fields', () => {
    const p = parseProfile({});
    expect(p.adapter).toBeUndefined();
    expect(p.budget).toBeUndefined();
  });
});

describe('Profiles - Loading', () => {
  test('loads profiles from YAML file', () => {
    const dir = tmpDir();
    const fp = path.join(dir, 'profiles.yml');
    fs.writeFileSync(fp, `
profiles:
  dev:
    adapter: ollama
    model: llama3
    budget: 0
  staging:
    adapter: openai
    model: gpt-3.5-turbo
    budget: 5.00
  production:
    adapter: openai
    model: gpt-4
    budget: 50.00
default: dev
`);
    const config = loadProfiles(fp);
    expect(Object.keys(config.profiles)).toHaveLength(3);
    expect(config.default).toBe('dev');
    expect(config.profiles.staging.model).toBe('gpt-3.5-turbo');
  });

  test('throws for missing file', () => {
    expect(() => loadProfiles('/nonexistent/profiles.yml')).toThrow();
  });
});

describe('Profiles - Resolution', () => {
  test('resolves named profile', () => {
    const config: ProfilesConfig = {
      profiles: {
        dev: { adapter: 'ollama', model: 'llama3' },
        prod: { adapter: 'openai', model: 'gpt-4' },
      },
      default: 'dev',
    };
    expect(resolveProfile(config, 'prod')?.model).toBe('gpt-4');
  });

  test('resolves default profile when no name given', () => {
    const config: ProfilesConfig = {
      profiles: { dev: { model: 'llama3' } },
      default: 'dev',
    };
    expect(resolveProfile(config)?.model).toBe('llama3');
  });

  test('returns undefined for unknown profile', () => {
    const config: ProfilesConfig = { profiles: {} };
    expect(resolveProfile(config, 'nope')).toBeUndefined();
  });
});

describe('Profiles - Validation', () => {
  test('valid profile passes', () => {
    expect(validateProfile({ budget: 10, timeout_ms: 5000 })).toEqual([]);
  });

  test('negative budget fails', () => {
    expect(validateProfile({ budget: -1 })).toContain('Budget cannot be negative');
  });

  test('negative timeout fails', () => {
    expect(validateProfile({ timeout_ms: -100 })).toContain('Timeout cannot be negative');
  });

  test('zero concurrency fails', () => {
    expect(validateProfile({ max_concurrency: 0 })).toContain('Max concurrency must be at least 1');
  });

  test('validateProfiles checks all profiles', () => {
    const config: ProfilesConfig = {
      profiles: {
        good: { budget: 10 },
        bad: { budget: -5 },
      },
      default: 'missing',
    };
    const errors = validateProfiles(config);
    expect(errors.bad).toBeDefined();
    expect(errors._config).toBeDefined();
  });
});

describe('Profiles - Formatting', () => {
  test('formats profile list', () => {
    const config: ProfilesConfig = {
      profiles: {
        dev: { adapter: 'ollama', model: 'llama3', budget: 0 },
        prod: { adapter: 'openai', model: 'gpt-4', budget: 50 },
      },
      default: 'dev',
    };
    const out = formatProfiles(config);
    expect(out).toContain('dev');
    expect(out).toContain('prod');
    expect(out).toContain('(default)');
  });

  test('listProfileNames returns names', () => {
    const config: ProfilesConfig = { profiles: { a: {}, b: {}, c: {} } };
    expect(listProfileNames(config)).toEqual(['a', 'b', 'c']);
  });
});

describe('Profiles - Scaffold', () => {
  test('generates scaffold YAML', () => {
    const yaml = scaffoldProfiles();
    expect(yaml).toContain('profiles:');
    expect(yaml).toContain('dev:');
    expect(yaml).toContain('staging:');
    expect(yaml).toContain('production:');
  });
});

describe('Profiles - Apply', () => {
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['AGENTPROBE_ADAPTER', 'AGENTPROBE_MODEL', 'AGENTPROBE_TIMEOUT_MS', 'AGENTPROBE_BUDGET']) {
      origEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(origEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test('applies profile to environment', () => {
    applyProfile({ adapter: 'anthropic', model: 'claude-3', budget: 25, timeout_ms: 60000 });
    expect(process.env.AGENTPROBE_ADAPTER).toBe('anthropic');
    expect(process.env.AGENTPROBE_MODEL).toBe('claude-3');
    expect(process.env.AGENTPROBE_BUDGET).toBe('25');
  });
});
