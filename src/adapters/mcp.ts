import type { AgentTrace, TraceStep } from '../types';

/**
 * Convert MCP (Model Context Protocol) tool call traces to AgentTrace.
 *
 * MCP defines a standard protocol for LLM tool/resource interactions.
 * Traces capture JSON-RPC style tool calls, resource reads, and prompt completions.
 *
 * Expected input shape (single trace or array):
 * {
 *   session_id?: string,
 *   events: [{
 *     type: 'tools/call' | 'tools/result' | 'resources/read' | 'resources/result' |
 *            'prompts/get' | 'completion' | 'error',
 *     method?: string,
 *     params?: { name?: string, arguments?: any, uri?: string },
 *     result?: any,
 *     error?: { code?: number, message: string },
 *     timestamp?: string,
 *     duration_ms?: number,
 *     model?: string,
 *     tokens?: { input?: number, output?: number },
 *   }],
 *   server?: { name?: string, version?: string },
 *   metadata?: Record<string, any>,
 *   created_at?: string,
 * }
 */
export function convertMCP(input: any): AgentTrace {
  const traces = Array.isArray(input) ? input : [input];
  const steps: TraceStep[] = [];

  for (const trace of traces) {
    for (const event of trace.events ?? []) {
      const ts = event.timestamp ?? trace.created_at ?? new Date().toISOString();
      const type = event.type ?? event.method;

      if (type === 'tools/call' || type === 'tools/list') {
        steps.push({
          type: 'tool_call',
          timestamp: ts,
          data: {
            model: event.model,
            tool_name: event.params?.name ?? event.params?.method ?? type,
            tool_args: event.params?.arguments ?? event.params,
            tokens: event.tokens,
          },
          duration_ms: event.duration_ms,
        });
      } else if (type === 'tools/result') {
        steps.push({
          type: 'tool_result',
          timestamp: ts,
          data: {
            tool_name: event.params?.name,
            tool_result: event.result,
          },
          duration_ms: event.duration_ms,
        });
      } else if (type === 'resources/read') {
        steps.push({
          type: 'tool_call',
          timestamp: ts,
          data: {
            tool_name: 'resource_read',
            tool_args: { uri: event.params?.uri },
          },
        });
      } else if (type === 'resources/result') {
        steps.push({
          type: 'tool_result',
          timestamp: ts,
          data: {
            tool_name: 'resource_read',
            tool_result: event.result,
          },
        });
      } else if (type === 'completion' || type === 'prompts/get') {
        steps.push({
          type: 'llm_call',
          timestamp: ts,
          data: {
            model: event.model,
            content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
            tokens: event.tokens,
          },
          duration_ms: event.duration_ms,
        });
      } else if (type === 'error') {
        steps.push({
          type: 'output',
          timestamp: ts,
          data: {
            content: `Error${event.error?.code ? ` (${event.error.code})` : ''}: ${event.error?.message ?? 'Unknown error'}`,
          },
        });
      }
    }
  }

  return {
    id: `mcp-${Date.now()}`,
    timestamp: steps[0]?.timestamp ?? new Date().toISOString(),
    steps,
    metadata: {
      source: 'mcp',
      session_id: traces[0]?.session_id,
      server: traces[0]?.server,
      ...traces[0]?.metadata,
    },
  };
}

/**
 * Detect MCP trace format.
 */
export function detectMCP(input: any): boolean {
  if (Array.isArray(input)) return input.some(isMCP);
  return isMCP(input);
}

function isMCP(input: any): boolean {
  if (!input?.events || !Array.isArray(input.events)) return false;
  const mcpTypes = ['tools/call', 'tools/result', 'resources/read', 'resources/result', 'prompts/get', 'completion'];
  return input.events.some(
    (e: any) => mcpTypes.includes(e.type) || mcpTypes.includes(e.method) || !!input.server,
  );
}
