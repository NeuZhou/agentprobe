/**
 * Agent Debugger — Step-through debugging for agent traces
 *
 * Interactive debugger that lets you step through agent traces
 * like a traditional code debugger.
 *
 * @example
 * ```bash
 * agentprobe debug trace.json
 * # Step 1/7: User → Agent: "Find flights to Paris"
 * # [s]tep | [n]ext | [i]nspect | [b]reakpoint | [c]ontinue | [q]uit
 * ```
 */

import type { AgentTrace, TraceStep } from './types';
import { calculateCost } from './cost';

export interface DebugBreakpoint {
  step?: number;
  toolName?: string;
  type?: string;
  condition?: (step: TraceStep, index: number) => boolean;
}

export interface DebugContext {
  totalTokens: number;
  totalCost: number;
  toolsAvailable: string[];
  toolsCalled: string[];
  stepDurations: number[];
  variables: Record<string, any>;
}

export interface DebugState {
  trace: AgentTrace;
  currentStep: number;
  breakpoints: DebugBreakpoint[];
  context: DebugContext;
  paused: boolean;
  history: number[];
}

/**
 * Format a trace step for display.
 */
export function formatStep(step: TraceStep, index: number, total: number): string {
  const prefix = `Step ${index + 1}/${total}`;

  switch (step.type) {
    case 'llm_call': {
      const model = step.data.model ?? 'unknown';
      const lastMsg = step.data.messages?.[step.data.messages.length - 1];
      const role = lastMsg?.role ?? 'user';
      const content = lastMsg?.content ?? '';
      const snippet = content.length > 80 ? content.slice(0, 77) + '...' : content;
      return `${prefix}: ${capitalize(role)} → Agent: "${snippet}" [model=${model}]`;
    }
    case 'tool_call': {
      const name = step.data.tool_name ?? 'unknown';
      const args = step.data.tool_args ? JSON.stringify(step.data.tool_args) : '{}';
      const argsSnippet = args.length > 60 ? args.slice(0, 57) + '...' : args;
      return `${prefix}: Agent → ${name}: ${argsSnippet}`;
    }
    case 'tool_result': {
      const name = step.data.tool_name ?? 'unknown';
      const result = typeof step.data.tool_result === 'string'
        ? step.data.tool_result
        : JSON.stringify(step.data.tool_result ?? '');
      const resultSnippet = result.length > 60 ? result.slice(0, 57) + '...' : result;
      return `${prefix}: ${name} → Agent: ${resultSnippet}`;
    }
    case 'thought': {
      const content = step.data.content ?? '';
      const snippet = content.length > 80 ? content.slice(0, 77) + '...' : content;
      return `${prefix}: 💭 Thought: "${snippet}"`;
    }
    case 'output': {
      const content = step.data.content ?? '';
      const snippet = content.length > 80 ? content.slice(0, 77) + '...' : content;
      return `${prefix}: Agent → User: "${snippet}"`;
    }
    default:
      return `${prefix}: [${step.type}]`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build the debug context from trace up to the given step.
 */
export function buildContext(trace: AgentTrace, upToStep: number): DebugContext {
  let totalTokens = 0;
  let totalCost = 0;
  const toolsAvailable: Set<string> = new Set();
  const toolsCalled: Set<string> = new Set();
  const stepDurations: number[] = [];

  const subTrace: AgentTrace = {
    ...trace,
    steps: trace.steps.slice(0, upToStep + 1),
  };
  const costReport = calculateCost(subTrace);
  totalCost = costReport.total_cost;

  for (let i = 0; i <= upToStep && i < trace.steps.length; i++) {
    const step = trace.steps[i];
    if (step.data.tokens) {
      totalTokens += (step.data.tokens.input ?? 0) + (step.data.tokens.output ?? 0);
    }
    if (step.type === 'tool_call' && step.data.tool_name) {
      toolsCalled.add(step.data.tool_name);
    }
    if (step.duration_ms != null) {
      stepDurations.push(step.duration_ms);
    }
    // Discover available tools from first LLM call messages
    if (step.type === 'llm_call' && step.data.messages) {
      for (const msg of step.data.messages) {
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            toolsAvailable.add(tc.function.name);
          }
        }
      }
    }
  }

  return {
    totalTokens,
    totalCost,
    toolsAvailable: Array.from(toolsAvailable),
    toolsCalled: Array.from(toolsCalled),
    stepDurations,
    variables: {},
  };
}

/**
 * Format debug context for display.
 */
export function formatContext(ctx: DebugContext): string {
  const lines: string[] = [
    `Context:`,
    `  tokens=${ctx.totalTokens}, cost=$${ctx.totalCost.toFixed(4)}`,
    `  tools_available=[${ctx.toolsAvailable.join(', ')}]`,
    `  tools_called=[${ctx.toolsCalled.join(', ')}]`,
  ];
  if (ctx.stepDurations.length > 0) {
    const totalMs = ctx.stepDurations.reduce((a, b) => a + b, 0);
    lines.push(`  total_duration=${(totalMs / 1000).toFixed(1)}s`);
  }
  return lines.join('\n');
}

/**
 * Check if a step matches any breakpoint.
 */
export function matchesBreakpoint(
  step: TraceStep,
  index: number,
  breakpoints: DebugBreakpoint[],
): boolean {
  for (const bp of breakpoints) {
    if (bp.step != null && bp.step === index + 1) return true;
    if (bp.toolName && step.data.tool_name === bp.toolName) return true;
    if (bp.type && step.type === bp.type) return true;
    if (bp.condition && bp.condition(step, index)) return true;
  }
  return false;
}

