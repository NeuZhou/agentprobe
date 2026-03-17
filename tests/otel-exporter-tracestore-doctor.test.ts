/**
 * Round 29 tests - v3.1.0
 * Tests for: OTelExporter class, TraceStore, Watch Mode, Init Command, Doctor Command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  traceToOTel, traceToOTLP, OTelExporter,
  TraceStore,
  findAffectedSuites, formatWatchEvent, formatWatchSession,
  generateConfig, generateSampleTests, generateProfiles, executeInit, formatInitResult,
  runDoctor, formatDoctor, checkNodeVersion, checkTypeScript, checkApiKey, checkTestDirectory, checkConfigFile,
} from '../src/lib';
import type { AgentTrace, SuiteResult } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ap-r29-'));
}

function makeTrace(steps: any[], metadata?: any): AgentTrace {
  return {
    id: `trace-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    steps,
    metadata: metadata ?? {},
  } as AgentTrace;
}

function makeSuiteResult(overrides?: Partial<SuiteResult>): SuiteResult {
  return {
    name: 'test-suite',
    passed: 2,
    failed: 1,
    total: 3,
    duration_ms: 1500,
    results: [
      { name: 'test-1', passed: true, assertions: [{ name: 'a', passed: true }], duration_ms: 500 },
      { name: 'test-2', passed: true, assertions: [{ name: 'b', passed: true }], duration_ms: 400 },
      { name: 'test-3', passed: false, assertions: [{ name: 'c', passed: false, message: 'fail' }], duration_ms: 600, error: 'assertion failed' },
    ],
    ...overrides,
  };
}

// ============================================================
// 1. OTelExporter class (8 tests)
// ============================================================

describe('OTelExporter', () => {
  it('constructor uses default config', () => {
    const exporter = new OTelExporter();
    expect(exporter.endpoint).toBe('http://localhost:4318/v1/traces');
    expect(exporter.serviceName).toBe('agentprobe');
  });

  it('constructor accepts custom config', () => {
    const exporter = new OTelExporter({ endpoint: 'http://jaeger:4318', serviceName: 'my-agent' });
    expect(exporter.endpoint).toBe('http://jaeger:4318');
    expect(exporter.serviceName).toBe('my-agent');
  });

  it('exportTrace returns OTel spans', () => {
    const exporter = new OTelExporter();
    const trace = makeTrace([
      { type: 'llm_call', timestamp: new Date().toISOString(), data: { model: 'gpt-4o', tokens: { input: 100, output: 50 } }, duration_ms: 500 },
      { type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: 'search', tool_args: { q: 'test' } }, duration_ms: 200 },
    ]);
    const spans = exporter.exportTrace(trace);
    expect(spans.length).toBeGreaterThanOrEqual(3); // root + llm + tool
    expect(spans[0].kind).toBe('SERVER');
  });

  it('exportSuiteResult creates suite root span', () => {
    const exporter = new OTelExporter();
    const result = makeSuiteResult();
    const spans = exporter.exportSuiteResult(result);
    const suiteSpan = spans.find((s) => s.operationName.startsWith('suite:'));
    expect(suiteSpan).toBeDefined();
    expect(suiteSpan!.attributes['agentprobe.suite.total']).toBe(3);
    expect(suiteSpan!.status.code).toBe('ERROR'); // has failures
  });

  it('exportSuiteResult creates per-test spans', () => {
    const exporter = new OTelExporter();
    const result = makeSuiteResult();
    const spans = exporter.exportSuiteResult(result);
    const testSpans = spans.filter((s) => s.operationName.startsWith('test:'));
    expect(testSpans).toHaveLength(3);
  });

  it('exportSuiteResult marks failed tests as ERROR', () => {
    const exporter = new OTelExporter();
    const result = makeSuiteResult();
    const spans = exporter.exportSuiteResult(result);
    const failedSpan = spans.find((s) => s.operationName === 'test:test-3');
    expect(failedSpan!.status.code).toBe('ERROR');
    expect(failedSpan!.status.message).toBe('assertion failed');
  });

  it('toOTLP wraps spans in OTLP format', () => {
    const exporter = new OTelExporter({ serviceName: 'custom' });
    const trace = makeTrace([{ type: 'llm_call', timestamp: new Date().toISOString(), data: { model: 'gpt-4' }, duration_ms: 100 }]);
    const spans = exporter.exportTrace(trace);
    const otlp = exporter.toOTLP(spans);
    expect(otlp.resourceSpans).toHaveLength(1);
    expect(otlp.resourceSpans[0].resource.attributes['service.name']).toBe('custom');
  });

  it('exportSuiteResult with all passing tests has OK status', () => {
    const exporter = new OTelExporter();
    const result = makeSuiteResult({ failed: 0, results: [
      { name: 't1', passed: true, assertions: [], duration_ms: 100 },
    ]});
    const spans = exporter.exportSuiteResult(result);
    const suiteSpan = spans.find((s) => s.operationName.startsWith('suite:'));
    expect(suiteSpan!.status.code).toBe('OK');
  });
});

// ============================================================
// 2. TraceStore (8 tests)
// ============================================================

describe('TraceStore', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = tmpDir();
    dbPath = path.join(dir, 'traces.db.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('save and get a trace', () => {
    const store = new TraceStore(dbPath);
    const trace = makeTrace([{ type: 'llm_call', timestamp: new Date().toISOString(), data: {}, duration_ms: 100 }]);
    const id = store.save(trace);
    expect(id).toBeTruthy();
    const retrieved = store.get(id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(trace.id);
  });

  it('get returns null for unknown id', () => {
    const store = new TraceStore(dbPath);
    expect(store.get('nonexistent')).toBeNull();
  });

  it('search by tool name', () => {
    const store = new TraceStore(dbPath);
    store.save(makeTrace([{ type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: 'search' }, duration_ms: 50 }]));
    store.save(makeTrace([{ type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: 'calculate' }, duration_ms: 50 }]));
    const results = store.search({ tool: 'search' });
    expect(results).toHaveLength(1);
  });

  it('search by tags', () => {
    const store = new TraceStore(dbPath);
    store.save(makeTrace([]), { tags: ['prod', 'fast'] });
    store.save(makeTrace([]), { tags: ['dev'] });
    const results = store.search({ tags: ['prod'] });
    expect(results).toHaveLength(1);
  });

  it('stats returns correct totals', () => {
    const store = new TraceStore(dbPath);
    store.save(makeTrace([]), { adapter: 'openai', cost: 0.05 });
    store.save(makeTrace([]), { adapter: 'openai', cost: 0.03 });
    store.save(makeTrace([]), { adapter: 'anthropic', cost: 0.10 });
    const stats = store.stats();
    expect(stats.total).toBe(3);
    expect(stats.byAdapter['openai']).toBe(2);
    expect(stats.byAdapter['anthropic']).toBe(1);
    expect(stats.totalCost).toBeCloseTo(0.18);
  });

  it('prune removes old entries', () => {
    const store = new TraceStore(dbPath);
    store.save(makeTrace([]));
    // Prune with future date removes all
    const deleted = store.prune(new Date(Date.now() + 60000));
    expect(deleted).toBe(1);
    expect(store.count()).toBe(0);
  });

  it('persists across instances', () => {
    const store1 = new TraceStore(dbPath);
    const trace = makeTrace([]);
    const id = store1.save(trace);

    const store2 = new TraceStore(dbPath);
    expect(store2.get(id)).not.toBeNull();
    expect(store2.count()).toBe(1);
  });

  it('clear removes all entries', () => {
    const store = new TraceStore(dbPath);
    store.save(makeTrace([]));
    store.save(makeTrace([]));
    store.clear();
    expect(store.count()).toBe(0);
  });
});

// ============================================================
// 3. Watch Mode (5 tests)
// ============================================================

describe('Watch Mode', () => {
  it('findAffectedSuites returns matching YAML suite', () => {
    const suites = ['/tests/a.yaml', '/tests/b.yaml'];
    const affected = findAffectedSuites('/tests/a.yaml', suites);
    expect(affected).toEqual(['/tests/a.yaml']);
  });

  it('findAffectedSuites returns all for .ts changes', () => {
    const suites = ['/tests/a.yaml', '/tests/b.yaml'];
    const affected = findAffectedSuites('/src/agent.ts', suites);
    expect(affected).toHaveLength(2);
  });

  it('findAffectedSuites returns empty for unrelated files', () => {
    const suites = ['/tests/a.yaml'];
    const affected = findAffectedSuites('/readme.md', suites);
    expect(affected).toHaveLength(0);
  });

  it('formatWatchEvent formats correctly', () => {
    const event = { type: 'change' as const, path: 'tests/a.yaml', timestamp: '2026-01-01T12:00:00Z' };
    const formatted = formatWatchEvent(event);
    expect(formatted).toContain('📝');
    expect(formatted).toContain('change');
    expect(formatted).toContain('tests/a.yaml');
  });

  it('formatWatchSession shows summary', () => {
    const session = { events: [], runs: 5, passed: 10, failed: 2, startedAt: '2026-01-01T12:00:00Z' };
    const formatted = formatWatchSession(session);
    expect(formatted).toContain('5');
    expect(formatted).toContain('10 passed');
    expect(formatted).toContain('2 failed');
  });
});

// ============================================================
// 4. Init Command (6 tests)
// ============================================================

describe('Init Command', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('generateConfig produces valid YAML for openai', () => {
    const config = generateConfig({ adapter: 'openai', createSampleTests: true, outputDir: dir });
    expect(config).toContain('adapter: openai');
    expect(config).toContain('gpt-4o');
  });

  it('generateConfig works for each adapter', () => {
    for (const adapter of ['anthropic', 'ollama', 'azure', 'gemini'] as const) {
      const config = generateConfig({ adapter, createSampleTests: false, outputDir: dir });
      expect(config).toContain(`adapter: ${adapter}`);
    }
  });

  it('generateSampleTests includes test cases', () => {
    const tests = generateSampleTests('openai');
    expect(tests).toContain('name:');
    expect(tests).toContain('input:');
    expect(tests).toContain('expect:');
  });

  it('generateProfiles includes dev/ci/production', () => {
    const profiles = generateProfiles('openai');
    expect(profiles).toContain('dev:');
    expect(profiles).toContain('ci:');
    expect(profiles).toContain('production:');
  });

  it('executeInit creates files on disk', () => {
    const result = executeInit({ adapter: 'openai', createSampleTests: true, outputDir: dir });
    expect(result.files.length).toBeGreaterThanOrEqual(3);
    for (const f of result.files) {
      expect(fs.existsSync(f)).toBe(true);
    }
  });

  it('formatInitResult includes next steps', () => {
    const result = { files: ['a.yml', 'b.yml'], adapter: 'openai' as const, projectName: 'test-proj' };
    const formatted = formatInitResult(result);
    expect(formatted).toContain('test-proj');
    expect(formatted).toContain('Next steps');
  });
});

// ============================================================
// 5. Doctor Command (7 tests)
// ============================================================

describe('Doctor Command', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('checkNodeVersion returns ok for current node', () => {
    const check = checkNodeVersion();
    expect(check.status).toBe('ok');
    expect(check.message).toContain(process.version);
  });

  it('checkTypeScript detects typescript', () => {
    const check = checkTypeScript();
    // In test environment, TypeScript should be available
    expect(['ok', 'warn']).toContain(check.status);
  });

  it('checkApiKey detects set env var', () => {
    const orig = process.env.TEST_API_KEY_R29;
    process.env.TEST_API_KEY_R29 = 'sk-test123';
    const check = checkApiKey('Test Key', 'TEST_API_KEY_R29', true);
    expect(check.status).toBe('ok');
    process.env.TEST_API_KEY_R29 = orig;
  });

  it('checkApiKey warns for missing optional key', () => {
    delete process.env.__NONEXISTENT_KEY_R29__;
    const check = checkApiKey('Missing', '__NONEXISTENT_KEY_R29__', false);
    expect(check.status).toBe('warn');
    expect(check.message).toContain('optional');
  });

  it('checkTestDirectory warns when no tests dir', () => {
    const check = checkTestDirectory(dir);
    expect(check.status).toBe('warn');
  });

  it('runDoctor returns overall status', () => {
    const result = runDoctor(dir);
    expect(['HEALTHY', 'DEGRADED', 'UNHEALTHY']).toContain(result.status);
    expect(result.checks.length).toBeGreaterThanOrEqual(4);
  });

  it('formatDoctor produces readable output', () => {
    const result = runDoctor(dir);
    const formatted = formatDoctor(result);
    expect(formatted).toContain('🏥 AgentProbe Doctor');
    expect(formatted).toContain('Overall:');
  });
});

// ============================================================
// 6. Integration / edge cases (3 tests)
// ============================================================

describe('Integration', () => {
  it('traceToOTLP uses updated version string', () => {
    const trace = makeTrace([{ type: 'llm_call', timestamp: new Date().toISOString(), data: {}, duration_ms: 100 }]);
    const otlp = traceToOTLP(trace);
    expect(otlp.resourceSpans[0].resource.attributes['service.version']).toBe('3.1.0');
  });

  it('TraceStore search by date range', () => {
    const dir = tmpDir();
    const dbPath = path.join(dir, 'traces.db.json');
    const store = new TraceStore(dbPath);
    const now = new Date();
    const trace = makeTrace([]);
    store.save(trace);
    const results = store.search({ dateRange: [new Date(now.getTime() - 60000), new Date(now.getTime() + 60000)] });
    expect(results).toHaveLength(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('OTelExporter exportSuiteResult with traces in results', () => {
    const exporter = new OTelExporter();
    const trace = makeTrace([
      { type: 'llm_call', timestamp: new Date().toISOString(), data: { model: 'gpt-4o' }, duration_ms: 200 },
    ]);
    const result: SuiteResult = {
      name: 'with-traces',
      passed: 1,
      failed: 0,
      total: 1,
      duration_ms: 500,
      results: [
        { name: 'traced-test', passed: true, assertions: [], duration_ms: 200, trace },
      ],
    };
    const spans = exporter.exportSuiteResult(result);
    // suite + test + root trace span + llm span = 4+
    expect(spans.length).toBeGreaterThanOrEqual(4);
  });
});
