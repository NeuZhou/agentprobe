/**
 * Round 31 Tests — v3.3.0 features:
 *   - Agent Replay (enhanced)
 *   - CI Integration (Jenkins)
 *   - Cost Estimator
 *   - Plugin Registry
 *   - Test Impact Prioritizer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  replayTrace,
  deterministicReplay,
  formatDeterministicReplay,
  formatReplayResult,
} from '../src/replay';
import type { ReplayConfig, DeterministicReplayResult } from '../src/replay';
import {
  generateCIContent,
  getSupportedProviders,
} from '../src/ci';
import type { CIProvider } from '../src/ci';
import {
  estimateCosts,
  countTests,
  estimateTestComplexity,
  formatCostEstimate,
} from '../src/cost-estimator';
import type { CostEstimate } from '../src/cost-estimator';
import {
  listPlugins,
  getPluginEntry,
  getInstallCommand,
  getInstalledPlugins,
  formatPluginList,
  formatPluginDetail,
} from '../src/plugin-registry';
import {
  analyzeTestFile,
  analyzeTestDirectory,
  formatImpactAnalysis,
} from '../src/test-impact';
import type { AgentTrace, TestSuite, TestCase } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ===== Helpers =====

function makeTrace(steps: any[] = []): AgentTrace {
  return {
    id: 'test-trace-1',
    timestamp: new Date().toISOString(),
    steps: steps.map((s, i) => ({
      type: s.type ?? 'tool_call',
      timestamp: new Date().toISOString(),
      data: s.data ?? {},
      duration_ms: s.duration_ms ?? 100,
    })),
    metadata: {},
  };
}

function makeSuite(tests: Partial<TestCase>[]): TestSuite {
  return {
    name: 'test-suite',
    tests: tests.map((t, i) => ({
      name: t.name ?? `test-${i}`,
      input: t.input ?? 'test input',
      expect: t.expect ?? {},
      ...t,
    })) as TestCase[],
  };
}

// ===== Replay Tests =====

describe('Agent Replay — v3.3.0', () => {
  it('replays a trace with return override', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'test' } } },
      { type: 'tool_result', data: { tool_result: { results: [] } } },
    ]);
    const config: ReplayConfig = {
      trace,
      overrides: { search: { return: { results: ['found'] } } },
    };
    const result = replayTrace(config);
    expect(result.modifications.length).toBe(1);
    expect(result.modifications[0].type).toBe('return_override');
    expect(result.trace.id).toContain('replay-');
  });

  it('replays with error injection', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'api', tool_args: {} } },
      { type: 'tool_result', data: { tool_result: 'ok' } },
    ]);
    const result = replayTrace({ trace, overrides: { api: { error: 'timeout' } } });
    expect(result.modifications.some(m => m.type === 'error_injected')).toBe(true);
  });

  it('replays with step drop', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'log', tool_args: {} } },
      { type: 'tool_result', data: { tool_result: 'logged' } },
      { type: 'output', data: { content: 'done' } },
    ]);
    const result = replayTrace({ trace, overrides: { log: { drop: true } } });
    expect(result.trace.steps.length).toBe(1); // only the output step
  });

  it('deterministic replay detects match', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'a' } } },
    ]);
    const result = deterministicReplay(trace, trace);
    expect(result.passed).toBe(true);
    expect(result.mismatches.length).toBe(0);
  });

  it('deterministic replay detects drift', () => {
    const expected = makeTrace([
      { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'a' } } },
    ]);
    const actual = makeTrace([
      { type: 'tool_call', data: { tool_name: 'browse', tool_args: { q: 'a' } } },
    ]);
    const result = deterministicReplay(expected, actual);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some(m => m.field === 'tool_name')).toBe(true);
  });

  it('formats deterministic replay result', () => {
    const result: DeterministicReplayResult = {
      passed: true,
      totalSteps: 5,
      verifiedSteps: 3,
      mismatches: [],
      trace: makeTrace([]),
    };
    const output = formatDeterministicReplay(result);
    expect(output).toContain('PASSED');
    expect(output).toContain('Verified: 3');
  });

  it('formats replay result with modifications', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'api', tool_args: {} } },
      { type: 'tool_result', data: { tool_result: 'x' } },
    ]);
    const result = replayTrace({ trace, overrides: { api: { return: 'y' } } });
    const output = formatReplayResult(result);
    expect(output).toContain('Replay');
    expect(output).toContain('Modifications: 1');
  });
});

// ===== CI Integration Tests =====

describe('CI Integration — v3.3.0', () => {
  it('supports jenkins provider', () => {
    const providers = getSupportedProviders();
    expect(providers).toContain('jenkins');
  });

  it('generates Jenkins pipeline', () => {
    const content = generateCIContent({ provider: 'jenkins' });
    expect(content).toContain('pipeline');
    expect(content).toContain('agentprobe');
    expect(content).toContain('junit');
  });

  it('generates GitHub Actions with custom path', () => {
    const content = generateCIContent({ provider: 'github', testPath: 'my-tests/' });
    expect(content).toContain('my-tests/');
  });

  it('generates GitLab CI with custom node version', () => {
    const content = generateCIContent({ provider: 'gitlab', nodeVersion: '22' });
    expect(content).toContain('node:22');
  });

  it('generates Azure Pipelines', () => {
    const content = generateCIContent({ provider: 'azure-pipelines' });
    expect(content).toContain('trigger');
    expect(content).toContain('vmImage');
  });

  it('generates CircleCI config', () => {
    const content = generateCIContent({ provider: 'circleci' });
    expect(content).toContain('version: 2.1');
    expect(content).toContain('workflows');
  });

  it('throws on unsupported provider', () => {
    expect(() => generateCIContent({ provider: 'travis' as CIProvider })).toThrow();
  });
});

// ===== Cost Estimator Tests =====

describe('Cost Estimator — v3.3.0', () => {
  it('counts tests in a suite', () => {
    const suite = makeSuite([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    expect(countTests(suite)).toBe(3);
  });

  it('counts parameterized tests', () => {
    const suite = makeSuite([
      { name: 'param', each: [{ x: 1 }, { x: 2 }, { x: 3 }] } as any,
    ]);
    expect(countTests(suite)).toBe(3);
  });

  it('estimates test complexity from tool_sequence', () => {
    const test: TestCase = {
      name: 'complex',
      input: 'test',
      expect: { tool_sequence: ['a', 'b', 'c'] },
    };
    const complexity = estimateTestComplexity(test);
    expect(complexity).toBeGreaterThan(1);
  });

  it('estimates test complexity from judge spec', () => {
    const test: TestCase = {
      name: 'judged',
      input: 'test',
      expect: { judge: { criteria: 'accuracy', threshold: 0.8 } },
    };
    const complexity = estimateTestComplexity(test);
    expect(complexity).toBeGreaterThanOrEqual(1.5);
  });

  it('estimates costs for a simple suite', () => {
    const suite = makeSuite([{ name: 'a' }, { name: 'b' }]);
    const estimate = estimateCosts(suite, { models: ['gpt-4o'] });
    expect(estimate.testCount).toBe(2);
    expect(estimate.models.length).toBe(1);
    expect(estimate.totalEstimated).toBeGreaterThan(0);
    expect(estimate.suggestedBudget).toBeGreaterThan(estimate.totalEstimated);
  });

  it('applies safety margin', () => {
    const suite = makeSuite([{ name: 'a' }]);
    const estimate = estimateCosts(suite, { models: ['gpt-4o'], safetyMargin: 2.0 });
    expect(estimate.safetyMargin).toBe(2.0);
    // suggestedBudget should be ~2x totalEstimated
    expect(estimate.suggestedBudget).toBeCloseTo(estimate.totalEstimated * 2.0, 1);
  });

  it('formats cost estimate', () => {
    const estimate: CostEstimate = {
      testCount: 10,
      models: [
        { model: 'gpt-4o', avgCallsPerTest: 3, avgCostPerCall: 0.005, totalCost: 0.15 },
      ],
      totalEstimated: 0.15,
      suggestedBudget: 0.23,
      safetyMargin: 1.5,
    };
    const output = formatCostEstimate(estimate);
    expect(output).toContain('Cost Estimate');
    expect(output).toContain('10 tests');
    expect(output).toContain('gpt-4o');
  });

  it('handles empty suite', () => {
    const suite = makeSuite([]);
    const estimate = estimateCosts(suite, { models: ['gpt-4o'] });
    expect(estimate.testCount).toBe(0);
    expect(estimate.totalEstimated).toBe(0);
  });
});

// ===== Plugin Registry Tests =====

describe('Plugin Registry — v3.3.0', () => {
  it('lists all plugins', () => {
    const plugins = listPlugins();
    expect(plugins.length).toBeGreaterThan(0);
  });

  it('filters by category', () => {
    const reporters = listPlugins({ category: 'reporter' });
    expect(reporters.every(p => p.category === 'reporter')).toBe(true);
  });

  it('filters official only', () => {
    const official = listPlugins({ official: true });
    expect(official.every(p => p.official)).toBe(true);
    expect(official.length).toBeGreaterThan(0);
  });

  it('searches by query', () => {
    const results = listPlugins({ query: 'slack' });
    expect(results.length).toBe(1);
    expect(results[0].name).toContain('slack');
  });

  it('gets plugin entry by name', () => {
    const entry = getPluginEntry('@agentprobe/slack-notifier');
    expect(entry).toBeDefined();
    expect(entry!.category).toBe('notifier');
  });

  it('returns undefined for unknown plugin', () => {
    expect(getPluginEntry('@agentprobe/does-not-exist')).toBeUndefined();
  });

  it('generates npm install command', () => {
    const cmd = getInstallCommand('@agentprobe/slack-notifier');
    expect(cmd).toBe('npm install @agentprobe/slack-notifier');
  });

  it('generates yarn install command', () => {
    const cmd = getInstallCommand('@agentprobe/slack-notifier', 'yarn');
    expect(cmd).toBe('yarn add @agentprobe/slack-notifier');
  });

  it('generates pnpm install command', () => {
    const cmd = getInstallCommand('@agentprobe/html-reporter', 'pnpm');
    expect(cmd).toBe('pnpm add @agentprobe/html-reporter');
  });

  it('returns null for unknown plugin install', () => {
    expect(getInstallCommand('@agentprobe/nope')).toBeNull();
  });

  it('gets installed plugins from non-existent dir', () => {
    const installed = getInstalledPlugins('/tmp/nonexistent-dir-xyz');
    expect(installed).toEqual([]);
  });

  it('formats plugin list', () => {
    const plugins = listPlugins();
    const output = formatPluginList(plugins);
    expect(output).toContain('Available Plugins');
    expect(output).toContain('@agentprobe/');
  });

  it('formats plugin detail', () => {
    const entry = getPluginEntry('@agentprobe/otel-exporter')!;
    const output = formatPluginDetail(entry);
    expect(output).toContain('Official');
    expect(output).toContain('exporter');
    expect(output).toContain('npm install');
  });

  it('sorts plugins by downloads', () => {
    const plugins = listPlugins();
    for (let i = 1; i < plugins.length; i++) {
      expect((plugins[i - 1].downloads ?? 0)).toBeGreaterThanOrEqual(
        (plugins[i].downloads ?? 0),
      );
    }
  });
});

// ===== Test Impact Prioritizer Tests =====

describe('Test Impact Prioritizer — v3.3.0', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-impact-'));
  });

  it('analyzes a security-related test file', () => {
    const file = path.join(tmpDir, 'security-tests.yaml');
    fs.writeFileSync(file, 'name: Security\ntests:\n  - name: test injection\n    input: test\n    expect: {}');
    const result = analyzeTestFile(file);
    expect(result.risk).toBe('HIGH');
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('analyzes a standard test file as MEDIUM or lower', () => {
    const file = path.join(tmpDir, 'smoke.test.ts');
    fs.writeFileSync(file, 'describe("smoke", () => { it("works", () => { expect(true).toBe(true); }); });');
    const result = analyzeTestFile(file);
    // recently created files get a "modified today" boost
    expect(['LOW', 'MEDIUM']).toContain(result.risk);
    expect(result.score).toBeLessThan(80); // not HIGH
  });

  it('analyzes a regression test as MEDIUM or HIGH', () => {
    const file = path.join(tmpDir, 'regression.yaml');
    fs.writeFileSync(file, 'name: Regression Suite\ntests:\n  - name: check\n    input: hi\n    expect: {}');
    const result = analyzeTestFile(file);
    expect(['MEDIUM', 'HIGH']).toContain(result.risk);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('analyzes a directory of test files', () => {
    fs.writeFileSync(path.join(tmpDir, 'security.test.ts'), 'describe("security", () => {});');
    fs.writeFileSync(path.join(tmpDir, 'smoke.test.ts'), 'describe("smoke", () => {});');
    fs.writeFileSync(path.join(tmpDir, 'regression.yaml'), 'name: reg\ntests: []');
    const result = analyzeTestDirectory(tmpDir);
    expect(result.totalFiles).toBe(3);
    expect(result.highRisk + result.mediumRisk + result.lowRisk).toBe(3);
  });

  it('sorts by score descending', () => {
    fs.writeFileSync(path.join(tmpDir, 'security.test.ts'), 'describe("security auth", () => {});');
    fs.writeFileSync(path.join(tmpDir, 'basic.test.ts'), 'describe("basic", () => {});');
    const result = analyzeTestDirectory(tmpDir);
    expect(result.assessments[0].score).toBeGreaterThanOrEqual(result.assessments[1].score);
  });

  it('boosts score for changed files', () => {
    fs.writeFileSync(path.join(tmpDir, 'basic.test.ts'), 'describe("basic", () => {});');
    const result = analyzeTestDirectory(tmpDir, { changedFiles: ['basic.ts'] });
    expect(result.assessments[0].reasons.some(r => r.includes('affected'))).toBe(true);
  });

  it('formats impact analysis output', () => {
    fs.writeFileSync(path.join(tmpDir, 'auth.test.ts'), 'describe("auth security", () => {});');
    fs.writeFileSync(path.join(tmpDir, 'smoke.test.ts'), 'describe("smoke", () => {});');
    const result = analyzeTestDirectory(tmpDir);
    const output = formatImpactAnalysis(result);
    expect(output).toContain('Priority Order');
    expect(output).toContain('HIGH');
  });

  it('handles empty directory', () => {
    const result = analyzeTestDirectory(tmpDir);
    expect(result.totalFiles).toBe(0);
    expect(result.assessments).toEqual([]);
  });
});
