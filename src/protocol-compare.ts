/**
 * Protocol Comparator — A2A vs MCP Comparison Testing
 *
 * Run identical test cases against both MCP servers and A2A agents,
 * comparing latency, accuracy, cost, and reliability across protocols.
 */


// ===== Types =====

export interface ComparisonTestCase {
  name: string;
  /** Input message / tool call */
  input: string;
  /** For MCP: tool name to invoke */
  mcpTool?: string;
  /** For MCP: tool arguments */
  mcpArgs?: Record<string, any>;
  /** Expected output substring */
  expectedOutput?: string;
  /** Maximum acceptable latency in ms */
  maxLatency_ms?: number;
  /** Number of repetitions for statistical comparison */
  repetitions?: number;
}

export interface ProtocolResult {
  protocol: 'mcp' | 'a2a';
  latency_ms: number;
  success: boolean;
  output?: string;
  error?: string;
  tokens?: { input?: number; output?: number };
  cost_usd?: number;
}

export interface ComparisonResult {
  testCase: string;
  mcp: ProtocolStats;
  a2a: ProtocolStats;
  winner: 'mcp' | 'a2a' | 'tie';
  latencyDiff_ms: number;
  accuracyDiff: number;
}

export interface ProtocolStats {
  avgLatency_ms: number;
  p50Latency_ms: number;
  p95Latency_ms: number;
  p99Latency_ms: number;
  successRate: number;
  totalCost_usd: number;
  samples: ProtocolResult[];
}

export interface ComparisonReport {
  timestamp: string;
  mcpServer: string;
  a2aAgent: string;
  results: ComparisonResult[];
  summary: ComparisonSummary;
}

export interface ComparisonSummary {
  totalTests: number;
  mcpWins: number;
  a2aWins: number;
  ties: number;
  mcpAvgLatency_ms: number;
  a2aAvgLatency_ms: number;
  mcpSuccessRate: number;
  a2aSuccessRate: number;
  mcpTotalCost_usd: number;
  a2aTotalCost_usd: number;
  recommendation: string;
}

export interface ComparatorConfig {
  mcpServer: string;
  a2aAgent: string;
  testCases: ComparisonTestCase[];
  /** Default repetitions per test case */
  repetitions?: number;
  /** Timeout per request */
  timeout_ms?: number;
  /** Auth for A2A agent */
  a2aAuth?: { type: 'bearer'; token: string };
  /** Env vars for MCP stdio server */
  mcpEnv?: Record<string, string>;
}

// ===== Protocol Comparator =====

export class ProtocolComparator {
  private config: ComparatorConfig;

  constructor(config: ComparatorConfig) {
    this.config = config;
  }

  /**
   * Run comparison across all test cases
   */
  async compareMCPvsA2A(): Promise<ComparisonReport> {
    const results: ComparisonResult[] = [];

    for (const tc of this.config.testCases) {
      const reps = tc.repetitions || this.config.repetitions || 3;

      const mcpResults = await this.runMCPTests(tc, reps);
      const a2aResults = await this.runA2ATests(tc, reps);

      const mcpStats = computeStats(mcpResults);
      const a2aStats = computeStats(a2aResults);

      const latencyDiff = mcpStats.avgLatency_ms - a2aStats.avgLatency_ms;
      const accuracyDiff = mcpStats.successRate - a2aStats.successRate;

      let winner: 'mcp' | 'a2a' | 'tie' = 'tie';
      if (mcpStats.successRate > a2aStats.successRate) winner = 'mcp';
      else if (a2aStats.successRate > mcpStats.successRate) winner = 'a2a';
      else if (mcpStats.avgLatency_ms < a2aStats.avgLatency_ms * 0.9) winner = 'mcp';
      else if (a2aStats.avgLatency_ms < mcpStats.avgLatency_ms * 0.9) winner = 'a2a';

      results.push({
        testCase: tc.name,
        mcp: mcpStats,
        a2a: a2aStats,
        winner,
        latencyDiff_ms: latencyDiff,
        accuracyDiff,
      });
    }

    const summary = this.computeSummary(results);

    return {
      timestamp: new Date().toISOString(),
      mcpServer: this.config.mcpServer,
      a2aAgent: this.config.a2aAgent,
      results,
      summary,
    };
  }

