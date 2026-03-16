/**
 * Multi-Agent Testing — Test interactions between multiple agents.
 *
 * Supports agent delegation, conversation flows, tool call expectations,
 * and inter-agent message passing validation.
 */

import type { AgentTrace } from './types';

// ===== Types =====

export interface AgentDefinition {
  name: string;
  adapter: string;
  model: string;
  tools?: string[];
  system_prompt?: string;
}

export interface ConversationStep {
  to: string;
  message?: string;
  expect?: ConversationExpectation;
}

export interface ConversationExpectation {
  delegates_to?: string;
  tool_called?: string | string[];
  output_contains?: string | string[];
  output_matches?: string;
  max_steps?: number;
  max_duration_ms?: number;
  response_not_empty?: boolean;
}

export interface MultiAgentTest {
  name: string;
  agents: Record<string, AgentDefinition>;
  conversation: ConversationStep[];
  timeout_ms?: number;
}

export interface DelegationEvent {
  from: string;
  to: string;
  message?: string;
  timestamp: string;
}

export interface MultiAgentResult {
  test_name: string;
  passed: boolean;
  agents_used: string[];
  delegations: DelegationEvent[];
  step_results: ConversationStepResult[];
  duration_ms: number;
  error?: string;
}

export interface ConversationStepResult {
  step_index: number;
  agent: string;
  passed: boolean;
  expectations_met: string[];
  expectations_failed: string[];
  trace?: AgentTrace;
}

// ===== Agent Registry =====

export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();

  register(name: string, definition: AgentDefinition): void {
    this.agents.set(name, { ...definition, name });
  }

  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  list(): string[] {
    return [...this.agents.keys()];
  }

  clear(): void {
    this.agents.clear();
  }
}

// ===== Parsing & Validation =====

export function parseMultiAgentConfig(raw: any): MultiAgentTest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid multi-agent config: expected an object');
  }
  if (!raw.name || typeof raw.name !== 'string') {
    throw new Error('Multi-agent test must have a "name" field');
  }
  if (!raw.agents || typeof raw.agents !== 'object') {
    throw new Error('Multi-agent test must have an "agents" map');
  }
  if (!raw.conversation || !Array.isArray(raw.conversation) || raw.conversation.length === 0) {
    throw new Error('Multi-agent test must have a non-empty "conversation" array');
  }

  const agents: Record<string, AgentDefinition> = {};
  for (const [name, def] of Object.entries(raw.agents)) {
    const d = def as any;
    agents[name] = {
      name,
      adapter: d.adapter ?? 'unknown',
      model: d.model ?? 'unknown',
      tools: d.tools,
      system_prompt: d.system_prompt,
    };
  }

  const conversation: ConversationStep[] = raw.conversation.map((step: any) => {
    if (!step.to) throw new Error('Each conversation step must have a "to" field');
    return {
      to: step.to,
      message: step.message,
      expect: step.expect ? parseExpectation(step.expect) : undefined,
    };
  });

  // Validate all "to" references exist in agents
  for (const step of conversation) {
    if (!agents[step.to]) {
      throw new Error(`Conversation step references unknown agent: "${step.to}"`);
    }
    if (step.expect?.delegates_to && !agents[step.expect.delegates_to]) {
      throw new Error(`Delegation target references unknown agent: "${step.expect.delegates_to}"`);
    }
  }

  return {
    name: raw.name,
    agents,
    conversation,
    timeout_ms: raw.timeout_ms,
  };
}

function parseExpectation(raw: any): ConversationExpectation {
  return {
    delegates_to: raw.delegates_to,
    tool_called: raw.tool_called,
    output_contains: raw.output_contains,
    output_matches: raw.output_matches,
    max_steps: raw.max_steps,
    max_duration_ms: raw.max_duration_ms,
    response_not_empty: raw.response_not_empty,
  };
}

// ===== Delegation Detection =====

