/**
 * Multi-Agent Test Orchestration — Test multi-agent scenarios.
 *
 * Load traces from multiple agents and verify delegation,
 * coordination, and completion patterns.
 */

import type { AgentTrace, Expectations, AssertionResult } from './types';
import { evaluate } from './assertions';

export interface AgentDef {
  trace: string;
  role?: string;
}

export interface OrchestrationConfig {
  agents: Record<string, AgentDef>;
  tests: OrchestrationTest[];
}

export interface OrchestrationTest {
  name: string;
  agent?: string;
  expect: OrchestrationExpectations;
}

export interface OrchestrationExpectations extends Expectations {
  delegated_to?: string[];
  all_agents_complete?: boolean;
  total_steps?: { max?: number; min?: number };
  agent_order?: string[];
  no_deadlock?: boolean;
}

export interface OrchestrationResult {
  name: string;
  passed: boolean;
  assertions: AssertionResult[];
  agents: Record<string, AgentTrace>;
}

/**
 * Evaluate orchestration-specific assertions.
 */
export function evaluateOrchestration(
  agents: Record<string, AgentTrace>,
  expect: OrchestrationExpectations,
  targetAgent?: string,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // If targeting a specific agent, run standard assertions on it
  if (targetAgent && agents[targetAgent]) {
    results.push(...evaluate(agents[targetAgent], expect));
  }

  // delegated_to — check if agent's tool calls reference other agents
  if (expect.delegated_to) {
    const target = targetAgent ? agents[targetAgent] : Object.values(agents)[0];
    if (target) {
      const toolCalls = target.steps
        .filter((s) => s.type === 'tool_call')
        .map((s) => s.data.tool_name ?? '');
      const outputs = target.steps
        .filter((s) => s.type === 'output' || s.type === 'tool_result')
        .map((s) => JSON.stringify(s.data))
        .join(' ');
      const allContent = [...toolCalls, outputs].join(' ').toLowerCase();

      for (const delegateName of expect.delegated_to) {
        const found =
          allContent.includes(delegateName.toLowerCase()) ||
          toolCalls.some((t) => t.toLowerCase().includes(delegateName.toLowerCase())) ||
          // Check if there's a tool call like "delegate", "spawn", "assign" with agent name in args
          target.steps.some(
            (s) =>
              s.type === 'tool_call' &&
              JSON.stringify(s.data.tool_args ?? {})
                .toLowerCase()
                .includes(delegateName.toLowerCase()),
          );

        results.push({
          name: `delegated_to: ${delegateName}`,
          passed: found,
          expected: delegateName,
          actual: toolCalls,
          message: found
            ? undefined
            : `No delegation to "${delegateName}" found in agent trace. ` +
              `Looked for references in tool calls and outputs. ` +
              `Suggestion: Verify the orchestrator explicitly delegates to "${delegateName}".`,
        });
      }
    }
  }

  // all_agents_complete
  if (expect.all_agents_complete) {
    const incomplete: string[] = [];
    for (const [name, trace] of Object.entries(agents)) {
      const hasOutput = trace.steps.some((s) => s.type === 'output');
      if (!hasOutput) incomplete.push(name);
    }
    const passed = incomplete.length === 0;
    results.push({
      name: 'all_agents_complete',
      passed,
      expected: 'all agents have output',
      actual: incomplete.length === 0 ? 'all complete' : `incomplete: ${incomplete.join(', ')}`,
      message: passed
        ? undefined
        : `Agents without output: ${incomplete.join(', ')}. ` +
          `Suggestion: Check if these agents received their tasks and produced results.`,
    });
  }

  // total_steps
  if (expect.total_steps) {
    const total = Object.values(agents).reduce((sum, t) => sum + t.steps.length, 0);
    const maxOk = expect.total_steps.max == null || total <= expect.total_steps.max;
    const minOk = expect.total_steps.min == null || total >= expect.total_steps.min;
    const passed = maxOk && minOk;

    let expectedStr = '';
    if (expect.total_steps.min != null) expectedStr += `>= ${expect.total_steps.min}`;
    if (expect.total_steps.min != null && expect.total_steps.max != null) expectedStr += ' and ';
    if (expect.total_steps.max != null) expectedStr += `<= ${expect.total_steps.max}`;

    results.push({
      name: `total_steps: ${expectedStr}`,
      passed,
      expected: expectedStr,
      actual: total,
      message: passed
        ? undefined
        : `Total steps across all agents: ${total}. ${!maxOk ? `Exceeds max ${expect.total_steps.max}.` : `Below min ${expect.total_steps.min}.`} ` +
          `Suggestion: ${!maxOk ? 'Agents may be doing redundant work.' : 'Agents may not be completing their tasks.'}`,
    });
  }

  // agent_order — verify agents acted in expected order by timestamp
  if (expect.agent_order) {
    const agentFirstTime = new Map<string, string>();
    for (const [name, trace] of Object.entries(agents)) {
      if (trace.steps.length > 0) {
        agentFirstTime.set(name, trace.steps[0].timestamp);
      }
    }

    const actualOrder = [...agentFirstTime.entries()]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([name]) => name);

    const expectedOrder = expect.agent_order;
    let matched = true;
    for (let i = 0; i < expectedOrder.length; i++) {
      if (actualOrder[i] !== expectedOrder[i]) {
        matched = false;
        break;
      }
    }

    results.push({
      name: `agent_order: [${expectedOrder.join(' → ')}]`,
      passed: matched,
      expected: expectedOrder,
      actual: actualOrder,
      message: matched
        ? undefined
        : `Expected order: ${expectedOrder.join(' → ')}, Actual: ${actualOrder.join(' → ')}. ` +
          `Suggestion: Check if agents are being started in the correct sequence.`,
    });
  }

  return results;
}