  private async runMCPTests(tc: ComparisonTestCase, reps: number): Promise<ProtocolResult[]> {
    const results: ProtocolResult[] = [];
    const timeout = this.config.timeout_ms || 30000;

    for (let i = 0; i < reps; i++) {
      const start = Date.now();
      try {
        const isMCPHttp = this.config.mcpServer.startsWith('http');

        if (isMCPHttp) {
          const resp = await fetch(this.config.mcpServer, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `mcp-${Date.now()}-${i}`,
              method: tc.mcpTool ? 'tools/call' : 'completion/complete',
              params: tc.mcpTool
                ? { name: tc.mcpTool, arguments: tc.mcpArgs || {} }
                : { argument: { value: tc.input } },
            }),
            signal: AbortSignal.timeout(timeout),
          });

          const data = (await resp.json()) as any;
          const output = extractMCPOutput(data);
          const success = resp.ok && !data.error && (!tc.expectedOutput || output.includes(tc.expectedOutput));

          results.push({
            protocol: 'mcp',
            latency_ms: Date.now() - start,
            success,
            output: output.slice(0, 1000),
            error: data.error?.message,
          });
        } else {
          // Stdio MCP — simulate with error for now (needs child_process)
          results.push({
            protocol: 'mcp',
            latency_ms: Date.now() - start,
            success: false,
            error: 'Stdio MCP comparison requires running server — use HTTP URL',
          });
        }
      } catch (err: any) {
        results.push({
          protocol: 'mcp',
          latency_ms: Date.now() - start,
          success: false,
          error: err.message,
        });
      }
    }

    return results;
  }

  private async runA2ATests(tc: ComparisonTestCase, reps: number): Promise<ProtocolResult[]> {
    const results: ProtocolResult[] = [];
    const timeout = this.config.timeout_ms || 30000;

    for (let i = 0; i < reps; i++) {
      const start = Date.now();
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.config.a2aAuth?.type === 'bearer') {
          headers['Authorization'] = `Bearer ${this.config.a2aAuth.token}`;
        }

        const resp = await fetch(this.config.a2aAgent, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `a2a-${Date.now()}-${i}`,
            method: 'tasks/send',
            params: {
              id: `compare-${Date.now()}-${i}`,
              message: { role: 'user', parts: [{ type: 'text', text: tc.input }] },
            },
          }),
          signal: AbortSignal.timeout(timeout),
        });

        const data = (await resp.json()) as any;
        const output = extractA2AOutput(data);
        const success = resp.ok && !data.error && (!tc.expectedOutput || output.includes(tc.expectedOutput));

        results.push({
          protocol: 'a2a',
          latency_ms: Date.now() - start,
          success,
          output: output.slice(0, 1000),
          error: data.error?.message,
        });
      } catch (err: any) {
        results.push({
          protocol: 'a2a',
          latency_ms: Date.now() - start,
          success: false,
          error: err.message,
        });
      }
    }

    return results;
  }

  private computeSummary(results: ComparisonResult[]): ComparisonSummary {
    const mcpWins = results.filter((r) => r.winner === 'mcp').length;
    const a2aWins = results.filter((r) => r.winner === 'a2a').length;
    const ties = results.filter((r) => r.winner === 'tie').length;

    const mcpAvg = avg(results.map((r) => r.mcp.avgLatency_ms));
    const a2aAvg = avg(results.map((r) => r.a2a.avgLatency_ms));
    const mcpSuccess = avg(results.map((r) => r.mcp.successRate));
    const a2aSuccess = avg(results.map((r) => r.a2a.successRate));
    const mcpCost = results.reduce((s, r) => s + r.mcp.totalCost_usd, 0);
    const a2aCost = results.reduce((s, r) => s + r.a2a.totalCost_usd, 0);

    let recommendation: string;
    if (mcpWins > a2aWins * 2) recommendation = 'MCP significantly outperforms A2A for these test cases';
    else if (a2aWins > mcpWins * 2) recommendation = 'A2A significantly outperforms MCP for these test cases';
    else if (mcpWins > a2aWins) recommendation = 'MCP slightly better — consider MCP for latency-sensitive cases';
    else if (a2aWins > mcpWins) recommendation = 'A2A slightly better — consider A2A for multi-agent workflows';
    else recommendation = 'Both protocols perform similarly — choose based on ecosystem needs';

    return {
      totalTests: results.length,
      mcpWins,
      a2aWins,
      ties,
      mcpAvgLatency_ms: mcpAvg,
      a2aAvgLatency_ms: a2aAvg,
      mcpSuccessRate: mcpSuccess,
      a2aSuccessRate: a2aSuccess,
      mcpTotalCost_usd: mcpCost,
      a2aTotalCost_usd: a2aCost,
      recommendation,
    };
  }
}

