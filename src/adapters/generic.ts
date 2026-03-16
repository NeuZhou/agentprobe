import type { AgentTrace, TraceStep, StepType } from '../types';

/**
 * Convert JSONL log entries to AgentTrace.
 * Each line/entry should have at least an `event` or `msg` field.
 * Accepts array of log entries or a newline-delimited string.
 */
export function convertGeneric(input: any): AgentTrace {
  let entries: any[];

  if (typeof input === 'string') {
    entries = input.split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } else if (Array.isArray(input)) {
    entries = input;
  } else {
    entries = [input];
  }

  const steps: TraceStep[] = [];

  for (const entry of entries) {
    const event = entry.event ?? entry.type ?? entry.msg ?? 'unknown';
    const ts = entry.timestamp ?? entry.ts ?? entry.time ?? new Date().toISOString();

    const stepType = mapEventType(event);

    steps.push({
      type: stepType,
      timestamp: typeof ts === 'number' ? new Date(ts).toISOString() : ts,
      duration_ms: entry.duration_ms ?? entry.duration ?? undefined,
      data: {
        model: entry.model,
        tool_name: entry.tool ?? entry.tool_name ?? entry.function,
        tool_args: entry.args ?? entry.tool_args ?? entry.input,
        tool_result: entry.result ?? entry.output ?? entry.response,
        content: entry.content ?? entry.text ?? entry.message ?? entry.msg,
        tokens: entry.tokens ?? (entry.input_tokens != null ? {
          input: entry.input_tokens,
          output: entry.output_tokens,
        } : undefined),
      },
    });
  }

  return {
    id: `generic-${Date.now()}`,
    timestamp: steps[0]?.timestamp ?? new Date().toISOString(),
    steps,
    metadata: { source: 'generic' },
  };
}

function mapEventType(event: string): StepType {
  const e = event.toLowerCase();
  if (e.includes('tool_call') || e.includes('function_call') || e.includes('tool_use')) return 'tool_call';
  if (e.includes('tool_result') || e.includes('function_result')) return 'tool_result';
  if (e.includes('llm') || e.includes('completion') || e.includes('chat')) return 'llm_call';
  if (e.includes('think') || e.includes('reason')) return 'thought';
  if (e.includes('output') || e.includes('response') || e.includes('answer')) return 'output';
  return 'output';
}
