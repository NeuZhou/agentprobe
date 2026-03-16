/**
 * Metrics Collector - Prometheus-compatible metrics for AgentProbe.
 *
 * Tracks test counts, durations, costs, and exposes a /metrics endpoint.
 */

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricLabel {
  [key: string]: string;
}

interface MetricEntry {
  name: string;
  type: MetricType;
  help: string;
  values: Map<string, number>;
  observations?: Map<string, number[]>;
}

// ===== Metrics Registry =====

export class MetricsRegistry {
  private metrics = new Map<string, MetricEntry>();

  counter(name: string, help: string): Counter {
    const entry = this.getOrCreate(name, 'counter', help);
    return new Counter(entry);
  }

  gauge(name: string, help: string): Gauge {
    const entry = this.getOrCreate(name, 'gauge', help);
    return new Gauge(entry);
  }

  histogram(name: string, help: string, buckets?: number[]): Histogram {
    const entry = this.getOrCreate(name, 'histogram', help);
    if (!entry.observations) entry.observations = new Map();
    return new Histogram(entry, buckets || [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
  }

  summary(name: string, help: string, quantiles?: number[]): Summary {
    const entry = this.getOrCreate(name, 'summary', help);
    if (!entry.observations) entry.observations = new Map();
    return new Summary(entry, quantiles || [0.5, 0.9, 0.95, 0.99]);
  }

  private getOrCreate(name: string, type: MetricType, help: string): MetricEntry {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { name, type, help, values: new Map() });
    }
    return this.metrics.get(name)!;
  }

