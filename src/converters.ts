/**
 * Trace Format Converters — Convert between different trace formats
 *
 * Supports: AgentProbe, LangSmith, OpenTelemetry, Arize, custom
 *
 * @example
 * ```bash
 * agentprobe convert trace.json --from agentprobe --to langsmith
 * agentprobe convert trace.json --from agentprobe --to opentelemetry
 * ```
 */

import type { AgentTrace, TraceStep } from './types';
import * as crypto from 'crypto';

export type TraceFormat = 'agentprobe' | 'langsmith' | 'opentelemetry' | 'arize' | 'custom';

// ===== LangSmith format =====

export interface LangSmithRun {
  id: string;
  name: string;
  run_type: 'chain' | 'llm' | 'tool';
  start_time: string;
  end_time?: string;
  inputs: Record<string, any>;
  outputs?: Record<string, any>;
  parent_run_id?: string;
  extra?: Record<string, any>;
  tags?: string[];
  error?: string;
}

export interface LangSmithTrace {
  runs: LangSmithRun[];
}

// ===== OpenTelemetry format =====

export interface OTelSpanSimple {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number; // 0=INTERNAL, 1=SERVER, 2=CLIENT
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string } }>;
  status: { code: number };
}

export interface OTelTrace {
  resourceSpans: Array<{
    resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
    scopeSpans: Array<{
      scope: { name: string };
      spans: OTelSpanSimple[];
    }>;
  }>;
}

// ===== Arize format =====

export interface ArizeSpan {
  name: string;
  span_kind: 'LLM' | 'TOOL' | 'CHAIN' | 'AGENT';
  start_time: string;
  end_time?: string;
  attributes: Record<string, any>;
  events: Array<{ name: string; timestamp: string; attributes: Record<string, any> }>;
  context: { trace_id: string; span_id: string };
  parent_id?: string;
  status_code: 'OK' | 'ERROR' | 'UNSET';
}

export interface ArizeTrace {
  spans: ArizeSpan[];
}

// ===== Converters =====

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * Convert AgentProbe trace → LangSmith format.
 */
export function toLangSmith(trace: AgentTrace): LangSmithTrace {
  const runs: LangSmithRun[] = [];
  const rootId = trace.id;

  // Root chain run
  runs.push({
    id: rootId,
    name: 'agent_run',
    run_type: 'chain',
    start_time: trace.timestamp,
    inputs: { trace_id: trace.id },
    outputs: {},
    tags: ['agentprobe'],
  });

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    const runId = `${rootId}-step-${i}`;
    const duration = step.duration_ms ?? 0;
    const endTime = new Date(new Date(step.timestamp).getTime() + duration).toISOString();

    switch (step.type) {
      case 'llm_call':
        runs.push({
          id: runId,
          name: step.data.model ?? 'llm',
          run_type: 'llm',
          start_time: step.timestamp,
          end_time: endTime,
          inputs: { messages: step.data.messages ?? [] },
          outputs: {},
          parent_run_id: rootId,
          extra: { tokens: step.data.tokens },
        });
        break;
      case 'tool_call':
        runs.push({
          id: runId,
          name: step.data.tool_name ?? 'unknown_tool',
          run_type: 'tool',
          start_time: step.timestamp,
          end_time: endTime,
          inputs: step.data.tool_args ?? {},
          outputs: {},
          parent_run_id: rootId,
        });
        break;
      case 'tool_result':
        // Merge with previous tool_call run if exists
        if (runs.length > 0 && runs[runs.length - 1].run_type === 'tool') {
          runs[runs.length - 1].outputs = { result: step.data.tool_result };
          runs[runs.length - 1].end_time = endTime;
        }
        break;
      case 'output':
        runs.push({
          id: runId,
          name: 'output',
          run_type: 'chain',
          start_time: step.timestamp,
          end_time: endTime,
          inputs: {},
          outputs: { content: step.data.content },
          parent_run_id: rootId,
        });
        break;
    }
  }

  // Set root end time
  if (runs.length > 1) {
    runs[0].end_time = runs[runs.length - 1].end_time;
    runs[0].outputs = { steps: trace.steps.length };
  }

  return { runs };
}

/**
 * Convert AgentProbe trace → OpenTelemetry format.
 */
