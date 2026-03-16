import type { AgentTrace, TraceStep } from './types';

export interface MergedStep extends TraceStep {
  agent_id?: string;
  agent_name?: string;
  is_handoff?: boolean;
  handoff_from?: string;
  handoff_to?: string;
  context_keys?: string[];
}

export interface MergedTrace extends Omit<AgentTrace, 'steps'> {
  steps: MergedStep[];
  agents: string[];
  handoffs: HandoffPoint[];
  context_flow: ContextFlow[];
}

export interface HandoffPoint {
  timestamp: string;
  from_agent: string;
  to_agent: string;
  step_index: number;
}

export interface ContextFlow {
  key: string;
  from_agent: string;
  to_agent: string;
  step_index: number;
}

/**
 * Detect context keys passed between agents by looking at tool args/results.
 */
function extractContextKeys(step: TraceStep): string[] {
  const keys: string[] = [];
  if (step.data.tool_args) {
    keys.push(...Object.keys(step.data.tool_args));
  }
  if (step.data.tool_result && typeof step.data.tool_result === 'object') {
    keys.push(...Object.keys(step.data.tool_result));
  }
  return keys;
}

/**
 * Merge multiple agent traces into a single timeline, interleaved by timestamp.
 * Each step is annotated with its source agent.
 * Detects handoff points and context passing between agents.
 */
export function mergeTraces(traces: { trace: AgentTrace; name?: string }[]): MergedTrace {
  const allSteps: MergedStep[] = [];
  const agents: string[] = [];

  for (let i = 0; i < traces.length; i++) {
    const { trace, name } = traces[i];
    const agentName = name ?? trace.metadata?.agent_name ?? `agent-${i}`;
    agents.push(agentName);

    for (const step of trace.steps) {
      allSteps.push({
        ...step,
        agent_id: trace.id,
        agent_name: agentName,
        context_keys: extractContextKeys(step),
      });
    }
  }

  // Sort by timestamp
  allSteps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Detect handoff points (agent changes in consecutive steps)
  const handoffs: HandoffPoint[] = [];
  for (let i = 1; i < allSteps.length; i++) {
    const prev = allSteps[i - 1];
    const curr = allSteps[i];
    if (prev.agent_name !== curr.agent_name) {
      const handoff: HandoffPoint = {
        timestamp: curr.timestamp,
        from_agent: prev.agent_name!,
        to_agent: curr.agent_name!,
        step_index: i,
      };
      handoffs.push(handoff);
      curr.is_handoff = true;
      curr.handoff_from = prev.agent_name;
      curr.handoff_to = curr.agent_name;
    }
  }

  // Detect context flow: shared keys between agents at handoff points
  const contextFlow: ContextFlow[] = [];
  for (const handoff of handoffs) {
    // Look at the step before and after handoff
    const beforeIdx = handoff.step_index - 1;
    const afterIdx = handoff.step_index;
    if (beforeIdx >= 0 && afterIdx < allSteps.length) {
      const beforeKeys = new Set(allSteps[beforeIdx].context_keys ?? []);
      const afterKeys = allSteps[afterIdx].context_keys ?? [];
      for (const key of afterKeys) {
        if (beforeKeys.has(key)) {
          contextFlow.push({
            key,
            from_agent: handoff.from_agent,
            to_agent: handoff.to_agent,
            step_index: handoff.step_index,
          });
        }
      }
    }
  }

  const earliest = traces[0]?.trace.timestamp ?? new Date().toISOString();

  return {
    id: `merged-${Date.now()}`,
    timestamp: earliest,
    steps: allSteps,
    metadata: {
      merged: true,
      source_count: traces.length,
      agents,
      handoff_count: handoffs.length,
      context_flow_count: contextFlow.length,
    },
    agents,
    handoffs,
    context_flow: contextFlow,
  };
}

/**
 * Split a merged trace back into individual agent traces.
 */
export function splitTrace(merged: MergedTrace): Map<string, AgentTrace> {
  const byAgent = new Map<string, TraceStep[]>();

  for (const step of merged.steps) {
    const key = step.agent_name ?? step.agent_id ?? 'unknown';
    if (!byAgent.has(key)) byAgent.set(key, []);
    byAgent.get(key)!.push(step);
  }

  const result = new Map<string, AgentTrace>();
  for (const [name, steps] of byAgent) {
    result.set(name, {
      id: `split-${name}-${Date.now()}`,
      timestamp: steps[0]?.timestamp ?? merged.timestamp,
      steps,
      metadata: { agent_name: name, split_from: merged.id },
    });
  }

  return result;
}

/**
 * Format a merged trace as a conversation view.
 */
export function formatMergedConversation(merged: MergedTrace): string {
  const lines: string[] = [];
  lines.push(`\n🔀 Merged Trace: ${merged.agents.length} agents`);
  lines.push(`   Agents: ${merged.agents.join(', ')}`);
  lines.push(`   Handoffs: ${merged.handoffs.length}`);
  lines.push(`   Context flows: ${merged.context_flow.length}\n`);

  for (const step of merged.steps) {
    const icon = step.is_handoff ? '🔄' : {
      llm_call: '🧠', tool_call: '🔧', tool_result: '📦', thought: '💭', output: '💬',
    }[step.type] ?? '❓';

    const agent = step.agent_name ?? '?';
    const detail = step.data.tool_name
      ? `${step.data.tool_name}()`
      : (step.data.content?.slice(0, 60) ?? step.data.model ?? '');

    let line = `  ${icon} [${agent}] ${step.type}: ${detail}`;
    if (step.is_handoff) {
      line += ` ← handoff from ${step.handoff_from}`;
    }
    lines.push(line);
  }

  if (merged.context_flow.length > 0) {
    lines.push(`\n  📎 Context Flow:`);
    for (const cf of merged.context_flow) {
      lines.push(`     ${cf.from_agent} → ${cf.to_agent}: "${cf.key}"`);
    }
  }

  return lines.join('\n');
}
