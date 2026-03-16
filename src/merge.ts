import type { AgentTrace, TraceStep } from './types';

export interface MergedStep extends TraceStep {
  agent_id?: string;
  agent_name?: string;
}

export interface MergedTrace extends Omit<AgentTrace, 'steps'> {
  steps: MergedStep[];
  agents: string[];
}

/**
 * Merge multiple agent traces into a single timeline, interleaved by timestamp.
 * Each step is annotated with its source agent.
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
      });
    }
  }

  // Sort by timestamp
  allSteps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const earliest = traces[0]?.trace.timestamp ?? new Date().toISOString();

  return {
    id: `merged-${Date.now()}`,
    timestamp: earliest,
    steps: allSteps,
    metadata: {
      merged: true,
      source_count: traces.length,
      agents,
    },
    agents,
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
