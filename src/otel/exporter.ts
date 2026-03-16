/**
 * Enhanced OTel Trace Exporter for AgentProbe v4.12.0
 *
 * Maps test runs to OTel spans with rich attributes:
 * - Each test → span
 * - Each tool call → child span
 * - Attributes: test.name, test.status, agent.model, agent.cost, agent.tokens
 */

import type { SuiteResult, TestResult, AgentTrace } from '../types';
import type { OTelSpan, OTelExport } from '../otel';

let exporterSpanCounter = 0;

function genSpanId(): string {
  exporterSpanCounter++;
  return (Date.now().toString(16) + exporterSpanCounter.toString(16)).padStart(16, '0').slice(-16);
}

function genTraceId(seed: string): string {
  const hash = seed.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  return Math.abs(hash).toString(16).padStart(32, '0');
}

export interface TestResults {
  suite: SuiteResult;
  metadata?: {
    model?: string;
    totalCost?: number;
    totalTokens?: number;
  };
}

export interface AgentProbeExporterConfig {
  endpoint?: string;
  serviceName?: string;
  headers?: Record<string, string>;
  batchSize?: number;
  timeout?: number;
}

export class AgentProbeExporter {
  private config: Required<Pick<AgentProbeExporterConfig, 'endpoint' | 'serviceName'>> & AgentProbeExporterConfig;

  constructor(config: AgentProbeExporterConfig = {}) {
    this.config = {
      ...config,
      endpoint: config.endpoint ?? 'http://localhost:4318/v1/traces',
      serviceName: config.serviceName ?? 'agentprobe',
    };
  }

  get endpoint(): string {
    return this.config.endpoint;
  }

  get serviceName(): string {
    return this.config.serviceName;
  }

  /**
   * Convert a test run into OTel spans.
   * Each test becomes a span, each tool call within a test trace becomes a child span.
   */
  exportTestRun(results: TestResults): OTelSpan[] {
    const { suite, metadata } = results;
    const traceId = genTraceId(suite.name + Date.now());
    const spans: OTelSpan[] = [];

    const rootSpanId = genSpanId();
    const rootStart = Date.now() * 1_000_000;
    const rootEnd = rootStart + suite.duration_ms * 1_000_000;

    // Root span for the entire test run
    spans.push({
      traceId,
      spanId: rootSpanId,
      operationName: `test-run:${suite.name}`,
      startTimeUnixNano: rootStart,
      endTimeUnixNano: rootEnd,
      attributes: {
        'test.suite': suite.name,
        'test.total': suite.total,
        'test.passed': suite.passed,
        'test.failed': suite.failed,
        ...(metadata?.model ? { 'agent.model': metadata.model } : {}),
        ...(metadata?.totalCost != null ? { 'agent.cost': metadata.totalCost } : {}),
        ...(metadata?.totalTokens != null ? { 'agent.tokens': metadata.totalTokens } : {}),
      },
      status: { code: suite.failed > 0 ? 'ERROR' : 'OK' },
      kind: 'SERVER',
    });

    let offset = 0;
    for (const test of suite.results) {
      const testSpans = this.testToSpans(test, traceId, rootSpanId, rootStart + offset * 1_000_000);
      spans.push(...testSpans);
      offset += test.duration_ms;
    }

    return spans;
  }

  private testToSpans(test: TestResult, traceId: string, parentSpanId: string, startNano: number): OTelSpan[] {
    const spans: OTelSpan[] = [];
    const testSpanId = genSpanId();
    const endNano = startNano + test.duration_ms * 1_000_000;

    // Test span
    spans.push({
      traceId,
      spanId: testSpanId,
      parentSpanId,
      operationName: `test:${test.name}`,
      startTimeUnixNano: startNano,
      endTimeUnixNano: endNano,
      attributes: {
        'test.name': test.name,
        'test.status': test.passed ? 'passed' : 'failed',
        'test.duration_ms': test.duration_ms,
        'test.assertions': test.assertions.length,
        ...(test.error ? { 'test.error': test.error } : {}),
        ...(test.tags ? { 'test.tags': test.tags.join(',') } : {}),
      },
      status: {
        code: test.passed ? 'OK' : 'ERROR',
        message: test.error,
      },
      kind: 'INTERNAL',
    });

    // Tool call child spans from trace
    if (test.trace) {
      const toolSpans = this.traceToToolSpans(test.trace, traceId, testSpanId, startNano);
      spans.push(...toolSpans);
    }

    // Assertion span
    if (test.assertions.length > 0) {
      const assertSpanId = genSpanId();
      const assertStart = endNano - 100_000; // 0.1ms before end
      spans.push({
        traceId,
        spanId: assertSpanId,
        parentSpanId: testSpanId,
        operationName: 'assertion',
        startTimeUnixNano: assertStart,
        endTimeUnixNano: endNano,
        attributes: {
          'assertion.count': test.assertions.length,
          'assertion.passed': test.assertions.filter(a => a.passed).length,
          'assertion.failed': test.assertions.filter(a => !a.passed).length,
        },
        status: {
          code: test.assertions.every(a => a.passed) ? 'OK' : 'ERROR',
        },
        kind: 'INTERNAL',
      });
    }

    return spans;
  }

