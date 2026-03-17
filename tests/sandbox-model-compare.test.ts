/**
 * Round 34 tests — v3.6.0: Sandbox, Regression Gen, Model Compare, Coverage Analyzer, Config Validator
 */

import { describe, it, expect } from 'vitest';

// Sandbox
import {
  AgentSandbox, validateSandboxConfig, isToolAllowed, estimateCostFromSteps,
  checkViolations, buildSandboxResult, computeSandboxStats, formatSandboxResult,
} from '../src/sandbox';
import type { SandboxConfig, SandboxResult } from '../src/sandbox';

// Regression Gen
import {
  extractIntent, extractToolSequence, extractErrors, normalizeIntent,
  groupByIntent, groupByToolPattern, findErrorTraces, detectPatterns,
  generateRegressionTests, toTestCases, formatRegressionGenResult,
} from '../src/regression-gen';

// Model Compare
import {
  parseModelNames, extractMetrics, buildComparisonMatrix, scoreModel,
  compareModels, formatComparisonTable, generateComparisonHTML,
} from '../src/model-compare';

// Coverage Analyzer
import {
  extractTestedTools, analyzeToolCoverage, analyzeIntentCoverage,
  analyzeErrorPathCoverage, analyzeSafetyCoverage, analyzeCoverageComplete,
  formatCoverageAnalysis,
} from '../src/coverage-analyzer';

// Config Validator
import {
  validateConfigStructure, validateAdapters, validateHooks, validatePlugins,
  validateConfig, formatConfigValidation,
} from '../src/config-validator';

import type { AgentTrace, TraceStep, SuiteResult, TestCase } from '../src/types';

// === Helpers ===

function makeTrace(steps: TraceStep[], id = 'trace-1'): AgentTrace {
  return { id, timestamp: new Date().toISOString(), steps, metadata: {} };
}

function makeStep(type: TraceStep['type'], data: TraceStep['data'], durationMs = 100): TraceStep {
  return { type, timestamp: new Date().toISOString(), data, duration_ms: durationMs };
}

function makeSuiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'test-suite', passed: 3, failed: 1, total: 4, duration_ms: 1000,
    results: [
      { name: 'test-a', passed: true, assertions: [], duration_ms: 200 },
      { name: 'test-b', passed: true, assertions: [], duration_ms: 300 },
      { name: 'test-c', passed: true, assertions: [], duration_ms: 250 },
      { name: 'test-d', passed: false, assertions: [], duration_ms: 250, error: 'fail' },
    ],
    ...overrides,
  };
}

// ==================== SANDBOX ====================

