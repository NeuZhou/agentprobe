/**
 * Round 17 Tests — CI/CD, Coverage Report, Behavior Profiler, Mutation Testing, i18n, Deps Enhancement
 */

import { describe, it, expect } from 'vitest';
import {
  generateCIContent, getSupportedProviders,
} from '../src/ci';
import type { CIProvider } from '../src/ci';
import {
  analyzeToolCoverage, analyzeAssertionCoverage, classifyScenario,
  analyzeScenarioCoverage, generateDetailedCoverage, formatDetailedCoverage,
  recordCoverageTrend,
} from '../src/coverage-report';
import type { DetailedCoverageReport } from '../src/coverage-report';
import {
  profileBehavior, formatBehaviorProfile,
} from '../src/behavior-profiler';
import {
  generateMutations, applyMutation, formatMutationReport,
} from '../src/mutation';
import type { MutationReport } from '../src/mutation';
import {
  setLocale, getLocale, t, getSupportedLocales, detectLocale, getTranslations,
} from '../src/i18n';
import type { Locale } from '../src/i18n';
import {
  buildExecutionPlan, shouldSkip, generateDependencyGraph,
} from '../src/deps';
import type { DepTestCase } from '../src/deps';
import type { SuiteResult, TestCase, AgentTrace } from '../src/types';

// ===== Helpers =====

function makeTrace(steps: any[] = []): AgentTrace {
  return {
    id: 'test-trace',
    timestamp: new Date().toISOString(),
    steps: steps.map((s, i) => ({
      type: s.type ?? 'tool_call',
      timestamp: new Date().toISOString(),
      duration_ms: s.duration_ms ?? 100,
      data: s.data ?? {},
    })),
    metadata: {},
  };
}

function makeSuiteResult(traces: AgentTrace[] = []): SuiteResult {
  return {
    name: 'test-suite',
    passed: traces.length,
    failed: 0,
    total: traces.length,
    duration_ms: 1000,
    results: traces.map((trace, i) => ({
      name: `test-${i}`,
      passed: true,
      assertions: [],
      duration_ms: 500,
      trace,
    })),
  };
}

function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    name: overrides.name ?? 'test-case',
    input: overrides.input ?? 'test input',
    tags: overrides.tags,
    faults: overrides.faults,
    expect: overrides.expect ?? { output_contains: 'hello' },
    ...overrides,
  } as TestCase;
}

// ===== CI/CD Tests =====

describe('CI/CD Integration', () => {
  it('lists supported providers', () => {
    const providers = getSupportedProviders();
    expect(providers).toContain('github');
    expect(providers).toContain('gitlab');
    expect(providers).toContain('azure-pipelines');
    expect(providers).toContain('circleci');
    expect(providers.length).toBe(5);
  });

  it('generates GitHub Actions workflow content', () => {
    const content = generateCIContent({ provider: 'github' });
    expect(content).toContain('Agent Tests');
    expect(content).toContain('agentprobe run');
    expect(content).toContain('actions/checkout@v4');
    expect(content).toContain('OPENAI_API_KEY');
  });

  it('generates GitLab CI content', () => {
    const content = generateCIContent({ provider: 'gitlab' });
    expect(content).toContain('stages:');
    expect(content).toContain('agent-test');
    expect(content).toContain('agentprobe run');
    expect(content).toContain('junit');
  });

  it('generates Azure Pipelines content', () => {
    const content = generateCIContent({ provider: 'azure-pipelines' });
    expect(content).toContain('trigger:');
    expect(content).toContain('NodeTool@0');
    expect(content).toContain('agentprobe run');
    expect(content).toContain('PublishTestResults@2');
  });

  it('generates CircleCI content', () => {
    const content = generateCIContent({ provider: 'circleci' });
    expect(content).toContain('version: 2.1');
    expect(content).toContain('cimg/node');
    expect(content).toContain('agentprobe run');
    expect(content).toContain('store_test_results');
  });

  it('uses custom test path in templates', () => {
    const content = generateCIContent({ provider: 'github', testPath: 'my-tests/' });
    expect(content).toContain('agentprobe run my-tests/');
  });

  it('uses custom node version', () => {
    const content = generateCIContent({ provider: 'github', nodeVersion: '22' });
    expect(content).toContain("node-version: '22'");
  });

  it('throws on unsupported provider', () => {
    expect(() => generateCIContent({ provider: 'travis' as any })).toThrow('Unsupported CI provider');
  });
});

// ===== Coverage Report Tests =====

