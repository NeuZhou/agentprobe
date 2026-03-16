/**
 * SLA Monitoring - Define and monitor service-level agreements
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import type { SuiteResult } from './types';
import chalk from 'chalk';

export interface SLAConfig {
  availability: number;    // percentage (e.g., 99.5)
  latency_p95: number;     // milliseconds
  cost_per_query: number;  // USD
  accuracy: number;        // percentage
}

export interface SLACheckResult {
  config: SLAConfig;
  actual: {
    availability: number;
    latency_p95: number;
    cost_per_query: number;
    accuracy: number;
  };
  violations: SLAViolation[];
  passing: boolean;
}

export interface SLAViolation {
  metric: string;
  threshold: number;
  actual: number;
  unit: string;
}

/**
 * Load SLA config from YAML file.
 */
export function loadSLAConfig(configPath: string): SLAConfig {
  const content = fs.readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(content);
  const sla = parsed.sla || parsed;
  return {
    availability: parsePercent(sla.availability),
    latency_p95: parseMs(sla.latency_p95),
    cost_per_query: typeof sla.cost_per_query === 'number' ? sla.cost_per_query : parseFloat(sla.cost_per_query),
    accuracy: parsePercent(sla.accuracy),
  };
}

function parsePercent(val: any): number {
  if (typeof val === 'number') return val;
  const str = String(val).replace('%', '').trim();
  return parseFloat(str);
}

function parseMs(val: any): number {
  if (typeof val === 'number') return val;
  const str = String(val).replace('ms', '').trim();
  return parseFloat(str);
}

/**
 * Compute percentile from array of numbers.
 */
export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Load report files from a directory.
 */
export function loadReports(dir: string): SuiteResult[] {
  const results: SuiteResult[] = [];
  if (!fs.existsSync(dir)) return results;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      if (data.name && typeof data.passed === 'number') {
        results.push(data as SuiteResult);
      }
    } catch { /* skip invalid */ }
  }
  return results;
}

/**
 * Check reports against SLA config.
 */
export function checkSLA(config: SLAConfig, reports: SuiteResult[]): SLACheckResult {
  if (reports.length === 0) {
    return {
      config,
      actual: { availability: 0, latency_p95: 0, cost_per_query: 0, accuracy: 0 },
      violations: [
        { metric: 'availability', threshold: config.availability, actual: 0, unit: '%' },
        { metric: 'accuracy', threshold: config.accuracy, actual: 0, unit: '%' },
      ],
      passing: false,
    };
  }

  const totalTests = reports.reduce((s, r) => s + r.total, 0);
  const totalPassed = reports.reduce((s, r) => s + r.passed, 0);
  const durations = reports.flatMap(r => r.results.map(tr => tr.duration_ms));

  const availability = totalTests > 0
    ? (reports.filter(r => r.total > 0).length / reports.length) * 100
    : 0;
  const latencyP95 = percentile(durations, 95);
  const accuracy = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;
  const costPerQuery = 0; // Would need cost data from traces

  const actual = { availability, latency_p95: latencyP95, cost_per_query: costPerQuery, accuracy };

  const violations: SLAViolation[] = [];
  if (availability < config.availability) {
    violations.push({ metric: 'availability', threshold: config.availability, actual: availability, unit: '%' });
  }
  if (latencyP95 > config.latency_p95) {
    violations.push({ metric: 'latency_p95', threshold: config.latency_p95, actual: latencyP95, unit: 'ms' });
  }
  if (costPerQuery > config.cost_per_query) {
    violations.push({ metric: 'cost_per_query', threshold: config.cost_per_query, actual: costPerQuery, unit: 'USD' });
  }
  if (accuracy < config.accuracy) {
    violations.push({ metric: 'accuracy', threshold: config.accuracy, actual: accuracy, unit: '%' });
  }

  return { config, actual, violations, passing: violations.length === 0 };
}

