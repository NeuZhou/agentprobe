import type { AgentTrace, TraceStep } from '../types';

/**
 * Convert Anthropic Messages API response logs to AgentTrace.
 * Accepts a single message or array of messages.
 */
export function convertAnthropic(input: any): AgentTrace {
  const messages = Array.isArray(input) ? input : [input];
  const steps: TraceStep[] = [];

  for (const msg of messages) {
    const ts = new Date().toISOString();
    const model = msg.model ?? 'unknown';
    const usage = msg.usage;

    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (block.type === 'text') {
        steps.push({
          type: 'output',
          timestamp: ts,
          data: {
            model,
            content: block.text,
            tokens: usage ? { input: usage.input_tokens, output: usage.output_tokens } : undefined,
          },
        });
      } else if (block.type === 'tool_use') {
        steps.push({
          type: 'tool_call',
          timestamp: ts,
          data: {
            model,
            tool_name: block.name,
            tool_args: block.input ?? {},
            tokens: usage ? { input: usage.input_tokens, output: usage.output_tokens } : undefined,
          },
        });
      } else if (block.type === 'thinking') {
        steps.push({
          type: 'thought',
          timestamp: ts,
          data: {
            model,
            content: block.thinking,
          },
        });
      }
    }
  }

  return {
    id: `anthropic-${Date.now()}`,
    timestamp: steps[0]?.timestamp ?? new Date().toISOString(),
    steps,
    metadata: { source: 'anthropic', model: messages[0]?.model },
  };
}