// ===== Helpers =====

function computeStats(results: ProtocolResult[]): ProtocolStats {
  const latencies = results.map((r) => r.latency_ms).sort((a, b) => a - b);
  const successes = results.filter((r) => r.success).length;

  return {
    avgLatency_ms: avg(latencies),
    p50Latency_ms: percentile(latencies, 0.5),
    p95Latency_ms: percentile(latencies, 0.95),
    p99Latency_ms: percentile(latencies, 0.99),
    successRate: results.length > 0 ? successes / results.length : 0,
    totalCost_usd: results.reduce((s, r) => s + (r.cost_usd || 0), 0),
    samples: results,
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function extractMCPOutput(data: any): string {
  if (data?.result?.content) {
    return data.result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
  }
  if (data?.result) return typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
  return '';
}

function extractA2AOutput(data: any): string {
  const task = data?.result;
  if (!task) return '';
  const parts: string[] = [];
  for (const msg of task.messages || []) {
    for (const part of msg.parts || []) {
      if (part.type === 'text') parts.push(part.text);
    }
  }
  for (const artifact of task.artifacts || []) {
    for (const part of artifact.parts || []) {
      if (part.type === 'text') parts.push(part.text);
    }
  }
  return parts.join('\n');
}

/**
 * Format a comparison report for display
 */
export function formatComparisonReport(report: ComparisonReport): string {
  const lines: string[] = [
    `⚡ Protocol Comparison: MCP vs A2A`,
    `   MCP: ${report.mcpServer}`,
    `   A2A: ${report.a2aAgent}`,
    `   Time: ${report.timestamp}`,
    '',
    `📊 Summary:`,
    `   Tests: ${report.summary.totalTests} | MCP wins: ${report.summary.mcpWins} | A2A wins: ${report.summary.a2aWins} | Ties: ${report.summary.ties}`,
    `   MCP avg latency: ${report.summary.mcpAvgLatency_ms.toFixed(0)}ms | Success: ${(report.summary.mcpSuccessRate * 100).toFixed(1)}%`,
    `   A2A avg latency: ${report.summary.a2aAvgLatency_ms.toFixed(0)}ms | Success: ${(report.summary.a2aSuccessRate * 100).toFixed(1)}%`,
    `   💡 ${report.summary.recommendation}`,
    '',
  ];

  for (const r of report.results) {
    const icon = r.winner === 'mcp' ? '🔵' : r.winner === 'a2a' ? '🟢' : '⚪';
    lines.push(`${icon} ${r.testCase}: ${r.winner.toUpperCase()} wins`);
    lines.push(`   MCP: ${r.mcp.avgLatency_ms.toFixed(0)}ms (${(r.mcp.successRate * 100).toFixed(0)}%) | A2A: ${r.a2a.avgLatency_ms.toFixed(0)}ms (${(r.a2a.successRate * 100).toFixed(0)}%)`);
  }

  return lines.join('\n');
}