  private traceToToolSpans(trace: AgentTrace, traceId: string, parentSpanId: string, baseNano: number): OTelSpan[] {
    const spans: OTelSpan[] = [];
    let currentOffset = 0;

    for (const step of trace.steps) {
      if (step.type !== 'tool_call') continue;

      const spanId = genSpanId();
      const duration = (step.duration_ms ?? 0) * 1_000_000;
      const start = baseNano + currentOffset * 1_000_000;

      spans.push({
        traceId,
        spanId,
        parentSpanId,
        operationName: `tool:${step.data.tool_name ?? 'unknown'}`,
        startTimeUnixNano: start,
        endTimeUnixNano: start + duration,
        attributes: {
          'tool.name': step.data.tool_name ?? 'unknown',
          ...(step.data.tool_args ? { 'tool.args': JSON.stringify(step.data.tool_args) } : {}),
          ...(step.duration_ms != null ? { 'tool.duration_ms': step.duration_ms } : {}),
        },
        status: { code: 'OK' },
        kind: 'CLIENT',
      });

      currentOffset += step.duration_ms ?? 0;
    }

    return spans;
  }

  /**
   * Pretty-print traces to console format.
   */
  exportToConsole(results: TestResults): string {
    const spans = this.exportTestRun(results);
    const lines: string[] = [];
    const rootSpan = spans[0];

    lines.push(`\n🔍 Trace: ${rootSpan.operationName}`);
    lines.push(`   TraceID: ${rootSpan.traceId}`);
    lines.push(`   Duration: ${((rootSpan.endTimeUnixNano - rootSpan.startTimeUnixNano) / 1_000_000_000).toFixed(2)}s`);
    lines.push('');

    // Group child spans by parent
    const childSpans = spans.filter(s => s.parentSpanId === rootSpan.spanId);
    for (const testSpan of childSpans) {
      const durationSec = ((testSpan.endTimeUnixNano - testSpan.startTimeUnixNano) / 1_000_000_000).toFixed(1);
      const status = testSpan.status.code === 'OK' ? '✅' : '❌';
      const bar = '─'.repeat(Math.max(1, Math.min(20, Math.round(parseFloat(durationSec) * 10))));
      lines.push(`├─ ${status} ${testSpan.operationName} ${bar} ${durationSec}s`);

      // Tool call children
      const toolSpans = spans.filter(s => s.parentSpanId === testSpan.spanId);
      for (let i = 0; i < toolSpans.length; i++) {
        const ts = toolSpans[i];
        const tDur = ((ts.endTimeUnixNano - ts.startTimeUnixNano) / 1_000_000_000).toFixed(1);
        const tBar = '─'.repeat(Math.max(1, Math.min(15, Math.round(parseFloat(tDur) * 10))));
        const prefix = i === toolSpans.length - 1 ? '└─' : '├─';
        lines.push(`│  ${prefix} ${ts.operationName} ${tBar} ${tDur}s`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Export as JSON object (OTLP format).
   */
  exportToJSON(results: TestResults): OTelExport {
    const spans = this.exportTestRun(results);
    return {
      resourceSpans: [
        {
          resource: {
            attributes: {
              'service.name': this.config.serviceName,
              'service.version': '4.12.0',
            },
          },
          scopeSpans: [
            {
              scope: { name: 'agentprobe', version: '4.12.0' },
              spans,
            },
          ],
        },
      ],
    };
  }

  /**
   * Send traces to an OTLP collector via HTTP.
   */
  async exportToOTLP(results: TestResults): Promise<void> {
    const payload = this.exportToJSON(results);
    const timeout = this.config.timeout ?? 10000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OTLP export failed: ${response.status} ${response.statusText}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
