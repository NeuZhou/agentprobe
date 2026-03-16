/**
 * Trace Viewer — Visual trace inspection in terminal.
 */

import type { AgentTrace } from './types';

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
  const durationStr =
    totalDuration >= 1000 ? `${(totalDuration / 1000).toFixed(1)}s` : `${totalDuration}ms`;
  const tokensIn = trace.steps.reduce((s, st) => s + (st.data.tokens?.input ?? 0), 0);
  const tokensOut = trace.steps.reduce((s, st) => s + (st.data.tokens?.output ?? 0), 0);
  const toolsCalled = [
    ...new Set(trace.steps.filter((s) => s.type === 'tool_call').map((s) => s.data.tool_name!)),
  ];

  // Header
  lines.push(`┌${hr}┐`);
  lines.push(
    `│ Trace: ${trace.id.slice(0, 24).padEnd(24)}│ ${durationStr.padStart(5)} │ ${String(trace.steps.length).padStart(2)} steps │`,
  );
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

/**
 * Format a Gantt-style timeline visualization of a trace.
 */
export function formatTraceTimeline(trace: AgentTrace): string {
  const lines: string[] = [];
  const steps = trace.steps;

  if (steps.length === 0) return 'No steps to display.';

  // Calculate total duration and build timeline entries
  interface TimelineEntry {
    label: string;
    start_ms: number;
    end_ms: number;
  }

  const entries: TimelineEntry[] = [];
  let elapsed = 0;

  for (const step of steps) {
    const dur = step.duration_ms ?? 0;
    let label: string;

    if (step.type === 'llm_call') {
      label = `LLM Call${step.data.model ? ` (${step.data.model})` : ''}`;
    } else if (step.type === 'tool_call') {
      label = step.data.tool_name ?? 'tool';
    } else if (step.type === 'tool_result') {
      elapsed += dur;
      continue; // merge with tool_call
    } else if (step.type === 'output') {
      label = 'Output';
    } else if (step.type === 'thought') {
      label = 'Thinking';
    } else {
      label = step.type;
    }

    entries.push({ label, start_ms: elapsed, end_ms: elapsed + dur });
    elapsed += dur;
  }

  if (entries.length === 0) return 'No timeline entries.';

  const totalMs = elapsed || 1;
  const chartWidth = 50;
  const labelWidth = Math.min(20, Math.max(...entries.map((e) => e.label.length)));

  // Header with time scale
  const intervals = 5;
  const intervalMs = totalMs / intervals;

  let header = ' '.repeat(labelWidth + 2);
  for (let i = 0; i <= intervals; i++) {
    const ms = Math.round(intervalMs * i);
    const label = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
    header += label.padEnd(Math.floor(chartWidth / intervals));
  }
  lines.push(header);

  let ruler = ' '.repeat(labelWidth + 2);
  for (let i = 0; i <= intervals; i++) {
    ruler += '|' + (i < intervals ? '·'.repeat(Math.floor(chartWidth / intervals) - 1) : '');
  }
  lines.push(ruler);

  // Entries
  for (const entry of entries) {
    const startFrac = entry.start_ms / totalMs;
    const endFrac = entry.end_ms / totalMs;
    const startCol = Math.floor(startFrac * chartWidth);
    const endCol = Math.max(startCol + 1, Math.floor(endFrac * chartWidth));

    const bar =
      '░'.repeat(startCol) +
      '█'.repeat(endCol - startCol) +
      '░'.repeat(Math.max(0, chartWidth - endCol));

    const label = entry.label.padEnd(labelWidth).slice(0, labelWidth);
    const dur = entry.end_ms - entry.start_ms;
    const durStr = dur >= 1000 ? `${(dur / 1000).toFixed(1)}s` : `${dur}ms`;

    lines.push(`${label}  ${bar} ${durStr}`);
  }

  // Summary
  lines.push('');
  const totalStr = totalMs >= 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`;
  lines.push(`Total: ${totalStr} | ${entries.length} operations`);

  return lines.join('\n');
}
