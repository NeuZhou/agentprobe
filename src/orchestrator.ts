/**
 * Test Orchestrator — Run complex multi-agent test scenarios.
 *
 * Supports sequential, parallel, and conditional flows between agents.
 *
 * @example
 * ```typescript
 * const orch = new TestOrchestrator();
 * orch.addAgent('router', { trace: 'traces/router.json' });
 * orch.addAgent('support', { trace: 'traces/support.json' });
 * orch.defineInteraction('router', 'support', 'Handle refund request');
 * const result = await orch.run();
 * ```
 */

import * as fs from 'fs';
import type { AgentTrace, Expectations, AssertionResult } from './types';
import { evaluate } from './assertions';

export interface AgentConfig {
  trace?: string;
  role?: string;
  model?: string;
  tools?: string[];
  maxSteps?: number;
  timeout_ms?: number;
}

export interface Interaction {
  from: string;
  to: string;
  message: string;
  condition?: string;
  expect?: Partial<Expectations>;
}

export type FlowMode = 'sequential' | 'parallel' | 'conditional';

export interface FlowStep {
  agent: string;
  action: string;
  dependsOn?: string[];
  condition?: (ctx: OrchestratorContext) => boolean;
}

export interface OrchestratorContext {
  results: Map<string, AgentRunResult>;
  interactions: InteractionResult[];
  metadata: Record<string, any>;
}

export interface AgentRunResult {
  agent: string;
  trace?: AgentTrace;
  passed: boolean;
  assertions: AssertionResult[];
  duration_ms: number;
  error?: string;
}

export interface InteractionResult {
  from: string;
  to: string;
  message: string;
  success: boolean;
  handoffDetected: boolean;
  duration_ms: number;
}

export interface OrchestratorResult {
  passed: boolean;
  agents: Map<string, AgentRunResult>;
  interactions: InteractionResult[];
  totalDuration_ms: number;
  flow: FlowMode;
  summary: string;
}

/**
 * Orchestrate multi-agent test scenarios.
 */
export class TestOrchestrator {
  private agents = new Map<string, AgentConfig>();
  private traces = new Map<string, AgentTrace>();
  private interactions: Interaction[] = [];
  private flowSteps: FlowStep[] = [];
  private flowMode: FlowMode = 'sequential';
  private expectations = new Map<string, Partial<Expectations>>();

  /**
   * Add an agent to the orchestration.
   */
  addAgent(name: string, config: AgentConfig): void {
    this.agents.set(name, config);
    if (config.trace && fs.existsSync(config.trace)) {
      const raw = fs.readFileSync(config.trace, 'utf-8');
      this.traces.set(name, JSON.parse(raw));
    }
  }

  /**
   * Add agent with inline trace (for testing).
   */
  addAgentWithTrace(name: string, config: AgentConfig, trace: AgentTrace): void {
    this.agents.set(name, config);
    this.traces.set(name, trace);
  }

  /**
   * Define an interaction between two agents.
   */
  defineInteraction(from: string, to: string, message: string, expect?: Partial<Expectations>): void {
    this.interactions.push({ from, to, message, expect });
  }

  /**
   * Set expectations for a specific agent.
   */
  setExpectations(agent: string, expect: Partial<Expectations>): void {
    this.expectations.set(agent, expect);
  }

  /**
   * Set the execution flow mode.
   */
  setFlowMode(mode: FlowMode): void {
    this.flowMode = mode;
  }

  /**
   * Add a flow step for conditional execution.
   */
  addFlowStep(step: FlowStep): void {
    this.flowSteps.push(step);
  }

  /**
   * Run the orchestrated test scenario.
   */
  async run(): Promise<OrchestratorResult> {
    const start = Date.now();
    const agentResults = new Map<string, AgentRunResult>();
    const interactionResults: InteractionResult[] = [];

    // Evaluate each agent's trace
    if (this.flowMode === 'parallel') {
      const promises = Array.from(this.agents.entries()).map(([name]) =>
        this.evaluateAgent(name),
      );
      const results = await Promise.all(promises);
      for (const r of results) agentResults.set(r.agent, r);
    } else {
      for (const [name] of this.agents) {
        const result = await this.evaluateAgent(name);
        agentResults.set(name, result);
      }
    }

    // Evaluate interactions
    for (const interaction of this.interactions) {
      const result = this.evaluateInteraction(interaction);
      interactionResults.push(result);
    }

    const allPassed = Array.from(agentResults.values()).every(r => r.passed)
      && interactionResults.every(r => r.success);

    const totalDuration = Date.now() - start;

    return {
      passed: allPassed,
      agents: agentResults,
      interactions: interactionResults,
      totalDuration_ms: totalDuration,
      flow: this.flowMode,
      summary: this.formatSummary(agentResults, interactionResults),
    };
  }

