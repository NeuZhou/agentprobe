import type { AgentTrace, TraceStep } from '../types';

/**
 * Convert Microsoft AutoGen trace/log output to AgentTrace.
 *
 * AutoGen is a multi-agent conversation framework. Its traces capture
 * agent messages, tool executions, and LLM calls within group chats.
 *
 * Expected input shape (single trace or array):
 * {
 *   session_id?: string,
 *   messages: [{
 *     sender: string,
 *     receiver?: string,
 *     content?: string,
 *     role?: string,
 *     tool_calls?: [{ id: string, function: { name: string, arguments: string } }],
 *     tool_responses?: [{ tool_call_id: string, content: string }],
 *     timestamp?: string,
 *     model?: string,
 *     usage?: { prompt_tokens: number, completion_tokens: number },
 *   }],
 *   summary?: string,
 *   metadata?: Record<string, any>,
 *   created_at?: string,
 * }
 */
export function convertAutoGen(input: any): AgentTrace {
  const traces = Array.isArray(input) ? input : [input];
  const steps: TraceStep[] = [];

  for (const trace of traces) {
    for (const msg of trace.messages ?? []) {
      const ts = msg.timestamp ?? trace.created_at ?? new Date().toISOString();
      const model = msg.model ?? 'unknown';

      // Tool calls from assistant messages
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          steps.push({
            type: 'tool_call',
            timestamp: ts,
            data: {
              model,
              tool_name: tc.function?.name ?? tc.name,
              tool_args: safeParse(tc.function?.arguments ?? tc.arguments),
              tokens: msg.usage
                ? { input: msg.usage.prompt_tokens, output: msg.usage.completion_tokens }
                : undefined,
            },
          });
        }
      }

      // Tool responses
      if (msg.tool_responses?.length) {
        for (const tr of msg.tool_responses) {
          steps.push({
            type: 'tool_result',
            timestamp: ts,
            data: {
              tool_name: tr.tool_call_id,
              tool_result: tr.content,
            },
          });
        }
      }

      // LLM output / agent message content
      if (msg.content && !msg.tool_responses?.length) {
        const isLlm = msg.role === 'assistant' || msg.usage;
        steps.push({
          type: isLlm ? 'llm_call' : 'output',
          timestamp: ts,
          data: {
            model: isLlm ? model : undefined,
            content: msg.content,
            tokens: msg.usage
              ? { input: msg.usage.prompt_tokens, output: msg.usage.completion_tokens }
              : undefined,
          },
        });
      }
    }
  }

  return {
    id: `autogen-${Date.now()}`,
    timestamp: steps[0]?.timestamp ?? new Date().toISOString(),
    steps,
    metadata: {
      source: 'autogen',
      session_id: traces[0]?.session_id,
      ...traces[0]?.metadata,
    },
  };
}

/**
 * Detect AutoGen trace format.
 */
export function detectAutoGen(input: any): boolean {
  if (Array.isArray(input)) return input.some(isAutoGen);
  return isAutoGen(input);
}

function isAutoGen(input: any): boolean {
  if (!input?.messages || !Array.isArray(input.messages)) return false;
  return input.messages.some(
    (m: any) => m.sender !== undefined || m.tool_responses !== undefined || !!input.session_id,
  );
}

function safeParse(s: any): Record<string, any> | undefined {
  if (!s) return undefined;
  if (typeof s === 'object') return s;
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}
