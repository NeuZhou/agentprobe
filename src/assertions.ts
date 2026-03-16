import type { AgentTrace, Expectations, AssertionResult, ChainStep } from './types';
import { calculateCost } from './cost';
import { evaluateCustomAssertion } from './custom-assertions';
import { judgeOutput, judgeWithRubric } from './judge';

export function evaluate(trace: AgentTrace, expect: Expectations): AssertionResult[] {
  const results: AssertionResult[] = [];

  const toolCalls = trace.steps.filter((s) => s.type === 'tool_call').map((s) => s.data.tool_name!);

  const outputs = trace.steps
    .filter((s) => s.type === 'output')
    .map((s) => s.data.content ?? '')
    .join('\n');

  // tool_called
  if (expect.tool_called) {
    const expected = Array.isArray(expect.tool_called) ? expect.tool_called : [expect.tool_called];
    for (const tool of expected) {
      results.push({
        name: `tool_called: ${tool}`,
        passed: toolCalls.includes(tool),
        expected: tool,
        actual: toolCalls,
        message: toolCalls.includes(tool) ? undefined : `Tool "${tool}" was not called`,
      });
    }
  }

  // tool_not_called
  if (expect.tool_not_called) {
    const forbidden = Array.isArray(expect.tool_not_called)
      ? expect.tool_not_called
      : [expect.tool_not_called];
    for (const tool of forbidden) {
      results.push({
        name: `tool_not_called: ${tool}`,
        passed: !toolCalls.includes(tool),
        expected: `not ${tool}`,
        actual: toolCalls,
        message: toolCalls.includes(tool)
          ? `Tool "${tool}" was called but should not have been`
          : undefined,
      });
    }
  }

  // output_contains
  if (expect.output_contains) {
    const needles = Array.isArray(expect.output_contains)
      ? expect.output_contains
      : [expect.output_contains];
    for (const needle of needles) {
      results.push({
        name: `output_contains: "${needle}"`,
        passed: outputs.includes(needle),
        expected: needle,
        actual: outputs.slice(0, 200),
        message: outputs.includes(needle) ? undefined : `Output does not contain "${needle}"`,
      });
    }
  }

  // output_not_contains
  if (expect.output_not_contains) {
    const forbidden = Array.isArray(expect.output_not_contains)
      ? expect.output_not_contains
      : [expect.output_not_contains];
    for (const needle of forbidden) {
      results.push({
        name: `output_not_contains: "${needle}"`,
        passed: !outputs.includes(needle),
        expected: `not "${needle}"`,
        actual: outputs.slice(0, 200),
        message: outputs.includes(needle) ? `Output contains forbidden "${needle}"` : undefined,
      });
    }
  }

  // output_matches
  if (expect.output_matches) {
    let re: RegExp;
    try {
      re = new RegExp(expect.output_matches);
    } catch (err: any) {
      results.push({
        name: `output_matches: /${expect.output_matches}/`,
        passed: false,
        expected: expect.output_matches,
        message: `Invalid regex: /${expect.output_matches}/ — ${err.message}`,
      });
      return results;
    }
    results.push({
      name: `output_matches: /${expect.output_matches}/`,
      passed: re.test(outputs),
      expected: expect.output_matches,
      actual: outputs.slice(0, 200),
    });
  }

  // max_steps
  if (expect.max_steps != null) {
    const passed = trace.steps.length <= expect.max_steps;
    results.push({
      name: `max_steps: ${expect.max_steps}`,
      passed,
      expected: `<= ${expect.max_steps}`,
      actual: trace.steps.length,
      message: passed
        ? undefined
        : `Agent took ${trace.steps.length} steps, exceeding the limit of ${expect.max_steps}.\n` +
          `  Breakdown: ${trace.steps.filter((s) => s.type === 'llm_call').length} LLM calls, ` +
          `${trace.steps.filter((s) => s.type === 'tool_call').length} tool calls, ` +
          `${trace.steps.filter((s) => s.type === 'output').length} outputs\n` +
          `  Suggestion: Agent may be stuck in a loop or making unnecessary calls`,
    });
  }

  // max_tokens
  if (expect.max_tokens != null) {
    const total = trace.steps.reduce((sum, s) => {
      const t = s.data.tokens;
      return sum + (t?.input ?? 0) + (t?.output ?? 0);
    }, 0);
    const passed = total <= expect.max_tokens;
    const inputTotal = trace.steps.reduce((s, st) => s + (st.data.tokens?.input ?? 0), 0);
    const outputTotal = trace.steps.reduce((s, st) => s + (st.data.tokens?.output ?? 0), 0);
    results.push({
      name: `max_tokens: ${expect.max_tokens}`,
      passed,
      expected: `<= ${expect.max_tokens}`,
      actual: total,
      message: passed
        ? undefined
        : `Token usage ${total} exceeds limit of ${expect.max_tokens}.\n` +
          `  Input tokens: ${inputTotal}, Output tokens: ${outputTotal}\n` +
          `  Suggestion: Consider reducing context size or using a more concise prompt`,
    });
  }

  // max_duration_ms
  if (expect.max_duration_ms != null) {
    const total = trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
    const passed = total <= expect.max_duration_ms;
    const slowest = [...trace.steps].sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))[0];
    results.push({
      name: `max_duration_ms: ${expect.max_duration_ms}`,
      passed,
      expected: `<= ${expect.max_duration_ms}ms`,
      actual: `${total}ms`,
      message: passed
        ? undefined
        : `Total duration ${total}ms exceeds limit of ${expect.max_duration_ms}ms.\n` +
          `  Slowest step: ${slowest?.type}${slowest?.data.tool_name ? ` (${slowest.data.tool_name})` : ''} at ${slowest?.duration_ms ?? 0}ms\n` +
          `  Suggestion: Check for slow tool calls or consider parallelizing operations`,
    });
  }

  // tool_sequence
  if (expect.tool_sequence) {
    const seq = expect.tool_sequence;
    let idx = 0;
    for (const call of toolCalls) {
      if (call === seq[idx]) idx++;
      if (idx === seq.length) break;
    }
    const passed = idx === seq.length;
    let message: string | undefined;
    if (!passed) {
      // Build detailed explanation
      const lines: string[] = [];
      lines.push(`Expected: ${seq.join(' → ')}`);
      lines.push(`Actual:   ${toolCalls.join(' → ')}`);

      // Find where the sequence breaks
      const positions = new Map<string, number[]>();
      toolCalls.forEach((t, i) => {
        if (!positions.has(t)) positions.set(t, []);
        positions.get(t)!.push(i);
      });

      for (let i = 0; i < seq.length; i++) {
        const tool = seq[i];
        const pos = positions.get(tool);
        if (!pos || pos.length === 0) {
          lines.push(`Issue: '${tool}' was never called`);
        } else if (i > 0) {
          const prevTool = seq[i - 1];
          const prevPos = positions.get(prevTool);
          if (prevPos && pos[0] < prevPos[0]) {
            lines.push(
              `Issue: '${tool}' was called at step ${pos[0]} but '${prevTool}' was called at step ${prevPos[0]}`,
            );
          }
        }
      }

      // Add contextual suggestion
      const missing = seq.filter((t) => !toolCalls.includes(t));
      if (missing.length > 0) {
        lines.push(`Suggestion: Tools never called: ${missing.join(', ')}`);
      } else {
        lines.push(`Suggestion: Check if the agent is calling tools in the correct order`);
      }
      message = lines.join('\n  ');
    }
    results.push({
      name: `tool_sequence: [${seq.join(' → ')}]`,
      passed,
      expected: seq,
      actual: toolCalls,
      message,
    });
  }

  // tool_args_match
  if (expect.tool_args_match) {
    for (const [toolName, expectedArgs] of Object.entries(expect.tool_args_match)) {
      const step = trace.steps.find((s) => s.type === 'tool_call' && s.data.tool_name === toolName);
      if (!step) {
        results.push({
          name: `tool_args_match: ${toolName}`,
          passed: false,
          expected: expectedArgs,
          actual: null,
          message: `Tool "${toolName}" was not called`,
        });
      } else {
        const match = deepPartialMatch(
          step.data.tool_args ?? {},
          expectedArgs as Record<string, any>,
        );
        results.push({
          name: `tool_args_match: ${toolName}`,
          passed: match,
          expected: expectedArgs,
          actual: step.data.tool_args,
          message: match
            ? undefined
            : `Tool "${toolName}" was called with unexpected arguments.\n` +
              `  Expected (partial): ${JSON.stringify(expectedArgs)}\n` +
              `  Actual: ${JSON.stringify(step.data.tool_args)}\n` +
              `  Suggestion: Verify the agent is passing the correct parameters to "${toolName}"`,
        });
      }
    }
  }

  // max_cost_usd
  if (expect.max_cost_usd != null) {
    const cost = calculateCost(trace);
    results.push({
      name: `max_cost_usd: $${expect.max_cost_usd}`,
      passed: cost.total_cost <= expect.max_cost_usd,
      expected: `<= $${expect.max_cost_usd}`,
      actual: `$${cost.total_cost.toFixed(4)}`,
      message:
        cost.total_cost > expect.max_cost_usd
          ? `Cost $${cost.total_cost.toFixed(4)} exceeds max $${expect.max_cost_usd}`
          : undefined,
    });
  }

  // not (universal negation wrapper)
  if (expect.not) {
    const negatedExpect = expect.not as Expectations;
    const inner = evaluate(trace, negatedExpect);
    for (const r of inner) {
      results.push({
        name: `not(${r.name})`,
        passed: !r.passed,
        expected: `NOT ${r.expected ?? 'pass'}`,
        actual: r.actual,
        message: !r.passed ? undefined : `Negated assertion failed: "${r.name}" should NOT have passed`,
      });
    }
  }

  // custom
  if (expect.custom) {
    try {
      const fn = new Function(
        'trace',
        'steps',
        'toolCalls',
        'outputs',
        `return (${expect.custom})`,
      );
      const result = fn(trace, trace.steps, toolCalls, outputs);
      results.push({
        name: `custom: ${expect.custom.slice(0, 60)}`,
        passed: !!result,
        actual: result,
      });
    } catch (err: any) {
      results.push({
        name: `custom: ${expect.custom.slice(0, 60)}`,
        passed: false,
        message: `Error evaluating: ${err.message}`,
      });
    }
  }

  // chain — sequential assertion that verifies a flow
  if (expect.chain && expect.chain.length > 0) {
    const chainResult = evaluateChain(trace, expect.chain);
    results.push(chainResult);
  }

  // custom_assertions — registered custom assertions
  if (expect.custom_assertions) {
    for (const ref of expect.custom_assertions) {
      results.push(evaluateCustomAssertion(ref.name, trace, ref.params));
    }
  }

  // judge — LLM-as-Judge single criterion (async, returns pending result)
  if (expect.judge) {
    const judgeSpec = expect.judge;
    const judgePending = judgeOutput(outputs, {
      criteria: judgeSpec.criteria,
      model: judgeSpec.model,
      threshold: judgeSpec.threshold,
    }).then((r) => ({
      name: `judge: "${judgeSpec.criteria}"`,
      passed: r.passed,
      expected: `score >= ${judgeSpec.threshold ?? 0.7}`,
      actual: `score=${r.score} (${r.model}${r.cached ? ', cached' : ''})`,
      message: r.passed ? undefined : `Judge score ${r.score}: ${r.reasoning}`,
    })).catch((err: any) => ({
      name: `judge: "${judgeSpec.criteria}"`,
      passed: false,
      message: `Judge error: ${err.message}`,
    }));
    (results as any).__judgePromises = (results as any).__judgePromises || [];
    (results as any).__judgePromises.push(judgePending);
  }

  // judge_rubric — LLM-as-Judge rubric-based evaluation (async)
  if (expect.judge_rubric) {
    const rubric = expect.judge_rubric;
    const rubricItems = Array.isArray(rubric) ? rubric.filter((r): r is { criterion: string; weight: number } => 'criterion' in r) : [];
    const threshold = (rubric as any).threshold ?? 0.7;
    const rubricPending = judgeWithRubric(outputs, {
      rubric: rubricItems,
      threshold,
    }).then((r) => ({
      name: `judge_rubric (${rubricItems.length} criteria)`,
      passed: r.passed,
      expected: `overall >= ${threshold}`,
      actual: `overall=${r.overallScore.toFixed(3)} (${r.model}${r.cached ? ', cached' : ''})`,
      message: r.passed ? undefined : `Rubric score ${r.overallScore.toFixed(3)}: ${r.scores.map(s => `${s.criterion}=${s.score}`).join(', ')}`,
    })).catch((err: any) => ({
      name: `judge_rubric`,
      passed: false,
      message: `Judge rubric error: ${err.message}`,
    }));
    (results as any).__judgePromises = (results as any).__judgePromises || [];
    (results as any).__judgePromises.push(rubricPending);
  }

  return results;
}

