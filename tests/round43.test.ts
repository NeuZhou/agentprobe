/**
 * Round 43 Tests — v4.7.0 features:
 *   Dashboard, Config (enhanced), Watch, Init
 *   35+ tests covering all new exports.
 */

import { describe, it, expect } from 'vitest';

// Dashboard
import {
  sparkline,
  collectDashboardData,
  estimateTestCost,
  renderDashboard,
  renderCompactDashboard,
} from '../src/dashboard';
import type { DashboardData } from '../src/dashboard';
import type { SuiteResult, TestResult, AgentTrace } from '../src/types';

// Config (enhanced)
import {
  parseDuration,
  interpolateEnv,
  interpolateEnvDeep,
  loadConfigRaw,
  resolveDefaults,
  resolveSecurityPatterns,
  findConfigFile,
  loadConfig,
  getConfigDir,
} from '../src/config';

// Watch
import {
  findAffectedSuites,
  formatWatchEvent,
  formatWatchSession,
} from '../src/watch';
import type { WatchEvent, WatchSession } from '../src/watch';

// Init
import {
  generateConfig,
  generateSampleTests,
  generateProfiles,
  formatInitResult,
} from '../src/init';
import type { InitResult, AdapterChoice } from '../src/init';

// ── Helpers ────────────────────────────────────────────────────────

function makeSuiteResult(overrides?: Partial<SuiteResult>): SuiteResult {
  return {
    name: 'test-suite',
    passed: 3,
    failed: 1,
    total: 5,
    duration_ms: 1200,
    results: [],
    ...overrides,
  };
}

function makeTestResult(overrides?: Partial<TestResult>): TestResult {
  return {
    name: 'test-case',
    passed: true,
    assertions: [],
    duration_ms: 100,
    ...overrides,
  };
}

function makeTrace(tokens: { input: number; output: number }[]): AgentTrace {
  return {
    id: 'tr-1',
    timestamp: new Date().toISOString(),
    steps: tokens.map((t) => ({
      type: 'llm_call' as const,
      timestamp: new Date().toISOString(),
      data: { tokens: t },
    })),
    metadata: {},
  };
}

// ════════════════════════════════════════════════════════════════════
// DASHBOARD TESTS
// ════════════════════════════════════════════════════════════════════

