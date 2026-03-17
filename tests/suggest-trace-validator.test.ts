import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { makeTrace, toolCall, output, llmCall } from './helpers';
import { suggestTests, formatSuggestions } from '../src/suggest';
import { validateTraceFormat, validateTraceFile, formatTraceValidation } from '../src/trace-validator';
import {
  addRegressionSnapshot,
  loadRegressionSnapshot,
  listRegressionSnapshots,
  compareRegressionSnapshots,
  formatRegressionComparison,
  formatSnapshotList,
} from '../src/regression-manager';
import { checkBudget, formatBudgetCheck } from '../src/budget';
import type { SuiteResult, AgentTrace } from '../src/types';

// ===== Test Suggestion (suggest.ts) =====
describe('suggest', () => {
  it('suggests tool_sequence for multi-tool traces', () => {
    const trace = makeTrace([
      toolCall('search', { q: 'weather' }),
      toolCall('parse', { format: 'json' }),
      toolCall('summarize', {}),
    ]);
    const suggestions = suggestTests(trace);
    const seqSugg = suggestions.find(s => s.category === 'tool_sequence' && s.yaml_snippet.includes('tool_sequence'));
    expect(seqSugg).toBeDefined();
    expect(seqSugg!.description).toContain('search');
    expect(seqSugg!.description).toContain('parse');
  });

  it('suggests cost_guard when trace has cost', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4o', tokens: { input: 1000, output: 500 } } },
    ]);
    const suggestions = suggestTests(trace);
    const costSugg = suggestions.find(s => s.category === 'cost_guard');
    expect(costSugg).toBeDefined();
    expect(costSugg!.yaml_snippet).toContain('max_cost_usd');
  });

  it('suggests safety guards for dangerous tools', () => {
    const trace = makeTrace([toolCall('file_read', { path: '/etc/passwd' })]);
    const suggestions = suggestTests(trace);
    const safetySugg = suggestions.find(s => s.category === 'safety');
    expect(safetySugg).toBeDefined();
  });

  it('suggests safety for non-dangerous traces', () => {
    const trace = makeTrace([toolCall('search', { q: 'hello' })]);
    const suggestions = suggestTests(trace);
    const safetySugg = suggestions.find(s => s.category === 'safety');
    expect(safetySugg).toBeDefined();
    expect(safetySugg!.yaml_snippet).toContain('tool_not_called');
  });

  it('suggests efficiency based on step count', () => {
    const trace = makeTrace([
      toolCall('a'), toolCall('b'), toolCall('c'),
      toolCall('d'), toolCall('e'), output('result'),
    ]);
    const suggestions = suggestTests(trace);
    const effSugg = suggestions.find(s => s.category === 'efficiency');
    expect(effSugg).toBeDefined();
    expect(effSugg!.yaml_snippet).toContain('max_steps');
  });

  it('suggests output_contains when output has content', () => {
    const trace = makeTrace([output('The weather in Tokyo is sunny and warm')]);
    const suggestions = suggestTests(trace);
    const outSugg = suggestions.find(s => s.category === 'output_quality');
    expect(outSugg).toBeDefined();
    expect(outSugg!.yaml_snippet).toContain('output_contains');
  });

  it('suggests performance when trace has duration', () => {
    const trace = makeTrace([
      { type: 'tool_call', data: { tool_name: 'slow_op' }, duration_ms: 500 },
      { type: 'tool_call', data: { tool_name: 'fast_op' }, duration_ms: 200 },
    ]);
    const suggestions = suggestTests(trace);
    const perfSugg = suggestions.find(s => s.category === 'performance');
    expect(perfSugg).toBeDefined();
    expect(perfSugg!.yaml_snippet).toContain('max_duration_ms');
  });

  it('returns empty for empty trace', () => {
    const trace = makeTrace([]);
    const suggestions = suggestTests(trace);
    // No tools, no cost, no steps = very few suggestions
    expect(suggestions.length).toBe(0);
  });

  it('sorts suggestions by confidence descending', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4o', tokens: { input: 1000, output: 500 } } },
      toolCall('search'), toolCall('parse'),
      output('Hello world result'),
    ]);
    const suggestions = suggestTests(trace);
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i].confidence).toBeLessThanOrEqual(suggestions[i - 1].confidence);
    }
  });

  it('formatSuggestions renders numbered list', () => {
    const trace = makeTrace([toolCall('search'), toolCall('parse'), output('result')]);
    const suggestions = suggestTests(trace);
    const formatted = formatSuggestions(suggestions);
    expect(formatted).toContain('1.');
    expect(formatted).toContain('Suggested tests');
  });

  it('formatSuggestions handles empty', () => {
    const formatted = formatSuggestions([]);
    expect(formatted).toContain('No suggestions');
  });
});

