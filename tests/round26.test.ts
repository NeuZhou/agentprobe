import { describe, it, expect } from 'vitest';
import {
  parseChaosConfigString,
  getScenario,
  applyChaos,
  applyAllChaos,
  describeChaos,
  formatChaosReport,
  validateChaosConfig,
} from '../src/chaos';
import type { ChaosScenario, ChaosConfig } from '../src/chaos';
import {
  analyzeTraces,
  generateComplianceReport,
  formatComplianceReport,
  listStandards,
} from '../src/compliance-report';
import type { ComplianceStandard, ComplianceReport } from '../src/compliance-report';
import {
  analyzeVersion,
  diffVersions,
  compareTraces,
  formatAgentDiff,
} from '../src/agent-diff';
import type { AgentDiff } from '../src/agent-diff';
import {
  parseAssertionConfig,
  extractAssertions,
  evaluateAssertion,
  evaluateAll,
  evaluateAllWithTrace,
  buildAssertionFn,
  validateAssertionConfig,
  formatAssertionResults,
} from '../src/custom-assert-builder';
import type { CustomAssertionEvalResult } from '../src/custom-assert-builder';
import { analyzeImpact, formatImpact } from '../src/impact';
import type { AgentTrace } from '../src/types';

// ===== Helpers =====
function makeTrace(toolNames: string[], outputs: string[] = [], model?: string): AgentTrace {
  const steps: AgentTrace['steps'] = [];
  for (const name of toolNames) {
    steps.push({ type: 'tool_call', timestamp: new Date().toISOString(), data: { tool_name: name } });
  }
  if (model) {
    steps.unshift({ type: 'llm_call', timestamp: new Date().toISOString(), data: { model, tokens: { input: 100, output: 50 } }, duration_ms: 200 });
  }
  for (const content of outputs) {
    steps.push({ type: 'output', timestamp: new Date().toISOString(), data: { content } });
  }
  return { id: 'test', timestamp: new Date().toISOString(), steps, metadata: {} };
}

