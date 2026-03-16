import { describe, it, expect } from 'vitest';
import { loadExtendedConfig, findExtendedConfigFile, getDefaultAdapter, getAdapterConfig, resolveOutputDir, loadEnvFromConfig } from '../src/config-file';
import { diffRuns, formatRunDiff } from '../src/reporters/diff';
import { searchPlugins, installPlugin, formatMarketplace } from '../src/marketplace';
import { exportTrace, listExportFormats } from '../src/export';
import { generateDependencyGraph, formatDependencyGraph } from '../src/deps';
import type { DepTestCase } from '../src/deps';
import type { AgentTrace, SuiteResult, TestResult } from '../src/types';
import type { ExtendedConfig } from '../src/config-file';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Helper: minimal trace
function makeTrace(overrides?: Partial<AgentTrace>): AgentTrace {
  return {
    id: 'test-trace-1',
    timestamp: '2024-01-01T00:00:00Z',
    steps: [
      { type: 'llm_call', data: { model: 'gpt-4', tokens: { input: 100, output: 50 } }, duration_ms: 500 },
      { type: 'tool_call', data: { tool_name: 'search', tool_args: { q: 'test' } }, duration_ms: 200 },
      { type: 'tool_result', data: { content: 'result data' }, duration_ms: 10 },
      { type: 'output', data: { content: 'Final answer about test' }, duration_ms: 0 },
    ],
    metadata: {},
    ...overrides,
  } as AgentTrace;
}

// Helper: suite result
function makeSuiteResult(overrides: Partial<SuiteResult> & { results: TestResult[] }): SuiteResult {
  return {
    name: 'test-suite',
    total: overrides.results.length,
    passed: overrides.results.filter(r => r.passed).length,
    failed: overrides.results.filter(r => !r.passed).length,
    skipped: 0,
    duration_ms: 1000,
    ...overrides,
  } as SuiteResult;
}

function makeTestResult(name: string, passed: boolean): TestResult {
  return { name, passed, assertions: [], duration_ms: 100 } as TestResult;
}

// ==========================================
// 1. Config File Support
// ==========================================
describe('config-file', () => {
  it('loads YAML config from temp dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-cfg-'));
    fs.writeFileSync(path.join(dir, '.agentproberc.yml'), `
adapters:
  default: openai
  openai:
    model: gpt-4
parallel: 4
timeout_ms: 30000
reporter: html
output_dir: ./reports
env_file: .env.test
`);
    const cfg = loadExtendedConfig(dir);
    expect(cfg.adapters?.default).toBe('openai');
    expect(cfg.parallel).toBe(4);
    expect(cfg.timeout_ms).toBe(30000);
    expect(cfg.reporter).toBe('html');
    expect(cfg.output_dir).toBe('./reports');
    expect(cfg.env_file).toBe('.env.test');
    fs.rmSync(dir, { recursive: true });
  });

  it('returns empty config when no file found', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-cfg-empty-'));
    const cfg = loadExtendedConfig(dir);
    expect(cfg).toEqual({});
    fs.rmSync(dir, { recursive: true });
  });

  it('findExtendedConfigFile searches up', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-cfg-up-'));
    const sub = path.join(dir, 'sub', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(dir, '.agentproberc.yml'), 'parallel: 2');
    const found = findExtendedConfigFile(sub);
    expect(found).toBe(path.join(dir, '.agentproberc.yml'));
    fs.rmSync(dir, { recursive: true });
  });

  it('getDefaultAdapter extracts adapter name', () => {
    const cfg: ExtendedConfig = { adapters: { default: 'anthropic' } };
    expect(getDefaultAdapter(cfg)).toBe('anthropic');
  });

  it('getDefaultAdapter returns undefined when no adapters', () => {
    expect(getDefaultAdapter({})).toBeUndefined();
  });

  it('getAdapterConfig returns adapter settings', () => {
    const cfg: ExtendedConfig = { adapters: { default: 'openai', openai: { model: 'gpt-4' } } };
    expect(getAdapterConfig(cfg, 'openai')).toEqual({ model: 'gpt-4' });
  });

  it('getAdapterConfig returns undefined for string values', () => {
    const cfg: ExtendedConfig = { adapters: { default: 'openai' } };
    expect(getAdapterConfig(cfg, 'default')).toBeUndefined();
  });

  it('resolveOutputDir uses config value', () => {
    const cfg: ExtendedConfig = { output_dir: './custom-reports' };
    const dir = resolveOutputDir(cfg, '/base');
    expect(dir).toContain('custom-reports');
  });

  it('resolveOutputDir defaults to ./reports', () => {
    const dir = resolveOutputDir({}, '/base');
    expect(dir).toContain('reports');
  });

  it('loadEnvFromConfig loads env vars', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-env-'));
    fs.writeFileSync(path.join(dir, '.env.test'), 'AP_TEST_VAR_XYZ=hello\nAP_TEST_QUOTED="world"');
    const cfg: ExtendedConfig = { env_file: '.env.test' };
    delete process.env.AP_TEST_VAR_XYZ;
    delete process.env.AP_TEST_QUOTED;
    loadEnvFromConfig(cfg, dir);
    expect(process.env.AP_TEST_VAR_XYZ).toBe('hello');
    expect(process.env.AP_TEST_QUOTED).toBe('world');
    delete process.env.AP_TEST_VAR_XYZ;
    delete process.env.AP_TEST_QUOTED;
    fs.rmSync(dir, { recursive: true });
  });

  it('loadEnvFromConfig ignores comments and blank lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-env2-'));
    fs.writeFileSync(path.join(dir, '.env'), '# comment\n\nAP_TEST_KEY99=val');
    const cfg: ExtendedConfig = { env_file: '.env' };
    delete process.env.AP_TEST_KEY99;
    loadEnvFromConfig(cfg, dir);
    expect(process.env.AP_TEST_KEY99).toBe('val');
    delete process.env.AP_TEST_KEY99;
    fs.rmSync(dir, { recursive: true });
  });

  it('loadEnvFromConfig does nothing when no env_file', () => {
    loadEnvFromConfig({});
    // No throw
  });

  it('supports agentprobe.config.yml name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-cfgname-'));
    fs.writeFileSync(path.join(dir, 'agentprobe.config.yml'), 'parallel: 8');
    const cfg = loadExtendedConfig(dir);
    expect(cfg.parallel).toBe(8);
    fs.rmSync(dir, { recursive: true });
  });
});

