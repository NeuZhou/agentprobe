/**
 * Agent Load Testing — stress test an agent with concurrent requests.
 * @module load-test
 */

export interface LoadTestConfig {
  /** Number of concurrent workers */
  concurrency: number;
  /** Duration string e.g. "60s", "5m" */
  duration: string;
  /** Optional max total requests (stop early) */
  maxRequests?: number;
  /** Optional ramp-up period string e.g. "10s" */
  rampUp?: string;
}

export interface LoadTestResult {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errors: LoadTestError[];
  totalCost: number;
  throughput: number;
  durationMs: number;
}

export interface LoadTestError {
  type: string;
  count: number;
  example?: string;
}

/**
 * Parse a duration string like "60s", "5m", "1h" into milliseconds.
 */
export function parseDuration(s: string): number {
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|ms)$/i);
  if (!match) throw new Error(`Invalid duration: ${s}`);
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'ms': return val;
    case 's': case 'sec': return val * 1000;
    case 'm': case 'min': return val * 60_000;
    case 'h': case 'hr': return val * 3_600_000;
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}

/**
 * Calculate percentile from sorted array.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Aggregate individual results into a LoadTestResult.
 */
export function aggregateResults(
  results: Array<{ passed: boolean; durationMs: number; error?: string; cost?: number }>,
  totalDurationMs: number,
): LoadTestResult {
  const latencies = results.map(r => r.durationMs).sort((a, b) => a - b);
  const errorMap = new Map<string, { count: number; example?: string }>();

  for (const r of results) {
    if (!r.passed && r.error) {
      const type = classifyError(r.error);
      const entry = errorMap.get(type) ?? { count: 0 };
      entry.count++;
      entry.example = entry.example ?? r.error;
      errorMap.set(type, entry);
    }
  }

  const successCount = results.filter(r => r.passed).length;
  const totalCost = results.reduce((sum, r) => sum + (r.cost ?? 0), 0);

  return {
    totalRequests: results.length,
    successCount,
    failureCount: results.length - successCount,
    successRate: results.length > 0 ? (successCount / results.length) * 100 : 0,
    avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    errors: Array.from(errorMap.entries()).map(([type, v]) => ({ type, ...v })),
    totalCost,
    throughput: totalDurationMs > 0 ? results.length / (totalDurationMs / 1000) : 0,
    durationMs: totalDurationMs,
  };
}

/**
 * Classify an error string into a category.
 */
export function classifyError(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('rate limit') || lower.includes('429')) return 'rate_limit';
  if (lower.includes('auth') || lower.includes('401') || lower.includes('403')) return 'auth';
  if (lower.includes('500') || lower.includes('internal server')) return 'server_error';
  if (lower.includes('network') || lower.includes('econnrefused')) return 'network';
  return 'unknown';
}

/**
 * Format load test results for console display.
 */
export function formatLoadTestResult(result: LoadTestResult): string {
  const lines: string[] = [];
  const dur = (result.durationMs / 1000).toFixed(0);
  lines.push(`📊 Load Test Results (${dur}s, concurrency-based)`);
  lines.push(`  Total requests:  ${result.totalRequests}`);
  lines.push(`  Success rate:    ${result.successRate.toFixed(1)}%`);
  lines.push(`  Avg latency:     ${(result.avgLatencyMs / 1000).toFixed(1)}s (P50: ${(result.p50LatencyMs / 1000).toFixed(1)}s, P95: ${(result.p95LatencyMs / 1000).toFixed(1)}s, P99: ${(result.p99LatencyMs / 1000).toFixed(1)}s)`);
  lines.push(`  Errors:          ${result.failureCount}${result.errors.length > 0 ? ` (${result.errors.map(e => `${e.count} ${e.type}`).join(', ')})` : ''}`);
  lines.push(`  Cost:            $${result.totalCost.toFixed(2)}`);
  lines.push(`  Throughput:      ${result.throughput.toFixed(2)} req/s`);
  return lines.join('\n');
}
