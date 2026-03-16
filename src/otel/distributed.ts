/**
 * Distributed Tracing for Multi-Agent scenarios — AgentProbe v4.12.0
 *
 * Enables trace context propagation across multiple agents in
 * orchestration tests, with span correlation.
 */

import type { OTelSpan } from '../otel';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  agentId: string;
  baggage: Record<string, string>;
  startTimeUnixNano: number;
  sampled: boolean;
}

export interface CorrelatedTrace {
  traceId: string;
  agents: string[];
  spans: OTelSpan[];
  rootSpan: OTelSpan;
  timeline: AgentTimeline[];
  totalDurationMs: number;
  crossAgentCalls: CrossAgentCall[];
}

export interface AgentTimeline {
  agentId: string;
  spans: OTelSpan[];
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface CrossAgentCall {
  fromAgent: string;
  toAgent: string;
  spanId: string;
  operation: string;
  durationMs: number;
}

let distTraceCounter = 0;

function genId(len: number): string {
  distTraceCounter++;
  return (Date.now().toString(16) + distTraceCounter.toString(16)).padStart(len, '0').slice(-len);
}

export class DistributedTracer {
  private traces = new Map<string, TraceContext>();
  private spans = new Map<string, OTelSpan[]>();

  /**
   * Start a new distributed trace for a test.
   */
  startTrace(testId: string): TraceContext {
    const ctx: TraceContext = {
      traceId: genId(32),
      spanId: genId(16),
      agentId: 'orchestrator',
      baggage: { 'test.id': testId },
      startTimeUnixNano: Date.now() * 1_000_000,
      sampled: true,
    };

    this.traces.set(ctx.traceId, ctx);
    this.spans.set(ctx.traceId, []);

    // Create root span
    const rootSpan: OTelSpan = {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      operationName: `distributed-test:${testId}`,
      startTimeUnixNano: ctx.startTimeUnixNano,
      endTimeUnixNano: ctx.startTimeUnixNano, // updated on correlation
      attributes: {
        'test.id': testId,
        'agent.id': 'orchestrator',
        'distributed': true,
      },
      status: { code: 'OK' },
      kind: 'SERVER',
    };

    this.spans.get(ctx.traceId)!.push(rootSpan);
    return ctx;
  }

  /**
   * Propagate trace context to a child agent.
   * Creates a new child span for the agent's work.
   */
  propagateContext(ctx: TraceContext, agentId: string): TraceContext {
    const childCtx: TraceContext = {
      traceId: ctx.traceId,
      spanId: genId(16),
      parentSpanId: ctx.spanId,
      agentId,
      baggage: { ...ctx.baggage, 'parent.agent': ctx.agentId },
      startTimeUnixNano: Date.now() * 1_000_000,
      sampled: ctx.sampled,
    };

    // Create span for this agent
    const agentSpan: OTelSpan = {
      traceId: ctx.traceId,
      spanId: childCtx.spanId,
      parentSpanId: ctx.spanId,
      operationName: `agent:${agentId}`,
      startTimeUnixNano: childCtx.startTimeUnixNano,
      endTimeUnixNano: childCtx.startTimeUnixNano, // updated later
      attributes: {
        'agent.id': agentId,
        'parent.agent': ctx.agentId,
        'distributed': true,
      },
      status: { code: 'OK' },
      kind: 'CLIENT',
    };

    if (this.spans.has(ctx.traceId)) {
      this.spans.get(ctx.traceId)!.push(agentSpan);
    }

    return childCtx;
  }

  /**
   * Record a span from an agent's work.
   */
  recordSpan(ctx: TraceContext, span: OTelSpan): void {
    const corrected: OTelSpan = {
      ...span,
      traceId: ctx.traceId,
      parentSpanId: span.parentSpanId ?? ctx.spanId,
      attributes: {
        ...span.attributes,
        'agent.id': ctx.agentId,
      },
    };

    if (this.spans.has(ctx.traceId)) {
      this.spans.get(ctx.traceId)!.push(corrected);
    }
  }

  /**
   * Complete an agent's trace context (set end time).
   */
  completeContext(ctx: TraceContext, status: 'OK' | 'ERROR' = 'OK'): void {
    const traceSpans = this.spans.get(ctx.traceId);
    if (!traceSpans) return;

    const agentSpan = traceSpans.find(s => s.spanId === ctx.spanId);
    if (agentSpan) {
      agentSpan.endTimeUnixNano = Date.now() * 1_000_000;
      agentSpan.status = { code: status };
    }
  }

  /**
   * Correlate spans across multiple trace contexts into a unified view.
   */
  correlateSpans(traces: TraceContext[]): CorrelatedTrace {
    if (traces.length === 0) {
      throw new Error('Cannot correlate empty trace list');
    }

    const traceId = traces[0].traceId;
    const allSpans = this.spans.get(traceId) ?? [];
    const agents = [...new Set(traces.map(t => t.agentId))];

    // Update root span end time
    const rootSpan = allSpans.find(s => !s.parentSpanId);
    if (rootSpan && allSpans.length > 0) {
      rootSpan.endTimeUnixNano = Math.max(...allSpans.map(s => s.endTimeUnixNano));
    }

    // Build agent timelines
    const timeline: AgentTimeline[] = agents.map(agentId => {
      const agentSpans = allSpans.filter(
        s => s.attributes['agent.id'] === agentId,
      );
      const starts = agentSpans.map(s => s.startTimeUnixNano);
      const ends = agentSpans.map(s => s.endTimeUnixNano);
      const startMs = starts.length > 0 ? Math.min(...starts) / 1_000_000 : 0;
      const endMs = ends.length > 0 ? Math.max(...ends) / 1_000_000 : 0;

      return {
        agentId,
        spans: agentSpans,
        startMs,
        endMs,
        durationMs: endMs - startMs,
      };
    });

    // Find cross-agent calls
    const crossAgentCalls: CrossAgentCall[] = [];
    for (const span of allSpans) {
      if (span.attributes['parent.agent'] && span.attributes['agent.id'] !== span.attributes['parent.agent']) {
        crossAgentCalls.push({
          fromAgent: String(span.attributes['parent.agent']),
          toAgent: String(span.attributes['agent.id']),
          spanId: span.spanId,
          operation: span.operationName,
          durationMs: (span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000,
        });
      }
    }

    const totalDurationMs = rootSpan
      ? (rootSpan.endTimeUnixNano - rootSpan.startTimeUnixNano) / 1_000_000
      : 0;

    return {
      traceId,
      agents,
      spans: allSpans,
      rootSpan: rootSpan ?? allSpans[0],
      timeline,
      totalDurationMs,
      crossAgentCalls,
    };
  }

  /**
   * Get all spans for a trace.
   */
  getSpans(traceId: string): OTelSpan[] {
    return this.spans.get(traceId) ?? [];
  }

  /**
   * Reset internal state.
   */
  reset(): void {
    this.traces.clear();
    this.spans.clear();
  }
}
