/**
 * Test Report Exporter - Export test results to PDF, CSV, JUnit XML, and SARIF formats.
 */

import type { SuiteResult, TestResult } from './types';

export type ReportExportFormat = 'pdf' | 'csv' | 'junit' | 'sarif' | 'json' | 'markdown';

export interface ReportExportOptions {
  format: ReportExportFormat;
  title?: string;
  includeTraces?: boolean;
  outputPath?: string;
}

// ===== CSV Export =====

export function exportToCsv(results: SuiteResult): string {
  const headers = [
    'test_name', 'passed', 'duration_ms', 'error', 'assertions_total',
    'assertions_passed', 'tags', 'skipped', 'attempts',
  ];
  const rows = results.results.map(r => [
    csvEscape(r.name),
    r.passed ? 'PASS' : 'FAIL',
    r.duration_ms.toString(),
    csvEscape(r.error || ''),
    r.assertions.length.toString(),
    r.assertions.filter(a => a.passed).length.toString(),
    csvEscape((r.tags || []).join(';')),
    r.skipped ? 'true' : 'false',
    (r.attempts || 1).toString(),
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ===== JUnit XML Export =====

export function exportToJunit(results: SuiteResult): string {
  const failures = results.results.filter(r => !r.passed && !r.skipped);
  const skipped = results.results.filter(r => r.skipped);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="agentprobe" tests="${results.total}" failures="${failures.length}" skipped="${skipped.length}" time="${(results.duration_ms / 1000).toFixed(3)}">`,
    `  <testsuite name="${escapeXml(results.name)}" tests="${results.total}" failures="${failures.length}" skipped="${skipped.length}" time="${(results.duration_ms / 1000).toFixed(3)}">`,
  ];

  for (const test of results.results) {
    const time = (test.duration_ms / 1000).toFixed(3);
    if (test.skipped) {
      lines.push(`    <testcase name="${escapeXml(test.name)}" time="${time}">`);
      lines.push(`      <skipped message="${escapeXml(test.skipReason || 'skipped')}" />`);
      lines.push('    </testcase>');
    } else if (!test.passed) {
      lines.push(`    <testcase name="${escapeXml(test.name)}" time="${time}">`);
      const failedAssertions = test.assertions.filter(a => !a.passed);
      const message = test.error || failedAssertions.map(a => a.message || a.name).join('; ');
      lines.push(`      <failure message="${escapeXml(message)}">`);
      for (const a of failedAssertions) {
        lines.push(`        ${escapeXml(a.name)}: expected=${escapeXml(String(a.expected))} actual=${escapeXml(String(a.actual))}`);
      }
      lines.push('      </failure>');
      lines.push('    </testcase>');
    } else {
      lines.push(`    <testcase name="${escapeXml(test.name)}" time="${time}" />`);
    }
  }

  lines.push('  </testsuite>');
  lines.push('</testsuites>');
  return lines.join('\n');
}

// ===== SARIF Export =====

export function exportToSarif(results: SuiteResult): string {
  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'agentprobe',
          version: '3.7.0',
          informationUri: 'https://github.com/neuzhou/agentprobe',
          rules: results.results.filter(r => !r.passed).map((r, i) => ({
            id: `AP${String(i + 1).padStart(4, '0')}`,
            name: r.name,
            shortDescription: { text: r.error || `Test "${r.name}" failed` },
            defaultConfiguration: { level: 'error' },
          })),
        },
      },
      results: results.results.filter(r => !r.passed).map((r, i) => ({
        ruleId: `AP${String(i + 1).padStart(4, '0')}`,
        level: 'error',
        message: { text: r.error || formatFailedAssertions(r) },
        properties: {
          duration_ms: r.duration_ms,
          tags: r.tags || [],
          assertions: r.assertions.map(a => ({
            name: a.name,
            passed: a.passed,
            expected: a.expected,
            actual: a.actual,
          })),
        },
      })),
      invocations: [{
        executionSuccessful: results.failed === 0,
        properties: {
          total: results.total,
          passed: results.passed,
          failed: results.failed,
          duration_ms: results.duration_ms,
        },
      }],
    }],
  };
  return JSON.stringify(sarif, null, 2);
}

// ===== PDF Export (text-based representation) =====

export function exportToPdf(results: SuiteResult, title?: string): string {
  // Real PDF generation would require a library; this produces a structured
  // text representation that can be piped into a PDF renderer.
  const lines: string[] = [];
  const t = title || `AgentProbe Test Report: ${results.name}`;
  lines.push('='.repeat(60));
  lines.push(t);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Suite: ${results.name}`);
  lines.push(`Total: ${results.total} | Passed: ${results.passed} | Failed: ${results.failed}`);
  lines.push(`Duration: ${(results.duration_ms / 1000).toFixed(2)}s`);
  lines.push(`Pass Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('-'.repeat(60));

  for (const test of results.results) {
    const status = test.skipped ? 'SKIP' : test.passed ? 'PASS' : 'FAIL';
    lines.push(`[${status}] ${test.name} (${test.duration_ms}ms)`);
    if (test.error) lines.push(`  Error: ${test.error}`);
    for (const a of test.assertions.filter(a => !a.passed)) {
      lines.push(`  ✗ ${a.name}: expected ${a.expected}, got ${a.actual}`);
    }
  }

  lines.push('');
  lines.push('-'.repeat(60));
  lines.push(`Generated by AgentProbe v3.7.0`);
  return lines.join('\n');
}

// ===== Markdown Export =====

export function exportToMarkdown(results: SuiteResult, title?: string): string {
  const t = title || `AgentProbe Test Report: ${results.name}`;
  const lines: string[] = [
    `# ${t}`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total | ${results.total} |`,
    `| Passed | ${results.passed} |`,
    `| Failed | ${results.failed} |`,
    `| Duration | ${(results.duration_ms / 1000).toFixed(2)}s |`,
    `| Pass Rate | ${((results.passed / results.total) * 100).toFixed(1)}% |`,
    '',
    '## Results',
    '',
    '| Test | Status | Duration | Error |',
    '|------|--------|----------|-------|',
  ];

  for (const test of results.results) {
    const status = test.skipped ? '⏭ SKIP' : test.passed ? '✅ PASS' : '❌ FAIL';
    lines.push(`| ${test.name} | ${status} | ${test.duration_ms}ms | ${test.error || ''} |`);
  }

  return lines.join('\n');
}

// ===== Unified export function =====

export function exportReport(results: SuiteResult, options: ReportExportOptions): string {
  switch (options.format) {
    case 'csv': return exportToCsv(results);
    case 'junit': return exportToJunit(results);
    case 'sarif': return exportToSarif(results);
    case 'pdf': return exportToPdf(results, options.title);
    case 'markdown': return exportToMarkdown(results, options.title);
    case 'json': return JSON.stringify(results, null, 2);
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }
}

// ===== Helpers =====

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatFailedAssertions(test: TestResult): string {
  return test.assertions
    .filter(a => !a.passed)
    .map(a => `${a.name}: expected ${a.expected}, got ${a.actual}`)
    .join('; ') || 'Test failed';
}