describe('Detailed Coverage Report', () => {
  it('analyzes tool coverage with declared tools', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'test' } } },
      { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'other' } } },
    ]);
    const result = makeSuiteResult([trace]);
    const cov = analyzeToolCoverage(result, ['search', 'calculate', 'browse']);
    expect(cov.totalTools).toBe(3);
    expect(cov.calledTools).toEqual(['search']);
    expect(cov.uncalledTools).toContain('calculate');
    expect(cov.coveragePercent).toBe(33);
    expect(cov.callCounts['search']).toBe(2);
  });

  it('reports 100% when no declared tools and none called', () => {
    const result = makeSuiteResult([makeTrace([])]);
    const cov = analyzeToolCoverage(result);
    expect(cov.coveragePercent).toBe(100);
  });

  it('analyzes assertion type coverage', () => {
    const tests: TestCase[] = [
      makeTestCase({ expect: { tool_called: 'search', max_steps: 5 } }),
      makeTestCase({ expect: { output_contains: 'hello', output_matches: '.*' } }),
    ];
    const cov = analyzeAssertionCoverage(tests);
    expect(cov.usedTypes).toContain('tool_called');
    expect(cov.usedTypes).toContain('max_steps');
    expect(cov.usedTypes).toContain('output_contains');
    expect(cov.usedTypes).toContain('output_matches');
    expect(cov.unusedTypes).toContain('snapshot');
  });

  it('classifies happy path scenarios', () => {
    expect(classifyScenario(makeTestCase({ name: 'basic search' }))).toBe('happy_path');
    expect(classifyScenario(makeTestCase({ name: 'should return results' }))).toBe('happy_path');
  });

  it('classifies error scenarios', () => {
    expect(classifyScenario(makeTestCase({ name: 'handles invalid input' }))).toBe('error');
    expect(classifyScenario(makeTestCase({ name: 'error on timeout' }))).toBe('error');
    expect(classifyScenario(makeTestCase({ name: 'test fail' }))).toBe('error');
  });

  it('classifies security scenarios', () => {
    expect(classifyScenario(makeTestCase({ tags: ['security'] }))).toBe('security');
    expect(classifyScenario(makeTestCase({ name: 'SQL injection test' }))).toBe('security');
  });

  it('classifies edge case scenarios', () => {
    expect(classifyScenario(makeTestCase({ name: 'empty input edge' }))).toBe('edge_case');
    expect(classifyScenario(makeTestCase({ name: 'boundary value test' }))).toBe('edge_case');
  });

  it('classifies performance scenarios', () => {
    expect(classifyScenario(makeTestCase({ expect: { max_duration_ms: 1000 } }))).toBe('performance');
    expect(classifyScenario(makeTestCase({ tags: ['perf'] }))).toBe('performance');
  });

  it('analyzes scenario coverage', () => {
    const tests = [
      makeTestCase({ name: 'basic test' }),
      makeTestCase({ name: 'error handling' }),
      makeTestCase({ tags: ['security'] }),
    ];
    const cov = analyzeScenarioCoverage(tests);
    expect(cov.total).toBe(3);
    expect(cov.scenarios.happy_path).toBeGreaterThan(0);
    expect(cov.scenarios.error).toBeGreaterThan(0);
    expect(cov.scenarios.security).toBeGreaterThan(0);
  });

  it('generates detailed coverage with overall score', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search' } },
    ]);
    const result = makeSuiteResult([trace]);
    const tests = [makeTestCase({ expect: { tool_called: 'search' } })];
    const report = generateDetailedCoverage(result, tests, ['search']);
    expect(report.overallScore).toBeGreaterThan(0);
    expect(report.toolCoverage.coveragePercent).toBe(100);
  });

  it('formats detailed coverage report', () => {
    const report: DetailedCoverageReport = {
      toolCoverage: { totalTools: 3, calledTools: ['a'], uncalledTools: ['b', 'c'], coveragePercent: 33, callCounts: { a: 1 }, argCombinations: {} },
      assertionCoverage: { usedTypes: ['tool_called'], unusedTypes: ['snapshot'], coveragePercent: 10, typeCounts: { tool_called: 1 } },
      scenarioCoverage: { scenarios: { happy_path: 1, error: 0, edge_case: 0, security: 0, performance: 0, unknown: 0 }, total: 1, coveragePercent: 20, missingScenarios: ['error', 'edge_case', 'security', 'performance'] },
      overallScore: 21,
    };
    const output = formatDetailedCoverage(report);
    expect(output).toContain('Coverage Report');
    expect(output).toContain('33%');
    expect(output).toContain('Untested');
  });

  it('records coverage trend point', () => {
    const report: DetailedCoverageReport = {
      toolCoverage: { totalTools: 2, calledTools: ['a'], uncalledTools: ['b'], coveragePercent: 50, callCounts: {}, argCombinations: {} },
      assertionCoverage: { usedTypes: ['x'], unusedTypes: [], coveragePercent: 100, typeCounts: {} },
      scenarioCoverage: { scenarios: { happy_path: 1, error: 0, edge_case: 0, security: 0, performance: 0, unknown: 0 }, total: 1, coveragePercent: 20, missingScenarios: [] },
      overallScore: 57,
    };
    const point = recordCoverageTrend(report, 10);
    expect(point.toolCoverage).toBe(50);
    expect(point.testCount).toBe(10);
    expect(point.timestamp).toBeTruthy();
  });
});