// ===== Chaos Testing =====
describe('chaos', () => {
  const yamlStr = `
chaos:
  scenarios:
    - type: api_latency
      target: openai
      delay_ms: 5000
    - type: api_error
      target: anthropic
      error: 429
      probability: 0.5
    - type: tool_failure
      tool: search
      error: "connection timeout"
    - type: response_corruption
      corrupt_tokens: "10%"
    - type: context_overflow
      inject_tokens: 100000
`;

  it('should parse chaos config from YAML', () => {
    const config = parseChaosConfigString(yamlStr);
    expect(config.chaos.scenarios).toHaveLength(5);
    expect(config.chaos.scenarios[0].type).toBe('api_latency');
  });

  it('should get a specific scenario by type', () => {
    const config = parseChaosConfigString(yamlStr);
    const s = getScenario(config, 'api_error');
    expect(s).toBeDefined();
    expect(s!.target).toBe('anthropic');
    expect(s!.error).toBe(429);
  });

  it('should return undefined for missing scenario', () => {
    const config: ChaosConfig = { chaos: { scenarios: [{ type: 'api_latency', delay_ms: 100 }] } };
    expect(getScenario(config, 'context_overflow')).toBeUndefined();
  });

  it('should apply api_latency chaos', () => {
    const trace = makeTrace(['search'], [], 'openai-gpt4');
    const scenario: ChaosScenario = { type: 'api_latency', target: 'openai', delay_ms: 3000 };
    const { trace: modified, result } = applyChaos(trace, scenario);
    expect(result.applied).toBe(true);
    expect(result.affectedSteps).toBeGreaterThan(0);
    const llmStep = modified.steps.find(s => s.type === 'llm_call');
    expect(llmStep!.duration_ms).toBeGreaterThanOrEqual(3000);
  });

  it('should apply tool_failure chaos', () => {
    const trace = makeTrace(['search', 'calculate'], ['result']);
    // Add a tool_result step
    trace.steps.push({ type: 'tool_result', timestamp: new Date().toISOString(), data: { tool_result: 'ok' } });
    const scenario: ChaosScenario = { type: 'tool_failure', tool: 'search', error: 'connection timeout' };
    const { result } = applyChaos(trace, scenario);
    expect(result.applied).toBe(true);
  });

  it('should apply response_corruption chaos', () => {
    const trace = makeTrace([], ['Hello world, this is a test output with some content']);
    const scenario: ChaosScenario = { type: 'response_corruption', corrupt_tokens: '50%' };
    const { trace: modified, result } = applyChaos(trace, scenario);
    expect(result.applied).toBe(true);
    const outputStep = modified.steps.find(s => s.type === 'output');
    expect(outputStep!.data.content).not.toBe('Hello world, this is a test output with some content');
  });

  it('should apply context_overflow chaos', () => {
    const trace = makeTrace(['search'], ['result']);
    const scenario: ChaosScenario = { type: 'context_overflow', inject_tokens: 50000 };
    const { trace: modified, result } = applyChaos(trace, scenario);
    expect(result.applied).toBe(true);
    expect(modified.steps.length).toBe(trace.steps.length + 1);
    expect(modified.steps[0].type).toBe('llm_call');
  });

  it('should apply all chaos scenarios at once', () => {
    const trace = makeTrace(['search'], ['some output'], 'openai-gpt4');
    const config = parseChaosConfigString(yamlStr);
    const { results } = applyAllChaos(trace, config.chaos.scenarios);
    expect(results).toHaveLength(5);
  });

  it('should describe chaos scenarios', () => {
    expect(describeChaos({ type: 'api_latency', delay_ms: 5000, target: 'openai' })).toContain('5000ms');
    expect(describeChaos({ type: 'tool_failure', tool: 'search', error: 'timeout' })).toContain('search');
    expect(describeChaos({ type: 'context_overflow', inject_tokens: 100000 })).toContain('100000');
  });

  it('should format chaos report', () => {
    const results = [
      { scenario: { type: 'api_latency' as const }, applied: true, affectedSteps: 2, description: 'test' },
      { scenario: { type: 'tool_failure' as const }, applied: false, affectedSteps: 0, description: 'none' },
    ];
    const report = formatChaosReport(results);
    expect(report).toContain('Chaos Test Report');
    expect(report).toContain('💥');
    expect(report).toContain('⏭️');
  });

  it('should validate valid chaos config', () => {
    const config = parseChaosConfigString(yamlStr);
    const { valid, errors } = validateChaosConfig(config);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid chaos config', () => {
    const { valid, errors } = validateChaosConfig({});
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject unknown chaos type', () => {
    const { valid } = validateChaosConfig({ chaos: { scenarios: [{ type: 'unknown' }] } });
    expect(valid).toBe(false);
  });
});

// ===== Compliance Reports =====
describe('compliance-report', () => {
  it('should list supported standards', () => {
    const stds = listStandards();
    expect(stds).toContain('soc2');
    expect(stds).toContain('hipaa');
    expect(stds).toContain('gdpr');
    expect(stds).toContain('pci-dss');
  });

  it('should generate SOC2 report with clean traces', () => {
    const trace = makeTrace(['search'], ['hello']);
    trace.metadata = { audit: true, rbac: true, version: '1.0' };
    const data = analyzeTraces([trace]);
    const report = generateComplianceReport('soc2', data);
    expect(report.standard).toBe('soc2');
    expect(report.checks).toHaveLength(4);
    expect(report.checks[0].id).toBe('CC6.1');
  });

  it('should detect missing RBAC in SOC2', () => {
    const trace = makeTrace(['search'], ['output']);
    const data = analyzeTraces([trace]);
    const report = generateComplianceReport('soc2', data);
    const rbac = report.checks.find(c => c.id === 'CC6.3');
    expect(rbac!.status).toBe('warn');
  });

  it('should detect PII in HIPAA report', () => {
    const trace = makeTrace([], ['Contact john@example.com for info']);
    const data = analyzeTraces([trace]);
    const report = generateComplianceReport('hipaa', data);
    const phi = report.checks.find(c => c.id === 'PHI-1');
    expect(phi!.status).toBe('fail');
  });

  it('should generate GDPR report', () => {
    const trace = makeTrace([], ['clean output']);
    trace.metadata = { consent: true, retention: '30d' };
    const data = analyzeTraces([trace]);
    const report = generateComplianceReport('gdpr', data);
    expect(report.checks).toHaveLength(4);
    expect(report.checks.find(c => c.id === 'GDPR-2')!.status).toBe('pass');
  });

  it('should generate PCI-DSS report', () => {
    const trace = makeTrace([], ['safe output']);
    const data = analyzeTraces([trace]);
    const report = generateComplianceReport('pci-dss', data);
    expect(report.checks).toHaveLength(4);
    expect(report.checks.find(c => c.id === 'PCI-3')!.status).toBe('pass');
  });

  it('should compute correct summary counts', () => {
    const trace = makeTrace([], ['output']);
    const data = analyzeTraces([trace]);
    const report = generateComplianceReport('soc2', data);
    const total = report.summary.pass + report.summary.warn + report.summary.fail;
    expect(total).toBe(report.checks.length);
  });

  it('should format compliance report', () => {
    const trace = makeTrace([], ['output']);
    const data = analyzeTraces([trace]);
    const report = generateComplianceReport('soc2', data);
    const formatted = formatComplianceReport(report);
    expect(formatted).toContain('SOC2');
    expect(formatted).toContain('CC6.1');
    expect(formatted).toContain('Summary');
  });

  it('should throw on unknown standard', () => {
    const data = analyzeTraces([]);
    expect(() => generateComplianceReport('unknown' as any, data)).toThrow();
  });
});

