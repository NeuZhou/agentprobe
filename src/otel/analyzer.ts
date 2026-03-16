/**
 * Trace Analyzer for AgentProbe v4.12.0
 *
 * Analyzes OTel spans to detect performance issues, anomalies,
 * and generate actionable insights.
 */

import type { OTelSpan } from '../otel';

export interface Bottleneck {
  spanId: string;
  operationName: string;
  durationMs: number;
  percentOfTotal: number;
  type: 'slow-tool' | 'slow-llm' | 'slow-test' | 'queue-wait';
  suggestion: string;
}

export interface Anomaly {
  type: 'retry-storm' | 'infinite-loop' | 'error-cascade' | 'timeout' | 'unusual-duration';
  severity: 'low' | 'medium' | 'high' | 'critical';
  spanIds: string[];
  description: string;
  evidence: Record<string, any>;
}

export interface TraceAnalysis {
  totalSpans: number;
  totalDurationMs: number;
  spansByType: Record<string, number>;
  errorRate: number;
  bottlenecks: Bottleneck[];
  anomalies: Anomaly[];
  insights: string[];
  summary: string;
}

export class TraceAnalyzer {
  private spans: OTelSpan[] = [];
  private _bottlenecks: Bottleneck[] = [];
  private _anomalies: Anomaly[] = [];

  constructor() {}

  /**
   * Analyze a set of OTel spans and produce a comprehensive analysis.
   */
  analyzeSpans(spans: OTelSpan[]): TraceAnalysis {
    this.spans = spans;
    this._bottlenecks = [];
    this._anomalies = [];

    const totalDurationMs = this.calculateTotalDuration();
    const spansByType = this.categorizeSpans();
    const errorRate = this.calculateErrorRate();

    this._bottlenecks = this.findBottlenecks();
    this._anomalies = this.findAnomalies();
    const insights = this.generateInsights();

    return {
      totalSpans: spans.length,
      totalDurationMs,
      spansByType,
      errorRate,
      bottlenecks: this._bottlenecks,
      anomalies: this._anomalies,
      insights,
      summary: this.generateSummary(spans.length, totalDurationMs, errorRate, this._bottlenecks.length, this._anomalies.length),
    };
  }

  private calculateTotalDuration(): number {
    if (this.spans.length === 0) return 0;
    const minStart = Math.min(...this.spans.map(s => s.startTimeUnixNano));
    const maxEnd = Math.max(...this.spans.map(s => s.endTimeUnixNano));
    return (maxEnd - minStart) / 1_000_000;
  }

  private categorizeSpans(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const span of this.spans) {
      const type = span.operationName.split(':')[0] || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }

  private calculateErrorRate(): number {
    if (this.spans.length === 0) return 0;
    const errors = this.spans.filter(s => s.status.code === 'ERROR').length;
    return errors / this.spans.length;
  }