// ===== Behavior Profiler Tests =====

describe('Behavior Profiler', () => {
  it('profiles decision style from thinking steps', () => {
    const trace = makeTrace([
      { type: 'thought', data: { content: 'Let me think...' } },
      { type: 'thought', data: { content: 'I should search' } },
      { type: 'tool_call', data: { tool_name: 'search' } },
    ]);
    const profile = profileBehavior([trace]);
    expect(profile.decisionStyle.label).toBe('deliberate');
    expect(profile.decisionStyle.avgThinkingSteps).toBeGreaterThan(0);
  });

  it('profiles impulsive style with no thinking', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search' } },
      { type: 'tool_call', data: { tool_name: 'browse' } },
    ]);
    const profile = profileBehavior([trace]);
    expect(profile.decisionStyle.label).toBe('impulsive');
  });

  it('profiles tool preferences', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search' } },
      { type: 'tool_call', data: { tool_name: 'search' } },
      { type: 'tool_call', data: { tool_name: 'calculate' } },
    ]);
    const profile = profileBehavior([trace]);
    expect(profile.toolPreference.ranked[0].tool).toBe('search');
    expect(profile.toolPreference.ranked[0].usagePercent).toBe(67);
  });

  it('computes tool diversity', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'a' } },
      { type: 'tool_call', data: { tool_name: 'b' } },
      { type: 'tool_call', data: { tool_name: 'c' } },
    ]);
    const profile = profileBehavior([trace]);
    expect(profile.toolPreference.diversity).toBeGreaterThan(0.9); // Nearly uniform
  });

  it('handles empty traces', () => {
    const profile = profileBehavior([]);
    expect(profile.decisionStyle.avgThinkingSteps).toBe(0);
    expect(profile.toolPreference.ranked).toEqual([]);
    expect(profile.conversationDepth.avgSteps).toBe(0);
  });

  it('profiles latency patterns', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'a' }, duration_ms: 50 },
      { type: 'tool_call', data: { tool_name: 'b' }, duration_ms: 5000 },
    ]);
    const profile = profileBehavior([trace]);
    expect(profile.latencyPattern.avgMs).toBeGreaterThan(0);
    expect(profile.latencyPattern.medianMs).toBeGreaterThan(0);
  });

  it('profiles conversation depth across traces', () => {
    const t1 = makeTrace([{ type: 'tool_call', data: {} }, { type: 'tool_call', data: {} }]);
    const t2 = makeTrace([{ type: 'tool_call', data: {} }]);
    const profile = profileBehavior([t1, t2]);
    expect(profile.conversationDepth.avgSteps).toBe(1.5);
    expect(profile.conversationDepth.maxSteps).toBe(2);
    expect(profile.conversationDepth.minSteps).toBe(1);
  });

  it('formats behavior profile', () => {
    const trace = makeTrace([
      { type: 'thought', data: { content: 'think' } },
      { type: 'tool_call', data: { tool_name: 'search' }, duration_ms: 200 },
    ]);
    const profile = profileBehavior([trace]);
    const output = formatBehaviorProfile(profile);
    expect(output).toContain('Agent Behavior Profile');
    expect(output).toContain('Decision style');
    expect(output).toContain('search');
  });
});

// ===== Mutation Testing Tests =====