export function toOpenTelemetry(trace: AgentTrace): OTelTrace {
  const traceId = trace.id.replace(/-/g, '').padEnd(32, '0').slice(0, 32);
  const rootSpanId = generateId();
  const spans: OTelSpanSimple[] = [];

  const startNano = (new Date(trace.timestamp).getTime() * 1_000_000).toString();
  let lastEndNano = startNano;

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    const spanId = generateId();
    const stepStartNano = (new Date(step.timestamp).getTime() * 1_000_000).toString();
    const durationNano = ((step.duration_ms ?? 0) * 1_000_000).toString();
    const stepEndNano = (BigInt(stepStartNano) + BigInt(durationNano)).toString();
    lastEndNano = stepEndNano;

    const attrs: Array<{ key: string; value: { stringValue?: string; intValue?: string } }> = [
      { key: 'agentprobe.step.type', value: { stringValue: step.type } },
    ];
    if (step.data.model) attrs.push({ key: 'llm.model', value: { stringValue: step.data.model } });
    if (step.data.tool_name) attrs.push({ key: 'tool.name', value: { stringValue: step.data.tool_name } });
    if (step.data.tokens?.input != null) attrs.push({ key: 'llm.tokens.input', value: { intValue: String(step.data.tokens.input) } });

    spans.push({
      traceId,
      spanId,
      parentSpanId: rootSpanId,
      name: step.type === 'tool_call' ? `tool:${step.data.tool_name}` : step.type,
      kind: step.type === 'llm_call' ? 2 : 0,
      startTimeUnixNano: stepStartNano,
      endTimeUnixNano: stepEndNano,
      attributes: attrs,
      status: { code: 0 },
    });
  }

  // Root span
  spans.unshift({
    traceId,
    spanId: rootSpanId,
    name: 'agent.run',
    kind: 1,
    startTimeUnixNano: startNano,
    endTimeUnixNano: lastEndNano,
    attributes: [
      { key: 'agentprobe.trace.id', value: { stringValue: trace.id } },
    ],
    status: { code: 0 },
  });

  return {
    resourceSpans: [{
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'agentprobe' } }],
      },
      scopeSpans: [{
        scope: { name: 'agentprobe' },
        spans,
      }],
    }],
  };
}

/**
 * Convert AgentProbe trace → Arize format.
 */
export function toArize(trace: AgentTrace): ArizeTrace {
  const traceId = trace.id;
  const rootSpanId = generateId();
  const spans: ArizeSpan[] = [];

  // Root span
  spans.push({
    name: 'agent_run',
    span_kind: 'AGENT',
    start_time: trace.timestamp,
    attributes: { 'agentprobe.trace.id': trace.id },
    events: [],
    context: { trace_id: traceId, span_id: rootSpanId },
    status_code: 'OK',
  });

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    const spanId = generateId();
    const duration = step.duration_ms ?? 0;
    const endTime = new Date(new Date(step.timestamp).getTime() + duration).toISOString();

    const spanKind: ArizeSpan['span_kind'] =
      step.type === 'llm_call' ? 'LLM' :
      step.type === 'tool_call' || step.type === 'tool_result' ? 'TOOL' : 'CHAIN';

    const attrs: Record<string, any> = { step_type: step.type };
    if (step.data.model) attrs['llm.model_name'] = step.data.model;
    if (step.data.tool_name) attrs['tool.name'] = step.data.tool_name;
    if (step.data.tokens) {
      attrs['llm.token_count.prompt'] = step.data.tokens.input ?? 0;
      attrs['llm.token_count.completion'] = step.data.tokens.output ?? 0;
    }

    spans.push({
      name: step.data.tool_name ?? step.data.model ?? step.type,
      span_kind: spanKind,
      start_time: step.timestamp,
      end_time: endTime,
      attributes: attrs,
      events: [],
      context: { trace_id: traceId, span_id: spanId },
      parent_id: rootSpanId,
      status_code: 'OK',
    });
  }

  // Set root end time
  if (spans.length > 1) {
    spans[0].end_time = spans[spans.length - 1].end_time;
  }

  return { spans };
}

/**
 * Convert LangSmith format → AgentProbe trace.
 */
export function fromLangSmith(ls: LangSmithTrace): AgentTrace {
  const rootRun = ls.runs.find(r => !r.parent_run_id) ?? ls.runs[0];
  const steps: TraceStep[] = [];

  for (const run of ls.runs) {
    if (run.id === rootRun?.id) continue;

    switch (run.run_type) {
      case 'llm':
        steps.push({
          type: 'llm_call',
          timestamp: run.start_time,
          data: {
            model: run.name,
            messages: run.inputs?.messages,
            tokens: run.extra?.tokens,
          },
          duration_ms: run.end_time ? new Date(run.end_time).getTime() - new Date(run.start_time).getTime() : undefined,
        });
        break;
      case 'tool':
        steps.push({
          type: 'tool_call',
          timestamp: run.start_time,
          data: {
            tool_name: run.name,
            tool_args: run.inputs,
          },
          duration_ms: run.end_time ? new Date(run.end_time).getTime() - new Date(run.start_time).getTime() : undefined,
        });
        if (run.outputs) {
          steps.push({
            type: 'tool_result',
            timestamp: run.end_time ?? run.start_time,
            data: {
              tool_name: run.name,
              tool_result: run.outputs.result ?? run.outputs,
            },
          });
        }
        break;
      case 'chain':
        if (run.outputs?.content) {
          steps.push({
            type: 'output',
            timestamp: run.start_time,
            data: { content: run.outputs.content },
            duration_ms: run.end_time ? new Date(run.end_time).getTime() - new Date(run.start_time).getTime() : undefined,
          });
        }
        break;
    }
  }

  return {
    id: rootRun?.id ?? crypto.randomUUID(),
    timestamp: rootRun?.start_time ?? new Date().toISOString(),
    steps,
    metadata: { source: 'langsmith', original_tags: rootRun?.tags },
  };
}

