import type { AgentTrace, TraceStep } from '../types';

/**
 * Convert LangSmith/LangChain trace runs to AgentTrace.
 * Accepts a single run or array of runs.
 */
export function convertLangChain(input: any): AgentTrace {
  const runs = Array.isArray(input) ? input : [input];
  const steps: TraceStep[] = [];

  for (const run of runs) {
    const ts = run.start_time ?? run.startTime ?? new Date().toISOString();
    const endTs = run.end_time ?? run.endTime;
    const duration = endTs ? new Date(endTs).getTime() - new Date(ts).getTime() : undefined;

    if (run.type === 'llm' || run.run_type === 'llm') {
      const output = run.outputs?.generations?.[0]?.[0] ?? run.outputs;
      const tokens = run.outputs?.llm_output?.token_usage ?? run.token_usage;
      steps.push({
        type: 'llm_call',
        timestamp: ts,
        duration_ms: duration,
        data: {
          model: run.serialized?.kwargs?.model_name ?? run.name ?? 'unknown',
          content: output?.text ?? output?.message?.content ?? JSON.stringify(output),
          tokens: tokens
            ? { input: tokens.prompt_tokens, output: tokens.completion_tokens }
            : undefined,
        },
      });
    } else if (run.type === 'tool' || run.run_type === 'tool') {
      steps.push({
        type: 'tool_call',
        timestamp: ts,
        duration_ms: duration,
        data: {
          tool_name: run.name ?? run.serialized?.name ?? 'unknown',
          tool_args: run.inputs ?? {},
        },
      });
      if (run.outputs) {
        steps.push({
          type: 'tool_result',
          timestamp: endTs ?? ts,
          data: {
            tool_name: run.name ?? 'unknown',
            tool_result: run.outputs?.output ?? run.outputs,
          },
        });
      }
    } else if (run.type === 'chain' || run.run_type === 'chain') {
      if (run.outputs?.output) {
        steps.push({
          type: 'output',
          timestamp: endTs ?? ts,
          duration_ms: duration,
          data: { content: String(run.outputs.output) },
        });
      }
    }

    // Recurse into child runs
    if (run.child_runs?.length) {
      const childTrace = convertLangChain(run.child_runs);
      steps.push(...childTrace.steps);
    }
  }

  return {
    id: `langchain-${Date.now()}`,
    timestamp: steps[0]?.timestamp ?? new Date().toISOString(),
    steps,
    metadata: { source: 'langchain' },
  };
}
