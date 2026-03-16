/**
 * Built-in Plugin: Enhanced Tool Call Coverage Tracking
 *
 * Tracks tool call coverage across tests with detailed metrics:
 * argument patterns, call sequences, and coverage gaps.
 */

import type { AgentProbePlugin } from '../plugins';
import type { TestResult } from '../types';

export interface CoverageMetric {
  tool: string;
  callCount: number;
  testsCovering: string[];
  argPatterns: string[];
  sequences: string[][]; // tool sequences involving this tool
}

export interface CoverageReport {
  tools: Record<string, CoverageMetric>;
  totalCalls: number;
  uniqueTools: number;
  declaredTools: string[];
  uncoveredTools: string[];
  coveragePercent: number;
  sequenceCoverage: string[][]; // unique sequences seen
}

export class CoverageTracker {
  private metrics = new Map<string, CoverageMetric>();
  private sequences: string[][] = [];
  private declaredTools: string[] = [];

  constructor(declaredTools?: string[]) {
    this.declaredTools = declaredTools ?? [];
  }

  setDeclaredTools(tools: string[]): void {
    this.declaredTools = tools;
  }

  recordTest(result: TestResult): void {
    if (!result.trace) return;

    const testSequence: string[] = [];

    for (const step of result.trace.steps) {
      if (step.type !== 'tool_call' || !step.data.tool_name) continue;

      const tool = step.data.tool_name;
      testSequence.push(tool);

      let metric = this.metrics.get(tool);
      if (!metric) {
        metric = { tool, callCount: 0, testsCovering: [], argPatterns: [], sequences: [] };
        this.metrics.set(tool, metric);
      }

      metric.callCount++;
      if (!metric.testsCovering.includes(result.name)) {
        metric.testsCovering.push(result.name);
      }

      if (step.data.tool_args) {
        const pattern = Object.keys(step.data.tool_args).sort().join(',');
        if (!metric.argPatterns.includes(pattern)) {
          metric.argPatterns.push(pattern);
        }
      }
    }

    if (testSequence.length > 0) {
      this.sequences.push(testSequence);
      const metric = this.metrics.get(testSequence[0]);
      if (metric) metric.sequences.push(testSequence);
    }
  }

  getReport(): CoverageReport {
    const tools: Record<string, CoverageMetric> = {};
    let totalCalls = 0;
    for (const [name, m] of this.metrics) {
      tools[name] = m;
      totalCalls += m.callCount;
    }

    const coveredSet = new Set(this.metrics.keys());
    const uncovered = this.declaredTools.filter((t) => !coveredSet.has(t));
    const totalTools = this.declaredTools.length || this.metrics.size;

    return {
      tools,
      totalCalls,
      uniqueTools: this.metrics.size,
      declaredTools: this.declaredTools,
      uncoveredTools: uncovered,
      coveragePercent: totalTools > 0 ? (this.metrics.size / totalTools) * 100 : 100,
      sequenceCoverage: this.sequences,
    };
  }

  reset(): void {
    this.metrics.clear();
    this.sequences = [];
  }

  formatReport(): string {
    const report = this.getReport();
    const lines = [
      'Enhanced Coverage Report',
      '='.repeat(40),
      `  Tools covered: ${report.uniqueTools}/${report.declaredTools.length || report.uniqueTools}`,
      `  Coverage: ${report.coveragePercent.toFixed(1)}%`,
      `  Total calls: ${report.totalCalls}`,
      `  Unique sequences: ${report.sequenceCoverage.length}`,
    ];
    if (report.uncoveredTools.length > 0) {
      lines.push(`  Uncovered: ${report.uncoveredTools.join(', ')}`);
    }
    for (const [name, m] of Object.entries(report.tools)) {
      lines.push(`  ${name}: ${m.callCount} calls, ${m.testsCovering.length} tests, ${m.argPatterns.length} patterns`);
    }
    return lines.join('\n');
  }
}

/**
 * Create the enhanced coverage plugin.
 */
export function createCoveragePlugin(declaredTools?: string[]): AgentProbePlugin & { coverageTracker: CoverageTracker } {
  const coverageTracker = new CoverageTracker(declaredTools);

  return {
    name: 'enhanced-coverage',
    version: '1.0.0',
    type: 'lifecycle',
    hooks: {
      onTestComplete(result: TestResult) {
        coverageTracker.recordTest(result);
      },
      onSuiteStart() {
        coverageTracker.reset();
      },
    },
    coverageTracker,
  };
}

export default createCoveragePlugin;
