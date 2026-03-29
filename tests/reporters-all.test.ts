import { describe, it, expect } from 'vitest';
import { reportJUnit } from '../src/reporters/junit';
import { reportJSON } from '../src/reporters/json';
import { reportMarkdownDetailed } from '../src/reporters/markdown';
import { reportHTML } from '../src/reporters/html';
import { reportGitHub, formatAnnotation, generateStepSummary, parseAnnotations } from '../src/reporters/github';
import { diffRuns, formatRunDiff } from '../src/reporters/diff';
import type { SuiteResult, TestResult } from '../src/types';

function makeSuiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'Test Suite',
    passed: 2,
    failed: 1,
    total: 3,
    duration_ms: 1500,
    results: [
      {
        name: 'test-pass-1',
        passed: true,
        assertions: [{ name: 'tool_called: search', passed: true }],
        duration_ms: 500,
        tags: ['smoke'],
      },
      {
        name: 'test-pass-2',
        passed: true,
        assertions: [{ name: 'output_contains: hello', passed: true }],
        duration_ms: 300,
      },
      {
        name: 'test-fail-1',
        passed: false,
        assertions: [
          { name: 'tool_called: exec', passed: false, expected: 'exec', actual: ['search'], message: 'Tool "exec" was not called' },
        ],
        duration_ms: 700,
        error: 'Agent did not complete task',
      },
    ],
    ...overrides,
  };
}

// ===== JUnit Reporter =====

describe('JUnit Reporter', () => {
  it('generates valid XML', () => {
    const xml = reportJUnit(makeSuiteResult());
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('</testsuites>');
  });

  it('includes test count and failures', () => {
    const xml = reportJUnit(makeSuiteResult());
    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
  });

  it('marks failed tests with failure element', () => {
    const xml = reportJUnit(makeSuiteResult());
    expect(xml).toContain('<failure');
    expect(xml).toContain('exec');
  });

  it('marks passing tests as self-closing', () => {
    const xml = reportJUnit(makeSuiteResult());
    expect(xml).toMatch(/testcase.*test-pass-1.*\/>/);
  });

  it('handles skipped tests', () => {
    const suite = makeSuiteResult({
      results: [
        { name: 'skipped-test', passed: true, assertions: [], duration_ms: 0, skipped: true, skipReason: 'not applicable' },
      ],
    });
    const xml = reportJUnit(suite);
    expect(xml).toContain('<skipped');
    expect(xml).toContain('not applicable');
  });

  it('escapes XML special characters', () => {
    const suite = makeSuiteResult({
      name: 'Suite <with> "special" &chars',
      results: [{
        name: 'test <special>',
        passed: false,
        assertions: [{ name: 'check', passed: false, message: 'expected <foo> & "bar"' }],
        duration_ms: 100,
      }],
    });
    const xml = reportJUnit(suite);
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).not.toMatch(/<with>/);
  });

  it('handles empty suite', () => {
    const suite = makeSuiteResult({ total: 0, passed: 0, failed: 0, results: [] });
    const xml = reportJUnit(suite);
    expect(xml).toContain('tests="0"');
    expect(xml).toContain('failures="0"');
  });
});

// ===== JSON Reporter =====

describe('JSON Reporter', () => {
  it('produces valid JSON', () => {
    const json = reportJSON(makeSuiteResult());
    const parsed = JSON.parse(json);
    expect(parsed).toBeDefined();
    expect(parsed.version).toBeDefined();
  });

  it('includes suite summary', () => {
    const parsed = JSON.parse(reportJSON(makeSuiteResult()));
    expect(parsed.suite.total).toBe(3);
    expect(parsed.suite.passed).toBe(2);
    expect(parsed.suite.failed).toBe(1);
    expect(parsed.suite.passRate).toBe(67);
  });

  it('includes test entries', () => {
    const parsed = JSON.parse(reportJSON(makeSuiteResult()));
    expect(parsed.tests).toHaveLength(3);
    expect(parsed.tests[0].name).toBe('test-pass-1');
    expect(parsed.tests[0].passed).toBe(true);
  });

  it('includes assertion details', () => {
    const parsed = JSON.parse(reportJSON(makeSuiteResult()));
    const failedTest = parsed.tests.find((t: any) => !t.passed);
    expect(failedTest.assertions[0].passed).toBe(false);
    expect(failedTest.assertions[0].message).toContain('exec');
  });

  it('includes summary with slowest test', () => {
    const parsed = JSON.parse(reportJSON(makeSuiteResult()));
    expect(parsed.summary.slowest.name).toBe('test-fail-1');
    expect(parsed.summary.slowest.duration_ms).toBe(700);
  });

  it('handles empty suite', () => {
    const parsed = JSON.parse(reportJSON(makeSuiteResult({ total: 0, passed: 0, failed: 0, results: [] })));
    expect(parsed.suite.passRate).toBe(0);
    expect(parsed.tests).toHaveLength(0);
  });
});

// ===== Markdown Reporter =====

describe('Markdown Reporter', () => {
  it('generates markdown with header', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('# 🔬 AgentProbe Report');
    expect(md).toContain('Test Suite');
  });

  it('includes summary table', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('| Metric | Value |');
    expect(md).toContain('| Total | 3 |');
    expect(md).toContain('| ✅ Passed | 2 |');
    expect(md).toContain('| ❌ Failed | 1 |');
  });

  it('includes test results', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('test-pass-1');
    expect(md).toContain('test-fail-1');
    expect(md).toContain('✅');
    expect(md).toContain('❌');
  });

  it('includes failure details', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('❌ Failures');
    expect(md).toContain('exec');
  });

  it('shows pass rate', () => {
    const md = reportMarkdownDetailed(makeSuiteResult());
    expect(md).toContain('67%');
  });
});

