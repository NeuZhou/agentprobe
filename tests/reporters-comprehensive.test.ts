/**
 * Tests for reporters: JUnit XML, JSON, Markdown, GitHub
 */
import { describe, it, expect } from 'vitest';
import { reportJUnit } from '../src/reporters/junit';
import { reportJSON } from '../src/reporters/json';
import { reportMarkdownDetailed } from '../src/reporters/markdown';
import { reportGitHub } from '../src/reporters/github';
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
        duration_ms: 300,
        assertions: [{ key: 'max_steps', passed: true, message: 'ok', name: 'max_steps: 10' }],
      },
      {
        name: 'test-pass-2',
        passed: true,
        duration_ms: 400,
        assertions: [{ key: 'output_contains', passed: true, message: 'ok', name: 'output_contains: "hello"' }],
      },
      {
        name: 'test-fail-1',
        passed: false,
        duration_ms: 800,
        assertions: [
          { key: 'tool_called', passed: false, message: 'Tool "search" was not called', name: 'tool_called: search', expected: 'search', actual: [] },
        ],
      },
    ] as TestResult[],
    ...overrides,
  };
}

describe('JUnit Reporter', () => {
  it('should generate valid XML', () => {
    const result = makeSuiteResult();
    const xml = reportJUnit(result);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('</testsuites>');
  });

  it('should include test counts', () => {
    const result = makeSuiteResult();
    const xml = reportJUnit(result);
    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
  });

  it('should include failure details', () => {
    const result = makeSuiteResult();
    const xml = reportJUnit(result);
    expect(xml).toContain('<failure');
    expect(xml).toContain('search');
  });

  it('should escape XML special characters', () => {
    const result = makeSuiteResult({
      name: 'Suite <with> "special" & \'chars\'',
      results: [
        {
          name: 'test <special>',
          passed: true,
          duration_ms: 100,
          assertions: [],
        } as TestResult,
      ],
    });
    const xml = reportJUnit(result);
    expect(xml).toContain('&lt;with&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('<with>');
  });

  it('should handle suites with all passing tests', () => {
    const result = makeSuiteResult({
      passed: 2,
      failed: 0,
      results: [
        { name: 't1', passed: true, duration_ms: 100, assertions: [] } as TestResult,
        { name: 't2', passed: true, duration_ms: 100, assertions: [] } as TestResult,
      ],
    });
    const xml = reportJUnit(result);
    expect(xml).toContain('failures="0"');
    expect(xml).not.toContain('<failure');
  });

  it('should handle skipped tests', () => {
    const result = makeSuiteResult({
      results: [
        { name: 'skipped-test', passed: false, skipped: true, skipReason: 'Dependency not met', duration_ms: 0, assertions: [] } as TestResult,
      ],
    });
    const xml = reportJUnit(result);
    expect(xml).toContain('<skipped');
    expect(xml).toContain('Dependency not met');
  });
});

describe('JSON Reporter', () => {
  it('should generate valid JSON', () => {
    const result = makeSuiteResult();
    const json = reportJSON(result);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should include all result fields', () => {
    const result = makeSuiteResult();
    const parsed = JSON.parse(reportJSON(result));
    expect(parsed.summary).toBeDefined();
    expect(parsed.tests).toBeDefined();
    expect(parsed.tests.length).toBe(3);
  });
});

describe('Markdown Reporter', () => {
  it('should generate markdown with headers', () => {
    const result = makeSuiteResult();
    const md = reportMarkdownDetailed(result);
    expect(md).toContain('#');
    expect(md).toContain('Test Suite');
  });

  it('should include pass/fail information', () => {
    const result = makeSuiteResult();
    const md = reportMarkdownDetailed(result);
    expect(md).toContain('test-pass-1');
    expect(md).toContain('test-fail-1');
  });
});

describe('GitHub Reporter', () => {
  it('should generate GitHub-compatible output', () => {
    const result = makeSuiteResult();
    const gh = reportGitHub(result);
    expect(gh).toContain('Test Suite');
  });

  it('should include test results', () => {
    const result = makeSuiteResult();
    const gh = reportGitHub(result);
    expect(gh.length).toBeGreaterThan(0);
  });
});