  private async evaluateAgent(name: string): Promise<AgentRunResult> {
    const start = Date.now();
    const trace = this.traces.get(name);
    const expect = this.expectations.get(name);

    if (!trace) {
      return {
        agent: name,
        passed: false,
        assertions: [{ name: 'trace_exists', passed: false, message: `No trace for agent "${name}"` }],
        duration_ms: Date.now() - start,
        error: 'No trace loaded',
      };
    }

    const assertions: AssertionResult[] = [];
    if (expect) {
      assertions.push(...evaluate(trace, expect as any));
    }

    // Basic sanity checks
    assertions.push({
      name: 'has_steps',
      passed: trace.steps.length > 0,
      message: trace.steps.length > 0 ? `Agent "${name}" has ${trace.steps.length} steps` : `Agent "${name}" has no steps`,
    });

    return {
      agent: name,
      trace,
      passed: assertions.every(a => a.passed),
      assertions,
      duration_ms: Date.now() - start,
    };
  }

  private evaluateInteraction(interaction: Interaction): InteractionResult {
    const start = Date.now();
    const fromTrace = this.traces.get(interaction.from);
    const toTrace = this.traces.get(interaction.to);

    // Detect handoff: from agent should have delegated to the target
    let handoffDetected = false;
    if (fromTrace) {
      for (const step of fromTrace.steps) {
        if (step.type === 'tool_call') {
          const args = JSON.stringify(step.data.tool_args ?? {});
          const toolName = step.data.tool_name ?? '';
          if (
            toolName.includes('delegate') ||
            toolName.includes('handoff') ||
            toolName.includes('transfer') ||
            args.includes(interaction.to) ||
            args.includes(interaction.message)
          ) {
            handoffDetected = true;
            break;
          }
        }
        if (step.type === 'output' && step.data.content?.includes(interaction.to)) {
          handoffDetected = true;
          break;
        }
      }
    }

    let success = handoffDetected;

    // Evaluate interaction-specific expectations
    if (interaction.expect && toTrace) {
      const results = evaluate(toTrace, interaction.expect as any);
      success = success && results.every(r => r.passed);
    }

    return {
      from: interaction.from,
      to: interaction.to,
      message: interaction.message,
      success,
      handoffDetected,
      duration_ms: Date.now() - start,
    };
  }

  private formatSummary(
    agents: Map<string, AgentRunResult>,
    interactions: InteractionResult[],
  ): string {
    const lines: string[] = ['🎭 Orchestrator Results', ''];
    const agentArr = Array.from(agents.values());
    const passedAgents = agentArr.filter(a => a.passed).length;
    lines.push(`Agents: ${passedAgents}/${agentArr.length} passed`);

    for (const a of agentArr) {
      const icon = a.passed ? '✅' : '❌';
      lines.push(`  ${icon} ${a.agent}: ${a.assertions.filter(r => r.passed).length}/${a.assertions.length} assertions`);
    }

    if (interactions.length > 0) {
      lines.push('');
      lines.push(`Interactions: ${interactions.filter(i => i.success).length}/${interactions.length}`);
      for (const i of interactions) {
        const icon = i.success ? '✅' : '❌';
        const handoff = i.handoffDetected ? '🤝' : '❓';
        lines.push(`  ${icon} ${i.from} → ${i.to}: "${i.message}" ${handoff}`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * Create an orchestrator from a config object.
 */
export function createOrchestrator(config: {
  agents: Record<string, AgentConfig>;
  interactions?: Interaction[];
  flow?: FlowMode;
  expectations?: Record<string, Partial<Expectations>>;
}): TestOrchestrator {
  const orch = new TestOrchestrator();
  for (const [name, agentConfig] of Object.entries(config.agents)) {
    orch.addAgent(name, agentConfig);
  }
  if (config.interactions) {
    for (const i of config.interactions) {
      orch.defineInteraction(i.from, i.to, i.message, i.expect);
    }
  }
  if (config.flow) {
    orch.setFlowMode(config.flow);
  }
  if (config.expectations) {
    for (const [agent, expect] of Object.entries(config.expectations)) {
      orch.setExpectations(agent, expect);
    }
  }
  return orch;
}

/**
 * Format orchestrator result for display.
 */
export function formatOrchestratorResult(result: OrchestratorResult): string {
  const icon = result.passed ? '✅' : '❌';
  const lines = [
    `${icon} Orchestrator: ${result.flow} flow (${result.totalDuration_ms}ms)`,
    '',
    result.summary,
  ];
  return lines.join('\n');
}
