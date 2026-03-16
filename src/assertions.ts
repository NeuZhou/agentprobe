import type { AgentTrace, Expectations, AssertionResult } from './types';

export function evaluate(trace: AgentTrace, expect: Expectations): AssertionResult[] {
  const results: AssertionResult[] = [];

  const toolCalls = trace.steps
    .filter(s => s.type === 'tool_call')
    .map(s => s.data.tool_name!);

  const outputs = trace.steps
    .filter(s => s.type === 'output')
    .map(s => s.data.content ?? '')
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
    const forbidden = Array.isArray(expect.tool_not_called) ? expect.tool_not_called : [expect.tool_not_called];
    for (const tool of forbidden) {
      results.push({
        name: `tool_not_called: ${tool}`,
        passed: !toolCalls.includes(tool),
        expected: `not ${tool}`,
        actual: toolCalls,
        message: toolCalls.includes(tool) ? `Tool "${tool}" was called but should not have been` : undefined,
      });
    }
  }

  // output_contains
  if (expect.output_contains) {
    const needles = Array.isArray(expect.output_contains) ? expect.output_contains : [expect.output_contains];
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
    const forbidden = Array.isArray(expect.output_not_contains) ? expect.output_not_contains : [expect.output_not_contains];
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
    const re = new RegExp(expect.output_matches);
    results.push({
      name: `output_matches: /${expect.output_matches}/`,
      passed: re.test(outputs),
      expected: expect.output_matches,
      actual: outputs.slice(0, 200),
    });
  }

  // max_steps
  if (expect.max_steps != null) {
    results.push({
      name: `max_steps: ${expect.max_steps}`,
      passed: trace.steps.length <= expect.max_steps,
      expected: `<= ${expect.max_steps}`,
      actual: trace.steps.length,
    });
  }

  // max_tokens
  if (expect.max_tokens != null) {
    const total = trace.steps.reduce((sum, s) => {
      const t = s.data.tokens;
      return sum + (t?.input ?? 0) + (t?.output ?? 0);
    }, 0);
    results.push({
      name: `max_tokens: ${expect.max_tokens}`,
      passed: total <= expect.max_tokens,
      expected: `<= ${expect.max_tokens}`,
      actual: total,
    });
  }

  // max_duration_ms
  if (expect.max_duration_ms != null) {
    const total = trace.steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
    results.push({
      name: `max_duration_ms: ${expect.max_duration_ms}`,
      passed: total <= expect.max_duration_ms,
      expected: `<= ${expect.max_duration_ms}ms`,
      actual: `${total}ms`,
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
    results.push({
      name: `tool_sequence: [${seq.join(' → ')}]`,
      passed: idx === seq.length,
      expected: seq,
      actual: toolCalls,
    });
  }

  // tool_args_match
  if (expect.tool_args_match) {
    for (const [toolName, expectedArgs] of Object.entries(expect.tool_args_match)) {
      const step = trace.steps.find(s => s.type === 'tool_call' && s.data.tool_name === toolName);
      if (!step) {
        results.push({
          name: `tool_args_match: ${toolName}`,
          passed: false,
          expected: expectedArgs,
          actual: null,
          message: `Tool "${toolName}" was not called`,
        });
      } else {
        const match = deepPartialMatch(step.data.tool_args ?? {}, expectedArgs as Record<string, any>);
        results.push({
          name: `tool_args_match: ${toolName}`,
          passed: match,
          expected: expectedArgs,
          actual: step.data.tool_args,
        });
      }
    }
  }

  // custom
  if (expect.custom) {
    try {
      const fn = new Function('trace', 'steps', 'toolCalls', 'outputs', `return (${expect.custom})`);
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

  return results;
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