  /**
   * Render all metrics in Prometheus exposition format.
   */
  serialize(): string {
    const lines: string[] = [];
    for (const [, metric] of this.metrics) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      if (metric.type === 'histogram' && metric.observations) {
        for (const [labelKey, obs] of metric.observations) {
          const sorted = [...obs].sort((a, b) => a - b);
          const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, Infinity];
          for (const b of buckets) {
            const count = sorted.filter(v => v <= b).length;
            const label = labelKey ? `{${labelKey},le="${b === Infinity ? '+Inf' : b}"}` : `{le="${b === Infinity ? '+Inf' : b}"}`;
            lines.push(`${metric.name}_bucket${label} ${count}`);
          }
          const sum = obs.reduce((s, v) => s + v, 0);
          const lbl = labelKey ? `{${labelKey}}` : '';
          lines.push(`${metric.name}_sum${lbl} ${sum}`);
          lines.push(`${metric.name}_count${lbl} ${obs.length}`);
        }
      } else if (metric.type === 'summary' && metric.observations) {
        for (const [labelKey, obs] of metric.observations) {
          const sorted = [...obs].sort((a, b) => a - b);
          const quantiles = [0.5, 0.9, 0.95, 0.99];
          for (const q of quantiles) {
            const idx = Math.max(0, Math.ceil(q * sorted.length) - 1);
            const val = sorted[idx] ?? 0;
            const label = labelKey ? `{${labelKey},quantile="${q}"}` : `{quantile="${q}"}`;
            lines.push(`${metric.name}${label} ${val}`);
          }
          const sum = obs.reduce((s, v) => s + v, 0);
          const lbl = labelKey ? `{${labelKey}}` : '';
          lines.push(`${metric.name}_sum${lbl} ${sum}`);
          lines.push(`${metric.name}_count${lbl} ${obs.length}`);
        }
      } else {
        for (const [labelKey, value] of metric.values) {
          const label = labelKey ? `{${labelKey}}` : '';
          lines.push(`${metric.name}${label} ${value}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.metrics.clear();
  }

  getMetricNames(): string[] {
    return [...this.metrics.keys()];
  }
}

// ===== Metric Classes =====

function labelsToKey(labels: MetricLabel): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

export class Counter {
  constructor(private entry: MetricEntry) {}

  inc(labels: MetricLabel = {}, value: number = 1): void {
    const key = labelsToKey(labels);
    this.entry.values.set(key, (this.entry.values.get(key) || 0) + value);
  }

  get(labels: MetricLabel = {}): number {
    return this.entry.values.get(labelsToKey(labels)) || 0;
  }
}

export class Gauge {
  constructor(private entry: MetricEntry) {}

  set(labels: MetricLabel, value: number): void;
  set(value: number): void;
  set(labelsOrValue: MetricLabel | number, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.entry.values.set('', labelsOrValue);
    } else {
      this.entry.values.set(labelsToKey(labelsOrValue), value!);
    }
  }

  inc(labels: MetricLabel = {}, value: number = 1): void {
    const key = labelsToKey(labels);
    this.entry.values.set(key, (this.entry.values.get(key) || 0) + value);
  }

  dec(labels: MetricLabel = {}, value: number = 1): void {
    const key = labelsToKey(labels);
    this.entry.values.set(key, (this.entry.values.get(key) || 0) - value);
  }

  get(labels: MetricLabel = {}): number {
    return this.entry.values.get(labelsToKey(labels)) || 0;
  }
}

export class Histogram {
  readonly buckets: number[];
  constructor(private entry: MetricEntry, buckets: number[]) {
    this.buckets = buckets;
  }

  observe(labels: MetricLabel, value: number): void;
  observe(value: number): void;
  observe(labelsOrValue: MetricLabel | number, value?: number): void {
    const key = typeof labelsOrValue === 'number' ? '' : labelsToKey(labelsOrValue);
    const val = typeof labelsOrValue === 'number' ? labelsOrValue : value!;
    if (!this.entry.observations) this.entry.observations = new Map();
    const arr = this.entry.observations.get(key) || [];
    arr.push(val);
    this.entry.observations.set(key, arr);
  }
}

export class Summary {
  readonly quantiles: number[];
  constructor(private entry: MetricEntry, quantiles: number[]) {
    this.quantiles = quantiles;
  }

  observe(labels: MetricLabel, value: number): void;
  observe(value: number): void;
  observe(labelsOrValue: MetricLabel | number, value?: number): void {
    const key = typeof labelsOrValue === 'number' ? '' : labelsToKey(labelsOrValue);
    const val = typeof labelsOrValue === 'number' ? labelsOrValue : value!;
    if (!this.entry.observations) this.entry.observations = new Map();
    const arr = this.entry.observations.get(key) || [];
    arr.push(val);
    this.entry.observations.set(key, arr);
  }
}

// ===== Default AgentProbe Metrics =====

export const defaultRegistry = new MetricsRegistry();

export const testsTotal = defaultRegistry.counter('agentprobe_tests_total', 'Total number of tests run');
export const testDuration = defaultRegistry.summary('agentprobe_test_duration_seconds', 'Test duration in seconds');
export const costTotal = defaultRegistry.counter('agentprobe_cost_total', 'Total cost in USD by model');
export const activeTests = defaultRegistry.gauge('agentprobe_active_tests', 'Number of currently running tests');
export const tokensTotal = defaultRegistry.counter('agentprobe_tokens_total', 'Total tokens used');

/**
 * Record results from a completed test.
 */
export function recordTestResult(testName: string, passed: boolean, durationMs: number, model?: string, costUsd?: number): void {
  const status = passed ? 'pass' : 'fail';
  defaultRegistry.counter('agentprobe_tests_total', 'Total number of tests run').inc({ status });
  defaultRegistry.summary('agentprobe_test_duration_seconds', 'Test duration in seconds').observe({ test: testName }, durationMs / 1000);
  if (model && costUsd) {
    defaultRegistry.counter('agentprobe_cost_total', 'Total cost in USD by model').inc({ model }, costUsd);
  }
}

/**
 * Get Prometheus-format metrics string from the default registry.
 */
export function getMetrics(): string {
  return defaultRegistry.serialize();
}
