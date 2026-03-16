import type { AgentTrace, TraceStep } from '../types';

/**
 * Convert Ollama API chat response logs to AgentTrace.
 * Accepts a single response or array of responses.
 */
export function convertOllama(input: any): AgentTrace {
  const responses = Array.isArray(input) ? input : [input];
  const steps: TraceStep[] = [];

  for (const resp of responses) {
    const ts = resp.created_at ?? new Date().toISOString();
    const model = resp.model ?? 'unknown';
    const usage = resp.prompt_eval_count != null || resp.eval_count != null
      ? { input: resp.prompt_eval_count, output: resp.eval_count }
      : undefined;

    const msg = resp.message;
    if (!msg) continue;

    // Tool calls
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        steps.push({
          type: 'tool_call',
          timestamp: ts,
          data: {
            model,
            tool_name: tc.function?.name,
            tool_args: tc.function?.arguments,
            tokens: usage,
          },
        });
      }
    }

    // Text content
    if (msg.content) {
      steps.push({
        type: 'output',
        timestamp: ts,
        data: {
          model,
          content: msg.content,
          tokens: usage,
        },
      });
    }
  }

  return {
    id: `ollama-${Date.now()}`,
    timestamp: steps[0]?.timestamp ?? new Date().toISOString(),
    steps,
    metadata: { source: 'ollama', model: responses[0]?.model },
  };
}

/**
 * Detect Ollama response format.
 */
export function detectOllama(input: any): boolean {
  if (Array.isArray(input)) return input.some((i) => i?.model && i?.message && i?.done !== undefined);
  return !!input?.model && !!input?.message && input?.done !== undefined;
}
