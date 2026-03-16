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
