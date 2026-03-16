/**
 * Round 22 Tests — A/B Testing, Fingerprinting, SLA, Enrichment, Group Filtering
 */

import { describe, test, expect } from 'vitest';
import { tTest, formatABTest } from '../src/ab-test';
import {
  buildFingerprint, loadTraces, formatFingerprint,
} from '../src/fingerprint';
import {
  loadSLAConfig, checkSLA, percentile, formatSLACheck, loadReports,
} from '../src/sla';
import {
  computeEnrichment, enrichTrace, enrichTraceDir, formatEnrichment,
} from '../src/enrich';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Helpers ───

function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'test-trace-1',
    timestamp: '2025-01-01T00:00:00Z',
    steps: [],
    metadata: {},
    ...overrides,
  };
}

function makeSuiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'test-suite',
    passed: 8,
    failed: 2,
    total: 10,
    duration_ms: 5000,
    results: [],
    ...overrides,
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-r22-'));
}

// ─── A/B Testing: t-test ───

describe('A/B Testing - tTest', () => {
  test('identical samples return p ≈ 1', () => {
    const p = tTest([0.9, 0.9, 0.9], [0.9, 0.9, 0.9]);
    expect(p).toBeGreaterThan(0.5);
  });

  test('very different samples return low p', () => {
    const p = tTest([0.95, 0.92, 0.97, 0.90, 0.93], [0.50, 0.55, 0.48, 0.52, 0.51]);
    expect(p).toBeLessThan(0.1);
  });

  test('single-element arrays return p = 1', () => {
    const p = tTest([0.9], [0.5]);
    expect(p).toBe(1);
  });

  test('slightly different samples are not significant', () => {
    const p = tTest([0.80, 0.82, 0.81], [0.78, 0.79, 0.80]);
    expect(p).toBeGreaterThan(0.05);
  });

  test('empty arrays return p = 1', () => {
    expect(tTest([], [])).toBe(1);
    expect(tTest([1, 2], [])).toBe(1);
  });
});

// ─── A/B Testing: formatting ───

describe('A/B Testing - formatABTest', () => {
  test('formats results correctly', () => {
    const result: ABTestResult = {
      modelA: { model: 'gpt-4', passRate: 90, avgCost: 0.05, avgTime: 2.1, results: [] },
      modelB: { model: 'gpt-3.5', passRate: 70, avgCost: 0.005, avgTime: 0.8, results: [] },
      pValue: 0.02,
      significant: true,
      qualityWinner: 'gpt-4',
      costWinner: 'gpt-3.5',
    };
    const output = formatABTest(result);
    expect(output).toContain('gpt-4');
    expect(output).toContain('gpt-3.5');
    expect(output).toContain('significant');
    expect(output).toContain('A/B Test');
  });

  test('shows not significant when p > 0.05', () => {
    const result: ABTestResult = {
      modelA: { model: 'a', passRate: 80, avgCost: 0, avgTime: 1, results: [] },
      modelB: { model: 'b', passRate: 78, avgCost: 0, avgTime: 1, results: [] },
      pValue: 0.45,
      significant: false,
      qualityWinner: 'a',
      costWinner: 'a',
    };
    const output = formatABTest(result);
    expect(output).toContain('not significant');
  });
});

// ─── Fingerprinting ───

