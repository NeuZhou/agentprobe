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

// ===== Deterministic Replay & Verification =====

export interface DeterministicReplayOptions {
  /** If true, verify that replayed tool calls match original exactly. */
  verify: boolean;
  /** Tolerance for timing differences in ms (default: 0, timing not checked). */
  timingToleranceMs?: number;
}

export interface VerificationMismatch {
  stepIndex: number;
  field: string;
  expected: any;
  actual: any;
}

export interface DeterministicReplayResult {
  passed: boolean;
  totalSteps: number;
  verifiedSteps: number;
  mismatches: VerificationMismatch[];
  trace: AgentTrace;
}

/**
 * Replay a trace deterministically — walk through each step and optionally
 * verify that the exact same tool calls (name + args) happen in sequence.
 * Useful for regression testing with recorded traces.
 */
export function deterministicReplay(
  trace: AgentTrace,
  actualTrace: AgentTrace,
  options: DeterministicReplayOptions = { verify: true },
): DeterministicReplayResult {
  const mismatches: VerificationMismatch[] = [];
  let verifiedSteps = 0;

  if (options.verify) {
    // Extract tool_call steps from both traces
    const expectedCalls = trace.steps.filter(s => s.type === 'tool_call');
    const actualCalls = actualTrace.steps.filter(s => s.type === 'tool_call');

    // Check count
    if (expectedCalls.length !== actualCalls.length) {
      mismatches.push({
        stepIndex: -1,
        field: 'tool_call_count',
        expected: expectedCalls.length,
        actual: actualCalls.length,
      });
    }

    const len = Math.min(expectedCalls.length, actualCalls.length);
    for (let i = 0; i < len; i++) {
      const exp = expectedCalls[i];
      const act = actualCalls[i];

      // Verify tool name
      if (exp.data.tool_name !== act.data.tool_name) {
        mismatches.push({
          stepIndex: i,
          field: 'tool_name',
          expected: exp.data.tool_name,
          actual: act.data.tool_name,
        });
      } else {
        verifiedSteps++;
      }

      // Verify tool args
      const expArgs = JSON.stringify(exp.data.tool_args || {});
      const actArgs = JSON.stringify(act.data.tool_args || {});
      if (expArgs !== actArgs) {
        mismatches.push({
          stepIndex: i,
          field: 'tool_args',
          expected: exp.data.tool_args,
          actual: act.data.tool_args,
        });
      }
    }

    // Flag extra calls
    for (let i = len; i < actualCalls.length; i++) {
      mismatches.push({
        stepIndex: i,
        field: 'extra_call',
        expected: undefined,
        actual: actualCalls[i].data.tool_name,
      });
    }
    for (let i = len; i < expectedCalls.length; i++) {
      mismatches.push({
        stepIndex: i,
        field: 'missing_call',
        expected: expectedCalls[i].data.tool_name,
        actual: undefined,
      });
    }
  }

  return {
    passed: mismatches.length === 0,
    totalSteps: trace.steps.length,
    verifiedSteps,
    mismatches,
    trace: actualTrace,
  };
}

/**
 * Format deterministic replay verification result.
 */
export function formatDeterministicReplay(result: DeterministicReplayResult): string {
  const lines: string[] = [];
  const icon = result.passed ? '✅' : '❌';
  lines.push(`${icon} Deterministic Replay: ${result.passed ? 'PASSED' : 'FAILED'}`);
  lines.push(`   Steps: ${result.totalSteps} | Verified: ${result.verifiedSteps} | Mismatches: ${result.mismatches.length}`);

  if (result.mismatches.length > 0) {
    lines.push('');
    for (const m of result.mismatches) {
      const loc = m.stepIndex >= 0 ? `Step ${m.stepIndex}` : 'Overall';
      lines.push(`  ❌ ${loc}: ${m.field}`);
      if (m.expected !== undefined) lines.push(`     Expected: ${JSON.stringify(m.expected).slice(0, 100)}`);
      if (m.actual !== undefined) lines.push(`     Actual:   ${JSON.stringify(m.actual).slice(0, 100)}`);
    }
  }

  return lines.join('\n');
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