// ===== Agent Diff =====
describe('agent-diff', () => {
  it('should analyze a version with tools and costs', () => {
    const traces = [makeTrace(['search', 'calculate'], ['result'], 'gpt-4')];
    const version = analyzeVersion(traces);
    expect(version.tools.has('search')).toBe(true);
    expect(version.tools.has('calculate')).toBe(true);
    expect(version.avgSteps).toBeGreaterThan(0);
  });

  it('should detect added tools', () => {
    const v1 = [makeTrace(['search'], ['r1'])];
    const v2 = [makeTrace(['search', 'web_browse'], ['r2'])];
    const diff = compareTraces(v1, v2);
    expect(diff.addedTools).toContain('web_browse');
  });

  it('should detect removed tools', () => {
    const v1 = [makeTrace(['search', 'calculate'], ['r1'])];
    const v2 = [makeTrace(['search'], ['r2'])];
    const diff = compareTraces(v1, v2);
    expect(diff.removedTools).toContain('calculate');
  });

  it('should detect no changes when tools are same', () => {
    const v1 = [makeTrace(['search'], ['r1'])];
    const v2 = [makeTrace(['search'], ['r2'])];
    const diff = compareTraces(v1, v2);
    expect(diff.addedTools).toHaveLength(0);
    expect(diff.removedTools).toHaveLength(0);
    expect(diff.unchangedTools).toContain('search');
  });

  it('should compute steps change percentage', () => {
    const v1 = [makeTrace(['a', 'b', 'c', 'd'], ['r1'])]; // 5 steps
    const v2 = [makeTrace(['a', 'b'], ['r2'])]; // 3 steps
    const diff = compareTraces(v1, v2);
    expect(diff.stepsChange.pct).toBeLessThan(0); // fewer steps
  });

  it('should generate new behaviors for added tools', () => {
    const v1 = [makeTrace(['search'], [])];
    const v2 = [makeTrace(['search', 'browse'], [])];
    const diff = compareTraces(v1, v2);
    expect(diff.newBehaviors.some(b => b.includes('browse'))).toBe(true);
  });

  it('should generate lost behaviors for removed tools', () => {
    const v1 = [makeTrace(['search', 'calculate'], [])];
    const v2 = [makeTrace(['search'], [])];
    const diff = compareTraces(v1, v2);
    expect(diff.lostBehaviors.some(b => b.includes('calculate'))).toBe(true);
  });

  it('should format agent diff report', () => {
    const v1 = [makeTrace(['search'], ['r1'], 'gpt-4')];
    const v2 = [makeTrace(['search', 'browse'], ['r2'], 'gpt-4')];
    const diff = compareTraces(v1, v2);
    const formatted = formatAgentDiff(diff);
    expect(formatted).toContain('Agent Behavior Diff');
    expect(formatted).toContain('browse');
  });

  it('should handle empty traces gracefully', () => {
    const diff = compareTraces([], []);
    expect(diff.addedTools).toHaveLength(0);
    expect(diff.removedTools).toHaveLength(0);
  });
});