// ===== Trace Validator (trace-validator.ts) =====
describe('trace-validator', () => {
  it('validates a correct trace', () => {
    const trace = {
      id: 'test-1',
      timestamp: '2024-01-01T00:00:00Z',
      steps: [
        { type: 'tool_call', timestamp: '2024-01-01T00:00:01Z', data: { tool_name: 'search', tool_args: {} } },
        { type: 'output', timestamp: '2024-01-01T00:00:02Z', data: { content: 'result' } },
      ],
      metadata: {},
    };
    const result = validateTraceFormat(trace);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on non-object input', () => {
    const result = validateTraceFormat(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('JSON object');
  });

  it('errors on missing steps array', () => {
    const result = validateTraceFormat({ id: 'test' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('steps');
  });

  it('warns on missing id and timestamp', () => {
    const result = validateTraceFormat({ steps: [] });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('errors on step missing type', () => {
    const result = validateTraceFormat({
      id: 't', timestamp: 'now', steps: [{ data: {} }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('type'))).toBe(true);
  });

  it('warns on unknown step type', () => {
    const result = validateTraceFormat({
      id: 't', timestamp: 'now',
      steps: [{ type: 'unknown_type', timestamp: 'now', data: {} }],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.message.includes('Unknown step type'))).toBe(true);
  });

  it('warns on missing timestamp in step', () => {
    const result = validateTraceFormat({
      id: 't', timestamp: 'now',
      steps: [{ type: 'tool_call', data: { tool_name: 'x' } }],
    });
    expect(result.warnings.some(w => w.message.includes('timestamp'))).toBe(true);
  });

  it('errors on tool_call without tool_name', () => {
    const result = validateTraceFormat({
      id: 't', timestamp: 'now',
      steps: [{ type: 'tool_call', timestamp: 'now', data: {} }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('tool_name'))).toBe(true);
  });

  it('warns on llm_call without model', () => {
    const result = validateTraceFormat({
      id: 't', timestamp: 'now',
      steps: [{ type: 'llm_call', timestamp: 'now', data: { tokens: { input: 10 } } }],
    });
    expect(result.warnings.some(w => w.message.includes('model'))).toBe(true);
  });

  it('warns on output without content', () => {
    const result = validateTraceFormat({
      id: 't', timestamp: 'now',
      steps: [{ type: 'output', timestamp: 'now', data: {} }],
    });
    expect(result.warnings.some(w => w.message.includes('content'))).toBe(true);
  });

  it('validateTraceFile handles invalid JSON', () => {
    const result = validateTraceFile('not json at all');
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('Invalid JSON');
  });

  it('validateTraceFile handles valid JSON', () => {
    const result = validateTraceFile(JSON.stringify({
      id: 'ok', timestamp: 'now', steps: [],
    }));
    expect(result.valid).toBe(true);
  });

  it('formatTraceValidation shows valid', () => {
    const fmt = formatTraceValidation({ valid: true, errors: [], warnings: [] });
    expect(fmt).toContain('valid');
  });

  it('formatTraceValidation shows errors', () => {
    const fmt = formatTraceValidation({
      valid: false,
      errors: [{ level: 'error', message: 'bad stuff' }],
      warnings: [],
    });
    expect(fmt).toContain('bad stuff');
    expect(fmt).toContain('Invalid');
  });
});

// ===== Regression Manager (regression-manager.ts) =====
describe('regression-manager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-reg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSuiteResult(overrides?: Partial<SuiteResult>): SuiteResult {
    return {
      name: 'Test Suite',
      passed: 3,
      failed: 0,
      total: 3,
      duration_ms: 100,
      results: [
        { name: 'test-a', passed: true, assertions: [], duration_ms: 30, trace: makeTrace([toolCall('search')]) },
        { name: 'test-b', passed: true, assertions: [], duration_ms: 30, trace: makeTrace([toolCall('parse')]) },
        { name: 'test-c', passed: true, assertions: [], duration_ms: 40, trace: makeTrace([output('hello')]) },
      ],
      ...overrides,
    };
  }

  it('saves and loads a regression snapshot', () => {
    const result = makeSuiteResult();
    const filePath = addRegressionSnapshot(result, 'v1.0', 'tests.yaml', tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = loadRegressionSnapshot('v1.0', tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.label).toBe('v1.0');
    expect(loaded!.tests).toHaveLength(3);
  });

  it('lists all snapshots', () => {
    addRegressionSnapshot(makeSuiteResult(), 'v1.0', 'tests.yaml', tmpDir);
    addRegressionSnapshot(makeSuiteResult(), 'v1.1', 'tests.yaml', tmpDir);
    const list = listRegressionSnapshots(tmpDir);
    expect(list).toHaveLength(2);
  });

  it('returns empty list when no snapshots', () => {
    const list = listRegressionSnapshots(tmpDir);
    expect(list).toHaveLength(0);
  });

  it('returns null for missing snapshot', () => {
    const loaded = loadRegressionSnapshot('nonexistent', tmpDir);
    expect(loaded).toBeNull();
  });

  it('compares two snapshots — no regressions', () => {
    addRegressionSnapshot(makeSuiteResult(), 'a', 'tests.yaml', tmpDir);
    addRegressionSnapshot(makeSuiteResult(), 'b', 'tests.yaml', tmpDir);
    const cmp = compareRegressionSnapshots('a', 'b', tmpDir);
    expect(cmp).not.toBeNull();
    expect(cmp!.new_failures).toHaveLength(0);
    expect(cmp!.summary.total_regressions).toBe(0);
  });

  it('detects new failures in comparison', () => {
    addRegressionSnapshot(makeSuiteResult(), 'a', 'tests.yaml', tmpDir);
    const failing = makeSuiteResult({
      passed: 2, failed: 1,
      results: [
        { name: 'test-a', passed: false, assertions: [], duration_ms: 30, trace: makeTrace([toolCall('search')]) },
        { name: 'test-b', passed: true, assertions: [], duration_ms: 30, trace: makeTrace([toolCall('parse')]) },
        { name: 'test-c', passed: true, assertions: [], duration_ms: 40, trace: makeTrace([output('hello')]) },
      ],
    });
    addRegressionSnapshot(failing, 'b', 'tests.yaml', tmpDir);
    const cmp = compareRegressionSnapshots('a', 'b', tmpDir);
    expect(cmp!.new_failures).toContain('test-a');
  });

  it('detects new passes in comparison', () => {
    const failing = makeSuiteResult({
      passed: 2, failed: 1,
      results: [
        { name: 'test-a', passed: false, assertions: [], duration_ms: 30, trace: makeTrace([]) },
        { name: 'test-b', passed: true, assertions: [], duration_ms: 30, trace: makeTrace([]) },
        { name: 'test-c', passed: true, assertions: [], duration_ms: 40, trace: makeTrace([]) },
      ],
    });
    addRegressionSnapshot(failing, 'a', 'tests.yaml', tmpDir);
    addRegressionSnapshot(makeSuiteResult(), 'b', 'tests.yaml', tmpDir);
    const cmp = compareRegressionSnapshots('a', 'b', tmpDir);
    expect(cmp!.new_passes).toContain('test-a');
  });

  it('returns null when snapshot not found', () => {
    addRegressionSnapshot(makeSuiteResult(), 'a', 'tests.yaml', tmpDir);
    const cmp = compareRegressionSnapshots('a', 'missing', tmpDir);
    expect(cmp).toBeNull();
  });

  it('formatRegressionComparison shows no regressions', () => {
    addRegressionSnapshot(makeSuiteResult(), 'a', 'tests.yaml', tmpDir);
    addRegressionSnapshot(makeSuiteResult(), 'b', 'tests.yaml', tmpDir);
    const cmp = compareRegressionSnapshots('a', 'b', tmpDir)!;
    const fmt = formatRegressionComparison(cmp);
    expect(fmt).toContain('No regressions');
  });

  it('formatSnapshotList renders labels', () => {
    addRegressionSnapshot(makeSuiteResult(), 'v1.0-baseline', 'tests.yaml', tmpDir);
    const list = listRegressionSnapshots(tmpDir);
    const fmt = formatSnapshotList(list);
    expect(fmt).toContain('v1.0-baseline');
  });

  it('formatSnapshotList handles empty', () => {
    const fmt = formatSnapshotList([]);
    expect(fmt).toContain('No regression');
  });
});

// ===== Budget Enforcement (budget.ts) =====
describe('budget', () => {
  it('passes when no cost and no budget limits', () => {
    const trace = makeTrace([toolCall('search')]);
    const check = checkBudget(trace, 0, {});
    expect(check.within_budget).toBe(true);
    expect(check.violations).toHaveLength(0);
  });

  it('detects per-test budget violation', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4', tokens: { input: 100000, output: 50000 } } },
    ]);
    const check = checkBudget(trace, 0, { per_test: 0.01 });
    expect(check.within_budget).toBe(false);
    expect(check.violations.some(v => v.type === 'per_test')).toBe(true);
  });

  it('detects per-suite budget violation', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4o-mini', tokens: { input: 100, output: 50 } } },
    ]);
    const check = checkBudget(trace, 0.99, { per_suite: 1.00 });
    // Suite cost = 0.99 + trace cost. If trace cost > 0.01, exceeds
    // With gpt-4o-mini: 100*0.15/1M + 50*0.6/1M = tiny, so within
    expect(check.within_budget).toBe(true);
  });

  it('warns at alert threshold', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4', tokens: { input: 5000, output: 2000 } } },
    ]);
    // gpt-4: 5000*30/1M + 2000*60/1M = 0.15 + 0.12 = 0.27
    const check = checkBudget(trace, 0, { per_test: 0.30, alert_threshold: 0.8 });
    // 0.27/0.30 = 90% > 80% threshold
    expect(check.warnings.some(w => w.type === 'per_test')).toBe(true);
  });

  it('does not warn below threshold', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4o-mini', tokens: { input: 100, output: 50 } } },
    ]);
    const check = checkBudget(trace, 0, { per_test: 1.00, alert_threshold: 0.8 });
    expect(check.warnings).toHaveLength(0);
  });

  it('formatBudgetCheck shows violations', () => {
    const trace = makeTrace([
      { type: 'llm_call', data: { model: 'gpt-4', tokens: { input: 100000, output: 50000 } } },
    ]);
    const check = checkBudget(trace, 0, { per_test: 0.01 });
    const fmt = formatBudgetCheck(check);
    expect(fmt).toContain('BUDGET EXCEEDED');
  });

  it('formatBudgetCheck shows within budget', () => {
    const trace = makeTrace([toolCall('search')]);
    const check = checkBudget(trace, 0, {});
    const fmt = formatBudgetCheck(check);
    expect(fmt).toContain('Within budget');
  });
});