describe('Mutation Testing', () => {
  it('generates mutations for tool_called assertion', () => {
    const test = makeTestCase({ expect: { tool_called: 'search' } });
    const mutations = generateMutations(test);
    expect(mutations.length).toBeGreaterThanOrEqual(2); // remove + swap
    expect(mutations.some(m => m.type === 'remove_assertion')).toBe(true);
    expect(mutations.some(m => m.type === 'swap_tool_name')).toBe(true);
  });

  it('generates mutations for output_contains', () => {
    const test = makeTestCase({ expect: { output_contains: 'hello' } });
    const mutations = generateMutations(test);
    expect(mutations.some(m => m.type === 'remove_assertion')).toBe(true);
    expect(mutations.some(m => m.type === 'change_expected_output')).toBe(true);
  });

  it('generates mutations for max_steps', () => {
    const test = makeTestCase({ expect: { max_steps: 5 } });
    const mutations = generateMutations(test);
    expect(mutations.some(m => m.type === 'weaken_threshold')).toBe(true);
    expect(mutations.find(m => m.field === 'max_steps')?.mutated).toBe(999);
  });

  it('generates mutations for tool_sequence', () => {
    const test = makeTestCase({ expect: { tool_sequence: ['search', 'browse'] } });
    const mutations = generateMutations(test);
    expect(mutations.some(m => m.type === 'remove_tool_sequence')).toBe(true);
  });

  it('generates mutations for output_matches', () => {
    const test = makeTestCase({ expect: { output_matches: 'hello.*world' } });
    const mutations = generateMutations(test);
    expect(mutations.some(m => m.type === 'negate_assertion')).toBe(true);
  });

  it('applies mutation correctly', () => {
    const test = makeTestCase({ expect: { tool_called: 'search', output_contains: 'hi' } });
    const mutations = generateMutations(test);
    const removeMutation = mutations.find(m => m.field === 'tool_called' && m.type === 'remove_assertion')!;
    const mutated = applyMutation(test, removeMutation);
    expect(mutated.expect.tool_called).toBeUndefined();
    expect(mutated.expect.output_contains).toBe('hi'); // unchanged
  });

  it('handles test with no assertions', () => {
    const test = makeTestCase({ expect: {} });
    const mutations = generateMutations(test);
    expect(mutations.length).toBe(0);
  });

  it('formats mutation report', () => {
    const report: MutationReport = {
      total: 3, caught: 2, escaped: 1, score: 67,
      results: [
        { mutation: { type: 'remove_assertion', description: 'Remove tool_called', testName: 'test', field: 'tool_called', original: 'x', mutated: undefined }, caught: true, message: 'CAUGHT' },
        { mutation: { type: 'change_expected_output', description: 'Change output', testName: 'test', field: 'output_contains', original: 'x', mutated: 'y' }, caught: true, message: 'CAUGHT' },
        { mutation: { type: 'remove_assertion', description: 'Remove max_steps', testName: 'test', field: 'max_steps', original: 5, mutated: undefined }, caught: false, message: 'ESCAPED' },
      ],
    };
    const output = formatMutationReport(report);
    expect(output).toContain('Mutation Testing Report');
    expect(output).toContain('67%');
    expect(output).toContain('CAUGHT');
    expect(output).toContain('ESCAPED');
    expect(output).toContain('weak test assertions');
  });

  it('generates mutation for max_cost_usd', () => {
    const test = makeTestCase({ expect: { max_cost_usd: 0.5 } });
    const mutations = generateMutations(test);
    expect(mutations.some(m => m.field === 'max_cost_usd')).toBe(true);
  });

  it('generates mutation for max_duration_ms', () => {
    const test = makeTestCase({ expect: { max_duration_ms: 5000 } });
    const mutations = generateMutations(test);
    expect(mutations.some(m => m.field === 'max_duration_ms')).toBe(true);
  });
});

// ===== i18n Tests =====

describe('Multi-Language Support (i18n)', () => {
  it('defaults to English', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('passed')).toBe('Passed');
  });

  it('switches to Chinese', () => {
    setLocale('zh-CN');
    expect(t('passed')).toBe('通过');
    expect(t('failed')).toBe('失败');
    expect(t('testResults')).toBe('测试结果');
    setLocale('en'); // reset
  });

  it('supports Japanese', () => {
    setLocale('ja');
    expect(t('passed')).toBe('成功');
    expect(t('testResults')).toBe('テスト結果');
    setLocale('en');
  });

  it('supports Korean', () => {
    setLocale('ko');
    expect(t('passed')).toBe('통과');
    setLocale('en');
  });

  it('supports German', () => {
    setLocale('de');
    expect(t('passed')).toBe('Bestanden');
    setLocale('en');
  });

  it('supports French', () => {
    setLocale('fr');
    expect(t('passed')).toBe('Réussi');
    setLocale('en');
  });

  it('lists supported locales', () => {
    const locales = getSupportedLocales();
    expect(locales).toContain('en');
    expect(locales).toContain('zh-CN');
    expect(locales).toContain('ja');
    expect(locales.length).toBeGreaterThanOrEqual(6);
  });

  it('throws on unsupported locale', () => {
    expect(() => setLocale('xx' as Locale)).toThrow('Unsupported locale');
  });

  it('gets full translation set', () => {
    const trans = getTranslations('zh-CN');
    expect(trans.passed).toBe('通过');
    expect(trans.deliberate).toBe('深思熟虑型');
  });

  it('translates coverage terms', () => {
    setLocale('zh-CN');
    expect(t('coverageReport')).toBe('覆盖率报告');
    expect(t('toolCoverage')).toBe('工具覆盖率');
    setLocale('en');
  });

  it('translates mutation terms', () => {
    setLocale('zh-CN');
    expect(t('mutationReport')).toBe('变异测试报告');
    expect(t('caught')).toBe('已捕获');
    expect(t('escaped')).toBe('已逃逸');
    setLocale('en');
  });

  it('translates profiler terms', () => {
    setLocale('zh-CN');
    expect(t('agentProfile')).toBe('Agent 行为画像');
    expect(t('decisionStyle')).toBe('决策风格');
    setLocale('en');
  });

  it('detects locale from environment', () => {
    const original = process.env.AGENTPROBE_LOCALE;
    process.env.AGENTPROBE_LOCALE = 'zh-CN';
    expect(detectLocale()).toBe('zh-CN');
    process.env.AGENTPROBE_LOCALE = original;
  });
});