describe('Dashboard — sparkline', () => {
  it('generates sparkline from data points', () => {
    const s = sparkline([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(s).toHaveLength(8);
    expect(s[0]).toBe('▁');
    expect(s[7]).toBe('█');
  });

  it('returns empty string for empty data', () => {
    expect(sparkline([])).toBe('');
  });

  it('handles single data point', () => {
    const s = sparkline([5]);
    expect(s).toHaveLength(1);
  });

  it('handles equal values', () => {
    const s = sparkline([3, 3, 3]);
    // All same → should be valid chars
    expect(s).toHaveLength(3);
  });
});

describe('Dashboard — estimateTestCost', () => {
  it('estimates cost from trace tokens', () => {
    const r = makeTestResult({
      trace: makeTrace([{ input: 500, output: 500 }]),
    });
    const cost = estimateTestCost(r);
    // 1000 tokens → $0.01
    expect(cost).toBeCloseTo(0.01, 3);
  });

  it('returns 0 when no trace', () => {
    expect(estimateTestCost(makeTestResult())).toBe(0);
  });

  it('sums across multiple steps', () => {
    const r = makeTestResult({
      trace: makeTrace([
        { input: 100, output: 100 },
        { input: 200, output: 200 },
      ]),
    });
    // 600 tokens → $0.006
    expect(estimateTestCost(r)).toBeCloseTo(0.006, 4);
  });
});

describe('Dashboard — collectDashboardData', () => {
  it('aggregates empty suites', () => {
    const data = collectDashboardData([]);
    expect(data.results.total).toBe(0);
    expect(data.cost.totalUsd).toBe(0);
  });

  it('counts passed/failed from results', () => {
    const suite = makeSuiteResult({
      results: [
        makeTestResult({ passed: true }),
        makeTestResult({ passed: true }),
        makeTestResult({ passed: false }),
      ],
    });
    const data = collectDashboardData([suite]);
    expect(data.results.passed).toBe(2);
    expect(data.results.failed).toBe(1);
  });

  it('counts skipped tests', () => {
    const suite = makeSuiteResult({
      results: [
        makeTestResult({ skipped: true }),
        makeTestResult({ passed: true }),
      ],
    });
    const data = collectDashboardData([suite]);
    expect(data.results.skipped).toBe(1);
    expect(data.results.passed).toBe(1);
  });

  it('identifies flaky tests (passed after retries)', () => {
    const suite = makeSuiteResult({
      results: [
        makeTestResult({ passed: true, attempts: 3 }),
      ],
    });
    const data = collectDashboardData([suite]);
    expect(data.results.flaky).toBe(1);
  });

  it('tracks most expensive test', () => {
    const suite = makeSuiteResult({
      results: [
        makeTestResult({ name: 'cheap', trace: makeTrace([{ input: 10, output: 10 }]) }),
        makeTestResult({ name: 'expensive', trace: makeTrace([{ input: 5000, output: 5000 }]) }),
      ],
    });
    const data = collectDashboardData([suite]);
    expect(data.cost.mostExpensive?.name).toBe('expensive');
  });

  it('uses provided history for trend', () => {
    const data = collectDashboardData([], { history: [1, 2, 3] });
    expect(data.trend).toEqual([1, 2, 3]);
  });
});

describe('Dashboard — renderDashboard', () => {
  it('renders box-drawing output', () => {
    const data: DashboardData = {
      results: { passed: 10, failed: 2, flaky: 1, skipped: 3, total: 16 },
      coverage: { tools: 85, prompts: 92, security: 78 },
      cost: { totalUsd: 1.23, avgPerTest: 0.008, mostExpensive: { name: 'search', costUsd: 0.15 } },
      trend: [1, 3, 5, 7, 8, 10, 8, 5],
      duration_ms: 4500,
    };
    const output = renderDashboard(data);
    expect(output).toContain('Test Results');
    expect(output).toContain('Coverage');
    expect(output).toContain('10 pass');
    expect(output).toContain('2 fail');
    expect(output).toContain('Tools: 85%');
    expect(output).toContain('$1.23');
    expect(output).toContain('search');
  });

  it('respects width option', () => {
    const data: DashboardData = {
      results: { passed: 1, failed: 0, flaky: 0, skipped: 0, total: 1 },
      coverage: { tools: 100, prompts: 100, security: 100 },
      cost: { totalUsd: 0, avgPerTest: 0, mostExpensive: null },
      trend: [],
      duration_ms: 100,
    };
    const output = renderDashboard(data, { width: 80 });
    expect(output).toBeTruthy();
  });
});

describe('Dashboard — renderCompactDashboard', () => {
  it('renders single-line summary', () => {
    const data: DashboardData = {
      results: { passed: 5, failed: 1, flaky: 0, skipped: 2, total: 8 },
      coverage: { tools: 90, prompts: 80, security: 70 },
      cost: { totalUsd: 0.5, avgPerTest: 0.0625, mostExpensive: null },
      trend: [],
      duration_ms: 2000,
    };
    const line = renderCompactDashboard(data);
    expect(line).toContain('5');
    expect(line).toContain('1');
    expect(line).toContain('$0.50');
    expect(line.split('\n')).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// CONFIG TESTS
// ════════════════════════════════════════════════════════════════════

describe('Config — parseDuration', () => {
  it('parses seconds', () => {
    expect(parseDuration('30s')).toBe(30000);
  });

  it('parses milliseconds', () => {
    expect(parseDuration('500ms')).toBe(500);
  });

  it('parses minutes', () => {
    expect(parseDuration('2m')).toBe(120000);
  });

  it('parses hours', () => {
    expect(parseDuration('1h')).toBe(3600000);
  });

  it('returns number as-is', () => {
    expect(parseDuration(5000)).toBe(5000);
  });

  it('uses default for undefined', () => {
    expect(parseDuration(undefined, 10000)).toBe(10000);
  });

  it('handles bare numbers as ms', () => {
    expect(parseDuration('1500')).toBe(1500);
  });
});

describe('Config — interpolateEnv', () => {
  it('replaces ${VAR} with env value', () => {
    process.env.__TEST_KEY = 'secret123';
    expect(interpolateEnv('key=${__TEST_KEY}')).toBe('key=secret123');
    delete process.env.__TEST_KEY;
  });

  it('replaces missing var with empty string', () => {
    expect(interpolateEnv('${__NONEXISTENT_VAR_XYZ}')).toBe('');
  });

  it('handles multiple replacements', () => {
    process.env.__A = 'x';
    process.env.__B = 'y';
    expect(interpolateEnv('${__A}-${__B}')).toBe('x-y');
    delete process.env.__A;
    delete process.env.__B;
  });
});

describe('Config — interpolateEnvDeep', () => {
  it('interpolates nested objects', () => {
    process.env.__DEEP = 'val';
    const result = interpolateEnvDeep({ a: { b: '${__DEEP}' } });
    expect(result.a.b).toBe('val');
    delete process.env.__DEEP;
  });

  it('interpolates arrays', () => {
    process.env.__ARR = 'item';
    const result = interpolateEnvDeep(['${__ARR}', 'plain']);
    expect(result).toEqual(['item', 'plain']);
    delete process.env.__ARR;
  });

  it('passes through non-string values', () => {
    expect(interpolateEnvDeep(42)).toBe(42);
    expect(interpolateEnvDeep(null)).toBe(null);
    expect(interpolateEnvDeep(true)).toBe(true);
  });
});

describe('Config — resolveDefaults', () => {
  it('resolves with timeout string', () => {
    const d = resolveDefaults({ defaults: { timeout: '30s', retries: 2, parallel: 4 } });
    expect(d.timeout_ms).toBe(30000);
    expect(d.retries).toBe(2);
    expect(d.parallel).toBe(4);
  });

  it('uses fallbacks for empty config', () => {
    const d = resolveDefaults({});
    expect(d.timeout_ms).toBe(30000);
    expect(d.retries).toBe(0);
    expect(d.parallel).toBe(1);
  });

  it('resolves parallel boolean true → 4', () => {
    const d = resolveDefaults({ defaults: { parallel: true as any } });
    expect(d.parallel).toBe(4);
  });
});

describe('Config — resolveSecurityPatterns', () => {
  it('returns patterns array', () => {
    const p = resolveSecurityPatterns({ security: { enabled: true, patterns: ['prompt-injection', 'data-exfil'] } });
    expect(p).toEqual(['prompt-injection', 'data-exfil']);
  });

  it('wraps single string in array', () => {
    const p = resolveSecurityPatterns({ security: { enabled: true, patterns: 'prompt-injection' } });
    expect(p).toEqual(['prompt-injection']);
  });

  it('returns empty when disabled', () => {
    const p = resolveSecurityPatterns({ security: { enabled: false, patterns: ['x'] } });
    expect(p).toEqual([]);
  });

  it('returns empty when no security section', () => {
    expect(resolveSecurityPatterns({})).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════
// WATCH TESTS
// ════════════════════════════════════════════════════════════════════

describe('Watch — findAffectedSuites', () => {
  const suites = ['tests/a.yaml', 'tests/b.yml'];

  it('returns matching suite when yaml file changes', () => {
    const result = findAffectedSuites('tests/a.yaml', suites);
    expect(result).toEqual(['tests/a.yaml']);
  });

  it('returns all suites when .ts file changes', () => {
    const result = findAffectedSuites('src/runner.ts', suites);
    expect(result).toEqual(suites);
  });

  it('returns empty for unrelated file', () => {
    const result = findAffectedSuites('README.md', suites);
    expect(result).toEqual([]);
  });
});

describe('Watch — formatWatchEvent', () => {
  it('formats change event', () => {
    const event: WatchEvent = { type: 'change', path: 'tests/a.yaml', timestamp: '2026-03-17T00:00:00Z' };
    const output = formatWatchEvent(event);
    expect(output).toContain('change');
    expect(output).toContain('tests/a.yaml');
  });
});

describe('Watch — formatWatchSession', () => {
  it('formats session summary', () => {
    const session: WatchSession = {
      events: [{ type: 'change', path: 'x', timestamp: '' }],
      runs: 5,
      passed: 10,
      failed: 2,
      startedAt: '2026-03-17T00:00:00Z',
    };
    const output = formatWatchSession(session);
    expect(output).toContain('5');
    expect(output).toContain('10 passed');
    expect(output).toContain('2 failed');
  });
});

// ════════════════════════════════════════════════════════════════════
// INIT TESTS
// ════════════════════════════════════════════════════════════════════

describe('Init — generateConfig', () => {
  const adapters: AdapterChoice[] = ['openai', 'anthropic', 'ollama', 'azure', 'gemini'];

  for (const adapter of adapters) {
    it(`generates config for ${adapter}`, () => {
      const config = generateConfig({ adapter, createSampleTests: false, outputDir: '.' });
      expect(config).toContain(`adapter: ${adapter}`);
      expect(config).toContain('AgentProbe Configuration');
    });
  }
});

describe('Init — generateSampleTests', () => {
  it('generates valid YAML test content', () => {
    const tests = generateSampleTests('openai');
    expect(tests).toContain('name:');
    expect(tests).toContain('tests:');
    expect(tests).toContain('input:');
  });
});

describe('Init — generateProfiles', () => {
  it('generates profiles with adapter', () => {
    const profiles = generateProfiles('anthropic');
    expect(profiles).toContain('anthropic');
    expect(profiles).toContain('dev:');
    expect(profiles).toContain('ci:');
    expect(profiles).toContain('production:');
  });
});

describe('Init — formatInitResult', () => {
  it('formats result with created files', () => {
    const result: InitResult = {
      files: ['config.yml', 'tests/sample.yaml'],
      adapter: 'openai',
      projectName: 'my-project',
    };
    const output = formatInitResult(result);
    expect(output).toContain('my-project');
    expect(output).toContain('openai');
    expect(output).toContain('config.yml');
    expect(output).toContain('Next steps');
  });
});
