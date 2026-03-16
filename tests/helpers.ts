import type { AgentTrace, TraceStep } from '../src/types';

export function makeTrace(steps: Partial<TraceStep>[] = [], metadata: Record<string, any> = {}): AgentTrace {
  return {
    id: `test-${Date.now()}`,
    timestamp: new Date().toISOString(),
    steps: steps.map(s => ({
      type: s.type ?? 'tool_call',
      timestamp: s.timestamp ?? new Date().toISOString(),
      data: s.data ?? {},
      duration_ms: s.duration_ms ?? 10,
    })),
    metadata,
  };
}

export function toolCall(name: string, args: Record<string, any> = {}, duration_ms = 10): Partial<TraceStep> {
  return { type: 'tool_call', data: { tool_name: name, tool_args: args }, duration_ms };
}

export function output(content: string): Partial<TraceStep> {
  return { type: 'output', data: { content } };
}

export function llmCall(tokens?: { input?: number; output?: number }): Partial<TraceStep> {
  return { type: 'llm_call', data: { tokens } };
}