/**
 * Parse a breakpoint command string.
 * Supports: "step=5", "tool=search", "type=llm_call"
 */
export function parseBreakpoint(input: string): DebugBreakpoint | null {
  const parts = input.split('=');
  if (parts.length !== 2) return null;

  const [key, value] = parts;
  switch (key.trim()) {
    case 'step':
      return { step: parseInt(value, 10) };
    case 'tool':
      return { toolName: value.trim() };
    case 'type':
      return { type: value.trim() };
    default:
      return null;
  }
}

/**
 * Create a new debug state for a trace.
 */
export function createDebugState(trace: AgentTrace): DebugState {
  return {
    trace,
    currentStep: 0,
    breakpoints: [],
    context: buildContext(trace, 0),
    paused: true,
    history: [0],
  };
}

/**
 * Process a debug command and return updated state + output.
 */
export function processCommand(
  state: DebugState,
  command: string,
): { state: DebugState; output: string; quit: boolean } {
  const cmd = command.trim().toLowerCase();
  const steps = state.trace.steps;

  if (cmd === 'q' || cmd === 'quit') {
    return { state, output: 'Debug session ended.', quit: true };
  }

  if (cmd === 's' || cmd === 'step' || cmd === 'n' || cmd === 'next') {
    if (state.currentStep >= steps.length - 1) {
      return { state, output: '⚠️ Already at last step.', quit: false };
    }
    const newStep = state.currentStep + 1;
    const newState: DebugState = {
      ...state,
      currentStep: newStep,
      context: buildContext(state.trace, newStep),
      history: [...state.history, newStep],
    };
    const stepOutput = formatStep(steps[newStep], newStep, steps.length);
    const duration = steps[newStep].duration_ms != null ? `  Duration: ${(steps[newStep].duration_ms! / 1000).toFixed(1)}s` : '';
    const cost = `  Cost: $${newState.context.totalCost.toFixed(4)}`;
    return { state: newState, output: `${stepOutput}\n${duration}\n${cost}`, quit: false };
  }

  if (cmd === 'i' || cmd === 'inspect') {
    return { state, output: formatContext(state.context), quit: false };
  }

  if (cmd.startsWith('b ') || cmd.startsWith('breakpoint ')) {
    const bpStr = cmd.replace(/^(b|breakpoint)\s+/, '');
    const bp = parseBreakpoint(bpStr);
    if (!bp) {
      return { state, output: '❌ Invalid breakpoint. Use: step=N, tool=NAME, type=TYPE', quit: false };
    }
    const newState: DebugState = {
      ...state,
      breakpoints: [...state.breakpoints, bp],
    };
    return { state: newState, output: `✅ Breakpoint set: ${bpStr}`, quit: false };
  }

  if (cmd === 'c' || cmd === 'continue') {
    let i = state.currentStep + 1;
    while (i < steps.length) {
      if (matchesBreakpoint(steps[i], i, state.breakpoints)) {
        const newState: DebugState = {
          ...state,
          currentStep: i,
          context: buildContext(state.trace, i),
          history: [...state.history, i],
        };
        const stepOutput = formatStep(steps[i], i, steps.length);
        return { state: newState, output: `⏸ Breakpoint hit!\n${stepOutput}`, quit: false };
      }
      i++;
    }
    // No breakpoint hit, run to end
    const lastIdx = steps.length - 1;
    const newState: DebugState = {
      ...state,
      currentStep: lastIdx,
      context: buildContext(state.trace, lastIdx),
      history: [...state.history, lastIdx],
    };
    return { state: newState, output: `▶ Ran to end. ${steps.length} steps completed.`, quit: false };
  }

  if (cmd === 'back' || cmd === 'p' || cmd === 'prev') {
    if (state.history.length <= 1) {
      return { state, output: '⚠️ Already at first step.', quit: false };
    }
    const newHistory = state.history.slice(0, -1);
    const prevStep = newHistory[newHistory.length - 1];
    const newState: DebugState = {
      ...state,
      currentStep: prevStep,
      context: buildContext(state.trace, prevStep),
      history: newHistory,
    };
    const stepOutput = formatStep(steps[prevStep], prevStep, steps.length);
    return { state: newState, output: `⏪ ${stepOutput}`, quit: false };
  }

  if (cmd === 'list' || cmd === 'l') {
    const lines: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const marker = i === state.currentStep ? '→ ' : '  ';
      const bpMarker = matchesBreakpoint(steps[i], i, state.breakpoints) ? '🔴 ' : '';
      lines.push(`${marker}${bpMarker}${formatStep(steps[i], i, steps.length)}`);
    }
    return { state, output: lines.join('\n'), quit: false };
  }

  return { state, output: `Unknown command: ${cmd}\nCommands: [s]tep [n]ext [i]nspect [b]reakpoint [c]ontinue [p]rev [l]ist [q]uit`, quit: false };
}

/**
 * Format initial debug session header.
 */
export function formatDebugHeader(trace: AgentTrace): string {
  const totalSteps = trace.steps.length;
  const cost = calculateCost(trace);
  const lines = [
    `🔍 AgentProbe Debugger`,
    `Trace: ${trace.id} (${totalSteps} steps)`,
    `Total cost: $${cost.total_cost.toFixed(4)}`,
    '',
    formatStep(trace.steps[0], 0, totalSteps),
    '',
    '[s]tep | [n]ext | [i]nspect | [b]reakpoint | [c]ontinue | [p]rev | [l]ist | [q]uit',
  ];
  return lines.join('\n');
}