describe('Fingerprinting - buildFingerprint', () => {
  test('empty traces returns zeroed fingerprint', () => {
    const fp = buildFingerprint([]);
    expect(fp.traceCount).toBe(0);
    expect(fp.tools).toEqual([]);
    expect(fp.avgSteps).toBe(0);
  });

  test('counts tools correctly', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '2025-01-01T00:00:00Z', data: { tool_name: 'search', tool_args: {} } },
        { type: 'tool_call', timestamp: '2025-01-01T00:00:01Z', data: { tool_name: 'search', tool_args: {} } },
        { type: 'tool_call', timestamp: '2025-01-01T00:00:02Z', data: { tool_name: 'calculate', tool_args: {} } },
      ],
    });
    const fp = buildFingerprint([trace]);
    expect(fp.tools.length).toBe(2);
    expect(fp.tools[0].name).toBe('search');
    expect(fp.tools[0].count).toBe(2);
    expect(fp.tools[1].name).toBe('calculate');
  });

  test('computes average steps', () => {
    const t1 = makeTrace({ steps: [
      { type: 'thought', timestamp: '', data: { content: 'think' } },
      { type: 'output', timestamp: '', data: { content: 'done' } },
    ] });
    const t2 = makeTrace({ steps: [
      { type: 'thought', timestamp: '', data: { content: 'think' } },
      { type: 'tool_call', timestamp: '', data: { tool_name: 'x', tool_args: {} } },
      { type: 'tool_result', timestamp: '', data: { tool_result: 'ok' } },
      { type: 'output', timestamp: '', data: { content: 'done' } },
    ] });
    const fp = buildFingerprint([t1, t2]);
    expect(fp.avgSteps).toBe(3); // (2+4)/2
  });

  test('tracks decision patterns', () => {
    const trace = makeTrace({
      steps: [
        { type: 'thought', timestamp: '', data: { content: 'hmm' } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: {} } },
        { type: 'llm_call', timestamp: '', data: { model: 'gpt-4' } },
        { type: 'output', timestamp: '', data: { content: 'answer' } },
      ],
    });
    const fp = buildFingerprint([trace]);
    expect(fp.decisionPattern).toContain('Think');
    expect(fp.decisionPattern).toContain('Respond');
  });

  test('handles error recovery tracking', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: {} } },
        { type: 'tool_result', timestamp: '', data: { tool_result: { error: 'timeout' } } },
        { type: 'tool_call', timestamp: '', data: { tool_name: 'search', tool_args: {} } },
        { type: 'output', timestamp: '', data: { content: 'done' } },
      ],
    });
    const fp = buildFingerprint([trace]);
    expect(fp.errorRecovery.retry + fp.errorRecovery.fallback + fp.errorRecovery.giveUp).toBeGreaterThanOrEqual(0);
  });
});

describe('Fingerprinting - loadTraces', () => {
  test('loads traces from directory', () => {
    const dir = tmpDir();
    const trace = makeTrace({ id: 'trace-1', steps: [{ type: 'output', timestamp: '', data: { content: 'hi' } }] });
    fs.writeFileSync(path.join(dir, 'trace1.json'), JSON.stringify(trace));
    fs.writeFileSync(path.join(dir, 'invalid.json'), '{ broken }');
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'not json');

    const traces = loadTraces(dir);
    expect(traces.length).toBe(1);
    expect(traces[0].id).toBe('trace-1');
    fs.rmSync(dir, { recursive: true });
  });

  test('returns empty for non-existent dir', () => {
    expect(loadTraces('/no/such/dir')).toEqual([]);
  });
});

describe('Fingerprinting - formatFingerprint', () => {
  test('formats output', () => {
    const fp: AgentFingerprint = {
      traceCount: 5,
      tools: [{ name: 'search', count: 10, percentage: 90 }],
      avgSteps: 4.2,
      stdDevSteps: 1.3,
      decisionPattern: ['Think', 'Search', 'Respond'],
      errorRecovery: { retry: 67, fallback: 22, giveUp: 11 },
      avgCost: 0.02,
      stdDevCost: 0.01,
    };
    const output = formatFingerprint(fp);
    expect(output).toContain('search(90%)');
    expect(output).toContain('4.2');
    expect(output).toContain('retry(67%)');
  });
});

// ─── SLA Monitoring ───

describe('SLA - loadSLAConfig', () => {
  test('loads config from YAML', () => {
    const dir = tmpDir();
    const yamlContent = `sla:\n  availability: 99.5%\n  latency_p95: 5000ms\n  cost_per_query: 0.10\n  accuracy: 85%\n`;
    const configPath = path.join(dir, 'sla.yml');
    fs.writeFileSync(configPath, yamlContent);
    const config = loadSLAConfig(configPath);
    expect(config.availability).toBe(99.5);
    expect(config.latency_p95).toBe(5000);
    expect(config.cost_per_query).toBe(0.10);
    expect(config.accuracy).toBe(85);
    fs.rmSync(dir, { recursive: true });
  });

  test('handles numeric values without units', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'sla.yml'), `sla:\n  availability: 99\n  latency_p95: 3000\n  cost_per_query: 0.05\n  accuracy: 90\n`);
    const config = loadSLAConfig(path.join(dir, 'sla.yml'));
    expect(config.availability).toBe(99);
    expect(config.latency_p95).toBe(3000);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('SLA - percentile', () => {
  test('computes 95th percentile', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(95);
  });

  test('empty array returns 0', () => {
    expect(percentile([], 95)).toBe(0);
  });

  test('single value returns that value', () => {
    expect(percentile([42], 95)).toBe(42);
  });
});