// ===== Dependencies Tests =====

describe('Test Dependency Resolver (enhanced)', () => {
  it('resolves diamond dependency graph', () => {
    const tests: DepTestCase[] = [
      { name: 'setup', id: 'setup', input: '', expect: {} },
      { name: 'a', id: 'a', depends_on: 'setup', input: '', expect: {} },
      { name: 'b', id: 'b', depends_on: 'setup', input: '', expect: {} },
      { name: 'final', id: 'final', depends_on: ['a', 'b'], input: '', expect: {} },
    ];
    const plan = buildExecutionPlan(tests);
    expect(plan.groups.length).toBe(3);
    expect(plan.groups[0].map(t => t.id)).toEqual(['setup']);
    expect(plan.groups[1].map(t => t.id).sort()).toEqual(['a', 'b']);
    expect(plan.groups[2].map(t => t.id)).toEqual(['final']);
  });

  it('handles circular dependency gracefully', () => {
    const tests: DepTestCase[] = [
      { name: 'a', id: 'a', depends_on: 'b', input: '', expect: {} },
      { name: 'b', id: 'b', depends_on: 'a', input: '', expect: {} },
    ];
    const plan = buildExecutionPlan(tests);
    // Should not hang; pushes remaining into final group
    expect(plan.groups.length).toBeGreaterThanOrEqual(1);
  });

  it('skips test when dependency failed', () => {
    const test: DepTestCase = { name: 'test', depends_on: 'setup', input: '', expect: {} };
    const results = new Map([['setup', false]]);
    const { skip, reason } = shouldSkip(test, results);
    expect(skip).toBe(true);
    expect(reason).toContain('failed');
  });

  it('does not skip when dependency passed', () => {
    const test: DepTestCase = { name: 'test', depends_on: 'setup', input: '', expect: {} };
    const results = new Map([['setup', true]]);
    expect(shouldSkip(test, results).skip).toBe(false);
  });

  it('generates Mermaid dependency graph', () => {
    const tests: DepTestCase[] = [
      { name: 'setup', id: 'setup', input: '', expect: {} },
      { name: 'test-a', id: 'a', depends_on: 'setup', input: '', expect: {} },
    ];
    const mermaid = generateDependencyGraph(tests);
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('setup --> a');
  });

  it('parallelizes independent tests', () => {
    const tests: DepTestCase[] = [
      { name: 'a', id: 'a', input: '', expect: {} },
      { name: 'b', id: 'b', input: '', expect: {} },
      { name: 'c', id: 'c', input: '', expect: {} },
    ];
    const plan = buildExecutionPlan(tests);
    expect(plan.groups.length).toBe(1);
    expect(plan.groups[0].length).toBe(3);
  });

  it('handles mixed deps and no-deps', () => {
    const tests: DepTestCase[] = [
      { name: 'independent', id: 'ind', input: '', expect: {} },
      { name: 'setup', id: 'setup', input: '', expect: {} },
      { name: 'dependent', id: 'dep', depends_on: 'setup', input: '', expect: {} },
    ];
    const plan = buildExecutionPlan(tests);
    expect(plan.groups[0].length).toBe(2); // ind + setup
    expect(plan.groups[1].length).toBe(1); // dep
  });

  it('skips when dependency not executed', () => {
    const test: DepTestCase = { name: 'test', depends_on: 'missing', input: '', expect: {} };
    const { skip, reason } = shouldSkip(test, new Map());
    expect(skip).toBe(true);
    expect(reason).toContain('not executed');
  });
});
