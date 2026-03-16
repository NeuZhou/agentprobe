/**
 * Trace Replay with Modifications — "What-if" testing for agent traces.
 *
 * Replay a recorded trace but with injected overrides to test
 * how the agent would behave with different tool responses.
 */

import type { AgentTrace, TraceStep } from './types';

export interface ReplayOverride {
  return?: any;
  error?: string;
  delay_ms?: number;
  drop?: boolean;
}

export interface ReplayConfig {
  trace: AgentTrace;
  overrides: Record<string, ReplayOverride>;
}

export interface ReplayResult {
  trace: AgentTrace;
  modifications: ReplayModification[];
}

export interface ReplayModification {
  step_index: number;
  tool_name: string;
  type: 'return_override' | 'error_injected' | 'step_dropped' | 'delay_added';
  original: any;
  modified: any;
}

/**
 * Replay a trace with modifications applied to tool results.
 */
export function replayTrace(config: ReplayConfig): ReplayResult {
  const { trace, overrides } = config;
  const modifications: ReplayModification[] = [];
  const newSteps: TraceStep[] = [];

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];

    // Check if this is a tool_call that has an override
    if (step.type === 'tool_call' && step.data.tool_name) {
      const override = overrides[step.data.tool_name];
      if (override) {
        if (override.drop) {
          modifications.push({
            step_index: i,
            tool_name: step.data.tool_name,
            type: 'step_dropped',
            original: step,
            modified: null,
          });
          // Also skip the next tool_result if it exists
          if (i + 1 < trace.steps.length && trace.steps[i + 1].type === 'tool_result') {
            i++; // skip tool_result too
          }
          continue;
        }

        // Keep the tool_call step
        newSteps.push({ ...step });

        // Look for the corresponding tool_result and modify it
        if (i + 1 < trace.steps.length && trace.steps[i + 1].type === 'tool_result') {
          const resultStep = trace.steps[i + 1];
          const newResultStep: TraceStep = {
            ...resultStep,
            data: { ...resultStep.data },
            duration_ms: override.delay_ms ?? resultStep.duration_ms,
          };

          if (override.error) {
            newResultStep.data.tool_result = { error: override.error };
            newResultStep.data.content = `Error: ${override.error}`;
            modifications.push({
              step_index: i + 1,
              tool_name: step.data.tool_name,
              type: 'error_injected',
              original: resultStep.data.tool_result,
              modified: newResultStep.data.tool_result,
            });
          } else if (override.return !== undefined) {
            modifications.push({
              step_index: i + 1,
              tool_name: step.data.tool_name,
              type: 'return_override',
              original: resultStep.data.tool_result,
              modified: override.return,
            });
            newResultStep.data.tool_result = override.return;
            newResultStep.data.content = JSON.stringify(override.return);
          }

          if (override.delay_ms) {
            modifications.push({
              step_index: i + 1,
              tool_name: step.data.tool_name,
              type: 'delay_added',
              original: resultStep.duration_ms,
              modified: override.delay_ms,
            });
          }

          newSteps.push(newResultStep);
          i++; // skip original tool_result
          continue;
        }
      }
    }

    newSteps.push({ ...step });
  }

  return {
    trace: {
      ...trace,
      id: `replay-${trace.id}`,
      steps: newSteps,
      metadata: {
        ...trace.metadata,
        replay: true,
        overrides: Object.keys(overrides),
        original_id: trace.id,
      },
    },
    modifications,
  };
}

/**
 * Format replay results for display.
 */
export function formatReplayResult(result: ReplayResult): string {
  const lines: string[] = [];
  lines.push(`🔄 Replay: ${result.trace.metadata.original_id ?? result.trace.id}`);
  lines.push(`   Steps: ${result.trace.steps.length} (original) → ${result.trace.steps.length}`);
  lines.push(`   Modifications: ${result.modifications.length}`);
  lines.push('');

  for (const mod of result.modifications) {
    const icon = {
      return_override: '📝',
      error_injected: '💥',
      step_dropped: '🗑️',
      delay_added: '⏱️',
    }[mod.type];

    lines.push(`  ${icon} Step ${mod.step_index}: ${mod.tool_name} — ${mod.type.replace(/_/g, ' ')}`);
    if (mod.type === 'return_override') {
      lines.push(`     Original: ${JSON.stringify(mod.original).slice(0, 80)}`);
      lines.push(`     Modified: ${JSON.stringify(mod.modified).slice(0, 80)}`);
    }
  }

  return lines.join('\n');
}