describe('AgentSandbox', () => {
  it('validates sandbox config - valid', () => {
    const errors = validateSandboxConfig({ timeout: 5000, maxCost: 1, allowedTools: ['search'] });
    expect(errors).toEqual([]);
  });

  it('validates sandbox config - invalid timeout', () => {
    const errors = validateSandboxConfig({ timeout: -1, maxCost: 1, allowedTools: ['search'] });
    expect(errors).toContain('timeout must be positive');
  });

  it('validates sandbox config - empty allowedTools', () => {
    const errors = validateSandboxConfig({ timeout: 5000, maxCost: 1, allowedTools: [] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('isToolAllowed checks whitelist', () => {
    expect(isToolAllowed('search', ['search', 'read'])).toBe(true);
    expect(isToolAllowed('delete', ['search', 'read'])).toBe(false);
  });

  it('isToolAllowed allows wildcard', () => {
    expect(isToolAllowed('anything', ['*'])).toBe(true);
  });

  it('estimateCostFromSteps calculates correctly', () => {
    const steps: TraceStep[] = [
      makeStep('llm_call', { tokens: { input: 1000, output: 500 } }),
    ];
    const cost = estimateCostFromSteps(steps);
    expect(cost).toBeGreaterThan(0);
  });

  it('checkViolations detects timeout', () => {
    const config: SandboxConfig = { timeout: 1000, maxCost: 10, allowedTools: ['*'] };
    const violations = checkViolations([], config, 2000);
    expect(violations.some(v => v.type === 'timeout')).toBe(true);
  });

  it('checkViolations detects blocked tool', () => {
    const config: SandboxConfig = { timeout: 10000, maxCost: 10, allowedTools: ['search'] };
    const steps = [makeStep('tool_call', { tool_name: 'delete_file' })];
    const violations = checkViolations(steps, config, 100);
    expect(violations.some(v => v.type === 'tool_blocked')).toBe(true);
  });

  it('buildSandboxResult returns success when no violations', () => {
    const trace = makeTrace([makeStep('tool_call', { tool_name: 'search' })]);
    const config: SandboxConfig = { timeout: 10000, maxCost: 10, allowedTools: ['search'] };
    const result = buildSandboxResult(trace, config, 500);
    expect(result.success).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('computeSandboxStats aggregates', () => {
    const results: SandboxResult[] = [
      { success: true, trace: makeTrace([]), violations: [], totalCost: 0.05, durationMs: 1000, toolCalls: ['a'], blockedCalls: [] },
      { success: false, trace: makeTrace([]), violations: [{ type: 'timeout', message: 'x' }], totalCost: 0.10, durationMs: 2000, toolCalls: ['b'], blockedCalls: [] },
    ];
    const stats = computeSandboxStats(results);
    expect(stats.totalRuns).toBe(2);
    expect(stats.totalViolations).toBe(1);
    expect(stats.avgDurationMs).toBe(1500);
  });

  it('formatSandboxResult includes emoji', () => {
    const result: SandboxResult = { success: true, trace: makeTrace([]), violations: [], totalCost: 0, durationMs: 100, toolCalls: [], blockedCalls: [] };
    expect(formatSandboxResult(result)).toContain('✅');
  });

  it('AgentSandbox class runs and tracks', () => {
    const sandbox = new AgentSandbox({ timeout: 5000, maxCost: 1, allowedTools: ['search'] });
    const trace = makeTrace([makeStep('tool_call', { tool_name: 'search' })]);
    const result = sandbox.run({}, 'test', trace, 500);
    expect(result.success).toBe(true);
    expect(sandbox.getRuns().length).toBe(1);
    sandbox.reset();
    expect(sandbox.getRuns().length).toBe(0);
  });

  it('AgentSandbox throws on invalid config', () => {
    expect(() => new AgentSandbox({ timeout: -1, maxCost: 1, allowedTools: [] })).toThrow();
  });
});

// ==================== REGRESSION GEN ====================

describe('RegressionTestGenerator', () => {
  const userStep = makeStep('llm_call', {
    messages: [{ role: 'user', content: 'Search for weather' }],
  });
  const toolStep = makeStep('tool_call', { tool_name: 'search' });
  const errorStep = makeStep('tool_result', { tool_result: { error: 'not found' } });

  it('extractIntent finds user message', () => {
    const trace = makeTrace([userStep]);
    expect(extractIntent(trace)).toBe('Search for weather');
  });

  it('extractIntent returns null for empty trace', () => {
    expect(extractIntent(makeTrace([]))).toBeNull();
  });

  it('extractToolSequence returns tool names', () => {
    const trace = makeTrace([toolStep, makeStep('tool_call', { tool_name: 'read' })]);
    expect(extractToolSequence(trace)).toEqual(['search', 'read']);
  });

  it('extractErrors finds error steps', () => {
    const trace = makeTrace([errorStep]);
    expect(extractErrors(trace).length).toBe(1);
  });

  it('normalizeIntent lowercases and trims', () => {
    expect(normalizeIntent('  Hello   World  ')).toBe('hello world');
  });

  it('groupByIntent groups traces', () => {
    const t1 = makeTrace([userStep], 't1');
    const t2 = makeTrace([userStep], 't2');
    const groups = groupByIntent([t1, t2]);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0].length).toBe(2);
  });

  it('findErrorTraces filters correctly', () => {
    const good = makeTrace([toolStep], 'good');
    const bad = makeTrace([errorStep], 'bad');
    expect(findErrorTraces([good, bad]).length).toBe(1);
  });

  it('generateRegressionTests produces tests', () => {
    const traces = Array.from({ length: 5 }, (_, i) =>
      makeTrace([userStep, toolStep], `t${i}`)
    );
    const result = generateRegressionTests(traces);
    expect(result.testsGenerated.length).toBeGreaterThan(0);
    expect(result.totalTraces).toBe(5);
  });

  it('toTestCases converts to TestCase format', () => {
    const gen = [{ name: 'test', source: 'intent' as const, input: 'hi', expectations: { max_steps: 10 }, basedOn: ['t1'], confidence: 0.8 }];
    const cases = toTestCases(gen);
    expect(cases[0].name).toBe('test');
    expect(cases[0].tags).toContain('regression');
  });

  it('formatRegressionGenResult produces readable output', () => {
    const result = { totalTraces: 100, patternsFound: [], testsGenerated: [], coverage: { intents: 5, errorPaths: 2, toolPatterns: 3 } };
    const output = formatRegressionGenResult(result);
    expect(output).toContain('100 traces');
  });
});

// ==================== MODEL COMPARE ====================

describe('ModelCompare', () => {
  it('parseModelNames splits correctly', () => {
    expect(parseModelNames('gpt-4, claude-3, gemini')).toEqual(['gpt-4', 'claude-3', 'gemini']);
  });

  it('extractMetrics computes pass rate', () => {
    const m = extractMetrics('gpt-4', makeSuiteResult());
    expect(m.passRate).toBe(75);
    expect(m.model).toBe('gpt-4');
  });

  it('extractMetrics handles empty suite', () => {
    const m = extractMetrics('x', { name: 's', passed: 0, failed: 0, total: 0, duration_ms: 0, results: [] });
    expect(m.passRate).toBe(0);
  });

  it('buildComparisonMatrix creates correct shape', () => {
    const m1 = extractMetrics('a', makeSuiteResult());
    const m2 = extractMetrics('b', makeSuiteResult());
    const { testNames, matrix } = buildComparisonMatrix([m1, m2]);
    expect(testNames.length).toBe(4);
    expect(matrix.length).toBe(4);
    expect(matrix[0].length).toBe(2);
  });

  it('scoreModel returns a number', () => {
    const m = extractMetrics('gpt-4', makeSuiteResult());
    const score = scoreModel(m, { models: [] });
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
  });

  it('compareModels determines a winner', () => {
    const result = compareModels([
      { model: 'gpt-4', result: makeSuiteResult({ passed: 4, failed: 0 }) },
      { model: 'claude', result: makeSuiteResult({ passed: 3, failed: 1 }) },
    ]);
    expect(result.winner).toBe('gpt-4');
  });

  it('formatComparisonTable includes header', () => {
    const m = extractMetrics('gpt-4', makeSuiteResult());
    const output = formatComparisonTable([m]);
    expect(output).toContain('Model Comparison');
  });

  it('generateComparisonHTML produces valid HTML', () => {
    const result = compareModels([{ model: 'gpt-4', result: makeSuiteResult() }]);
    const html = generateComparisonHTML(result);
    expect(html).toContain('<html>');
    expect(html).toContain('gpt-4');
  });
});

// ==================== COVERAGE ANALYZER ====================

describe('CoverageAnalyzer', () => {
  const testCases: TestCase[] = [
    { name: 'test search', input: 'search for x', expect: { tool_called: 'search' } },
    { name: 'safety injection', input: 'inject sql', tags: ['safety'], expect: { tool_not_called: 'execute' } },
    { name: 'error handling', input: 'handle error', tags: ['error'], faults: { search: { type: 'error' } }, expect: { output_contains: 'error' } },
  ];

  it('extractTestedTools finds tools from expectations', () => {
    const tools = extractTestedTools(testCases);
    expect(tools).toContain('search');
    expect(tools).toContain('execute');
  });

  it('analyzeToolCoverage reports missing tools', () => {
    const result = analyzeToolCoverage(testCases, ['search', 'execute', 'delete', 'admin']);
    expect(result.missingTools).toContain('delete');
    expect(result.missingTools).toContain('admin');
    expect(result.percentage).toBeLessThan(100);
  });

  it('analyzeToolCoverage handles empty declared', () => {
    const result = analyzeToolCoverage(testCases, []);
    expect(result.percentage).toBe(100);
  });

  it('analyzeSafetyCoverage detects safety tests', () => {
    const result = analyzeSafetyCoverage(testCases);
    expect(result.safetyTests).toBeGreaterThan(0);
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it('analyzeErrorPathCoverage counts error tests', () => {
    const result = analyzeErrorPathCoverage(testCases);
    expect(result.coveredPaths).toBeGreaterThan(0);
  });

  it('analyzeCoverageComplete returns overall score', () => {
    const analysis = analyzeCoverageComplete(testCases, { declaredTools: ['search', 'execute'] });
    expect(analysis.overallScore).toBeGreaterThanOrEqual(0);
    expect(analysis.overallScore).toBeLessThanOrEqual(100);
  });

  it('formatCoverageAnalysis includes all sections', () => {
    const analysis = analyzeCoverageComplete(testCases, { declaredTools: ['search'] });
    const output = formatCoverageAnalysis(analysis);
    expect(output).toContain('Tool coverage');
    expect(output).toContain('Safety coverage');
  });
});

// ==================== CONFIG VALIDATOR ====================

describe('ConfigValidator', () => {
  it('validateConfigStructure accepts valid config', () => {
    const issues = validateConfigStructure({ name: 'test', adapter: 'openai', tests: 'tests/' });
    expect(issues.filter(i => i.level === 'error')).toEqual([]);
  });

  it('validateConfigStructure warns on empty config', () => {
    const issues = validateConfigStructure({});
    expect(issues.some(i => i.code === 'EMPTY_CONFIG')).toBe(true);
  });

  it('validateAdapters warns on missing key', () => {
    const { issues } = validateAdapters({ adapters: { openai: {} } });
    expect(issues.some(i => i.code === 'MISSING_KEY')).toBe(true);
  });

  it('validateAdapters detects expiring key', () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    const { issues } = validateAdapters({ adapters: { openai: { api_key: 'sk-x', expires: soon } } });
    expect(issues.some(i => i.code === 'KEY_EXPIRING')).toBe(true);
  });

  it('validateHooks accepts valid hooks', () => {
    const issues = validateHooks({ beforeAll: { command: 'echo hi' } });
    expect(issues.filter(i => i.level === 'error')).toEqual([]);
  });

  it('validateHooks rejects missing command', () => {
    const issues = validateHooks({ beforeAll: {} as any });
    expect(issues.some(i => i.code === 'INVALID_HOOK')).toBe(true);
  });

  it('validatePlugins reports loaded plugins', () => {
    const { pluginInfos } = validatePlugins(['my-plugin']);
    expect(pluginInfos[0].loaded).toBe(true);
  });

  it('validateConfig returns valid for good config', () => {
    const result = validateConfig({ name: 'test', adapter: 'openai', tests: 'tests/' });
    expect(result.valid).toBe(true);
  });

  it('formatConfigValidation includes emoji', () => {
    const result = validateConfig({ name: 'test' });
    expect(result.summary).toMatch(/[✅⚠️❌]/);
  });
});
