import { describe, it, expect } from 'vitest';
import { report } from '../src/reporter';
import { evaluate } from '../src/assertions';
import { parseYamlWithValidation } from '../src/yaml-validator';
import { expandTemplate } from '../src/templates';
import { replayTrace } from '../src/replay';
import { makeTrace, toolCall, output, llmCall } from './helpers';
import type { SuiteResult, TestResult, ReportFormat } from '../src/types';

function makeSuiteResult(results: Partial<TestResult>[] = []): SuiteResult {
  const full: TestResult[] = results.map(r => ({
    name: r.name ?? 'test',
    passed: r.passed ?? true,
    assertions: r.assertions ?? [],
    duration_ms: r.duration_ms ?? 10,
    ...r,
  }));
  return {
    name: 'Test Suite',
    passed: full.filter(r => r.passed).length,
    failed: full.filter(r => !r.passed).length,
    total: full.length,
    duration_ms: full.reduce((s, r) => s + r.duration_ms, 0),
    results: full,
  };
}

describe('integration', () => {
  it('format report (console)', () => {
    const suite = makeSuiteResult([{ name: 'test1', passed: true }]);
    const output = report(suite, 'console');
    expect(output).toContain('test1');
  });

  it('format report (JSON)', () => {
    const suite = makeSuiteResult([{ name: 'test1', passed: true }]);
    const out = report(suite, 'json');
    const parsed = JSON.parse(out);
    expect(parsed.name).toBe('Test Suite');
  });

  it('format report (markdown)', () => {
    const suite = makeSuiteResult([{ name: 'test1', passed: true }]);
    const out = report(suite, 'markdown');
    expect(out).toContain('test1');
    expect(out).toContain('#');
  });

  it('format report (HTML)', () => {
    const suite = makeSuiteResult([{ name: 'test1', passed: true }]);
    const out = report(suite, 'html');
    expect(out).toContain('<');
    expect(out).toContain('test1');
  });

  it('format report (JUnit)', () => {
    const suite = makeSuiteResult([{ name: 'test1', passed: true }]);
    const out = report(suite, 'junit');
    expect(out).toContain('<?xml');
    expect(out).toContain('test1');
  });

  it('run assertions on trace', () => {
    const trace = makeTrace([toolCall('search'), output('hello world')]);
    const results = evaluate(trace, { tool_called: 'search', output_contains: 'hello' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('YAML parsing valid input', () => {
    const yaml = `
name: Test Suite
tests:
  - name: test1
    input: hello
    expect:
      output_contains: world
`;
    const result = parseYamlWithValidation(yaml);
    expect(result.parsed.name).toBe('Test Suite');
    expect(result.parsed.tests).toHaveLength(1);
  });

  it('YAML parsing invalid input throws', () => {
    expect(() => parseYamlWithValidation('not: valid: yaml: {{{')).toThrow();
  });

  it('template expand + assertion evaluation', () => {
    const expectations = expandTemplate('safety_basic');
    const trace = makeTrace([output('safe output')]);
    const results = evaluate(trace, expectations);
    expect(results.length).toBeGreaterThan(0);
  });

  it('replay + assertion evaluation', () => {
    const trace = makeTrace([toolCall('search'), output('hello world')]);
    const replayed = replayTrace({ trace, overrides: {} });
    const results = evaluate(replayed.trace, { output_contains: 'hello' });
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('mixed pass/fail suite result', () => {
    const suite = makeSuiteResult([
      { name: 'pass', passed: true },
      { name: 'fail', passed: false },
    ]);
    expect(suite.passed).toBe(1);
    expect(suite.failed).toBe(1);
  });

  it('empty suite result', () => {
    const suite = makeSuiteResult([]);
    expect(suite.total).toBe(0);
    const out = report(suite, 'json');
    expect(JSON.parse(out).total).toBe(0);
  });

  it('suite with tags', () => {
    const suite = makeSuiteResult([
      { name: 'tagged', passed: true, tags: ['smoke'] },
    ]);
    expect(suite.results[0].tags).toContain('smoke');
  });

  it('report all formats do not throw', () => {
    const suite = makeSuiteResult([{ name: 't', passed: true }]);
    const formats: ReportFormat[] = ['console', 'json', 'markdown', 'html', 'junit'];
    for (const fmt of formats) {
      expect(() => report(suite, fmt)).not.toThrow();
    }
  });

  it('full pipeline: evaluate → format JSON report', () => {
    const trace = makeTrace([toolCall('search'), output('found it')]);
    const assertions = evaluate(trace, { tool_called: 'search', output_contains: 'found' });
    const suite = makeSuiteResult([{
      name: 'pipeline test',
      passed: assertions.every(a => a.passed),
      assertions,
    }]);
    const json = report(suite, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.results[0].passed).toBe(true);
  });
});