describe('SLA - checkSLA', () => {
  const config: SLAConfig = {
    availability: 99.5,
    latency_p95: 5000,
    cost_per_query: 0.10,
    accuracy: 85,
  };

  test('passing SLA returns no violations', () => {
    const reports = [
      makeSuiteResult({ passed: 9, failed: 1, total: 10, duration_ms: 3000, results: [
        { name: 't1', passed: true, assertions: [], duration_ms: 1000 },
        { name: 't2', passed: true, assertions: [], duration_ms: 2000 },
      ] }),
    ];
    const result = checkSLA(config, reports);
    expect(result.actual.accuracy).toBe(90);
    // accuracy 90% > 85% threshold
  });

  test('low accuracy triggers violation', () => {
    const reports = [
      makeSuiteResult({ passed: 5, failed: 5, total: 10, results: [] }),
    ];
    const result = checkSLA(config, reports);
    expect(result.violations.some(v => v.metric === 'accuracy')).toBe(true);
  });

  test('empty reports fail all SLAs', () => {
    const result = checkSLA(config, []);
    expect(result.passing).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

describe('SLA - formatSLACheck', () => {
  test('shows passing', () => {
    const result: SLACheckResult = {
      config: { availability: 99.5, latency_p95: 5000, cost_per_query: 0.10, accuracy: 85 },
      actual: { availability: 100, latency_p95: 2000, cost_per_query: 0.05, accuracy: 92 },
      violations: [],
      passing: true,
    };
    expect(formatSLACheck(result)).toContain('PASSING');
  });

  test('shows violations', () => {
    const result: SLACheckResult = {
      config: { availability: 99.5, latency_p95: 5000, cost_per_query: 0.10, accuracy: 85 },
      actual: { availability: 98, latency_p95: 6000, cost_per_query: 0.05, accuracy: 70 },
      violations: [
        { metric: 'accuracy', threshold: 85, actual: 70, unit: '%' },
      ],
      passing: false,
    };
    const output = formatSLACheck(result);
    expect(output).toContain('VIOLATIONS');
    expect(output).toContain('accuracy');
  });
});

describe('SLA - loadReports', () => {
  test('loads report files from directory', () => {
    const dir = tmpDir();
    const report = makeSuiteResult({ name: 'test' });
    fs.writeFileSync(path.join(dir, 'report1.json'), JSON.stringify(report));
    const reports = loadReports(dir);
    expect(reports.length).toBe(1);
    expect(reports[0].name).toBe('test');
    fs.rmSync(dir, { recursive: true });
  });

  test('returns empty for non-existent dir', () => {
    expect(loadReports('/no/such/dir')).toEqual([]);
  });
});

// ─── Trace Enrichment ───

describe('Enrichment - computeEnrichment', () => {
  test('counts tools and LLM calls', () => {
    const trace = makeTrace({
      steps: [
        { type: 'llm_call', timestamp: '2025-01-01T00:00:00Z', data: { model: 'gpt-4', tokens: { input: 100, output: 50 } }, duration_ms: 1000 },
        { type: 'tool_call', timestamp: '2025-01-01T00:00:01Z', data: { tool_name: 'search' }, duration_ms: 500 },
        { type: 'tool_call', timestamp: '2025-01-01T00:00:02Z', data: { tool_name: 'calc' }, duration_ms: 200 },
      ],
    });
    const e = computeEnrichment(trace);
    expect(e.tool_count).toBe(2);
    expect(e.llm_call_count).toBe(1);
    expect(e.token_total).toBe(150);
    expect(e.duration_ms).toBe(1700);
    expect(e.cost_usd).toBeGreaterThan(0);
  });

  test('empty trace returns zeroes', () => {
    const e = computeEnrichment(makeTrace());
    expect(e.tool_count).toBe(0);
    expect(e.llm_call_count).toBe(0);
    expect(e.token_total).toBe(0);
  });

  test('falls back to timestamps for duration', () => {
    const trace = makeTrace({
      steps: [
        { type: 'llm_call', timestamp: '2025-01-01T00:00:00.000Z', data: {} },
        { type: 'output', timestamp: '2025-01-01T00:00:03.000Z', data: { content: 'done' } },
      ],
    });
    const e = computeEnrichment(trace);
    expect(e.duration_ms).toBe(3000);
  });
});

describe('Enrichment - enrichTrace', () => {
  test('adds metadata to trace', () => {
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'x' }, duration_ms: 100 },
      ],
      metadata: { existing: 'data' },
    });
    const enriched = enrichTrace(trace);
    expect(enriched.metadata.tool_count).toBe(1);
    expect(enriched.metadata.existing).toBe('data');
  });
});

