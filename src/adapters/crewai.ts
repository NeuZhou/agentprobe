import type { AgentTrace, TraceStep } from '../types';

/**
 * Convert CrewAI trace/log output to AgentTrace.
 *
 * CrewAI is a Python multi-agent orchestration framework. Its JSON trace output
 * typically contains task executions with agent assignments, tool usage, and LLM calls.
 *
 * Expected input shape (single trace or array):
 * {
 *   crew_id?: string,
 *   tasks: [{
 *     task_id: string,
 *     description?: string,
 *     agent?: string,
 *     status?: string,
 *     output?: string,
 *     tools_used?: [{ name: string, input: any, output: any, error?: string }],
 *     llm_calls?: [{ model?: string, prompt?: string, response?: string, tokens?: { input: number, output: number } }],
 *     started_at?: string,
 *     finished_at?: string,
 *     error?: string,
 *   }],
 *   metadata?: Record<string, any>,
 *   created_at?: string,
 * }
 */
export function convertCrewAI(input: any): AgentTrace {
  const traces = Array.isArray(input) ? input : [input];
  const steps: TraceStep[] = [];

  for (const trace of traces) {
    for (const task of trace.tasks ?? []) {
      const ts = task.started_at ?? trace.created_at ?? new Date().toISOString();

      // LLM calls
      for (const llm of task.llm_calls ?? []) {
        steps.push({
          type: 'llm_call',
          timestamp: ts,
          data: {
            model: llm.model ?? 'unknown',
            content: llm.response,
            messages: llm.prompt
              ? [{ role: 'user', content: llm.prompt }]
              : undefined,
            tokens: llm.tokens,
          },
        });
      }

      // Tool calls
      for (const tool of task.tools_used ?? []) {
        steps.push({
          type: 'tool_call',
          timestamp: ts,
          data: {
            tool_name: tool.name,
            tool_args: typeof tool.input === 'object' ? tool.input : { input: tool.input },
          },
        });

        if (tool.output !== undefined || tool.error) {
          steps.push({
            type: 'tool_result',
            timestamp: ts,
            data: {
              tool_name: tool.name,
              tool_result: tool.error ? { error: tool.error } : tool.output,
            },
          });
        }
      }

      // Task output
      if (task.output) {
        steps.push({
          type: 'output',
          timestamp: task.finished_at ?? ts,
          data: {
            content: task.output,
          },
          duration_ms: task.started_at && task.finished_at
            ? new Date(task.finished_at).getTime() - new Date(task.started_at).getTime()
            : undefined,
        });
      }

      // Task error
      if (task.error) {
        steps.push({
          type: 'output',
          timestamp: task.finished_at ?? ts,
          data: {
            content: `Error: ${task.error}`,
          },
        });
      }
    }
  }

  return {
    id: `crewai-${Date.now()}`,
    timestamp: steps[0]?.timestamp ?? new Date().toISOString(),
    steps,
    metadata: {
      source: 'crewai',
      crew_id: traces[0]?.crew_id,
      ...traces[0]?.metadata,
    },
  };
}

/**
 * Detect CrewAI trace format.
 */
export function detectCrewAI(input: any): boolean {
  if (Array.isArray(input)) return input.some(isCrewAI);
  return isCrewAI(input);
}

function isCrewAI(input: any): boolean {
  return (
    !!input?.tasks &&
    Array.isArray(input.tasks) &&
    (!!input.crew_id || input.tasks.some((t: any) => t.agent || t.tools_used))
  );
}
