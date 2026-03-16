/**
 * Round 38 — v4.0.0 Major Release Tests
 *
 * Tests for: Visual Test Studio, Agent Contract Testing (guarantees),
 * Enhanced Chaos Testing, Test Orchestrator
 */

import { describe, it, expect } from 'vitest';
import type { AgentTrace } from '../src/types';
import { loadStudioData, generateStudioHTML, studioFromSuiteResult } from '../src/studio';
import type { StudioConfig } from '../src/studio';
import {
  verifyContract, parseContract, formatContractResult,
  checkGuarantees, checkNamedBehavior, checkCapabilities, checkBehaviors, checkSafety,
} from '../src/contract';
import type { GuaranteeSpec, BehaviorGuarantee } from '../src/contract';
import {
  applyChaos, applyAllChaos, parseChaosConfigString,
  describeChaos, formatChaosReport, validateChaosConfig, getScenario,
} from '../src/chaos';
import { TestOrchestrator, createOrchestrator, formatOrchestratorResult } from '../src/orchestrator';

// === Helpers ===

function makeTrace(steps: AgentTrace['steps'] = [], meta: Record<string, any> = {}): AgentTrace {
  return {
    id: 'test-trace',
    timestamp: new Date().toISOString(),
    steps,
    metadata: meta,
  };
}

function toolCallStep(name: string, args: Record<string, any> = {}, durationMs = 100) {
  return {
    type: 'tool_call' as const,
    timestamp: new Date().toISOString(),
    data: { tool_name: name, tool_args: args },
    duration_ms: durationMs,
  };
}

function toolResultStep(result: any) {
  return {
    type: 'tool_result' as const,
    timestamp: new Date().toISOString(),
    data: { tool_result: result },
  };
}

function outputStep(content: string, durationMs = 50) {
  return {
    type: 'output' as const,
    timestamp: new Date().toISOString(),
    data: { content },
    duration_ms: durationMs,
  };
}

function llmStep(content: string, tokens = { input: 100, output: 50 }, durationMs = 200) {
  return {
    type: 'llm_call' as const,
    timestamp: new Date().toISOString(),
    data: { content, tokens, model: 'gpt-4' },
    duration_ms: durationMs,
  };
}

// =============================================================================
// 1. VISUAL TEST STUDIO
// =============================================================================

