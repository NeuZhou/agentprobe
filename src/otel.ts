import type { AgentTrace, TraceStep } from './types';
import { calculateCost } from './cost';

/**
 * OpenTelemetry span representation.
 */
export interface OTelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  attributes: Record<string, string | number | boolean>;
  status: { code: 'OK' | 'ERROR'; message?: string };
  kind: 'INTERNAL' | 'CLIENT' | 'SERVER';
}

export interface OTelExport {
  resourceSpans: Array<{
    resource: { attributes: Record<string, string> };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: OTelSpan[];
    }>;
  }>;
}

let spanCounter = 0;

function generateSpanId(): string {
  spanCounter++;
  const hex = (Date.now().toString(16) + spanCounter.toString(16)).padStart(16, '0');
  return hex.slice(-16);
}

function generateTraceId(trace: AgentTrace): string {
  // Deterministic from trace id
  const hash = trace.id.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  return Math.abs(hash).toString(16).padStart(32, '0');
}

function stepToAttributes(step: TraceStep): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    'agentprobe.step.type': step.type,
  };

  if (step.data.model) attrs['llm.model'] = step.data.model;
  if (step.data.tokens?.input != null) attrs['llm.tokens.input'] = step.data.tokens.input;
  if (step.data.tokens?.output != null) attrs['llm.tokens.output'] = step.data.tokens.output;
  if (step.data.tool_name) attrs['tool.name'] = step.data.tool_name;
  if (step.data.tool_args) attrs['tool.args'] = JSON.stringify(step.data.tool_args);
  if (step.duration_ms != null) attrs['duration_ms'] = step.duration_ms;

  return attrs;
}

/**
 * Convert an AgentTrace to OpenTelemetry spans.
 *
 * LLM calls become root-level spans, tool calls become child spans
 * of the most recent LLM call.
 */
export function traceToOTel(trace: AgentTrace, _serviceName = 'agentprobe'): OTelSpan[] {
  const traceId = generateTraceId(trace);
  const spans: OTelSpan[] = [];
  const cost = calculateCost(trace);

  // Root span for the entire trace
  const rootSpanId = generateSpanId();
  const startNano = new Date(trace.timestamp).getTime() * 1_000_000;
  let endNano = startNano;

  let currentLlmSpanId: string | undefined;

  for (const step of trace.steps) {
    const stepStart = new Date(step.timestamp).getTime() * 1_000_000;
    const durationNano = (step.duration_ms ?? 0) * 1_000_000;
    const stepEnd = stepStart + durationNano;
    if (stepEnd > endNano) endNano = stepEnd;

    const spanId = generateSpanId();
    const attrs = stepToAttributes(step);

    if (step.type === 'llm_call') {
      currentLlmSpanId = spanId;
      spans.push({
        traceId,
        spanId,
        parentSpanId: rootSpanId,
        operationName: `llm.call${step.data.model ? `:${step.data.model}` : ''}`,
        startTimeUnixNano: stepStart,
        endTimeUnixNano: stepEnd,
        attributes: attrs,
        status: { code: 'OK' },
        kind: 'CLIENT',
      });
    } else if (step.type === 'tool_call') {
      spans.push({
        traceId,
        spanId,
        parentSpanId: currentLlmSpanId ?? rootSpanId,
        operationName: `tool.call:${step.data.tool_name ?? 'unknown'}`,
        startTimeUnixNano: stepStart,
        endTimeUnixNano: stepEnd,
        attributes: attrs,
        status: { code: 'OK' },
        kind: 'INTERNAL',
      });
    } else {
      spans.push({
        traceId,
        spanId,
        parentSpanId: currentLlmSpanId ?? rootSpanId,
        operationName: step.type,
        startTimeUnixNano: stepStart,
        endTimeUnixNano: stepEnd,
        attributes: attrs,
        status: { code: 'OK' },
        kind: 'INTERNAL',
      });
    }
  }

  // Add root span
  spans.unshift({
    traceId,
    spanId: rootSpanId,
    operationName: `agent.run:${trace.id}`,
    startTimeUnixNano: startNano,
    endTimeUnixNano: endNano,
    attributes: {
      'agentprobe.trace.id': trace.id,
      'agentprobe.trace.steps': trace.steps.length,
      'agentprobe.cost.total': cost.total_cost,
    },
    status: { code: 'OK' },
    kind: 'SERVER',
  });

  return spans;
}

/**
 * Export trace as OTLP-compatible JSON payload.
 */
export function traceToOTLP(trace: AgentTrace, serviceName = 'agentprobe'): OTelExport {
  const spans = traceToOTel(trace, serviceName);
  return {
    resourceSpans: [
      {
        resource: {
          attributes: {
            'service.name': serviceName,
            'service.version': '1.5.0',
          },
        },
        scopeSpans: [
          {
            scope: { name: 'agentprobe', version: '1.5.0' },
            spans,
          },
        ],
      },
    ],
  };
}
