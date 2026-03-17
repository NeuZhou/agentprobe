/**
 * Round 45 Tests — v4.10.0 features:
 *   Plugin System: PluginManager, CostTracker, SmartRetry, LLMCache, CoverageTracker
 *   Built-in plugin lifecycle hooks, plugin discovery, hot-reload.
 *   40 tests covering all new exports.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Plugin system
import {
  PluginManager,
  registerPlugin,
  unregisterPlugin,
  getRegisteredPlugins,
  getPlugin,
  clearAllPlugins,
  runPluginHook,
  runPluginAssertion,
  getPluginReporter,
} from '../src/plugins';
import type { AgentProbePlugin, PluginHooks } from '../src/plugins';

// Built-in plugins
import { createCostTrackerPlugin, CostTracker } from '../src/plugins/cost-tracker';
import type { CostTrackerConfig, CostRecord } from '../src/plugins/cost-tracker';
import { createRetryPlugin, SmartRetryTracker } from '../src/plugins/retry';
import type { SmartRetryConfig, RetryRecord } from '../src/plugins/retry';
import { createCachePlugin, LLMCache } from '../src/plugins/cache';
import type { CacheConfig, CacheEntry, CacheStats } from '../src/plugins/cache';
import { createCoveragePlugin, CoverageTracker } from '../src/plugins/coverage';
import type { CoverageMetric, CoverageReport } from '../src/plugins/coverage';

import type { TestResult, AgentTrace, TraceStep } from '../src/types';

// ── Helpers ────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-r45-'));
}

function makeTrace(steps: Partial<TraceStep>[] = []): AgentTrace {
  return {
    id: 'trace-1',
    timestamp: new Date().toISOString(),
    steps: steps.map((s) => ({
      type: s.type ?? 'tool_call',
      timestamp: new Date().toISOString(),
      data: s.data ?? {},
      duration_ms: s.duration_ms ?? 100,
    })),
    metadata: {},
  };
}

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    name: 'test-1',
    passed: true,
    assertions: [],
    duration_ms: 500,
    ...overrides,
  };
}

function makePlugin(name: string, extras: Partial<AgentProbePlugin> = {}): AgentProbePlugin {
  return { name, version: '1.0.0', ...extras };
}

// ═══════════════════════════════════════════════════════════════════
// Plugin Manager
// ═══════════════════════════════════════════════════════════════════

describe('PluginManager', () => {
  beforeEach(() => clearAllPlugins());

  it('registers and retrieves plugins', () => {
    const pm = new PluginManager();
    const plugin = makePlugin('test-plugin');
    pm.register(plugin);
    expect(pm.get('test-plugin')).toBeDefined();
    expect(pm.get('test-plugin')!.name).toBe('test-plugin');
  });

  it('lists all registered plugins', () => {
    const pm = new PluginManager();
    pm.register(makePlugin('a'));
    pm.register(makePlugin('b'));
    expect(pm.getAll()).toHaveLength(2);
  });

  it('unregisters a plugin', () => {
    const pm = new PluginManager();
    pm.register(makePlugin('removeme'));
    expect(pm.unregister('removeme')).toBe(true);
    expect(pm.get('removeme')).toBeUndefined();
  });

  it('unregister returns false for unknown plugin', () => {
    const pm = new PluginManager();
    expect(pm.unregister('nope')).toBe(false);
  });

  it('clears all plugins', () => {
    const pm = new PluginManager();
    pm.register(makePlugin('x'));
    pm.register(makePlugin('y'));
    pm.clear();
    expect(pm.getAll()).toHaveLength(0);
  });

  it('getHooks returns matching hook functions', () => {
    const pm = new PluginManager();
    const fn = () => {};
    pm.register(makePlugin('hooked', { hooks: { onTestComplete: fn } }));
    const hooks = pm.getHooks('onTestComplete');
    expect(hooks).toHaveLength(1);
  });

  it('getHooks returns empty for no matching hooks', () => {
    const pm = new PluginManager();
    pm.register(makePlugin('nohook'));
    expect(pm.getHooks('onSuiteStart')).toHaveLength(0);
  });

  it('re-registering same name replaces old plugin', () => {
    const pm = new PluginManager();
    pm.register(makePlugin('dup', { version: '1.0.0' }));
    pm.register(makePlugin('dup', { version: '2.0.0' }));
    expect(pm.getAll()).toHaveLength(1);
    expect(pm.get('dup')!.version).toBe('2.0.0');
  });

  it('loadFromPackage throws for missing package', () => {
    const pm = new PluginManager();
    expect(() => pm.loadFromPackage('nonexistent-xyz')).toThrow(/Failed to load/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Plugin Hook Runner
// ═══════════════════════════════════════════════════════════════════

describe('runPluginHook', () => {
  beforeEach(() => clearAllPlugins());

  it('runs onTestComplete hooks', async () => {
    let called = false;
    registerPlugin(makePlugin('hook-test', {
      hooks: { onTestComplete: () => { called = true; } },
    }));
    await runPluginHook('onTestComplete', makeResult());
    expect(called).toBe(true);
  });

  it('runs async hooks', async () => {
    let value = 0;
    registerPlugin(makePlugin('async-hook', {
      hooks: { onTestComplete: async () => { value = 42; } },
    }));
    await runPluginHook('onTestComplete', makeResult());
    expect(value).toBe(42);
  });

  it('swallows hook errors gracefully', async () => {
    registerPlugin(makePlugin('bad-hook', {
      hooks: { onTestComplete: () => { throw new Error('boom'); } },
    }));
    // Should not throw
    await runPluginHook('onTestComplete', makeResult());
  });

  it('runs multiple hooks in order', async () => {
    const order: number[] = [];
    registerPlugin(makePlugin('h1', { hooks: { onSuiteStart: () => { order.push(1); } } }));
    registerPlugin(makePlugin('h2', { hooks: { onSuiteStart: () => { order.push(2); } } }));
    await runPluginHook('onSuiteStart', { name: 'suite', total: 2 });
    expect(order).toEqual([1, 2]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cost Tracker Plugin
// ═══════════════════════════════════════════════════════════════════

describe('CostTracker', () => {
  it('initializes with defaults', () => {
    const tracker = new CostTracker();
    expect(tracker.config.mode).toBe('warn');
    expect(tracker.getTotalCost()).toBe(0);
    expect(tracker.getRecords()).toHaveLength(0);
  });

  it('records test cost from trace', () => {
    const tracker = new CostTracker();
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4o-mini', tokens: { input: 100, output: 50 } } },
    ]);
    const result = makeResult({ trace });
    const record = tracker.recordTest(result);
    expect(record).not.toBeNull();
    expect(tracker.getRecords()).toHaveLength(1);
  });

  it('returns null for tests without trace', () => {
    const tracker = new CostTracker();
    expect(tracker.recordTest(makeResult())).toBeNull();
  });

  it('checks suite budget', () => {
    const tracker = new CostTracker({ maxCostPerSuite: 1.0 });
    expect(tracker.checkSuiteBudget()).toBe(true);
  });

  it('resets state', () => {
    const tracker = new CostTracker();
    tracker.recordTest(makeResult({ trace: makeTrace([{ type: 'llm_call', data: { model: 'gpt-4o' } }]) }));
    tracker.reset();
    expect(tracker.getRecords()).toHaveLength(0);
    expect(tracker.getTotalCost()).toBe(0);
  });

  it('formatReport returns string', () => {
    const tracker = new CostTracker({ maxCostPerSuite: 10 });
    expect(tracker.formatReport()).toContain('Cost Tracker Report');
    expect(tracker.formatReport()).toContain('Budget');
  });

  it('fires onBudgetExceeded callback', () => {
    let fired = false;
    const tracker = new CostTracker({
      maxCostPerTest: 0.0001,
      mode: 'warn',
      onBudgetExceeded: () => { fired = true; },
    });
    // Create a trace where calculateCost produces non-zero cost
    const trace: AgentTrace = {
      id: 'cost-test',
      timestamp: new Date().toISOString(),
      steps: [{
        type: 'llm_call',
        timestamp: new Date().toISOString(),
        data: { model: 'gpt-4o', tokens: { input: 100000, output: 50000 } },
        duration_ms: 100,
      }],
      metadata: {},
    };
    const record = tracker.recordTest(makeResult({ name: 'expensive', trace }));
    expect(record).not.toBeNull();
    expect(record!.cost).toBeGreaterThan(0);
    expect(fired).toBe(true);
  });
});

describe('createCostTrackerPlugin', () => {
  beforeEach(() => clearAllPlugins());

  it('creates a valid plugin', () => {
    const plugin = createCostTrackerPlugin();
    expect(plugin.name).toBe('cost-tracker');
    expect(plugin.tracker).toBeInstanceOf(CostTracker);
  });

  it('registers and works with PluginManager', () => {
    const pm = new PluginManager();
    const plugin = createCostTrackerPlugin();
    pm.register(plugin);
    expect(pm.get('cost-tracker')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Smart Retry Plugin
// ═══════════════════════════════════════════════════════════════════

describe('SmartRetryTracker', () => {
  it('initializes with defaults', () => {
    const tracker = new SmartRetryTracker();
    expect(tracker.config.maxRetries).toBe(3);
    expect(tracker.config.backoff).toBe('exponential');
  });

  it('computes delay with backoff', () => {
    const tracker = new SmartRetryTracker({ initialDelay: 1000, backoff: 'exponential', jitter: 0 });
    const d0 = tracker.computeDelay(0);
    const d1 = tracker.computeDelay(1);
    expect(d1).toBeGreaterThanOrEqual(d0);
  });

  it('shouldRetry returns false when max attempts reached', () => {
    const tracker = new SmartRetryTracker({ maxRetries: 2 });
    const result = makeResult({ passed: false, error: 'timeout' });
    expect(tracker.shouldRetry(result, 2)).toBe(false);
  });

  it('shouldRetry respects skipOn', () => {
    const tracker = new SmartRetryTracker({ skipOn: ['assertion_failed'] });
    const result = makeResult({ passed: false, error: 'assertion failed', assertions: [{ name: 'x', passed: false }] });
    expect(tracker.shouldRetry(result, 0)).toBe(false);
  });

  it('records retry info', () => {
    const tracker = new SmartRetryTracker();
    tracker.recordRetry('test-1', 3, 'timeout', [1000, 2000], true);
    expect(tracker.getRecords()).toHaveLength(1);
    expect(tracker.getFlakyTests()).toHaveLength(1);
  });

  it('reset clears records', () => {
    const tracker = new SmartRetryTracker();
    tracker.recordRetry('t', 2, 'timeout', [1000], false);
    tracker.reset();
    expect(tracker.getRecords()).toHaveLength(0);
  });

  it('formatReport returns string', () => {
    const tracker = new SmartRetryTracker();
    tracker.recordRetry('flaky-test', 2, 'rate_limit', [500], true);
    const report = tracker.formatReport();
    expect(report).toContain('Smart Retry Report');
    expect(report).toContain('flaky-test');
  });
});

describe('createRetryPlugin', () => {
  it('creates a valid plugin', () => {
    const plugin = createRetryPlugin({ maxRetries: 5 });
    expect(plugin.name).toBe('smart-retry');
    expect(plugin.retryTracker.config.maxRetries).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LLM Cache Plugin
// ═══════════════════════════════════════════════════════════════════

describe('LLMCache', () => {
  it('stores and retrieves responses', () => {
    const cache = new LLMCache();
    cache.set('gpt-4o', [{ role: 'user', content: 'hi' }], { text: 'hello' });
    const result = cache.get('gpt-4o', [{ role: 'user', content: 'hi' }]);
    expect(result).toEqual({ text: 'hello' });
  });

  it('returns null for cache miss', () => {
    const cache = new LLMCache();
    expect(cache.get('gpt-4o', [{ role: 'user', content: 'unknown' }])).toBeNull();
  });

  it('respects TTL', () => {
    const cache = new LLMCache({ ttlMs: 1 }); // 1ms TTL
    cache.set('gpt-4o', 'msg', 'resp');
    // Entry should expire almost immediately
    // Use a sync wait
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    expect(cache.get('gpt-4o', 'msg')).toBeNull();
  });

  it('has() works', () => {
    const cache = new LLMCache();
    cache.set('model', 'q', 'a');
    expect(cache.has('model', 'q')).toBe(true);
    expect(cache.has('model', 'other')).toBe(false);
  });

  it('tracks stats', () => {
    const cache = new LLMCache();
    cache.set('m', 'q', 'a');
    cache.get('m', 'q');   // hit
    cache.get('m', 'x');   // miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.entries).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it('evicts oldest when maxEntries reached', () => {
    const cache = new LLMCache({ maxEntries: 2 });
    cache.set('m', 'a', '1');
    cache.set('m', 'b', '2');
    cache.set('m', 'c', '3'); // should evict 'a'
    expect(cache.get('m', 'a')).toBeNull();
    expect(cache.getStats().entries).toBe(2);
  });

  it('clear resets everything', () => {
    const cache = new LLMCache();
    cache.set('m', 'q', 'a');
    cache.get('m', 'q');
    cache.clear();
    expect(cache.getStats().entries).toBe(0);
    expect(cache.getStats().hits).toBe(0);
  });

  it('disabled cache returns null', () => {
    const cache = new LLMCache({ enabled: false });
    cache.set('m', 'q', 'a');
    expect(cache.get('m', 'q')).toBeNull();
  });

  it('save and load from disk', () => {
    const dir = tmpDir();
    const cache = new LLMCache({ cacheDir: dir });
    cache.set('m', 'q', 'answer');
    cache.saveToDisk();

    const cache2 = new LLMCache({ cacheDir: dir });
    const loaded = cache2.loadFromDisk();
    expect(loaded).toBe(1);
    expect(cache2.has('m', 'q')).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it('formatReport returns string', () => {
    const cache = new LLMCache();
    expect(cache.formatReport()).toContain('LLM Cache Report');
  });
});

describe('createCachePlugin', () => {
  it('creates a valid plugin', () => {
    const plugin = createCachePlugin({ maxEntries: 500 });
    expect(plugin.name).toBe('llm-cache');
    expect(plugin.cache).toBeInstanceOf(LLMCache);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Enhanced Coverage Plugin
// ═══════════════════════════════════════════════════════════════════

describe('CoverageTracker', () => {
  it('records tool calls from test results', () => {
    const tracker = new CoverageTracker(['search', 'read', 'write']);
    tracker.recordTest(makeResult({
      trace: makeTrace([
        { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'test' } } },
        { type: 'tool_call', data: { tool_name: 'read', tool_args: { path: '/f' } } },
      ]),
    }));
    const report = tracker.getReport();
    expect(report.uniqueTools).toBe(2);
    expect(report.totalCalls).toBe(2);
    expect(report.uncoveredTools).toEqual(['write']);
    expect(report.coveragePercent).toBeCloseTo(66.67, 0);
  });

  it('tracks arg patterns', () => {
    const tracker = new CoverageTracker();
    tracker.recordTest(makeResult({
      trace: makeTrace([
        { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'a' } } },
        { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'b', limit: 5 } } },
      ]),
    }));
    const report = tracker.getReport();
    expect(report.tools['search'].argPatterns).toHaveLength(2);
  });

  it('tracks sequences', () => {
    const tracker = new CoverageTracker();
    tracker.recordTest(makeResult({
      trace: makeTrace([
        { type: 'tool_call', data: { tool_name: 'search' } },
        { type: 'tool_call', data: { tool_name: 'read' } },
      ]),
    }));
    expect(tracker.getReport().sequenceCoverage).toHaveLength(1);
    expect(tracker.getReport().sequenceCoverage[0]).toEqual(['search', 'read']);
  });

  it('100% coverage when all declared tools covered', () => {
    const tracker = new CoverageTracker(['a', 'b']);
    tracker.recordTest(makeResult({
      trace: makeTrace([
        { type: 'tool_call', data: { tool_name: 'a' } },
        { type: 'tool_call', data: { tool_name: 'b' } },
      ]),
    }));
    expect(tracker.getReport().coveragePercent).toBe(100);
  });

  it('reset clears metrics', () => {
    const tracker = new CoverageTracker();
    tracker.recordTest(makeResult({ trace: makeTrace([{ type: 'tool_call', data: { tool_name: 'x' } }]) }));
    tracker.reset();
    expect(tracker.getReport().uniqueTools).toBe(0);
  });

  it('formatReport returns string', () => {
    const tracker = new CoverageTracker(['search']);
    expect(tracker.formatReport()).toContain('Enhanced Coverage Report');
  });

  it('setDeclaredTools updates declared list', () => {
    const tracker = new CoverageTracker();
    tracker.setDeclaredTools(['a', 'b', 'c']);
    const report = tracker.getReport();
    expect(report.declaredTools).toEqual(['a', 'b', 'c']);
    expect(report.uncoveredTools).toEqual(['a', 'b', 'c']);
  });
});

describe('createCoveragePlugin', () => {
  it('creates a valid plugin', () => {
    const plugin = createCoveragePlugin(['tool-a']);
    expect(plugin.name).toBe('enhanced-coverage');
    expect(plugin.coverageTracker).toBeInstanceOf(CoverageTracker);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Plugin Assertions & Reporters
// ═══════════════════════════════════════════════════════════════════

describe('Plugin custom assertions and reporters', () => {
  beforeEach(() => clearAllPlugins());

  it('registers custom assertion via plugin', () => {
    const plugin = makePlugin('custom-assert', {
      assertions: {
        'has-search': (trace, _value) => ({
          name: 'has-search',
          passed: trace.steps.some((s: TraceStep) => s.data.tool_name === 'search'),
        }),
      },
    });
    registerPlugin(plugin);
    const trace = makeTrace([{ type: 'tool_call', data: { tool_name: 'search' } }]);
    const result = runPluginAssertion('has-search', trace, null);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('registers custom reporter via plugin', () => {
    const plugin = makePlugin('custom-reporter', {
      reporters: {
        'csv': (result) => `name,passed\n${result.results.map((r: TestResult) => `${r.name},${r.passed}`).join('\n')}`,
      },
    });
    registerPlugin(plugin);
    const reporter = getPluginReporter('csv');
    expect(reporter).not.toBeNull();
  });
});