describe('Visual Test Studio', () => {
  it('should generate valid HTML from empty data', () => {
    const data = {
      title: 'Test', generated: new Date().toISOString(),
      tests: [], summary: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, totalDuration: 0, totalCost: 0 },
      costHistory: [], latencyHistory: [], coverageMap: {},
    };
    const html = generateStudioHTML(data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Test</title>');
    expect(html).toContain('🔬');
  });

  it('should include test entries in HTML', () => {
    const data = {
      title: 'My Studio', generated: new Date().toISOString(),
      tests: [
        { name: 'test-1', status: 'pass', duration_ms: 100, tags: ['smoke'] },
        { name: 'test-2', status: 'fail', duration_ms: 200 },
      ],
      summary: { total: 2, passed: 1, failed: 1, flaky: 0, skipped: 0, totalDuration: 300, totalCost: 0 },
      costHistory: [], latencyHistory: [], coverageMap: {},
    };
    const html = generateStudioHTML(data);
    expect(html).toContain('test-1');
    expect(html).toContain('test-2');
    expect(html).toContain('smoke');
  });

  it('should include charts section', () => {
    const data = {
      title: 'Charts', generated: new Date().toISOString(),
      tests: [],
      summary: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, totalDuration: 0, totalCost: 0 },
      costHistory: [{ date: '2024-01-01', cost: 0.05 }],
      latencyHistory: [{ date: '2024-01-01', avg_ms: 500, p95_ms: 1200 }],
      coverageMap: { search: 5, calculate: 3 },
    };
    const html = generateStudioHTML(data);
    expect(html).toContain('Cost Over Time');
    expect(html).toContain('Latency Over Time');
    expect(html).toContain('Coverage Heatmap');
  });

  it('should include builder section', () => {
    const data = {
      title: 'Builder', generated: new Date().toISOString(),
      tests: [], summary: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, totalDuration: 0, totalCost: 0 },
      costHistory: [], latencyHistory: [], coverageMap: {},
    };
    const html = generateStudioHTML(data);
    expect(html).toContain('Test Builder');
    expect(html).toContain('builderYaml');
  });

  it('should generate studio data from suite result', () => {
    const suiteResult = {
      name: 'test-suite', passed: 2, failed: 1, total: 3, duration_ms: 500,
      results: [
        { name: 'a', passed: true, assertions: [], duration_ms: 100, tags: ['unit'] },
        { name: 'b', passed: true, assertions: [], duration_ms: 150, attempts: 3, tags: ['smoke'] },
        { name: 'c', passed: false, assertions: [], duration_ms: 250 },
      ],
    };
    const data = studioFromSuiteResult(suiteResult);
    expect(data.tests).toHaveLength(3);
    expect(data.summary.total).toBe(3);
    expect(data.summary.passed).toBe(1); // b is flaky due to attempts > 1
    expect(data.summary.flaky).toBe(1);
    expect(data.summary.failed).toBe(1);
    expect(data.coverageMap['unit']).toBe(1);
  });

  it('should load studio data from non-existent dir gracefully', () => {
    const config = { port: 3000, reportDir: '/nonexistent/path', title: 'Empty' };
    const data = loadStudioData(config);
    expect(data.tests).toHaveLength(0);
    expect(data.summary.total).toBe(0);
  });

  it('should escape HTML in title', () => {
    const data = {
      title: 'Test <b>bold</b>', generated: new Date().toISOString(),
      tests: [], summary: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, totalDuration: 0, totalCost: 0 },
      costHistory: [], latencyHistory: [], coverageMap: {},
    };
    const html = generateStudioHTML(data);
    expect(html).toContain('&lt;b&gt;');
  });

  it('should include tabs for all panels', () => {
    const data = {
      title: 'Tabs', generated: new Date().toISOString(),
      tests: [], summary: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, totalDuration: 0, totalCost: 0 },
      costHistory: [], latencyHistory: [], coverageMap: {},
    };
    const html = generateStudioHTML(data);
    expect(html).toContain('panel-tests');
    expect(html).toContain('panel-traces');
    expect(html).toContain('panel-charts');
    expect(html).toContain('panel-coverage');
    expect(html).toContain('panel-builder');
  });
});

// =============================================================================
// 2. AGENT CONTRACT TESTING — GUARANTEES
// =============================================================================