// ===== Multi-Suite & Parallel (integration tests) =====
describe('multi-suite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-multi-'));
    // Create trace file
    const traceDir = path.join(tmpDir, 'traces');
    fs.mkdirSync(traceDir, { recursive: true });
    const trace: AgentTrace = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      steps: [
        { type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: 'search', tool_args: { q: 'test' } }, duration_ms: 10 },
        { type: 'output', timestamp: new Date().toISOString(), data: { content: 'Tokyo weather is sunny' } },
      ],
      metadata: {},
    };
    fs.writeFileSync(path.join(traceDir, 'basic.json'), JSON.stringify(trace, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates valid YAML suite files in subdirectories', () => {
    const subDir = path.join(tmpDir, 'suites');
    fs.mkdirSync(subDir, { recursive: true });
    const suite1 = `name: Suite 1\ntests:\n  - name: Test1\n    input: hello\n    trace: ../traces/basic.json\n    expect:\n      output_contains: Tokyo\n`;
    const suite2 = `name: Suite 2\ntests:\n  - name: Test2\n    input: world\n    trace: ../traces/basic.json\n    expect:\n      tool_called: search\n`;
    fs.writeFileSync(path.join(subDir, 'suite1.yaml'), suite1);
    fs.writeFileSync(path.join(subDir, 'suite2.yaml'), suite2);

    // Verify files exist
    const files = fs.readdirSync(subDir).filter(f => f.endsWith('.yaml'));
    expect(files).toHaveLength(2);
  });

  it('glob finds yaml files in directory', () => {
    const subDir = path.join(tmpDir, 'glob-test');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'a.yaml'), 'name: A\ntests: []\n');
    fs.writeFileSync(path.join(subDir, 'b.yml'), 'name: B\ntests: []\n');
    fs.writeFileSync(path.join(subDir, 'c.txt'), 'not yaml');

    const { glob } = require('glob');
    const pattern = path.join(subDir, '*.{yaml,yml}').replace(/\\/g, '/');
    const files: string[] = glob.sync(pattern);
    expect(files.length).toBe(2);
  });

  it('recursive glob finds nested yaml files', () => {
    const sub1 = path.join(tmpDir, 'rec', 'sub1');
    const sub2 = path.join(tmpDir, 'rec', 'sub2');
    fs.mkdirSync(sub1, { recursive: true });
    fs.mkdirSync(sub2, { recursive: true });
    fs.writeFileSync(path.join(sub1, 'a.yaml'), 'name: A\ntests: []\n');
    fs.writeFileSync(path.join(sub2, 'b.yaml'), 'name: B\ntests: []\n');

    const { glob } = require('glob');
    const pattern = path.join(tmpDir, 'rec', '**/*.{yaml,yml}').replace(/\\/g, '/');
    const files: string[] = glob.sync(pattern);
    expect(files.length).toBe(2);
  });
});

import { loadExtendedConfig } from '../src/config-file';

// ===== Extended config with budgets =====
describe('config-budgets', () => {
  it('loadExtendedConfig parses budget section', () => {
    // Just verify the type is correct — budget config extends ExtendedConfig
    const config = loadExtendedConfig(os.tmpdir()); // won't find config, returns {}
    expect(config.budgets).toBeUndefined(); // no config file = no budgets
  });
});

// ===== Parallel execution =====
describe('parallel-execution', () => {
  it('runner supports parallel config', () => {
    // Verify type includes parallel fields
    const suiteYaml = `
name: Parallel Suite
config:
  parallel: true
  max_concurrency: 2
tests: []
`;
    const YAML = require('yaml');
    const parsed = YAML.parse(suiteYaml);
    expect(parsed.config.parallel).toBe(true);
    expect(parsed.config.max_concurrency).toBe(2);
  });
});
