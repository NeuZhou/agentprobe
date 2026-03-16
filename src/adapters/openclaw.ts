import type { AgentTrace, TraceStep } from '../types';

/**
 * OpenClaw session trace adapter.
 * Converts OpenClaw session history (messages with tool calls) to AgentTrace.
 */

interface OpenClawMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
  timestamp?: string;
  duration_ms?: number;
  tokens?: { input?: number; output?: number };
  model?: string;
}

interface OpenClawSession {
  id?: string;
  session_id?: string;
  messages?: OpenClawMessage[];
  history?: OpenClawMessage[];
  metadata?: Record<string, any>;
  created_at?: string;
  timestamp?: string;
}

/**
 * Detect if input is an OpenClaw session trace.
 */
export function detectOpenClaw(input: any): boolean {
  if (!input || typeof input !== 'object') return false;
  // OpenClaw sessions have messages/history arrays with role-based messages
  const messages = input.messages || input.history;
  if (!Array.isArray(messages)) return false;
  // Check for OpenClaw-specific patterns: session_id or messages with tool_calls
  if (input.session_id) return true;
  // Check if messages have the assistant+tool_calls pattern typical of OpenClaw
  return messages.some(
    (m: any) =>
      m.role === 'assistant' &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.some((tc: any) => tc?.function?.name)
  );
}

/**
 * Convert OpenClaw session trace to AgentTrace.
 */
export function convertOpenClaw(input: OpenClawSession): AgentTrace {
  const messages = input.messages || input.history || [];
  const steps: TraceStep[] = [];
  const now = new Date().toISOString();

  for (const msg of messages) {
    const ts = msg.timestamp || now;

    switch (msg.role) {
      case 'system':
        // Skip system messages (they're context, not steps)
        break;

      case 'user':
        steps.push({
          type: 'output',
          timestamp: ts,
          data: { content: msg.content || '' },
        });
        break;

      case 'assistant':
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Assistant made tool calls
          for (const tc of msg.tool_calls) {
            let args: Record<string, any> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = { _raw: tc.function.arguments };
            }
            steps.push({
              type: 'tool_call',
              timestamp: ts,
              data: {
                tool_name: tc.function.name,
                tool_args: args,
                model: msg.model,
                tokens: msg.tokens,
              },
              duration_ms: msg.duration_ms,
            });
          }
        }
        if (msg.content) {
          steps.push({
            type: 'output',
            timestamp: ts,
            data: {
              content: msg.content,
              model: msg.model,
              tokens: msg.tokens,
            },
            duration_ms: msg.duration_ms,
          });
        }
        // If assistant message with no content and no tool_calls, record as LLM call
        if (!msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
          steps.push({
            type: 'llm_call',
            timestamp: ts,
            data: { model: msg.model, tokens: msg.tokens },
            duration_ms: msg.duration_ms,
          });
        }
        break;

      case 'tool':
        steps.push({
          type: 'tool_result',
          timestamp: ts,
          data: {
            tool_name: msg.name,
            tool_result: msg.content,
          },
        });
        break;
    }
  }

  return {
    id: input.id || input.session_id || `openclaw-${Date.now()}`,
    timestamp: input.created_at || input.timestamp || now,
    steps,
    metadata: {
      source: 'openclaw',
      ...input.metadata,
    },
  };
}
