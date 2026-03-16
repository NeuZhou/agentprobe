/**
 * Built-in Plugin: Cost Tracker
 *
 * Track and limit costs per test and per suite.
 * Accumulates token usage from traces and enforces budget limits.
 */

import type { AgentProbePlugin, PluginHooks } from '../plugins';
import type { TestResult } from '../types';
import { calculateCost } from '../cost';

export interface CostTrackerConfig {
  /** Maximum cost per individual test in USD */
  maxCostPerTest?: number;
  /** Maximum cost per suite in USD */
  maxCostPerSuite?: number;
  /** Whether to warn (log) or throw on budget exceeded */
  mode?: 'warn' | 'enforce';
  /** Callback when cost exceeds limit */
  onBudgetExceeded?: (test: string, cost: number, limit: number) => void;
}

export interface CostRecord {
  testName: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export class CostTracker {
  private records: CostRecord[] = [];
  private suiteCost = 0;
  readonly config: CostTrackerConfig;

  constructor(config: CostTrackerConfig = {}) {
    this.config = {
      mode: 'warn',
      ...config,
    };
  }

  recordTest(result: TestResult): CostRecord | null {
    if (!result.trace) return null;

    const breakdown = calculateCost(result.trace);
    const record: CostRecord = {
      testName: result.name,
      cost: breakdown.total_cost,
      inputTokens: breakdown.total_input_tokens,
      outputTokens: breakdown.total_output_tokens,
      model: breakdown.breakdowns[0]?.model ?? 'unknown',
    };

    this.records.push(record);
    this.suiteCost += record.cost;

    if (this.config.maxCostPerTest && record.cost > this.config.maxCostPerTest) {
      this.config.onBudgetExceeded?.(result.name, record.cost, this.config.maxCostPerTest);
      if (this.config.mode === 'enforce') {
        throw new Error(
          `Cost limit exceeded for test "${result.name}": $${record.cost.toFixed(4)} > $${this.config.maxCostPerTest.toFixed(4)}`,
        );
      }
    }

    return record;
  }

  checkSuiteBudget(): boolean {
    if (!this.config.maxCostPerSuite) return true;
    return this.suiteCost <= this.config.maxCostPerSuite;
  }

  getRecords(): CostRecord[] {
    return [...this.records];
  }

  getTotalCost(): number {
    return this.suiteCost;
  }

  reset(): void {
    this.records = [];
    this.suiteCost = 0;
  }

  formatReport(): string {
    const lines = ['Cost Tracker Report', '='.repeat(40)];
    for (const r of this.records) {
      lines.push(`  ${r.testName}: $${r.cost.toFixed(4)} (${r.inputTokens}/${r.outputTokens} tokens, ${r.model})`);
    }
    lines.push(`  Total: $${this.suiteCost.toFixed(4)}`);
    if (this.config.maxCostPerSuite) {
      lines.push(`  Budget: $${this.config.maxCostPerSuite.toFixed(4)} (${this.checkSuiteBudget() ? 'OK' : 'EXCEEDED'})`);
    }
    return lines.join('\n');
  }
}

/**
 * Create the cost-tracker plugin instance.
 */
export function createCostTrackerPlugin(config: CostTrackerConfig = {}): AgentProbePlugin & { tracker: CostTracker } {
  const tracker = new CostTracker(config);

  const hooks: PluginHooks = {
    onTestComplete(result: TestResult) {
      tracker.recordTest(result);
    },
    onSuiteStart() {
      tracker.reset();
    },
    onSuiteComplete() {
      if (!tracker.checkSuiteBudget() && config.mode === 'enforce') {
        throw new Error(
          `Suite cost budget exceeded: $${tracker.getTotalCost().toFixed(4)} > $${config.maxCostPerSuite?.toFixed(4)}`,
        );
      }
    },
  };

  return {
    name: 'cost-tracker',
    version: '1.0.0',
    type: 'lifecycle',
    hooks,
    tracker,
  };
}

export default createCostTrackerPlugin;