/**
 * Evaluate a chain of sequential assertions against a trace.
 */
function evaluateChain(trace: AgentTrace, chain: ChainStep[]): AssertionResult {
  // Flatten the chain (handle nested `then`)
  const steps = flattenChain(chain);
  const traceSteps = trace.steps;
  let traceIdx = 0;

  for (let i = 0; i < steps.length; i++) {
    const chainStep = steps[i];
    let found = false;

    while (traceIdx < traceSteps.length) {
      const ts = traceSteps[traceIdx];
      traceIdx++;

      if (chainStep.tool_called && ts.type === 'tool_call' && ts.data.tool_name === chainStep.tool_called) {
        found = true;
        break;
      }
      if (chainStep.output_contains && ts.type === 'output' && (ts.data.content ?? '').includes(chainStep.output_contains)) {
        found = true;
        break;
      }
    }

    if (!found) {
      const desc = chainStep.tool_called
        ? `tool_called: ${chainStep.tool_called}`
        : `output_contains: "${chainStep.output_contains}"`;
      return {
        name: `chain[${i}]: ${desc}`,
        passed: false,
        message: `Chain step ${i} failed: expected ${desc} after step ${i > 0 ? i - 1 : 'start'}`,
      };
    }
  }

  const names = steps.map((s) =>
    s.tool_called ? `tool:${s.tool_called}` : `output:"${s.output_contains}"`,
  );
  return {
    name: `chain: [${names.join(' → ')}]`,
    passed: true,
  };
}

function flattenChain(chain: ChainStep[]): ChainStep[] {
  const result: ChainStep[] = [];
  for (const step of chain) {
    result.push({ tool_called: step.tool_called, output_contains: step.output_contains });
    if (step.then) {
      result.push(...flattenChain([step.then]));
    }
  }
  return result;
}

function deepPartialMatch(actual: Record<string, any>, expected: Record<string, any>): boolean {
  for (const [key, val] of Object.entries(expected)) {
    if (!(key in actual)) return false;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      if (!deepPartialMatch(actual[key], val)) return false;
    } else if (JSON.stringify(actual[key]) !== JSON.stringify(val)) {
      return false;
    }
  }
  return true;
}