// ===== Custom Assertion Builder =====
describe('custom-assert-builder', () => {
  const yamlStr = `
assertions:
  - custom:
      name: "valid_json_response"
      check: |
        const data = JSON.parse(output);
        return data.status === 'success' && data.results.length > 0;
  - custom:
      name: "citations_included"
      check: |
        const urls = output.match(/https?:\\/\\/[^\\s]+/g);
        return urls && urls.length >= 2;
`;

  it('should parse assertion config from YAML', () => {
    const config = parseAssertionConfig(yamlStr);
    expect(config.assertions).toHaveLength(2);
  });

  it('should extract assertion definitions', () => {
    const config = parseAssertionConfig(yamlStr);
    const defs = extractAssertions(config);
    expect(defs).toHaveLength(2);
    expect(defs[0].name).toBe('valid_json_response');
    expect(defs[1].name).toBe('citations_included');
  });

  it('should evaluate passing json assertion', () => {
    const config = parseAssertionConfig(yamlStr);
    const defs = extractAssertions(config);
    const output = JSON.stringify({ status: 'success', results: ['a', 'b'] });
    const result = evaluateAssertion(defs[0], output);
    expect(result.passed).toBe(true);
  });

  it('should evaluate failing json assertion', () => {
    const config = parseAssertionConfig(yamlStr);
    const defs = extractAssertions(config);
    const result = evaluateAssertion(defs[0], 'not json');
    expect(result.passed).toBe(false);
  });

  it('should evaluate passing citations assertion', () => {
    const config = parseAssertionConfig(yamlStr);
    const defs = extractAssertions(config);
    const result = evaluateAssertion(defs[1], 'See https://a.com and https://b.com');
    expect(result.passed).toBe(true);
  });

  it('should evaluate failing citations assertion', () => {
    const config = parseAssertionConfig(yamlStr);
    const defs = extractAssertions(config);
    const result = evaluateAssertion(defs[1], 'no links here');
    expect(result.passed).toBe(false);
  });

  it('should evaluate all assertions at once', () => {
    const config = parseAssertionConfig(yamlStr);
    const output = JSON.stringify({ status: 'success', results: ['a'] });
    const results = evaluateAll(config, output);
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true); // valid json
    expect(results[1].passed).toBe(false); // no citations
  });

  it('should evaluate assertions against trace', () => {
    const config = parseAssertionConfig(yamlStr);
    const trace = makeTrace([], ['See https://a.com and https://b.com for details']);
    const results = evaluateAllWithTrace(config, trace);
    expect(results[1].passed).toBe(true);
  });

  it('should build reusable assertion fn', () => {
    const def = { name: 'len_check', check: 'return output.length > 5;' };
    const fn = buildAssertionFn(def);
    expect(fn('hello!')).toBe(true);
    expect(fn('hi')).toBe(false);
  });

  it('should validate valid config', () => {
    const config = parseAssertionConfig(yamlStr);
    const { valid } = validateAssertionConfig(config);
    expect(valid).toBe(true);
  });

  it('should reject config missing assertions', () => {
    const { valid, errors } = validateAssertionConfig({});
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject assertion missing name', () => {
    const { valid } = validateAssertionConfig({ assertions: [{ custom: { check: 'return true;' } }] });
    expect(valid).toBe(false);
  });

  it('should format assertion results', () => {
    const results: CustomAssertionEvalResult[] = [
      { name: 'test1', passed: true },
      { name: 'test2', passed: false, error: 'oops' },
    ];
    const formatted = formatAssertionResults(results);
    expect(formatted).toContain('✅');
    expect(formatted).toContain('❌');
    expect(formatted).toContain('1/2 passed');
  });
});

// ===== Impact Analysis (additional tests) =====
describe('impact-analysis', () => {
  it('should format impact with no affected tests', () => {
    const result = { changedFiles: ['src/foo.ts'], affectedTests: [], unaffectedCount: 5 };
    const formatted = formatImpact(result);
    expect(formatted).toContain('No tests affected');
    expect(formatted).toContain('5 tests can be skipped');
  });

  it('should format impact with affected tests', () => {
    const result = {
      changedFiles: ['src/search.ts'],
      affectedTests: [{ name: 'test-search', file: 'tests.yaml', reason: 'uses tool: search' }],
      unaffectedCount: 3,
    };
    const formatted = formatImpact(result);
    expect(formatted).toContain('test-search');
    expect(formatted).toContain('uses tool: search');
  });
});
