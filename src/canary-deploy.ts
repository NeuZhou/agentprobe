/**
 * Canary Deployment Testing - Compare baseline vs canary agent versions safely.
 *
 * @example
 * ```bash
 * agentprobe canary-compare baseline.json canary.json --thresholds thresholds.yaml
 * ```
 */

import type { SuiteResult } from './types';

// ===== Types =====

export interface CanaryMetrics {
  passRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
  safetyScore: number;
  errorRate: number;
}

export interface CanaryThresholds {
  maxPassRateDrop: number;       // e.g. 0.05 = 5% drop allowed
  maxLatencyIncrease: number;    // e.g. 0.2 = 20% increase allowed
  maxCostIncrease: number;       // e.g. 0.1 = 10% increase allowed
  minSafetyScore: number;        // e.g. 0.95
  maxErrorRateIncrease: number;  // e.g. 0.02
}

export interface MetricComparison {
  metric: string;
  baseline: number;
  canary: number;
  delta: number;
  deltaPercent: number;
  status: 'improved' | 'degraded' | 'unchanged';
}

export interface CanaryReport {
  timestamp: string;
  baselineName: string;
  canaryName: string;
  metrics: {
    baseline: CanaryMetrics;
    canary: CanaryMetrics;
  };
  comparisons: MetricComparison[];
  recommendation: 'promote' | 'rollback' | 'extend';
  confidence: number;  // 0-1
  reasons: string[];
}

// ===== Defaults =====

export const DEFAULT_THRESHOLDS: CanaryThresholds = {
  maxPassRateDrop: 0.05,
  maxLatencyIncrease: 0.20,
  maxCostIncrease: 0.10,
  minSafetyScore: 0.95,
  maxErrorRateIncrease: 0.02,
};

// ===== Core Functions =====

/**
 * Extract metrics from a suite result.
 */
export function extractMetrics(suite: SuiteResult): CanaryMetrics {
  const total = suite.total || 1;
  const passRate = suite.passed / total;
  const durations = suite.results.map(r => r.duration_ms).filter(d => d > 0);
  const sorted = [...durations].sort((a, b) => a - b);
  const avgLatencyMs = durations.length > 0
    ? durations.reduce((s, d) => s + d, 0) / durations.length
    : 0;
  const p95Idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const p95LatencyMs = sorted.length > 0 ? sorted[p95Idx] : 0;
  const errorRate = suite.failed / total;

  // Safety score from traces — estimate from assertions
  const safetyResults = suite.results.filter(r =>
    r.assertions.some(a => a.name.includes('safety') || a.name.includes('pii') || a.name.includes('security'))
  );
  const safetyPassed = safetyResults.filter(r => r.passed).length;
  const safetyScore = safetyResults.length > 0 ? safetyPassed / safetyResults.length : 1.0;

  // Cost estimation from trace token counts
  let totalCostUsd = 0;
  for (const r of suite.results) {
    if (r.trace) {
      for (const step of r.trace.steps) {
        const tokens = step.data?.tokens;
        if (tokens) {
          totalCostUsd += ((tokens.input || 0) * 0.000003) + ((tokens.output || 0) * 0.000015);
        }
      }
    }
  }

  return { passRate, avgLatencyMs, p95LatencyMs, totalCostUsd, safetyScore, errorRate };
}

/**
 * Compare a single metric.
 */
function compareMetric(name: string, baseline: number, canary: number): MetricComparison {
  const delta = canary - baseline;
  const deltaPercent = baseline !== 0 ? delta / baseline : (canary !== 0 ? 1 : 0);
  const threshold = 0.01;
  let status: MetricComparison['status'] = 'unchanged';

  // For passRate and safetyScore, higher is better
  if (name === 'passRate' || name === 'safetyScore') {
    if (deltaPercent > threshold) status = 'improved';
    else if (deltaPercent < -threshold) status = 'degraded';
  } else {
    // For latency, cost, errorRate — lower is better
    if (deltaPercent < -threshold) status = 'improved';
    else if (deltaPercent > threshold) status = 'degraded';
  }

  return { metric: name, baseline, canary, delta, deltaPercent, status };
}

/**
 * Compare baseline and canary suite results.
 */
