import type { AgentTrace, TraceStep } from '../types';

/**
 * Convert OpenAI API chat completion response logs to AgentTrace.
 * Accepts a single completion or array of completions.
 */
export function convertOpenAI(input: any): AgentTrace {
  const completions = Array.isArray(input) ? input : [input];
  const steps: TraceStep[] = [];

  for (const completion of completions) {
    const ts = completion.created
      ? new Date(completion.created * 1000).toISOString()
      : new Date().toISOString();
    const model = completion.model ?? 'unknown';
    const usage = completion.usage;

    for (const choice of completion.choices ?? []) {
      const msg = choice.message ?? choice.delta ?? {};

      // Tool calls
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          steps.push({
            type: 'tool_call',
            timestamp: ts,
            data: {
              model,
              tool_name: tc.function?.name,
              tool_args: safeParse(tc.function?.arguments),
              tokens: usage ? { input: usage.prompt_tokens, output: usage.completion_tokens } : undefined,
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
            tokens: usage ? { input: usage.prompt_tokens, output: usage.completion_tokens } : undefined,
          },
        });
      }
    }
  }

  return {
    id: `openai-${Date.now()}`,
    timestamp: steps[0]?.timestamp ?? new Date().toISOString(),
    steps,
    metadata: { source: 'openai', model: completions[0]?.model },
  };
}

function safeParse(s: any): Record<string, any> | undefined {
  if (!s) return undefined;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return { raw: s }; }
}