// ==========================================
// 2. Diff Reporter
// ==========================================
describe('reporters/diff', () => {
  it('detects regressions', () => {
    const old = makeSuiteResult({ results: [makeTestResult('A', true), makeTestResult('B', true)] });
    const newer = makeSuiteResult({ results: [makeTestResult('A', true), makeTestResult('B', false)] });
    const d = diffRuns(old, newer);
    expect(d.regressions).toEqual(['B']);
    expect(d.improvements).toEqual([]);
  });

  it('detects improvements', () => {
    const old = makeSuiteResult({ results: [makeTestResult('A', false)] });
    const newer = makeSuiteResult({ results: [makeTestResult('A', true)] });
    const d = diffRuns(old, newer);
    expect(d.improvements).toEqual(['A']);
    expect(d.regressions).toEqual([]);
  });

  it('detects new passes', () => {
    const old = makeSuiteResult({ results: [] });
    const newer = makeSuiteResult({ results: [makeTestResult('X', true)] });
    const d = diffRuns(old, newer);
    expect(d.newPasses).toEqual(['X']);
  });

  it('detects new failures', () => {
    const old = makeSuiteResult({ results: [] });
    const newer = makeSuiteResult({ results: [makeTestResult('X', false)] });
    const d = diffRuns(old, newer);
    expect(d.newFailures).toEqual(['X']);
  });

  it('tracks unchanged tests', () => {
    const old = makeSuiteResult({ results: [makeTestResult('A', true)] });
    const newer = makeSuiteResult({ results: [makeTestResult('A', true)] });
    const d = diffRuns(old, newer);
    expect(d.unchanged).toEqual(['A']);
  });

  it('formatRunDiff contains regression info', () => {
    const old = makeSuiteResult({ results: [makeTestResult('A', true)] });
    const newer = makeSuiteResult({ results: [makeTestResult('A', false)] });
    const d = diffRuns(old, newer);
    const output = formatRunDiff(d);
    expect(output).toContain('Regressions');
    expect(output).toContain('A');
  });

  it('formatRunDiff shows no regressions message', () => {
    const old = makeSuiteResult({ results: [makeTestResult('A', true)] });
    const newer = makeSuiteResult({ results: [makeTestResult('A', true)] });
    const d = diffRuns(old, newer);
    const output = formatRunDiff(d);
    expect(output).toContain('No regressions');
  });

  it('summary counts are correct', () => {
    const old = makeSuiteResult({ results: [makeTestResult('A', true), makeTestResult('B', false)] });
    const newer = makeSuiteResult({ results: [makeTestResult('A', false), makeTestResult('B', true), makeTestResult('C', true)] });
    const d = diffRuns(old, newer);
    expect(d.summary.oldTotal).toBe(2);
    expect(d.summary.newTotal).toBe(3);
    expect(d.summary.oldPassed).toBe(1);
    expect(d.summary.newPassed).toBe(2);
  });
});