export function compare(baseline: SuiteResult, canary: SuiteResult): CanaryReport {
  const baseMetrics = extractMetrics(baseline);
  const canaryMetrics = extractMetrics(canary);

  const comparisons: MetricComparison[] = [
    compareMetric('passRate', baseMetrics.passRate, canaryMetrics.passRate),
    compareMetric('avgLatencyMs', baseMetrics.avgLatencyMs, canaryMetrics.avgLatencyMs),
    compareMetric('p95LatencyMs', baseMetrics.p95LatencyMs, canaryMetrics.p95LatencyMs),
    compareMetric('totalCostUsd', baseMetrics.totalCostUsd, canaryMetrics.totalCostUsd),
    compareMetric('safetyScore', baseMetrics.safetyScore, canaryMetrics.safetyScore),
    compareMetric('errorRate', baseMetrics.errorRate, canaryMetrics.errorRate),
  ];

  const degraded = comparisons.filter(c => c.status === 'degraded');
  const improved = comparisons.filter(c => c.status === 'improved');

  // Confidence based on sample size
  const sampleSize = Math.min(baseline.total, canary.total);
  const confidence = Math.min(1, sampleSize / 100);

  const reasons: string[] = [];
  let recommendation: CanaryReport['recommendation'] = 'promote';

  if (degraded.length >= 3) {
    recommendation = 'rollback';
    reasons.push(`${degraded.length} metrics degraded`);
  } else if (degraded.length > 0) {
    recommendation = 'extend';
    reasons.push(`${degraded.length} metric(s) degraded: ${degraded.map(d => d.metric).join(', ')}`);
  }

  if (improved.length > 0) {
    reasons.push(`${improved.length} metric(s) improved: ${improved.map(d => d.metric).join(', ')}`);
  }

  if (sampleSize < 10) {
    recommendation = 'extend';
    reasons.push(`Low sample size (${sampleSize}), need more data`);
  }

  if (canaryMetrics.safetyScore < 0.9) {
    recommendation = 'rollback';
    reasons.push('Safety score below critical threshold');
  }

  return {
    timestamp: new Date().toISOString(),
    baselineName: baseline.name,
    canaryName: canary.name,
    metrics: { baseline: baseMetrics, canary: canaryMetrics },
    comparisons,
    recommendation,
    confidence,
    reasons,
  };
}

/**
 * Determine if a canary should be promoted based on thresholds.
 */
export function shouldPromote(report: CanaryReport, thresholds: CanaryThresholds = DEFAULT_THRESHOLDS): boolean {
  const { baseline, canary } = report.metrics;

  // Pass rate must not drop beyond threshold
  if (baseline.passRate - canary.passRate > thresholds.maxPassRateDrop) return false;

  // Latency must not increase beyond threshold
  if (baseline.p95LatencyMs > 0 &&
    (canary.p95LatencyMs - baseline.p95LatencyMs) / baseline.p95LatencyMs > thresholds.maxLatencyIncrease) return false;

  // Cost must not increase beyond threshold
  if (baseline.totalCostUsd > 0 &&
    (canary.totalCostUsd - baseline.totalCostUsd) / baseline.totalCostUsd > thresholds.maxCostIncrease) return false;

  // Safety must meet minimum
  if (canary.safetyScore < thresholds.minSafetyScore) return false;

  // Error rate must not spike
  if (canary.errorRate - baseline.errorRate > thresholds.maxErrorRateIncrease) return false;

  return true;
}

/**
 * Format a canary report for console display.
 */
export function formatCanaryReport(report: CanaryReport): string {
  const icon = report.recommendation === 'promote' ? '✅' :
    report.recommendation === 'rollback' ? '🚨' : '⏳';

  const lines: string[] = [
    `${icon} Canary Report: ${report.recommendation.toUpperCase()}`,
    `  Baseline: ${report.baselineName}  |  Canary: ${report.canaryName}`,
    `  Confidence: ${(report.confidence * 100).toFixed(0)}%`,
    '',
    '  Metric          Baseline    Canary      Delta     Status',
    '  ─────────────── ─────────── ─────────── ───────── ──────',
  ];

  for (const c of report.comparisons) {
    const statusIcon = c.status === 'improved' ? '↑' : c.status === 'degraded' ? '↓' : '─';
    const fmt = (v: number) => {
      if (c.metric.includes('Rate') || c.metric.includes('Score') || c.metric === 'passRate')
        return (v * 100).toFixed(1) + '%';
      if (c.metric.includes('Cost')) return '$' + v.toFixed(4);
      if (c.metric.includes('Latency')) return v.toFixed(0) + 'ms';
      return v.toFixed(2);
    };
    const pct = (c.deltaPercent * 100).toFixed(1) + '%';
    lines.push(
      `  ${c.metric.padEnd(16)} ${fmt(c.baseline).padEnd(12)} ${fmt(c.canary).padEnd(12)} ${pct.padEnd(10)} ${statusIcon} ${c.status}`
    );
  }

  if (report.reasons.length > 0) {
    lines.push('', '  Reasons:');
    for (const r of report.reasons) {
      lines.push(`    • ${r}`);
    }
  }

  return lines.join('\n');
}