  /**
   * Find performance bottlenecks in the trace.
   */
  findBottlenecks(): Bottleneck[] {
    const totalMs = this.calculateTotalDuration();
    if (totalMs === 0) return [];

    const bottlenecks: Bottleneck[] = [];
    const SLOW_THRESHOLD = 0.3; // 30% of total duration

    for (const span of this.spans) {
      const durationMs = (span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000;
      const pct = durationMs / totalMs;

      if (pct >= SLOW_THRESHOLD && span.parentSpanId) {
        const type = span.operationName.startsWith('tool:')
          ? 'slow-tool'
          : span.operationName.startsWith('llm.')
          ? 'slow-llm'
          : span.operationName.startsWith('test:')
          ? 'slow-test'
          : 'queue-wait';

        bottlenecks.push({
          spanId: span.spanId,
          operationName: span.operationName,
          durationMs,
          percentOfTotal: Math.round(pct * 100),
          type,
          suggestion: this.suggestFix(type, span),
        });
      }
    }

    return bottlenecks.sort((a, b) => b.durationMs - a.durationMs);
  }

  private suggestFix(type: Bottleneck['type'], span: OTelSpan): string {
    switch (type) {
      case 'slow-tool':
        return `Tool "${span.operationName}" is slow. Consider caching results or using a faster provider.`;
      case 'slow-llm':
        return `LLM call is slow. Consider using a smaller model, reducing prompt size, or enabling streaming.`;
      case 'slow-test':
        return `Test "${span.operationName}" takes too long. Review assertions and consider splitting.`;
      case 'queue-wait':
        return `Excessive wait time detected. Check for rate limiting or resource contention.`;
    }
  }

  /**
   * Find anomalies in span patterns.
   */
  findAnomalies(): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // Detect retry storms: same operation repeated many times
    const opCounts = new Map<string, OTelSpan[]>();
    for (const span of this.spans) {
      const key = span.operationName;
      if (!opCounts.has(key)) opCounts.set(key, []);
      opCounts.get(key)!.push(span);
    }

    for (const [op, spans] of opCounts) {
      if (spans.length >= 5) {
        anomalies.push({
          type: 'retry-storm',
          severity: spans.length >= 10 ? 'critical' : 'high',
          spanIds: spans.map(s => s.spanId),
          description: `Operation "${op}" repeated ${spans.length} times — possible retry storm`,
          evidence: { operation: op, count: spans.length },
        });
      }
    }

    // Detect error cascades: multiple consecutive errors
    const errorSpans = this.spans.filter(s => s.status.code === 'ERROR');
    if (errorSpans.length >= 3) {
      anomalies.push({
        type: 'error-cascade',
        severity: errorSpans.length >= 5 ? 'critical' : 'medium',
        spanIds: errorSpans.map(s => s.spanId),
        description: `${errorSpans.length} errors detected — possible error cascade`,
        evidence: { errorCount: errorSpans.length },
      });
    }

    // Detect infinite loops: very high span count under single parent
    const parentCounts = new Map<string, number>();
    for (const span of this.spans) {
      if (span.parentSpanId) {
        parentCounts.set(span.parentSpanId, (parentCounts.get(span.parentSpanId) || 0) + 1);
      }
    }
    for (const [parentId, count] of parentCounts) {
      if (count >= 20) {
        anomalies.push({
          type: 'infinite-loop',
          severity: 'critical',
          spanIds: [parentId],
          description: `Parent span has ${count} children — possible infinite loop`,
          evidence: { parentSpanId: parentId, childCount: count },
        });
      }
    }

    // Detect unusual durations: spans > 30s
    for (const span of this.spans) {
      const durationMs = (span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000;
      if (durationMs > 30000) {
        anomalies.push({
          type: 'timeout',
          severity: durationMs > 60000 ? 'critical' : 'high',
          spanIds: [span.spanId],
          description: `Span "${span.operationName}" took ${(durationMs / 1000).toFixed(1)}s — possible timeout`,
          evidence: { durationMs, operation: span.operationName },
        });
      }
    }

    return anomalies;
  }

  /**
   * Generate human-readable insights from the analysis.
   */
  generateInsights(): string[] {
    const insights: string[] = [];
    const totalMs = this.calculateTotalDuration();
    const errorRate = this.calculateErrorRate();

    if (totalMs > 10000) {
      insights.push(`Total trace duration is ${(totalMs / 1000).toFixed(1)}s — consider optimizing slow spans.`);
    }

    if (errorRate > 0.1) {
      insights.push(`Error rate is ${(errorRate * 100).toFixed(1)}% — investigate failing operations.`);
    }

    if (errorRate === 0 && this.spans.length > 0) {
      insights.push('All spans completed successfully — no errors detected.');
    }

    // Tool call analysis
    const toolSpans = this.spans.filter(s => s.operationName.startsWith('tool:'));
    if (toolSpans.length > 0) {
      const avgToolMs = toolSpans.reduce((sum, s) =>
        sum + (s.endTimeUnixNano - s.startTimeUnixNano) / 1_000_000, 0) / toolSpans.length;
      insights.push(`Average tool call duration: ${avgToolMs.toFixed(0)}ms across ${toolSpans.length} calls.`);
    }

    // Bottleneck insights
    for (const b of this._bottlenecks.slice(0, 3)) {
      insights.push(`Bottleneck: ${b.operationName} uses ${b.percentOfTotal}% of total time.`);
    }

    // Anomaly insights
    for (const a of this._anomalies.slice(0, 3)) {
      insights.push(`${a.severity.toUpperCase()}: ${a.description}`);
    }

    return insights;
  }

  private generateSummary(totalSpans: number, totalMs: number, errorRate: number, bottleneckCount: number, anomalyCount: number): string {
    const status = errorRate > 0.2 ? '⚠️ Unhealthy' : errorRate > 0 ? '🔶 Degraded' : '✅ Healthy';
    return `${status} | ${totalSpans} spans | ${(totalMs / 1000).toFixed(2)}s | ${(errorRate * 100).toFixed(1)}% errors | ${bottleneckCount} bottlenecks | ${anomalyCount} anomalies`;
  }
}
