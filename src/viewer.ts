/**
 * Trace Viewer — Visual trace inspection in terminal.
 */

import type { AgentTrace, TraceStep } from './types';

const ICONS: Record<string, string> = {
  llm_call: '🧠',
  tool_call: '🔧',
  tool_result: '📥',
  thought: '💭',
  output: '📤',
};

/**
 * Format a trace for terminal display with box-drawing characters.
 */
export function formatTraceView(trace: AgentTrace): string {
  const lines: string[] = [];
  const width = 60;
  const hr = '─'.repeat(width - 2);

  // Calculate totals
  const totalDuration = trace.steps.reduce((s, st) => s + (st.duration_ms ?? 0), 0);
  const durationStr = totalDuration >= 1000
    ? `${(totalDuration / 1000).toFixed(1)}s`
    : `${totalDuration}ms`;
  const tokensIn = trace.steps.reduce((s, st) => s + (st.data.tokens?.input ?? 0), 0);
  const tokensOut = trace.steps.reduce((s, st) => s + (st.data.tokens?.output ?? 0), 0);
  const toolsCalled = [...new Set(
    trace.steps.filter(s => s.type === 'tool_call').map(s => s.data.tool_name!)
  )];

  // Header
  lines.push(`┌${hr}┐`);
  lines.push(`│ Trace: ${trace.id.slice(0, 24).padEnd(24)}│ ${durationStr.padStart(5)} │ ${String(trace.steps.length).padStart(2)} steps │`);
  lines.push(`├${hr}┤`);

  // Steps
  let elapsed = 0;
  for (const step of trace.steps) {
    const icon = ICONS[step.type] ?? '❓';
    const time = `[${(elapsed / 1000).toFixed(1)}s]`;

    let detail = '';
    if (step.type === 'tool_call') {
      const args = JSON.stringify(step.data.tool_args ?? {}).slice(0, 30);
      detail = `Tool: ${step.data.tool_name}(${args})`;
    } else if (step.type === 'tool_result') {
      const res = JSON.stringify(step.data.tool_result ?? step.data.content ?? '').slice(0, 35);
      detail = `Result: ${res}`;
    } else if (step.type === 'llm_call') {
      detail = `LLM Call (${step.data.model ?? 'unknown'})`;
    } else if (step.type === 'output') {
      detail = `Output: "${(step.data.content ?? '').slice(0, 35)}..."`;
    } else if (step.type === 'thought') {
      detail = `"${(step.data.content ?? '').slice(0, 40)}..."`;
    }

    const content = `${time} ${icon} ${detail}`;
    lines.push(`│ ${content.padEnd(width - 4)} │`);

    elapsed += step.duration_ms ?? 0;
  }

  // Footer
  lines.push(`├${hr}┤`);
  const footer = `Tokens: ${tokensIn} in / ${tokensOut} out │ Tools: ${toolsCalled.length} called`;
  lines.push(`│ ${footer.padEnd(width - 4)} │`);
  lines.push(`└${hr}┘`);

  return lines.join('\n');
}