/**
 * Convert OpenTelemetry format → AgentProbe trace.
 */
export function fromOpenTelemetry(otel: OTelTrace): AgentTrace {
  const spans = otel.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
  const rootSpan = spans.find(s => !s.parentSpanId) ?? spans[0];
  const steps: TraceStep[] = [];

  for (const span of spans) {
    if (span.spanId === rootSpan?.spanId) continue;

    const attrMap: Record<string, string> = {};
    for (const attr of span.attributes) {
      attrMap[attr.key] = attr.value.stringValue ?? attr.value.intValue ?? '';
    }

    const stepType = attrMap['agentprobe.step.type'] as TraceStep['type'] ??
      (span.name.startsWith('tool:') ? 'tool_call' :
       span.kind === 2 ? 'llm_call' : 'output');

    const startMs = Number(BigInt(span.startTimeUnixNano) / BigInt(1_000_000));
    const endMs = Number(BigInt(span.endTimeUnixNano) / BigInt(1_000_000));

    steps.push({
      type: stepType,
      timestamp: new Date(startMs).toISOString(),
      data: {
        model: attrMap['llm.model'],
        tool_name: attrMap['tool.name'] ?? (span.name.startsWith('tool:') ? span.name.slice(5) : undefined),
        tokens: attrMap['llm.tokens.input'] ? {
          input: parseInt(attrMap['llm.tokens.input']),
          output: parseInt(attrMap['llm.tokens.output'] ?? '0'),
        } : undefined,
      },
      duration_ms: endMs - startMs,
    });
  }

  const traceId = rootSpan?.traceId ?? crypto.randomUUID();

  return {
    id: traceId,
    timestamp: rootSpan ? new Date(Number(BigInt(rootSpan.startTimeUnixNano) / BigInt(1_000_000))).toISOString() : new Date().toISOString(),
    steps,
    metadata: { source: 'opentelemetry' },
  };
}

/**
 * Convert between any two supported formats.
 */
export function convertTrace(
  input: any,
  from: TraceFormat,
  to: TraceFormat,
): any {
  // First convert to AgentProbe format
  let agentTrace: AgentTrace;

  switch (from) {
    case 'agentprobe':
      agentTrace = input as AgentTrace;
      break;
    case 'langsmith':
      agentTrace = fromLangSmith(input as LangSmithTrace);
      break;
    case 'opentelemetry':
      agentTrace = fromOpenTelemetry(input as OTelTrace);
      break;
    case 'arize':
      // Arize → AgentProbe: basic conversion
      agentTrace = fromArize(input as ArizeTrace);
      break;
    default:
      throw new Error(`Unsupported source format: ${from}`);
  }

  // Then convert from AgentProbe to target format
  switch (to) {
    case 'agentprobe':
      return agentTrace;
    case 'langsmith':
      return toLangSmith(agentTrace);
    case 'opentelemetry':
      return toOpenTelemetry(agentTrace);
    case 'arize':
      return toArize(agentTrace);
    default:
      throw new Error(`Unsupported target format: ${to}`);
  }
}

/**
 * Convert Arize format → AgentProbe trace.
 */
export function fromArize(arize: ArizeTrace): AgentTrace {
  const rootSpan = arize.spans.find(s => !s.parent_id) ?? arize.spans[0];
  const steps: TraceStep[] = [];

  for (const span of arize.spans) {
    if (span.context.span_id === rootSpan?.context.span_id) continue;

    const stepType: TraceStep['type'] =
      span.span_kind === 'LLM' ? 'llm_call' :
      span.span_kind === 'TOOL' ? 'tool_call' : 'output';

    const durationMs = span.end_time
      ? new Date(span.end_time).getTime() - new Date(span.start_time).getTime()
      : undefined;

    steps.push({
      type: stepType,
      timestamp: span.start_time,
      data: {
        model: span.attributes['llm.model_name'],
        tool_name: span.attributes['tool.name'] ?? (stepType === 'tool_call' ? span.name : undefined),
        tokens: span.attributes['llm.token_count.prompt'] != null ? {
          input: span.attributes['llm.token_count.prompt'],
          output: span.attributes['llm.token_count.completion'] ?? 0,
        } : undefined,
      },
      duration_ms: durationMs,
    });
  }

  return {
    id: rootSpan?.context.trace_id ?? crypto.randomUUID(),
    timestamp: rootSpan?.start_time ?? new Date().toISOString(),
    steps,
    metadata: { source: 'arize' },
  };
}

/**
 * List supported formats.
 */
export function listFormats(): TraceFormat[] {
  return ['agentprobe', 'langsmith', 'opentelemetry', 'arize', 'custom'];
}

/**
 * Detect the format of a trace object.
 */
export function detectFormat(obj: any): TraceFormat | null {
  if (obj?.steps && obj?.id && obj?.timestamp) return 'agentprobe';
  if (obj?.runs && Array.isArray(obj.runs)) return 'langsmith';
  if (obj?.resourceSpans) return 'opentelemetry';
  if (obj?.spans && Array.isArray(obj.spans) && obj.spans[0]?.span_kind) return 'arize';
  return null;
}