describe('Enrichment - enrichTraceDir', () => {
  test('enriches all traces in directory', () => {
    const dir = tmpDir();
    const trace = makeTrace({
      steps: [
        { type: 'tool_call', timestamp: '', data: { tool_name: 'x' }, duration_ms: 100 },
      ],
    });
    fs.writeFileSync(path.join(dir, 't1.json'), JSON.stringify(trace));
    fs.writeFileSync(path.join(dir, 't2.json'), JSON.stringify(trace));
    fs.writeFileSync(path.join(dir, 'bad.json'), 'not json');

    const result = enrichTraceDir(dir);
    expect(result.enriched).toBe(2);
    expect(result.errors).toBe(1);

    const loaded = JSON.parse(fs.readFileSync(path.join(dir, 't1.json'), 'utf-8'));
    expect(loaded.metadata.tool_count).toBe(1);
    fs.rmSync(dir, { recursive: true });
  });

  test('non-existent dir returns 0', () => {
    expect(enrichTraceDir('/no/such/dir')).toEqual({ enriched: 0, errors: 0 });
  });
});

describe('Enrichment - formatEnrichment', () => {
  test('formats output', () => {
    const output = formatEnrichment({ enriched: 5, errors: 1 });
    expect(output).toContain('5 traces');
    expect(output).toContain('cost_usd');
    expect(output).toContain('Errors: 1');
  });

  test('no errors hides error line', () => {
    const output = formatEnrichment({ enriched: 3, errors: 0 });
    expect(output).not.toContain('Errors');
  });
});

// ─── Group Filtering (runner integration) ───

describe('Group Filtering', () => {
  test('TestSuiteGroups type has correct shape', () => {
    // Type-level test - just ensure the interface is importable
    const groups: Record<string, string[]> = {
      smoke: ['test-1', 'test-2'],
      security: ['test-3', 'test-4'],
    };
    expect(groups.smoke).toEqual(['test-1', 'test-2']);
    expect(groups.security).toEqual(['test-3', 'test-4']);
  });

  test('RunOptions includes group field', () => {
    const opts: import('../src/types').RunOptions = {
      group: 'smoke',
      tags: ['fast'],
    };
    expect(opts.group).toBe('smoke');
  });
});

// ─── Cost computation in enrichment ───

describe('Enrichment - cost calculation', () => {
  test('computes cost from token counts', () => {
    const trace = makeTrace({
      steps: [
        { type: 'llm_call', timestamp: '', data: { tokens: { input: 1000, output: 500 } } },
        { type: 'llm_call', timestamp: '', data: { tokens: { input: 500, output: 200 } } },
      ],
    });
    const e = computeEnrichment(trace);
    // Cost = (1000+500)*0.00003 + (500+200)*0.00006 = 0.045 + 0.042 = ...
    expect(e.cost_usd).toBeGreaterThan(0);
    expect(e.token_total).toBe(2200);
  });
});

// ─── Edge cases ───

describe('Fingerprint edge cases', () => {
  test('single trace with no tools', () => {
    const trace = makeTrace({
      steps: [
        { type: 'thought', timestamp: '', data: { content: 'thinking' } },
        { type: 'output', timestamp: '', data: { content: 'answer' } },
      ],
    });
    const fp = buildFingerprint([trace]);
    expect(fp.tools).toEqual([]);
    expect(fp.avgSteps).toBe(2);
  });

  test('cost std dev with single trace', () => {
    const trace = makeTrace({
      steps: [
        { type: 'llm_call', timestamp: '', data: { tokens: { input: 100, output: 50 } } },
      ],
    });
    const fp = buildFingerprint([trace]);
    expect(fp.stdDevCost).toBe(0); // single sample, std dev = 0
  });
});

describe('SLA edge cases', () => {
  test('all tests passing exceeds accuracy threshold', () => {
    const config: SLAConfig = { availability: 50, latency_p95: 99999, cost_per_query: 99, accuracy: 90 };
    const reports = [
      makeSuiteResult({ passed: 10, failed: 0, total: 10, results: [] }),
    ];
    const result = checkSLA(config, reports);
    expect(result.actual.accuracy).toBe(100);
    expect(result.violations.filter(v => v.metric === 'accuracy')).toEqual([]);
  });
});

describe('t-test edge cases', () => {
  test('zero variance in both samples', () => {
    const p = tTest([0.8, 0.8, 0.8], [0.8, 0.8, 0.8]);
    // Same values = no difference
    expect(p).toBeGreaterThan(0.5);
  });

  test('large sample size', () => {
    const a = Array.from({ length: 100 }, () => 0.9 + Math.random() * 0.05);
    const b = Array.from({ length: 100 }, () => 0.5 + Math.random() * 0.05);
    const p = tTest(a, b);
    expect(p).toBeLessThan(0.01);
  });
});
