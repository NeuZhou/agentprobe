/**
 * Tests for 5 critical logic bug fixes:
 * 1. Custom assertion security (no arbitrary code execution)
 * 2. output_matches invalid regex doesn't skip subsequent assertions
 * 3. Codegen generates max_cost_usd (not max_cost)
 * 4. Cost model fuzzy matching — o1-mini doesn't match o1
 * 5. Zero-assertion tests should warn/fail
 */
import { describe, test, expect } from 'vitest';
import { evaluate, evaluateSafeExpression } from '../src/assertions';
import { findPricing, PRICING } from '../src/cost';
import { generateFromNLEnhanced, formatGeneratedTests, generateTests } from '../src/codegen';
import type { AgentTrace, Expectations } from '../src/types';

// ─── Helpers ────────────────────────────────────────────

function makeTrace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: 'test-trace',
    timestamp: new Date().toISOString(),
    steps: [],
    ...overrides,
  };
}

function makeTraceWithSteps(): AgentTrace {
  return makeTrace({
    steps: [
      {
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        data: { tool_name: 'search', tool_args: { query: 'test' } },
      },
      {
        type: 'output',
        timestamp: new Date().toISOString(),
        data: { content: 'Here is the result of the search.' },
      },
    ],
  });
}

// ═══════════════════════════════════════════════════════
// Fix 1: Custom assertion security
// ═══════════════════════════════════════════════════════