// ==========================================
// 3. Plugin Marketplace
// ==========================================
describe('marketplace', () => {
  it('searchPlugins returns empty when npm fails', () => {
    const result = searchPlugins('nonexistent-xyz-12345');
    expect(result.plugins).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('formatMarketplace shows message for empty results', () => {
    const output = formatMarketplace({ plugins: [], total: 0 });
    expect(output).toContain('No plugins found');
  });

  it('formatMarketplace formats plugin list', () => {
    const output = formatMarketplace({
      plugins: [{ name: 'agentprobe-plugin-test', description: 'Test plugin', version: '1.0.0' }],
      total: 1,
    });
    expect(output).toContain('agentprobe-plugin-test');
    expect(output).toContain('1.0.0');
    expect(output).toContain('1 plugin(s)');
  });
});

// ==========================================
// 4. Trace Export
// ==========================================
describe('export', () => {
  it('exports to OpenTelemetry format', () => {
    const trace = makeTrace();
    const output = exportTrace(trace, { format: 'opentelemetry' });
    const parsed = JSON.parse(output);
    expect(parsed.resourceSpans).toBeDefined();
    expect(parsed.resourceSpans[0].scopeSpans[0].spans.length).toBe(4);
  });

  it('exports to LangSmith format', () => {
    const trace = makeTrace();
    const output = exportTrace(trace, { format: 'langsmith' });
    const parsed = JSON.parse(output);
    expect(parsed.runs).toBeDefined();
    expect(parsed.runs.length).toBe(4);
    expect(parsed.runs[0].run_type).toBe('llm');
    expect(parsed.runs[1].run_type).toBe('tool');
  });

  it('exports to CSV format', () => {
    const trace = makeTrace();
    const output = exportTrace(trace, { format: 'csv' });
    const lines = output.split('\n');
    expect(lines[0]).toContain('step_index');
    expect(lines[0]).toContain('type');
    expect(lines.length).toBe(5); // header + 4 steps
  });

  it('throws for unknown format', () => {
    const trace = makeTrace();
    expect(() => exportTrace(trace, { format: 'unknown' as any })).toThrow('Unknown export format');
  });

  it('listExportFormats returns all formats', () => {
    const formats = listExportFormats();
    expect(formats).toContain('opentelemetry');
    expect(formats).toContain('langsmith');
    expect(formats).toContain('csv');
  });

  it('OpenTelemetry includes service name', () => {
    const trace = makeTrace();
    const output = exportTrace(trace, { format: 'opentelemetry', serviceName: 'my-agent' });
    expect(output).toContain('my-agent');
  });

  it('CSV escapes commas in content', () => {
    const trace = makeTrace({
      steps: [{ type: 'output', data: { content: 'hello, world' }, duration_ms: 0 }],
    } as any);
    const output = exportTrace(trace, { format: 'csv' });
    expect(output).toContain('"hello, world"');
  });

  it('LangSmith includes trace_id', () => {
    const trace = makeTrace({ id: 'my-trace-id' });
    const output = exportTrace(trace, { format: 'langsmith' });
    expect(output).toContain('my-trace-id');
  });
});

// ==========================================
// 5. Dependency Graph
// ==========================================
describe('dependency graph', () => {
  it('generates Mermaid diagram', () => {
    const tests: DepTestCase[] = [
      { name: 'Login', id: 'login', input: '', expect: {} },
      { name: 'Search', id: 'search', depends_on: 'login', input: '', expect: {} },
    ];
    const mermaid = generateDependencyGraph(tests);
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('login');
    expect(mermaid).toContain('search');
    expect(mermaid).toContain('-->');
  });

  it('handles tests with no dependencies', () => {
    const tests: DepTestCase[] = [
      { name: 'Standalone', id: 'solo', input: '', expect: {} },
    ];
    const mermaid = generateDependencyGraph(tests);
    expect(mermaid).toContain('solo');
    expect(mermaid).not.toContain('-->');
  });

  it('handles multiple dependencies', () => {
    const tests: DepTestCase[] = [
      { name: 'A', id: 'a', input: '', expect: {} },
      { name: 'B', id: 'b', input: '', expect: {} },
      { name: 'C', id: 'c', depends_on: ['a', 'b'], input: '', expect: {} },
    ];
    const mermaid = generateDependencyGraph(tests);
    expect(mermaid).toContain('a --> c');
    expect(mermaid).toContain('b --> c');
  });

  it('sanitizes special characters in IDs', () => {
    const tests: DepTestCase[] = [
      { name: 'Test with spaces!', id: 'test-with-spaces', input: '', expect: {} },
    ];
    const mermaid = generateDependencyGraph(tests);
    expect(mermaid).toContain('test_with_spaces');
  });

  it('formatDependencyGraph shows groups', () => {
    const tests: DepTestCase[] = [
      { name: 'A', id: 'a', input: '', expect: {} },
      { name: 'B', id: 'b', depends_on: 'a', input: '', expect: {} },
    ];
    const output = formatDependencyGraph(tests);
    expect(output).toContain('Group 1');
    expect(output).toContain('Group 2');
    expect(output).toContain('mermaid');
  });

  it('formatDependencyGraph shows dependency info', () => {
    const tests: DepTestCase[] = [
      { name: 'Login', id: 'login', input: '', expect: {} },
      { name: 'Dashboard', id: 'dashboard', depends_on: 'login', input: '', expect: {} },
    ];
    const output = formatDependencyGraph(tests);
    expect(output).toContain('depends on: login');
  });
});
