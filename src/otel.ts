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
            'service.version': '3.1.0',
          },
        },
        scopeSpans: [
          {
            scope: { name: 'agentprobe', version: '3.1.0' },
            spans,
          },
        ],
      },
    ],
  };
}

// ============================================================
// OTelExporter class — stateful exporter with config
// ============================================================

export interface OTelExporterConfig {
  endpoint?: string;
  serviceName?: string;
  format?: OTelFormat;
}

export type OTelFormat = 'otlp-grpc' | 'otlp-http' | 'jaeger' | 'zipkin';

// ============================================================
// Metrics types
// ============================================================

export interface OTelMetric {
  name: string;
  description: string;
  unit: string;
  value: number;
  type: 'gauge' | 'counter' | 'histogram';
  attributes: Record<string, string | number | boolean>;
  timestamp: number;
}

export interface OTelMetricsExport {
  resourceMetrics: Array<{
    resource: { attributes: Record<string, string> };
    scopeMetrics: Array<{
      scope: { name: string; version: string };
      metrics: OTelMetric[];
    }>;
  }>;
}

// ============================================================
// Jaeger / Zipkin format types
// ============================================================

export interface JaegerSpan {
  traceID: string;
  spanID: string;
  parentSpanID?: string;
  operationName: string;
  startTime: number; // microseconds
  duration: number;  // microseconds
  tags: Array<{ key: string; type: string; value: string | number | boolean }>;
  process: { serviceName: string; tags: Array<{ key: string; value: string }> };
}

export interface ZipkinSpan {
  traceId: string;
  id: string;
  parentId?: string;
  name: string;
  timestamp: number; // microseconds
  duration: number;  // microseconds
  kind: 'CLIENT' | 'SERVER' | 'PRODUCER' | 'CONSUMER';
  localEndpoint: { serviceName: string };
  tags: Record<string, string>;
}

// ============================================================
// Format converters
// ============================================================

/**
 * Convert OTel spans to Jaeger format.
 */
export function toJaegerSpans(spans: OTelSpan[], serviceName = 'agentprobe'): JaegerSpan[] {
  return spans.map((span) => ({
    traceID: span.traceId,
    spanID: span.spanId,
    parentSpanID: span.parentSpanId,
    operationName: span.operationName,
    startTime: Math.floor(span.startTimeUnixNano / 1000),
    duration: Math.floor((span.endTimeUnixNano - span.startTimeUnixNano) / 1000),
    tags: Object.entries(span.attributes).map(([key, value]) => ({
      key,
      type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'float64' : 'string',
      value,
    })),
    process: {
      serviceName,
      tags: [{ key: 'service.version', value: '4.1.0' }],
    },
  }));
}

/**
 * Convert OTel spans to Zipkin format.
 */
export function toZipkinSpans(spans: OTelSpan[], serviceName = 'agentprobe'): ZipkinSpan[] {
  return spans.map((span) => ({
    traceId: span.traceId,
    id: span.spanId,
    parentId: span.parentSpanId,
    name: span.operationName,
    timestamp: Math.floor(span.startTimeUnixNano / 1000),
    duration: Math.floor((span.endTimeUnixNano - span.startTimeUnixNano) / 1000),
    kind: span.kind === 'CLIENT' ? 'CLIENT' : span.kind === 'SERVER' ? 'SERVER' : 'CLIENT',
    localEndpoint: { serviceName },
    tags: Object.fromEntries(
      Object.entries(span.attributes).map(([k, v]) => [k, String(v)]),
    ),
  }));
}

import type { SuiteResult } from './types';

/**
 * Stateful OpenTelemetry exporter.
 * Maps agent steps → spans, tool calls → child spans.
 * Adds cost, tokens, model as span attributes.
 */
export class OTelExporter {
  private config: OTelExporterConfig;

  private format: OTelFormat;

  constructor(config: OTelExporterConfig = {}) {
    this.config = {
      endpoint: config.endpoint ?? 'http://localhost:4318/v1/traces',
      serviceName: config.serviceName ?? 'agentprobe',
    };
    this.format = config.format ?? 'otlp-http';
  }

  get endpoint(): string {
    return this.config.endpoint!;
  }

  get serviceName(): string {
    return this.config.serviceName!;
  }

  /**
   * Export a single trace as OTel spans.
   */
  exportTrace(trace: AgentTrace): OTelSpan[] {
    return traceToOTel(trace, this.config.serviceName);
  }

  /**
   * Export an entire suite result as OTel spans.
   * Creates a root span for the suite, with child spans per test,
   * and nested spans for each test's trace steps.
   */
  exportSuiteResult(result: SuiteResult): OTelSpan[] {
    const allSpans: OTelSpan[] = [];
    const suiteTraceId = Math.abs(
      result.name.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0),
    )
      .toString(16)
      .padStart(32, '0');

    const suiteSpanId = generateSpanId();
    const suiteStart = Date.now() * 1_000_000;
    const suiteEnd = suiteStart + result.duration_ms * 1_000_000;