describe('Agent Contract Testing — Guarantees', () => {
  it('should verify always_responds_within guarantee (pass)', () => {
    const trace = makeTrace([
      llmStep('thinking', { input: 50, output: 30 }, 1000),
      outputStep('Hello!', 500),
    ]);
    const violations = checkGuarantees(trace, { always_responds_within: '5s' });
    expect(violations).toHaveLength(0);
  });

  it('should detect always_responds_within violation', () => {
    const trace = makeTrace([
      llmStep('thinking', { input: 50, output: 30 }, 3000),
      outputStep('Hello!', 3000),
    ]);
    const violations = checkGuarantees(trace, { always_responds_within: '5s' });
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toContain('always_responds_within');
  });

  it('should detect never_calls violation', () => {
    const trace = makeTrace([
      toolCallStep('delete_user', { id: 123 }),
      outputStep('User deleted'),
    ]);
    const violations = checkGuarantees(trace, { never_calls: ['delete_user', 'admin_panel'] });
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('delete_user');
  });

  it('should pass never_calls when tools not used', () => {
    const trace = makeTrace([
      toolCallStep('search', { q: 'hello' }),
      outputStep('Found results'),
    ]);
    const violations = checkGuarantees(trace, { never_calls: ['delete_user'] });
    expect(violations).toHaveLength(0);
  });

  it('should detect max_cost violation', () => {
    const trace = makeTrace([
      llmStep('response', { input: 50000, output: 10000 }, 1000),
    ]);
    const violations = checkGuarantees(trace, { max_cost_per_interaction: '$0.10' });
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toContain('max_cost');
  });

  it('should pass max_cost when within budget', () => {
    const trace = makeTrace([
      llmStep('response', { input: 100, output: 50 }, 1000),
    ]);
    const violations = checkGuarantees(trace, { max_cost_per_interaction: '$1.00' });
    expect(violations).toHaveLength(0);
  });

  it('should warn on language with no outputs', () => {
    const trace = makeTrace([llmStep('thinking')]);
    const violations = checkGuarantees(trace, { language: ['en', 'es'] });
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('warning');
  });

  it('should verify named behavior must_call', () => {
    const trace = makeTrace([
      toolCallStep('lookup_order'),
      toolCallStep('check_policy'),
      outputStep('Refund approved'),
    ]);
    const violations = checkNamedBehavior(trace, 'refund_request', {
      name: 'refund_request',
      must_call: ['lookup_order', 'check_policy'],
    });
    expect(violations).toHaveLength(0);
  });

  it('should detect named behavior must_call violation', () => {
    const trace = makeTrace([
      toolCallStep('search'),
      outputStep('Here is your refund'),
    ]);
    const violations = checkNamedBehavior(trace, 'refund_request', {
      name: 'refund_request',
      must_call: ['lookup_order', 'check_policy'],
    });
    expect(violations).toHaveLength(2);
  });

  it('should detect named behavior must_not_call violation', () => {
    const trace = makeTrace([
      toolCallStep('issue_refund', { amount: 50 }),
      outputStep('Refund issued'),
    ]);
    const violations = checkNamedBehavior(trace, 'refund_request', {
      name: 'refund_request',
      must_not_call: ['issue_refund'],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('issue_refund');
  });

  it('should check must_output in named behaviors', () => {
    const trace = makeTrace([outputStep('Your order #1234 has been refunded')]);
    const violations = checkNamedBehavior(trace, 'refund', {
      name: 'refund',
      must_output: ['refunded'],
    });
    expect(violations).toHaveLength(0);
  });

  it('should check must_not_output in named behaviors', () => {
    const trace = makeTrace([outputStep('Your SSN is 123-45-6789')]);
    const violations = checkNamedBehavior(trace, 'response', {
      name: 'response',
      must_not_output: ['SSN'],
    });
    expect(violations).toHaveLength(1);
  });

  it('should parse full contract with guarantees', () => {
    const obj = {
      contract: {
        name: 'support-agent', version: '1.0',
        guarantees: { always_responds_within: '5s', never_calls: ['admin_panel'] },
        capabilities: [{ tool: 'search', required: true }],
      },
    };
    const contract = parseContract(obj);
    expect(contract).not.toBeNull();
    expect(contract.guarantees).toBeDefined();
    expect(contract.guarantees.never_calls).toContain('admin_panel');
  });

  it('should verify full contract with guarantees', () => {
    const trace = makeTrace([
      toolCallStep('search', { q: 'test' }, 100),
      outputStep('Hello! Here are results', 200),
    ]);
    const contract = {
      name: 'test-agent', version: '1.0',
      capabilities: [{ tool: 'search', required: true }],
      guarantees: { always_responds_within: '5s', never_calls: ['delete'] },
    };
    const result = verifyContract(trace, contract);
    expect(result.passed).toBe(true);
  });

  it('should format contract result', () => {
    const result = {
      contract: 'test', version: '1.0', passed: false,
      violations: [{ type: 'capability', rule: 'test', message: 'failed', severity: 'error' }],
      checked: 1, timestamp: new Date().toISOString(),
    };
    const formatted = formatContractResult(result);
    expect(formatted).toContain('❌');
    expect(formatted).toContain('test');
  });

  // Existing contract features still work
  it('should check required capabilities', () => {
    const trace = makeTrace([toolCallStep('other_tool')]);
    const violations = checkCapabilities(trace, [{ tool: 'required_tool', required: true }]);
    expect(violations).toHaveLength(1);
  });

  it('should check max_calls capability', () => {
    const trace = makeTrace([
      toolCallStep('api'), toolCallStep('api'), toolCallStep('api'),
    ]);
    const violations = checkCapabilities(trace, [{ tool: 'api', required: false, max_calls: 2 }]);
    expect(violations).toHaveLength(1);
  });

  it('should check PII safety rule', () => {
    const trace = makeTrace([outputStep('Call me at 555-123-4567')]);
    const violations = checkSafety(trace, [{ no_pii_in_responses: true }]);
    expect(violations).toHaveLength(1);
  });

  it('should check always_greets behavior', () => {
    const trace = makeTrace([outputStep('Here is your answer.')]);
    const violations = checkBehaviors(trace, [{ always_greets: true }]);
    expect(violations).toHaveLength(1);
  });
});

// =============================================================================
// 3. CHAOS TESTING — ENHANCED
// =============================================================================

describe('Chaos Testing — Enhanced', () => {
  it('should apply tool_timeout chaos', () => {
    const trace = makeTrace([
      toolCallStep('search_tool', { q: 'test' }, 100),
      toolResultStep({ results: [] }),
    ]);
    const { trace: modified, result } = applyChaos(trace, {
      type: 'tool_timeout', target: 'search_tool', probability: 1.0, inject: 'timeout(5s)',
    });
    expect(result.applied).toBe(true);
    expect(modified.steps[0].duration_ms).toBeGreaterThan(100);
  });

  it('should apply rate_limit chaos', () => {
    const trace = makeTrace([
      toolCallStep('api', {}, 100),
      llmStep('response'),
    ]);
    const { result } = applyChaos(trace, {
      type: 'rate_limit', target: 'all_tools', probability: 1.0,
    });
    expect(result.applied).toBe(true);
  });

  it('should apply malformed_response chaos', () => {
    const trace = makeTrace([
      llmStep('This is a long response that should be truncated by chaos testing'),
    ]);
    const { trace: modified, result } = applyChaos(trace, {
      type: 'malformed_response', target: 'llm', inject: 'truncate(50%)',
    });
    expect(result.applied).toBe(true);
    expect(modified.steps[0].data.content!.length).toBeLessThan(
      'This is a long response that should be truncated by chaos testing'.length,
    );
  });

  it('should apply api_latency chaos', () => {
    const trace = makeTrace([llmStep('hi', { input: 10, output: 5 }, 100)]);
    const { trace: modified, result } = applyChaos(trace, {
      type: 'api_latency', delay_ms: 3000,
    });
    expect(result.applied).toBe(true);
    expect(modified.steps[0].duration_ms).toBe(3100);
  });

  it('should apply api_error chaos', () => {
    const trace = makeTrace([llmStep('thinking')]);
    const { trace: modified, result } = applyChaos(trace, {
      type: 'api_error', error: 503, probability: 1.0,
    });
    expect(result.applied).toBe(true);
    expect(modified.steps[0].data.content).toContain('Error 503');
  });

  it('should apply context_overflow chaos', () => {
    const trace = makeTrace([outputStep('hi')]);
    const { trace: modified, result } = applyChaos(trace, {
      type: 'context_overflow', inject_tokens: 50000,
    });
    expect(result.applied).toBe(true);
    expect(modified.steps.length).toBe(2);
  });

  it('should apply response_corruption chaos', () => {
    const trace = makeTrace([outputStep('Clean output text')]);
    const { trace: modified, result } = applyChaos(trace, {
      type: 'response_corruption', corrupt_tokens: '50%',
    });
    expect(result.applied).toBe(true);
  });

  it('should apply multiple chaos scenarios', () => {
    const trace = makeTrace([
      llmStep('thinking', { input: 100, output: 50 }, 200),
      toolCallStep('search', { q: 'test' }),
      outputStep('Result'),
    ]);
    const { results } = applyAllChaos(trace, [
      { type: 'api_latency', delay_ms: 1000 },
      { type: 'tool_timeout', target: 'search', probability: 1.0 },
    ]);
    expect(results).toHaveLength(2);
  });

  it('should validate chaos config with new types', () => {
    const config = {
      chaos: {
        scenarios: [
          { type: 'tool_timeout', target: 'search', probability: 0.3 },
          { type: 'rate_limit', target: 'all_tools', probability: 0.1 },
          { type: 'malformed_response', target: 'llm', inject: 'truncate(50%)' },
        ],
      },
    };
    const { valid, errors } = validateChaosConfig(config);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid chaos type', () => {
    const config = { chaos: { scenarios: [{ type: 'invalid_type' }] } };
    const { valid } = validateChaosConfig(config);
    expect(valid).toBe(false);
  });

  it('should describe new chaos types', () => {
    expect(describeChaos({ type: 'tool_timeout' })).toContain('timeout');
    expect(describeChaos({ type: 'rate_limit' })).toContain('429');
    expect(describeChaos({ type: 'malformed_response' })).toContain('Truncate');
  });

  it('should format chaos report', () => {
    const results = [
      { scenario: { type: 'tool_timeout' }, applied: true, affectedSteps: 2, description: 'timeout test' },
      { scenario: { type: 'rate_limit' }, applied: false, affectedSteps: 0, description: 'rate limit test' },
    ];
    const report = formatChaosReport(results);
    expect(report).toContain('Chaos Test Report');
    expect(report).toContain('💥');
    expect(report).toContain('⏭️');
  });

  it('should parse chaos config from YAML string', () => {
    const yaml = `
chaos:
  scenarios:
    - type: tool_timeout
      target: search_tool
      probability: 0.3
    - type: rate_limit
      probability: 0.1
`;
    const config = parseChaosConfigString(yaml);
    expect(config.chaos.scenarios).toHaveLength(2);
    expect(config.chaos.scenarios[0].type).toBe('tool_timeout');
  });

  it('should get scenario by type', () => {
    const config = {
      chaos: { scenarios: [
        { type: 'api_latency', delay_ms: 1000 },
        { type: 'tool_timeout', target: 'search' },
      ] },
    };
    const s = getScenario(config, 'tool_timeout');
    expect(s).toBeDefined();
    expect(s.target).toBe('search');
  });

  it('should handle tool_failure chaos', () => {
    const trace = makeTrace([
      toolCallStep('db_query', {}),
      toolResultStep({ data: [] }),
    ]);
    const { result } = applyChaos(trace, {
      type: 'tool_failure', tool: 'db_query', error: 'connection refused',
    });
    expect(result.affectedSteps).toBeGreaterThan(0);
  });
});

// =============================================================================
// 4. TEST ORCHESTRATOR
// =============================================================================

describe('Test Orchestrator', () => {
  it('should add agents and evaluate traces', async () => {
    const orch = new TestOrchestrator();
    const trace = makeTrace([
      toolCallStep('search', { q: 'test' }),
      outputStep('Found results'),
    ]);
    orch.addAgentWithTrace('agent1', { role: 'searcher' }, trace);
    orch.setExpectations('agent1', { tool_called: 'search' });
    const result = await orch.run();
    expect(result.agents.get('agent1')!.passed).toBe(true);
  });

  it('should detect missing trace', async () => {
    const orch = new TestOrchestrator();
    orch.addAgent('ghost', { role: 'missing' });
    const result = await orch.run();
    expect(result.agents.get('ghost')!.passed).toBe(false);
    expect(result.agents.get('ghost')!.error).toContain('No trace');
  });

  it('should evaluate interactions between agents', async () => {
    const orch = new TestOrchestrator();
    const routerTrace = makeTrace([
      toolCallStep('delegate', { target: 'support', reason: 'refund' }),
      outputStep('Delegating to support'),
    ]);
    const supportTrace = makeTrace([
      toolCallStep('lookup_order'),
      outputStep('Order found, processing refund'),
    ]);
    orch.addAgentWithTrace('router', {}, routerTrace);
    orch.addAgentWithTrace('support', {}, supportTrace);
    orch.defineInteraction('router', 'support', 'Handle refund');
    const result = await orch.run();
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0].handoffDetected).toBe(true);
  });

  it('should run in parallel mode', async () => {
    const orch = new TestOrchestrator();
    orch.addAgentWithTrace('a', {}, makeTrace([outputStep('hi')]));
    orch.addAgentWithTrace('b', {}, makeTrace([outputStep('hello')]));
    orch.setFlowMode('parallel');
    const result = await orch.run();
    expect(result.flow).toBe('parallel');
    expect(result.passed).toBe(true);
  });

  it('should create orchestrator from config', async () => {
    const trace1 = makeTrace([toolCallStep('search'), outputStep('results')]);
    const orch = createOrchestrator({
      agents: { searcher: { role: 'search' } },
      flow: 'sequential',
    });
    orch.addAgentWithTrace('searcher', { role: 'search' }, trace1);
    const result = await orch.run();
    expect(result.flow).toBe('sequential');
  });

  it('should format orchestrator result', () => {
    const result = {
      passed: true,
      agents: new Map([['a', { agent: 'a', passed: true, assertions: [], duration_ms: 100 }]]),
      interactions: [],
      totalDuration_ms: 100,
      flow: 'sequential',
      summary: 'All passed',
    };
    const formatted = formatOrchestratorResult(result);
    expect(formatted).toContain('✅');
    expect(formatted).toContain('sequential');
  });

  it('should detect failed interaction (no handoff)', async () => {
    const orch = new TestOrchestrator();
    orch.addAgentWithTrace('a', {}, makeTrace([outputStep('I will handle this myself')]));
    orch.addAgentWithTrace('b', {}, makeTrace([outputStep('Waiting')]));
    orch.defineInteraction('a', 'b', 'Should delegate');
    const result = await orch.run();
    expect(result.interactions[0].handoffDetected).toBe(false);
    expect(result.interactions[0].success).toBe(false);
  });

  it('should handle multi-agent scenario with expectations', async () => {
    const orch = new TestOrchestrator();
    orch.addAgentWithTrace('classifier', {}, makeTrace([
      llmStep('Classifying intent...'),
      toolCallStep('classify', { intent: 'billing' }),
      outputStep('Intent: billing'),
    ]));
    orch.addAgentWithTrace('billing', {}, makeTrace([
      toolCallStep('get_invoice', { id: 42 }),
      outputStep('Invoice total: $99.00'),
    ]));
    orch.setExpectations('classifier', { tool_called: 'classify' });
    orch.setExpectations('billing', { tool_called: 'get_invoice', output_contains: '$99' });
    const result = await orch.run();
    expect(result.passed).toBe(true);
  });

  it('should report failed expectations', async () => {
    const orch = new TestOrchestrator();
    orch.addAgentWithTrace('agent', {}, makeTrace([outputStep('hi')]));
    orch.setExpectations('agent', { tool_called: 'nonexistent_tool' });
    const result = await orch.run();
    expect(result.passed).toBe(false);
  });

  it('should produce summary with interaction details', async () => {
    const orch = new TestOrchestrator();
    orch.addAgentWithTrace('router', {}, makeTrace([
      toolCallStep('transfer', { to: 'handler' }),
    ]));
    orch.addAgentWithTrace('handler', {}, makeTrace([outputStep('Done')]));
    orch.defineInteraction('router', 'handler', 'Process request');
    const result = await orch.run();
    expect(result.summary).toContain('Orchestrator');
    expect(result.summary).toContain('router');
  });
});