describe('Fix 1: Custom assertion security — no arbitrary code execution', () => {
  const trace = makeTraceWithSteps();

  test('safe expression: property access works', () => {
    const result = evaluateSafeExpression('steps.length > 0', {
      trace,
      steps: trace.steps,
      toolCalls: ['search'],
      outputs: 'result',
    });
    expect(result).toBe(true);
  });

  test('safe expression: comparison operators work', () => {
    const result = evaluateSafeExpression('toolCalls.length === 1', {
      trace,
      steps: trace.steps,
      toolCalls: ['search'],
      outputs: 'result',
    });
    expect(result).toBe(true);
  });

  test('custom assertion cannot execute process.exit()', () => {
    expect(() => {
      evaluateSafeExpression('process.exit(1)', {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('custom assertion cannot access filesystem via require', () => {
    expect(() => {
      evaluateSafeExpression("require('fs').readFileSync('/etc/passwd')", {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('custom assertion cannot use new Function()', () => {
    expect(() => {
      evaluateSafeExpression("new Function('return 1')()", {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('custom assertion cannot use eval()', () => {
    expect(() => {
      evaluateSafeExpression("eval('1+1')", {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('custom assertion cannot use import()', () => {
    expect(() => {
      evaluateSafeExpression("import('child_process')", {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('custom assertion cannot access constructor', () => {
    expect(() => {
      evaluateSafeExpression("trace.constructor.constructor('return 1')()", {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('custom assertion cannot access __proto__', () => {
    expect(() => {
      evaluateSafeExpression("trace.__proto__", {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('custom assertion cannot use template literals', () => {
    expect(() => {
      evaluateSafeExpression("`${process.env.SECRET}`", {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('custom assertion cannot use globalThis', () => {
    expect(() => {
      evaluateSafeExpression("globalThis.process.exit()", {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('custom assertion cannot assign variables', () => {
    expect(() => {
      evaluateSafeExpression("x = 1", {
        trace,
        steps: trace.steps,
        toolCalls: [],
        outputs: '',
      });
    }).toThrow(/Unsafe expression blocked/);
  });

  test('evaluate() uses safe evaluator for custom assertions', () => {
    const results = evaluate(trace, {
      custom: 'steps.length > 0',
    } as any);
    const customResult = results.find(r => r.name.startsWith('custom:'));
    expect(customResult).toBeDefined();
    expect(customResult!.passed).toBe(true);
  });

  test('evaluate() blocks dangerous custom assertions', () => {
    const results = evaluate(trace, {
      custom: "process.exit(1)",
    } as any);
    const customResult = results.find(r => r.name.startsWith('custom:'));
    expect(customResult).toBeDefined();
    expect(customResult!.passed).toBe(false);
    expect(customResult!.message).toMatch(/Unsafe expression blocked|Error evaluating/);
  });
});

// ═══════════════════════════════════════════════════════
// Fix 2: output_matches invalid regex doesn't skip
// ═══════════════════════════════════════════════════════

describe('Fix 2: Invalid regex in output_matches reports error, does not skip', () => {
  const trace = makeTraceWithSteps();

  test('invalid regex produces failure result with clear error message', () => {
    const results = evaluate(trace, {
      output_matches: '[invalid(regex',
    });
    const regexResult = results.find(r => r.name.includes('output_matches'));
    expect(regexResult).toBeDefined();
    expect(regexResult!.passed).toBe(false);
    expect(regexResult!.message).toMatch(/Invalid regex/);
  });

  test('subsequent assertions still run after invalid regex', () => {
    const results = evaluate(trace, {
      output_matches: '[invalid(regex',
      tool_called: 'search',
      max_steps: 100,
    });

    // Should have results for ALL assertions, not just the regex one
    const regexResult = results.find(r => r.name.includes('output_matches'));
    const toolResult = results.find(r => r.name.includes('tool_called'));
    const stepsResult = results.find(r => r.name.includes('max_steps'));

    expect(regexResult).toBeDefined();
    expect(regexResult!.passed).toBe(false);

    expect(toolResult).toBeDefined();
    expect(toolResult!.passed).toBe(true); // search IS called

    expect(stepsResult).toBeDefined();
    expect(stepsResult!.passed).toBe(true); // 2 steps <= 100
  });

  test('valid regex still works correctly', () => {
    const results = evaluate(trace, {
      output_matches: 'result.*search',
    });
    const regexResult = results.find(r => r.name.includes('output_matches'));
    expect(regexResult).toBeDefined();
    expect(regexResult!.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// Fix 3: Codegen generates max_cost_usd not max_cost
// ═══════════════════════════════════════════════════════

describe('Fix 3: Codegen generates correct field name max_cost_usd', () => {
  test('NL pattern for cost generates max_cost_usd', () => {
    const result = generateFromNLEnhanced('costs under $0.50');
    expect(result).not.toBeNull();
    expect(result!.expect).toHaveProperty('max_cost_usd');
    expect(result!.expect).not.toHaveProperty('max_cost');
    expect(result!.expect.max_cost_usd).toBe(0.5);
  });

  test('NL pattern for "cost below" generates max_cost_usd', () => {
    const result = generateFromNLEnhanced('cost below $1.00');
    expect(result).not.toBeNull();
    expect(result!.expect).toHaveProperty('max_cost_usd');
    expect(result!.expect.max_cost_usd).toBe(1.0);
  });

  test('NL pattern for "costs less than" generates max_cost_usd', () => {
    const result = generateFromNLEnhanced('costs less than 0.25');
    expect(result).not.toBeNull();
    expect(result!.expect).toHaveProperty('max_cost_usd');
    expect(result!.expect.max_cost_usd).toBe(0.25);
  });

  test('generated YAML output uses max_cost_usd key', () => {
    const result = generateFromNLEnhanced('costs under $0.50');
    expect(result).not.toBeNull();
    const yaml = formatGeneratedTests([result!], 'test-trace');
    expect(yaml).toContain('max_cost_usd');
    expect(yaml).not.toMatch(/max_cost(?!_usd)/); // max_cost not followed by _usd should not appear
  });
});

// ═══════════════════════════════════════════════════════
// Fix 4: Cost model fuzzy matching
// ═══════════════════════════════════════════════════════

describe('Fix 4: Cost model matches o1-mini correctly, not o1', () => {
  test('o1-mini uses o1-mini pricing, not o1 pricing', () => {
    const pricing = findPricing('o1-mini');
    expect(pricing.input).toBe(PRICING['o1-mini'].input);
    expect(pricing.output).toBe(PRICING['o1-mini'].output);
    // Ensure it's NOT o1 pricing
    expect(pricing.input).not.toBe(PRICING['o1'].input);
  });

  test('o1 still matches o1 pricing exactly', () => {
    const pricing = findPricing('o1');
    expect(pricing.input).toBe(PRICING['o1'].input);
    expect(pricing.output).toBe(PRICING['o1'].output);
  });

  test('o3-mini matches o3-mini pricing', () => {
    const pricing = findPricing('o3-mini');
    expect(pricing.input).toBe(PRICING['o3-mini'].input);
    expect(pricing.output).toBe(PRICING['o3-mini'].output);
  });

  test('gpt-4o-mini matches gpt-4o-mini pricing, not gpt-4o', () => {
    const pricing = findPricing('gpt-4o-mini');
    expect(pricing.input).toBe(PRICING['gpt-4o-mini'].input);
    expect(pricing.output).toBe(PRICING['gpt-4o-mini'].output);
    // Should NOT match gpt-4o pricing
    expect(pricing.input).not.toBe(PRICING['gpt-4o'].input);
  });

  test('claude-3.5-haiku matches correct pricing, not claude-3-haiku', () => {
    const pricing = findPricing('claude-3.5-haiku');
    expect(pricing.input).toBe(PRICING['claude-3.5-haiku'].input);
    expect(pricing.output).toBe(PRICING['claude-3.5-haiku'].output);
  });

  test('unknown model falls back to gpt-4o-mini pricing', () => {
    const pricing = findPricing('totally-unknown-model-xyz');
    expect(pricing.input).toBe(0.15);
    expect(pricing.output).toBe(0.6);
  });

  test('model name with prefix still matches (e.g., o1-mini-2024-01)', () => {
    const pricing = findPricing('o1-mini-2024-01');
    // Should match o1-mini, not o1
    expect(pricing.input).toBe(PRICING['o1-mini'].input);
    expect(pricing.output).toBe(PRICING['o1-mini'].output);
  });
});

// ═══════════════════════════════════════════════════════
// Fix 5: Zero-assertion tests should warn/fail
// ═══════════════════════════════════════════════════════

describe('Fix 5: Zero-assertion tests should warn/fail', () => {
  test('test with zero assertions produces failure assertion', () => {
    const trace = makeTrace();
    // Empty expectations → zero assertions
    const results = evaluate(trace, {} as Expectations);
    // The evaluate function itself returns an empty array, 
    // but the runner adds the no_assertions failure.
    // Here we test that evaluate returns empty for empty expect,
    // and the runner integration test covers the warning.
    expect(results).toHaveLength(0);
  });

  test('evaluate with at least one assertion does not add warning', () => {
    const trace = makeTraceWithSteps();
    const results = evaluate(trace, { tool_called: 'search' });
    expect(results.length).toBeGreaterThan(0);
    const noAssertionResult = results.find(r => r.name === 'no_assertions');
    expect(noAssertionResult).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════
// Integration: Runner zero-assertion behavior
// ═══════════════════════════════════════════════════════

describe('Fix 5 integration: Runner handles zero assertions', () => {
  // We test the runner behavior by importing runSuite indirectly
  // Since runSuite requires file I/O, we test via a temp YAML file
  test('runner adds no_assertions failure for empty expect', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const { runSuite } = await import('../src/runner');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentprobe-test-'));
    const suiteFile = path.join(tmpDir, 'test-suite.yaml');

    // Create a minimal trace file
    const traceFile = path.join(tmpDir, 'trace.json');
    const trace: AgentTrace = {
      id: 'test',
      timestamp: new Date().toISOString(),
      steps: [
        {
          type: 'output',
          timestamp: new Date().toISOString(),
          data: { content: 'hello' },
        },
      ],
    };
    fs.writeFileSync(traceFile, JSON.stringify(trace));

    // Create suite with no assertions
    const yaml = `
name: Zero assertion test
tests:
  - name: Empty test
    input: "hello"
    trace: trace.json
    expect: {}
`;
    fs.writeFileSync(suiteFile, yaml);

    const result = await runSuite(suiteFile);
    expect(result.results[0].passed).toBe(false);
    const noAssert = result.results[0].assertions.find(a => a.name === 'no_assertions');
    expect(noAssert).toBeDefined();
    expect(noAssert!.passed).toBe(false);
    expect(noAssert!.message).toMatch(/No assertions defined/);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