    // Suite root span
    allSpans.push({
      traceId: suiteTraceId,
      spanId: suiteSpanId,
      operationName: `suite:${result.name}`,
      startTimeUnixNano: suiteStart,
      endTimeUnixNano: suiteEnd,
      attributes: {
        'agentprobe.suite.name': result.name,
        'agentprobe.suite.total': result.total,
        'agentprobe.suite.passed': result.passed,
        'agentprobe.suite.failed': result.failed,
        'agentprobe.suite.duration_ms': result.duration_ms,
      },
      status: { code: result.failed > 0 ? 'ERROR' : 'OK' },
      kind: 'SERVER',
    });

    // Per-test spans
    for (const testResult of result.results) {
      const testSpanId = generateSpanId();
      const testStart = suiteStart;
      const testEnd = testStart + testResult.duration_ms * 1_000_000;

      allSpans.push({
        traceId: suiteTraceId,
        spanId: testSpanId,
        parentSpanId: suiteSpanId,
        operationName: `test:${testResult.name}`,
        startTimeUnixNano: testStart,
        endTimeUnixNano: testEnd,
        attributes: {
          'agentprobe.test.name': testResult.name,
          'agentprobe.test.passed': testResult.passed,
          'agentprobe.test.duration_ms': testResult.duration_ms,
          'agentprobe.test.assertions': testResult.assertions.length,
        },
        status: {
          code: testResult.passed ? 'OK' : 'ERROR',
          message: testResult.error,
        },
        kind: 'INTERNAL',
      });

      // If test has a trace, add step spans as children
      if (testResult.trace) {
        const stepSpans = traceToOTel(testResult.trace, this.config.serviceName);
        // Re-parent root span under the test span
        for (const span of stepSpans) {
          if (!span.parentSpanId) {
            span.parentSpanId = testSpanId;
          }
          span.traceId = suiteTraceId;
          allSpans.push(span);
        }
      }
    }

    return allSpans;
  }

  /**
   * Build OTLP JSON payload from spans.
   */
  toOTLP(spans: OTelSpan[]): OTelExport {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: {
              'service.name': this.config.serviceName!,
              'service.version': '4.1.0',
            },
          },
          scopeSpans: [
            {
              scope: { name: 'agentprobe', version: '4.1.0' },
              spans,
            },
          ],
        },
      ],
    };
  }

  /**
   * Convert trace to OTel spans (alias for exportTrace).
   */
  toOTelSpans(trace: AgentTrace): OTelSpan[] {
    return this.exportTrace(trace);
  }

  /**
   * Export metrics from a SuiteResult.
   */
  exportMetrics(suiteResult: SuiteResult): OTelMetricsExport {
    const now = Date.now();
    const metrics: OTelMetric[] = [
      {
        name: 'agentprobe.tests.total',
        description: 'Total number of tests',
        unit: '1',
        value: suiteResult.total,
        type: 'gauge',
        attributes: { 'suite.name': suiteResult.name },
        timestamp: now,
      },
      {
        name: 'agentprobe.tests.passed',
        description: 'Number of passed tests',
        unit: '1',
        value: suiteResult.passed,
        type: 'gauge',
        attributes: { 'suite.name': suiteResult.name },
        timestamp: now,
      },
      {
        name: 'agentprobe.tests.failed',
        description: 'Number of failed tests',
        unit: '1',
        value: suiteResult.failed,
        type: 'gauge',
        attributes: { 'suite.name': suiteResult.name },
        timestamp: now,
      },
      {
        name: 'agentprobe.tests.duration',
        description: 'Suite duration',
        unit: 'ms',
        value: suiteResult.duration_ms,
        type: 'gauge',
        attributes: { 'suite.name': suiteResult.name },
        timestamp: now,
      },
      {
        name: 'agentprobe.tests.pass_rate',
        description: 'Pass rate',
        unit: '%',
        value: suiteResult.total > 0 ? (suiteResult.passed / suiteResult.total) * 100 : 0,
        type: 'gauge',
        attributes: { 'suite.name': suiteResult.name },
        timestamp: now,
      },
    ];

    return {
      resourceMetrics: [
        {
          resource: {
            attributes: {
              'service.name': this.config.serviceName!,
              'service.version': '4.1.0',
            },
          },
          scopeMetrics: [
            {
              scope: { name: 'agentprobe', version: '4.1.0' },
              metrics,
            },
          ],
        },
      ],
    };
  }

  /**
   * Convert spans to Jaeger format.
   */
  toJaeger(spans: OTelSpan[]): JaegerSpan[] {
    return toJaegerSpans(spans, this.config.serviceName);
  }

  /**
   * Convert spans to Zipkin format.
   */
  toZipkin(spans: OTelSpan[]): ZipkinSpan[] {
    return toZipkinSpans(spans, this.config.serviceName);
  }

  /**
   * Get the configured format.
   */
  getFormat(): OTelFormat {
    return this.format;
  }
}