// ===== HTML Reporter =====

describe('HTML Reporter', () => {
  it('generates valid HTML', () => {
    const html = reportHTML(makeSuiteResult());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes test name', () => {
    const html = reportHTML(makeSuiteResult());
    expect(html).toContain('Test Suite');
  });

  it('includes stats', () => {
    const html = reportHTML(makeSuiteResult());
    expect(html).toContain('Total Tests');
    expect(html).toContain('Passed');
    expect(html).toContain('Failed');
  });

  it('includes test results with pass/fail icons', () => {
    const html = reportHTML(makeSuiteResult());
    expect(html).toContain('✅');
    expect(html).toContain('❌');
    expect(html).toContain('test-pass-1');
    expect(html).toContain('test-fail-1');
  });

  it('includes inline JavaScript for interactivity', () => {
    const html = reportHTML(makeSuiteResult());
    expect(html).toContain('<script>');
    expect(html).toContain('addEventListener');
  });

  it('includes CSS styles', () => {
    const html = reportHTML(makeSuiteResult());
    expect(html).toContain('<style>');
  });

  it('handles suite with all passing', () => {
    const suite = makeSuiteResult({
      failed: 0,
      results: [
        { name: 'pass', passed: true, assertions: [{ name: 'x', passed: true }], duration_ms: 100 },
      ],
    });
    const html = reportHTML(suite);
    expect(html).toContain('✅');
    expect(html).not.toContain('test-fail');
  });
});

// ===== GitHub Reporter =====

describe('GitHub Reporter', () => {
  it('generates annotations', () => {
    const output = reportGitHub(makeSuiteResult());
    expect(output).toContain('::error');
    expect(output).toContain('test-fail-1');
  });

  it('includes summary annotation', () => {
    const output = reportGitHub(makeSuiteResult());
    expect(output).toContain('AgentProbe');
    expect(output).toContain('2/3 passed');
  });

  it('generates step summary markdown', () => {
    const output = reportGitHub(makeSuiteResult());
    expect(output).toContain('### 🔬 AgentProbe Results');
  });

  it('handles skipped tests', () => {
    const suite = makeSuiteResult({
      results: [
        { name: 'skipped', passed: true, assertions: [], duration_ms: 0, skipped: true, skipReason: 'N/A' },
      ],
    });
    const output = reportGitHub(suite);
    expect(output).toContain('::notice');
    expect(output).toContain('Skipped');
  });
});

describe('formatAnnotation', () => {
  it('formats error annotation', () => {
    const line = formatAnnotation({ level: 'error', message: 'test failed', title: 'Test Error' });
    expect(line).toContain('::error');
    expect(line).toContain('title=');
    expect(line).toContain('test failed');
  });

  it('formats notice annotation', () => {
    const line = formatAnnotation({ level: 'notice', message: 'info' });
    expect(line).toContain('::notice');
  });

  it('includes file and line when provided', () => {
    const line = formatAnnotation({ level: 'error', message: 'err', file: 'test.ts', line: 42 });
    expect(line).toContain('file=test.ts');
    expect(line).toContain('line=42');
  });
});

describe('parseAnnotations', () => {
  it('parses annotations from output', () => {
    const output = '::error title=Test Failed::Something went wrong\n::notice title=Info::All good';
    const annotations = parseAnnotations(output);
    expect(annotations).toHaveLength(2);
    expect(annotations[0].level).toBe('error');
    expect(annotations[0].title).toBe('Test Failed');
    expect(annotations[1].level).toBe('notice');
  });
});

// ===== Diff Reporter =====

describe('Diff Reporter', () => {
  const oldRun = makeSuiteResult({
    results: [
      { name: 'test-a', passed: true, assertions: [], duration_ms: 100 },
      { name: 'test-b', passed: false, assertions: [], duration_ms: 200 },
      { name: 'test-c', passed: true, assertions: [], duration_ms: 300 },
    ],
  });

  const newRun = makeSuiteResult({
    results: [
      { name: 'test-a', passed: false, assertions: [], duration_ms: 100 }, // regression
      { name: 'test-b', passed: true, assertions: [], duration_ms: 200 }, // improvement
      { name: 'test-d', passed: true, assertions: [], duration_ms: 50 }, // new pass
    ],
  });

  it('detects regressions', () => {
    const diff = diffRuns(oldRun, newRun);
    expect(diff.regressions).toContain('test-a');
  });

  it('detects improvements', () => {
    const diff = diffRuns(oldRun, newRun);
    expect(diff.improvements).toContain('test-b');
  });

  it('detects new tests', () => {
    const diff = diffRuns(oldRun, newRun);
    expect(diff.newPasses).toContain('test-d');
  });

  it('includes summary', () => {
    const diff = diffRuns(oldRun, newRun);
    expect(diff.summary.oldTotal).toBe(3);
    expect(diff.summary.newTotal).toBe(3);
  });

  it('formats diff output', () => {
    const diff = diffRuns(oldRun, newRun);
    const formatted = formatRunDiff(diff);
    expect(formatted).toContain('Regression');
    expect(formatted).toContain('Improvement');
    expect(formatted).toContain('test-a');
    expect(formatted).toContain('test-b');
  });

  it('handles identical runs', () => {
    const diff = diffRuns(oldRun, oldRun);
    expect(diff.regressions).toHaveLength(0);
    expect(diff.improvements).toHaveLength(0);
    expect(diff.newPasses).toHaveLength(0);
    expect(diff.newFailures).toHaveLength(0);
  });
});
