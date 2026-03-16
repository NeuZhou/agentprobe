/**
 * Trace Export — Export traces to different formats:
 * OpenTelemetry, LangSmith, CSV.
 */

import type { AgentTrace, TraceStep } from './types';

export type ExportFormat = 'opentelemetry' | 'langsmith' | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  serviceName?: string;
}

/**
 * Export a trace to the specified format.
 */
export function exportTrace(trace: AgentTrace, options: ExportOptions): string {
  switch (options.format) {
    case 'opentelemetry':
      return exportOpenTelemetry(trace, options);
    case 'langsmith':
      return exportLangSmith(trace);
    case 'csv':
      return exportCsv(trace);
    default:
      throw new Error(`Unknown export format: ${options.format}`);
  }
}

/**
 * Export as OpenTelemetry-compatible JSON (OTLP spans).
 */
function exportOpenTelemetry(trace: AgentTrace, options: ExportOptions): string {
  const serviceName = options.serviceName ?? 'agentprobe';
  const traceId = trace.id.replace(/-/g, '').slice(0, 32).padEnd(32, '0');

  const spans = trace.steps.map((step, i) => ({
    traceId,
    spanId: generateSpanId(i),
    parentSpanId: i > 0 ? generateSpanId(0) : undefined,
    name: stepName(step),
    kind: step.type === 'llm_call' ? 3 : 1, // CLIENT : INTERNAL
    startTimeUnixNano: stepStartNano(trace, step, i),
    endTimeUnixNano: stepEndNano(trace, step, i),
    attributes: stepAttributes(step),
    status: { code: 1 }, // OK
  }));

  const otlp = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
            { key: 'agentprobe.trace.id', value: { stringValue: trace.id } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'agentprobe', version: '1.2.0' },
            spans,
          },
        ],
      },
    ],
  };

  return JSON.stringify(otlp, null, 2);
}

/**
 * Export as LangSmith-compatible run tree JSON.
 */
function exportLangSmith(trace: AgentTrace): string {
  const runs = trace.steps.map((step, i) => ({
    id: `${trace.id}-step-${i}`,
    name: stepName(step),
    run_type: langSmithRunType(step),
    inputs: step.type === 'llm_call'
      ? { messages: step.data.messages ?? [] }
      : step.type === 'tool_call'
        ? { tool: step.data.tool_name, args: step.data.tool_args }
        : { content: step.data.content },
    outputs: step.type === 'tool_result'
      ? { result: step.data.content }
      : step.type === 'output'
        ? { content: step.data.content }
        : {},
    start_time: trace.timestamp,
    end_time: trace.timestamp,
    extra: {
      tokens: step.data.tokens,
      model: step.data.model,
      duration_ms: step.duration_ms,
    },
    parent_run_id: i > 0 ? `${trace.id}-step-0` : undefined,
    trace_id: trace.id,
  }));

  return JSON.stringify({ runs }, null, 2);
}

/**
 * Export as CSV.
 */
function exportCsv(trace: AgentTrace): string {
  const headers = ['step_index', 'type', 'tool_name', 'model', 'content', 'duration_ms', 'tokens_input', 'tokens_output'];
  const rows = trace.steps.map((step, i) => [
    i,
    step.type,
    step.data.tool_name ?? '',
    step.data.model ?? '',
    csvEscape(step.data.content ?? ''),
    step.duration_ms ?? '',
    step.data.tokens?.input ?? '',
    step.data.tokens?.output ?? '',
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function generateSpanId(index: number): string {
  return index.toString(16).padStart(16, '0');
}

function stepName(step: TraceStep): string {
  if (step.data.tool_name) return `tool:${step.data.tool_name}`;
  if (step.data.model) return `llm:${step.data.model}`;
  return step.type;
}

function stepStartNano(trace: AgentTrace, _step: TraceStep, _i: number): string {
  const base = new Date(trace.timestamp).getTime() * 1_000_000;
  return base.toString();
}

function stepEndNano(trace: AgentTrace, step: TraceStep, _i: number): string {
  const base = new Date(trace.timestamp).getTime() * 1_000_000;
  const duration = (step.duration_ms ?? 0) * 1_000_000;
  return (base + duration).toString();
}

function stepAttributes(step: TraceStep): Array<{ key: string; value: any }> {
  const attrs: Array<{ key: string; value: any }> = [
    { key: 'step.type', value: { stringValue: step.type } },
  ];
  if (step.data.tool_name) {
    attrs.push({ key: 'tool.name', value: { stringValue: step.data.tool_name } });
  }
  if (step.data.model) {
    attrs.push({ key: 'llm.model', value: { stringValue: step.data.model } });
  }
  if (step.data.tokens) {
    attrs.push({ key: 'llm.tokens.input', value: { intValue: step.data.tokens.input } });
    attrs.push({ key: 'llm.tokens.output', value: { intValue: step.data.tokens.output } });
  }
  return attrs;
}

function langSmithRunType(step: TraceStep): string {
  switch (step.type) {
    case 'llm_call': return 'llm';
    case 'tool_call':
    case 'tool_result': return 'tool';
    default: return 'chain';
  }
}

/**
 * List supported export formats.
 */
export function listExportFormats(): string[] {
  return ['opentelemetry', 'langsmith', 'csv'];
}
