/**
 * Round 18 tests — Portal, Health, Matrix, Anonymize enhancements, Perf Regression
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Portal
import {
  loadReports, computeTrends, computeFlaky, computeSlowest,
  computeCosts, detectGaps, buildPortalData, generatePortalHTML,
  generatePortal,
} from '../src/portal';
import type { ReportEntry, PortalData } from '../src/portal';

// Health
import { formatHealth } from '../src/health';
import type { HealthCheckResult } from '../src/health';

// Matrix
import {
  generateCombinations, buildMatrixResult, parseMatrixOptions,
  formatMatrix,
} from '../src/matrix';

// Perf regression
import {
  detectPerfChanges, formatPerfChanges, buildDurationMap,
} from '../src/perf-regression';
import type { SuiteResult } from '../src/types';

// Enhanced anonymize
import {
  anonymizeString, anonymize, anonymizeWithReport,
  anonymizeReversible, deanonymize, formatAnonymizationReport,
} from '../src/anonymize';

// ===== Helper: create temp dir =====
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ap-r18-'));
}

function writeSuiteReport(dir: string, name: string, data: any): void {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}

const SUITE_A: SuiteResult = {
  name: 'suite-a',
  passed: 3, failed: 1, total: 4, duration_ms: 1000,
  results: [
    { name: 'test-1', passed: true, assertions: [], duration_ms: 200, tags: ['integration'] },
    { name: 'test-2', passed: true, assertions: [], duration_ms: 300 },
    { name: 'test-3', passed: true, assertions: [], duration_ms: 100 },
    { name: 'test-4', passed: false, assertions: [], duration_ms: 400 },
  ],
};

const SUITE_B: SuiteResult = {
  name: 'suite-a',
  passed: 2, failed: 2, total: 4, duration_ms: 1200,
  results: [
    { name: 'test-1', passed: false, assertions: [], duration_ms: 250 },
    { name: 'test-2', passed: true, assertions: [], duration_ms: 350 },
    { name: 'test-3', passed: true, assertions: [], duration_ms: 150 },
    { name: 'test-4', passed: false, assertions: [], duration_ms: 450 },
  ],
};

// ============================
// Portal Tests
// ============================
describe('Portal', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('loadReports returns empty for empty dir', () => {
    expect(loadReports(tmpDir)).toEqual([]);
  });

  it('loadReports parses valid report files', () => {
    writeSuiteReport(tmpDir, '2024-01-01.json', { timestamp: '2024-01-01', suite: SUITE_A });
    const reports = loadReports(tmpDir);
    expect(reports).toHaveLength(1);
    expect(reports[0].suite.total).toBe(4);
  });

  it('loadReports skips invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), 'not json');
    expect(loadReports(tmpDir)).toEqual([]);
  });

  it('computeTrends extracts pass/fail over time', () => {
    const entries: ReportEntry[] = [
      { filename: 'a.json', timestamp: '2024-01-01', suite: SUITE_A },
      { filename: 'b.json', timestamp: '2024-01-02', suite: SUITE_B },
    ];
    const trends = computeTrends(entries);
    expect(trends).toHaveLength(2);
    expect(trends[0].passed).toBe(3);
    expect(trends[1].failed).toBe(2);
  });

  it('computeFlaky detects flaky tests', () => {
    const entries: ReportEntry[] = [
      { filename: 'a.json', timestamp: '2024-01-01', suite: SUITE_A },
      { filename: 'b.json', timestamp: '2024-01-02', suite: SUITE_B },
    ];
    const flaky = computeFlaky(entries);
    // test-1 passed once, failed once → flaky
    expect(flaky.some(f => f.name === 'test-1')).toBe(true);
  });

  it('computeSlowest ranks by avg duration', () => {
    const entries: ReportEntry[] = [
      { filename: 'a.json', timestamp: '2024-01-01', suite: SUITE_A },
    ];
    const slowest = computeSlowest(entries);
    expect(slowest[0].name).toBe('test-4'); // 400ms
  });

  it('computeCosts returns cost breakdown', () => {
    const entries: ReportEntry[] = [
      { filename: 'a.json', timestamp: '2024-01-01', suite: SUITE_A },
    ];
    const costs = computeCosts(entries);
    expect(costs).toHaveLength(1);
    expect(costs[0].testCount).toBe(4);
  });

  it('detectGaps identifies missing tag categories', () => {
    const entries: ReportEntry[] = [
      { filename: 'a.json', timestamp: '2024-01-01', suite: SUITE_A },
    ];
    const gaps = detectGaps(entries);
    // SUITE_A only has 'integration' tag, missing error-handling, edge-case, etc.
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some(g => g.area === 'error-handling')).toBe(true);
  });

  it('generatePortalHTML produces valid HTML', () => {
    const data: PortalData = {
      trends: [{ date: '2024-01-01', passed: 3, failed: 1, total: 4 }],
      flaky: [], slowest: [], costs: [], gaps: [],
      totalReports: 1, lastUpdated: '2024-01-01',
    };
    const html = generatePortalHTML(data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('AgentProbe Test Dashboard');
  });

  it('generatePortal creates index.html and data.json', () => {
    const reportsDir = path.join(tmpDir, 'reports');
    const outDir = path.join(tmpDir, 'out');
    fs.mkdirSync(reportsDir);
    writeSuiteReport(reportsDir, 'r1.json', { timestamp: '2024-01-01', suite: SUITE_A });
    generatePortal({ reportsDir, outputDir: outDir });
    expect(fs.existsSync(path.join(outDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'data.json'))).toBe(true);
  });

  it('loadReports returns empty for non-existent dir', () => {
    expect(loadReports('/nonexistent/path')).toEqual([]);
  });
});

// ============================
// Health Check Tests
// ============================
describe('Health Check', () => {
  it('formatHealth renders connected adapters', () => {
    const result: HealthCheckResult = {
      adapters: [
        { name: 'openai', status: 'connected', models: ['gpt-4'], latency_ms: 100 },
        { name: 'local', status: 'error', error: 'connection refused' },
        { name: 'azure', status: 'unconfigured' },
      ],
      timestamp: '2024-01-01',
    };
    const out = formatHealth(result);
    expect(out).toContain('openai');
    expect(out).toContain('connected');
    expect(out).toContain('connection refused');
    expect(out).toContain('not configured');
  });

  it('formatHealth handles empty adapters', () => {
    const result: HealthCheckResult = { adapters: [], timestamp: '2024-01-01' };
    const out = formatHealth(result);
    expect(out).toContain('Adapter Status:');
  });
});

// ============================
// Matrix Tests
// ============================
describe('Matrix', () => {
  it('generateCombinations creates model×temp grid', () => {
    const combos = generateCombinations({
      suiteFile: 'test.yaml',
      models: ['gpt-4', 'claude-3'],
      temperatures: [0, 0.5, 1],
    });
    expect(combos).toHaveLength(6); // 2 × 3
  });

  it('generateCombinations handles extra dimensions', () => {
    const combos = generateCombinations({
      suiteFile: 'test.yaml',
      models: ['gpt-4'],
      temperatures: [0],
      extraDimensions: [{ name: 'maxTokens', values: ['100', '500'] }],
    });
    expect(combos).toHaveLength(2); // 1 × 1 × 2
    expect(combos[0].extras).toEqual({ maxTokens: '100' });
  });

  it('parseMatrixOptions parses comma-separated values', () => {
    const { models, temperatures } = parseMatrixOptions({
      models: 'gpt-4,gpt-3.5,claude-3',
      temps: '0,0.5,1',
    });
    expect(models).toEqual(['gpt-4', 'gpt-3.5', 'claude-3']);
    expect(temperatures).toEqual([0, 0.5, 1]);
  });

  it('parseMatrixOptions uses defaults', () => {
    const { models, temperatures } = parseMatrixOptions({});
    expect(models).toEqual(['default']);
    expect(temperatures).toEqual([0]);
  });

  it('buildMatrixResult produces correct cell count', () => {
    const result = buildMatrixResult(
      { suiteFile: 'x', models: ['a', 'b'], temperatures: [0, 1] },
      [{ name: 't1', input: 'hi', expect: {} }],
    );
    expect(result.cells).toHaveLength(4);
    expect(result.totalConfigs).toBe(4);
  });

  it('formatMatrix produces readable output', () => {
    const result = buildMatrixResult(
      { suiteFile: 'x', models: ['gpt-4'], temperatures: [0] },
      [{ name: 't1', input: 'hi', expect: {} }],
    );
    const out = formatMatrix(result);
    expect(out).toContain('Test Matrix');
    expect(out).toContain('gpt-4');
  });
});

// ============================
// Performance Regression Tests
// ============================
describe('Performance Regression', () => {
  const baseline: SuiteResult = {
    name: 'perf', passed: 3, failed: 0, total: 3, duration_ms: 700,
    results: [
      { name: 'test-1', passed: true, assertions: [], duration_ms: 200 },
      { name: 'test-2', passed: true, assertions: [], duration_ms: 300 },
      { name: 'test-3', passed: true, assertions: [], duration_ms: 200 },
    ],
  };

  it('detects regression when duration increases significantly', () => {
    const current: SuiteResult = {
      ...baseline,
      results: [
        { name: 'test-1', passed: true, assertions: [], duration_ms: 500 }, // +300ms
        { name: 'test-2', passed: true, assertions: [], duration_ms: 300 },
        { name: 'test-3', passed: true, assertions: [], duration_ms: 200 },
      ],
    };
    const result = detectPerfChanges(baseline, current, { thresholdMs: 100, thresholdPercent: 20 });
    expect(result.regressions).toBe(1);
    expect(result.changes.find(c => c.name === 'test-1')?.status).toBe('regression');
  });

  it('detects improvement when duration decreases', () => {
    const current: SuiteResult = {
      ...baseline,
      results: [
        { name: 'test-1', passed: true, assertions: [], duration_ms: 200 },
        { name: 'test-2', passed: true, assertions: [], duration_ms: 50 }, // -250ms
        { name: 'test-3', passed: true, assertions: [], duration_ms: 200 },
      ],
    };
    const result = detectPerfChanges(baseline, current, { thresholdMs: 100, thresholdPercent: 20 });
    expect(result.improvements).toBe(1);
  });

  it('detects new tests', () => {
    const current: SuiteResult = {
      name: 'perf', passed: 4, failed: 0, total: 4, duration_ms: 900,
      results: [
        ...baseline.results,
        { name: 'test-new', passed: true, assertions: [], duration_ms: 200 },
      ],
    };
    const result = detectPerfChanges(baseline, current);
    expect(result.newTests).toBe(1);
  });

  it('detects removed tests', () => {
    const current: SuiteResult = {
      name: 'perf', passed: 2, failed: 0, total: 2, duration_ms: 500,
      results: baseline.results.slice(0, 2),
    };
    const result = detectPerfChanges(baseline, current);
    expect(result.removedTests).toBe(1);
  });

  it('buildDurationMap creates correct map', () => {
    const map = buildDurationMap(baseline);
    expect(map.get('test-1')).toBe(200);
    expect(map.size).toBe(3);
  });

  it('formatPerfChanges produces readable output', () => {
    const result = detectPerfChanges(baseline, baseline);
    const out = formatPerfChanges(result);
    expect(out).toContain('Performance Changes');
    expect(out).toContain('unchanged');
  });

  it('handles identical reports as unchanged', () => {
    const result = detectPerfChanges(baseline, baseline);
    expect(result.regressions).toBe(0);
    expect(result.improvements).toBe(0);
    expect(result.unchanged).toBe(3);
  });
});

// ============================
// Enhanced Anonymize Tests
// ============================
describe('Enhanced Anonymize', () => {
  it('redacts credit card numbers (Luhn-valid)', () => {
    const input = 'Card: 4111 1111 1111 1111';
    const result = anonymizeString(input, { creditCards: true });
    expect(result).toContain('[CREDIT_CARD]');
    expect(result).not.toContain('4111');
  });

  it('does not redact non-Luhn numbers', () => {
    const input = 'Number: 1234 5678 9012 3456';
    const result = anonymizeString(input, { creditCards: true, phones: false, ips: false, secrets: false, emails: false, names: false });
    // 1234567890123456 fails Luhn
    expect(result).not.toContain('[CREDIT_CARD]');
  });

  it('supports custom PII patterns', () => {
    const input = 'SSN: 123-45-6789';
    const result = anonymizeString(input, {
      custom: [{ pattern: '\\d{3}-\\d{2}-\\d{4}', replacement: '[SSN]', name: 'ssn' }],
    });
    expect(result).toContain('[SSN]');
  });

  it('anonymizeWithReport returns report', () => {
    const data = { email: 'john@test.com', note: 'Call +1-555-123-4567' };
    const { data: anon, report } = anonymizeWithReport(data);
    expect(anon.email).toBe('user@example.com');
    expect(report.totalRedactions).toBeGreaterThan(0);
    expect(report.byType).toHaveProperty('email');
  });

  it('anonymizeReversible allows deanonymization', () => {
    const data = { msg: 'Email me at alice@corp.com' };
    const { data: anon, mapping } = anonymizeReversible(data);
    expect(anon.msg).toContain('user@example.com');
    const restored = deanonymize(anon, mapping);
    expect(restored.msg).toContain('alice@corp.com');
  });

  it('deanonymize handles nested objects', () => {
    const data = { a: { b: 'contact bob@test.org' } };
    const { data: anon, mapping } = anonymizeReversible(data);
    const restored = deanonymize(anon, mapping);
    expect(restored.a.b).toContain('bob@test.org');
  });

  it('formatAnonymizationReport produces summary', () => {
    const { report } = anonymizeWithReport({ text: 'key@example.com and 10.0.0.1' });
    const out = formatAnonymizationReport(report);
    expect(out).toContain('Anonymization Report');
    expect(out).toContain('total redactions');
  });

  it('redacts IP addresses consistently', () => {
    const result = anonymize({ a: '10.0.0.5', b: '10.0.0.5' });
    expect(result.a).toBe(result.b);
    expect(result.a).not.toBe('10.0.0.5');
  });

  it('preserves localhost IPs', () => {
    const result = anonymizeString('Connect to 127.0.0.1');
    expect(result).toContain('127.0.0.1');
  });

  it('redacts phone numbers', () => {
    const result = anonymizeString('Call me at +1-555-867-5309');
    expect(result).toContain('[PHONE]');
  });

  it('handles sensitive object keys', () => {
    const result = anonymize({ password: 'hunter2', normal: 'hello' });
    expect(result.password).toBe('[REDACTED]');
    expect(result.normal).toBe('hello');
  });
});