/**
 * Format SLA check results for console.
 */
// ===== Enhanced SLA: Trend Analysis & Monitoring =====

export interface SLAMonitoringConfig {
  windowHours: number;       // e.g. 24
  alertThreshold: number;    // e.g. 0.9 — alert at 90% of SLA
  trend: 'degrading' | 'stable' | 'improving' | 'any';
}

export interface SLATrendPoint {
  timestamp: string;
  availability: number;
  latency_p95: number;
  cost_per_query: number;
  accuracy: number;
}

export interface SLATrendResult {
  metric: string;
  direction: 'degrading' | 'stable' | 'improving';
  slope: number;            // rate of change per hour
  breachEta?: number;       // hours until SLA breach (if degrading)
  alert: boolean;
  alertReason?: string;
}

export interface SLAMonitorResult {
  config: SLAConfig;
  monitoring: SLAMonitoringConfig;
  currentCheck: SLACheckResult;
  trends: SLATrendResult[];
  overallStatus: 'healthy' | 'warning' | 'critical';
}

/**
 * Calculate linear regression slope for a time series.
 */
export function linearSlope(points: { x: number; y: number }[]): number {
  if (points.length < 2) return 0;
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Analyze trend for a single metric.
 */
export function analyzeTrend(
  metric: string,
  points: { x: number; y: number }[],
  threshold: number,
  alertThreshold: number,
  higherIsBetter: boolean,
): SLATrendResult {
  const slope = linearSlope(points);
  const slopeAbs = Math.abs(slope);
  const slopeThreshold = 0.001; // minimum slope to consider meaningful

  let direction: SLATrendResult['direction'] = 'stable';
  if (slopeAbs > slopeThreshold) {
    if (higherIsBetter) {
      direction = slope > 0 ? 'improving' : 'degrading';
    } else {
      direction = slope < 0 ? 'improving' : 'degrading';
    }
  }

  // Estimate time to breach
  let breachEta: number | undefined;
  if (direction === 'degrading' && points.length > 0) {
    const current = points[points.length - 1].y;
    if (higherIsBetter && slope < 0) {
      breachEta = (current - threshold) / Math.abs(slope);
    } else if (!higherIsBetter && slope > 0) {
      breachEta = (threshold - current) / slope;
    }
    if (breachEta !== undefined && breachEta < 0) breachEta = undefined;
  }

  // Check if approaching alert threshold
  let alert = false;
  let alertReason: string | undefined;
  if (points.length > 0) {
    const current = points[points.length - 1].y;
    const alertLevel = higherIsBetter
      ? threshold * alertThreshold
      : threshold / alertThreshold;

    if (higherIsBetter && current <= alertLevel) {
      alert = true;
      alertReason = `${metric} at ${current.toFixed(2)}, approaching SLA of ${threshold}`;
    } else if (!higherIsBetter && current >= alertLevel) {
      alert = true;
      alertReason = `${metric} at ${current.toFixed(2)}, approaching SLA of ${threshold}`;
    }
  }

  if (direction === 'degrading' && breachEta !== undefined && breachEta < 24) {
    alert = true;
    alertReason = `${metric} trending toward breach in ~${breachEta.toFixed(1)}h`;
  }

  return { metric, direction, slope, breachEta, alert, alertReason };
}

/**
 * Run full SLA monitoring with trend analysis.
 */
export function monitorSLA(
  config: SLAConfig,
  monitoring: SLAMonitoringConfig,
  history: SLATrendPoint[],
  currentReports: SuiteResult[],
): SLAMonitorResult {
  const currentCheck = checkSLA(config, currentReports);

  // Convert history to time-indexed points (hours from first)
  const baseTime = history.length > 0 ? new Date(history[0].timestamp).getTime() : Date.now();
  const toHours = (ts: string) => (new Date(ts).getTime() - baseTime) / (1000 * 60 * 60);

  const trends: SLATrendResult[] = [
    analyzeTrend(
      'availability',
      history.map(h => ({ x: toHours(h.timestamp), y: h.availability })),
      config.availability, monitoring.alertThreshold, true,
    ),
    analyzeTrend(
      'latency_p95',
      history.map(h => ({ x: toHours(h.timestamp), y: h.latency_p95 })),
      config.latency_p95, monitoring.alertThreshold, false,
    ),
    analyzeTrend(
      'cost_per_query',
      history.map(h => ({ x: toHours(h.timestamp), y: h.cost_per_query })),
      config.cost_per_query, monitoring.alertThreshold, false,
    ),
    analyzeTrend(
      'accuracy',
      history.map(h => ({ x: toHours(h.timestamp), y: h.accuracy })),
      config.accuracy, monitoring.alertThreshold, true,
    ),
  ];

  // Filter by monitoring trend preference
  const alertTrends = trends.filter(t => t.alert);
  const degrading = trends.filter(t => t.direction === 'degrading');

  let overallStatus: SLAMonitorResult['overallStatus'] = 'healthy';
  if (!currentCheck.passing || alertTrends.length >= 2) {
    overallStatus = 'critical';
  } else if (alertTrends.length > 0 || degrading.length > 0) {
    overallStatus = 'warning';
  }

  return { config, monitoring, currentCheck, trends, overallStatus };
}

/**
 * Format SLA monitoring result for console.
 */
export function formatSLAMonitor(result: SLAMonitorResult): string {
  const statusIcon = result.overallStatus === 'healthy' ? '✅' :
    result.overallStatus === 'warning' ? '⚠️' : '🚨';

  const lines: string[] = [
    `${statusIcon} SLA Monitor: ${result.overallStatus.toUpperCase()}`,
    '',
  ];

  // Current check
  lines.push(formatSLACheck(result.currentCheck));

  // Trends
  lines.push('\n  📈 Trends:');
  for (const t of result.trends) {
    const arrow = t.direction === 'improving' ? '↑' : t.direction === 'degrading' ? '↓' : '─';
    const eta = t.breachEta !== undefined ? ` (breach in ~${t.breachEta.toFixed(1)}h)` : '';
    const alertMark = t.alert ? ' ⚠️' : '';
    lines.push(`    ${arrow} ${t.metric}: ${t.direction}${eta}${alertMark}`);
  }

  // Alerts
  const alerts = result.trends.filter(t => t.alert);
  if (alerts.length > 0) {
    lines.push('\n  🔔 Alerts:');
    for (const a of alerts) {
      lines.push(`    • ${a.alertReason}`);
    }
  }

  return lines.join('\n');
}

export function formatSLACheck(result: SLACheckResult): string {
  const lines: string[] = [];
  const icon = result.passing ? '✅' : '❌';
  lines.push(chalk.bold(`\n${icon} SLA Check: ${result.passing ? 'PASSING' : 'VIOLATIONS DETECTED'}\n`));
  lines.push(`  Availability: ${result.actual.availability.toFixed(1)}% (threshold: ${result.config.availability}%)`);
  lines.push(`  Latency P95:  ${result.actual.latency_p95.toFixed(0)}ms (threshold: ${result.config.latency_p95}ms)`);
  lines.push(`  Cost/Query:   $${result.actual.cost_per_query.toFixed(3)} (threshold: $${result.config.cost_per_query.toFixed(2)})`);
  lines.push(`  Accuracy:     ${result.actual.accuracy.toFixed(1)}% (threshold: ${result.config.accuracy}%)`);

  if (result.violations.length > 0) {
    lines.push(chalk.red('\n  Violations:'));
    for (const v of result.violations) {
      lines.push(chalk.red(`    ⚠ ${v.metric}: ${v.actual.toFixed(2)}${v.unit} (threshold: ${v.threshold}${v.unit})`));
    }
  }
  return lines.join('\n');
}