export function detectDelegation(trace: AgentTrace, agentNames: string[]): DelegationEvent[] {
  const delegations: DelegationEvent[] = [];

  for (const step of trace.steps) {
    if (step.type === 'tool_call') {
      const toolName = step.data.tool_name ?? '';
      const args = step.data.tool_args ?? {};

      // Check if tool call is a delegation (e.g., "delegate", "handoff", "route_to")
      if (/^(delegate|handoff|route_to|send_to|forward)$/i.test(toolName)) {
        const target = args.agent ?? args.to ?? args.target;
        if (target && agentNames.includes(target)) {
          delegations.push({
            from: trace.metadata?.agent ?? 'unknown',
            to: target,
            message: args.message ?? args.content,
            timestamp: step.timestamp,
          });
        }
      }

      // Check if tool name matches an agent name (direct agent invocation)
      if (agentNames.includes(toolName)) {
        delegations.push({
          from: trace.metadata?.agent ?? 'unknown',
          to: toolName,
          message: args.message ?? args.input,
          timestamp: step.timestamp,
        });
      }
    }

    // Check output for delegation patterns
    if (step.type === 'output' && step.data.content) {
      for (const name of agentNames) {
        const pattern = new RegExp(`@${name}\\b|\\bdelegate.*${name}\\b`, 'i');
        if (pattern.test(step.data.content)) {
          delegations.push({
            from: trace.metadata?.agent ?? 'unknown',
            to: name,
            message: step.data.content,
            timestamp: step.timestamp,
          });
        }
      }
    }
  }

  return delegations;
}

// ===== Expectation Evaluation =====

export function evaluateConversationStep(
  trace: AgentTrace,
  expect: ConversationExpectation,
  agentNames: string[],
): { passed: boolean; met: string[]; failed: string[] } {
  const met: string[] = [];
  const failed: string[] = [];

  // Check delegation
  if (expect.delegates_to) {
    const delegations = detectDelegation(trace, agentNames);
    const found = delegations.some(d => d.to === expect.delegates_to);
    if (found) met.push(`delegates_to:${expect.delegates_to}`);
    else failed.push(`delegates_to:${expect.delegates_to}`);
  }

  // Check tool called
  if (expect.tool_called) {
    const tools = Array.isArray(expect.tool_called) ? expect.tool_called : [expect.tool_called];
    for (const tool of tools) {
      const found = trace.steps.some(s => s.type === 'tool_call' && s.data.tool_name === tool);
      if (found) met.push(`tool_called:${tool}`);
      else failed.push(`tool_called:${tool}`);
    }
  }

  // Check output contains
  if (expect.output_contains) {
    const patterns = Array.isArray(expect.output_contains) ? expect.output_contains : [expect.output_contains];
    const outputs = trace.steps.filter(s => s.type === 'output').map(s => s.data.content ?? '');
    const allOutput = outputs.join(' ');
    for (const pat of patterns) {
      if (allOutput.includes(pat)) met.push(`output_contains:${pat}`);
      else failed.push(`output_contains:${pat}`);
    }
  }

  // Check output matches regex
  if (expect.output_matches) {
    const outputs = trace.steps.filter(s => s.type === 'output').map(s => s.data.content ?? '');
    const allOutput = outputs.join(' ');
    const re = new RegExp(expect.output_matches);
    if (re.test(allOutput)) met.push(`output_matches:${expect.output_matches}`);
    else failed.push(`output_matches:${expect.output_matches}`);
  }

  // Check max steps
  if (expect.max_steps !== undefined) {
    if (trace.steps.length <= expect.max_steps) met.push(`max_steps:${expect.max_steps}`);
    else failed.push(`max_steps:${expect.max_steps} (got ${trace.steps.length})`);
  }

  // Check response not empty
  if (expect.response_not_empty) {
    const outputs = trace.steps.filter(s => s.type === 'output').map(s => s.data.content ?? '');
    const hasContent = outputs.some(o => o.trim().length > 0);
    if (hasContent) met.push('response_not_empty');
    else failed.push('response_not_empty');
  }

  return { passed: failed.length === 0, met, failed };
}

// ===== Formatting =====

export function formatMultiAgentResult(result: MultiAgentResult): string {
  const lines: string[] = [
    '',
    `  🤖 Multi-Agent Test: ${result.test_name}`,
    `     Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`,
    `     Agents: ${result.agents_used.join(', ')}`,
    `     Duration: ${result.duration_ms}ms`,
  ];

  if (result.delegations.length > 0) {
    lines.push('     Delegations:');
    for (const d of result.delegations) {
      lines.push(`       ${d.from} → ${d.to}${d.message ? `: "${d.message.slice(0, 50)}"` : ''}`);
    }
  }

  for (const sr of result.step_results) {
    const icon = sr.passed ? '✅' : '❌';
    lines.push(`     Step ${sr.step_index + 1} (${sr.agent}): ${icon}`);
    if (sr.expectations_failed.length > 0) {
      for (const f of sr.expectations_failed) {
        lines.push(`       ✗ ${f}`);
      }
    }
  }

  if (result.error) {
    lines.push(`     Error: ${result.error}`);
  }

  return lines.join('\n');
}
