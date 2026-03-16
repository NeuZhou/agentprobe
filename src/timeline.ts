/**
 * Trace Timeline Viewer — Generate interactive HTML timelines from traces
 */

import * as fs from 'fs';
import type { AgentTrace } from './types';

export interface TimelineEvent {
  label: string;
  type: string;
  start_ms: number;
  duration_ms: number;
  cost_usd: number;
  detail?: string;
}

export interface TimelineSummary {
  events: TimelineEvent[];
  total_ms: number;
  total_cost: number;
  step_count: number;
}

/**
 * Parse a trace into timeline events with relative offsets.
 */
export function parseTimeline(trace: AgentTrace): TimelineSummary {
  const events: TimelineEvent[] = [];
  let offset = 0;

  for (const step of trace.steps) {
    const dur = step.duration_ms || 0;
    let label: string = step.type;
    let cost = 0;
    let detail: string | undefined;

    if (step.type === 'llm_call') {
      label = step.data.model ? `LLM (${step.data.model})` : 'LLM';
      if (step.data.tokens) {
        const inp = step.data.tokens.input || 0;
        const out = step.data.tokens.output || 0;
        cost = inp * 0.00001 + out * 0.00003;
        detail = `${inp} in / ${out} out tokens`;
      }
    } else if (step.type === 'tool_call') {
      label = step.data.tool_name || 'tool';
      detail = step.data.tool_args ? JSON.stringify(step.data.tool_args).slice(0, 100) : undefined;
    } else if (step.type === 'tool_result') {
      label = 'result';
      const result = step.data.tool_result;
      detail = typeof result === 'string' ? result.slice(0, 80) : JSON.stringify(result)?.slice(0, 80);
    } else if (step.type === 'output') {
      label = 'Response';
      detail = step.data.content?.slice(0, 80);
    } else if (step.type === 'thought') {
      label = 'Think';
      detail = step.data.content?.slice(0, 80);
    }

    events.push({ label, type: step.type, start_ms: offset, duration_ms: dur, cost_usd: cost, detail });
    offset += dur;
  }

  return {
    events,
    total_ms: offset,
    total_cost: events.reduce((s, e) => s + e.cost_usd, 0),
    step_count: events.length,
  };
}

/**
 * Format timeline as ASCII for console output.
 */
export function formatTimelineAscii(summary: TimelineSummary): string {
  const lines: string[] = [];
  lines.push(`Timeline: ${summary.step_count} steps, ${summary.total_ms}ms, $${summary.total_cost.toFixed(4)}`);
  lines.push('');

  const maxWidth = 60;
  const scale = summary.total_ms > 0 ? maxWidth / summary.total_ms : 1;

  for (const ev of summary.events) {
    const barLen = Math.max(1, Math.round(ev.duration_ms * scale));
    const padLen = Math.round(ev.start_ms * scale);
    const bar = ' '.repeat(padLen) + '█'.repeat(barLen);
    const label = `${ev.label} (${ev.duration_ms}ms)`;
    lines.push(`  ${label.padEnd(25)} |${bar}|`);
  }

  return lines.join('\n');
}

const TYPE_COLORS: Record<string, string> = {
  llm_call: '#4f46e5',
  tool_call: '#059669',
  tool_result: '#d97706',
  output: '#dc2626',
  thought: '#7c3aed',
};

/**
 * Generate an interactive HTML timeline page.
 */
export function generateTimelineHTML(trace: AgentTrace): string {
  const summary = parseTimeline(trace);
  const eventsJSON = JSON.stringify(summary.events);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AgentProbe Timeline — ${trace.id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 1.5rem; margin-bottom: 8px; }
  .meta { color: #94a3b8; margin-bottom: 24px; font-size: 0.9rem; }
  .timeline { position: relative; margin: 20px 0; }
  .event { display: flex; align-items: center; margin: 4px 0; height: 32px; }
  .event-label { width: 160px; text-align: right; padding-right: 12px; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .event-bar { height: 24px; border-radius: 4px; min-width: 4px; position: relative; cursor: pointer; transition: opacity 0.2s; }
  .event-bar:hover { opacity: 0.8; }
  .event-bar .tooltip { display: none; position: absolute; bottom: 100%; left: 0; background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; font-size: 0.8rem; white-space: nowrap; z-index: 10; }
  .event-bar:hover .tooltip { display: block; }
  .summary { margin-top: 24px; padding: 16px; background: #1e293b; border-radius: 8px; display: flex; gap: 32px; }
  .summary-item { text-align: center; }
  .summary-value { font-size: 1.4rem; font-weight: bold; color: #38bdf8; }
  .summary-label { font-size: 0.8rem; color: #94a3b8; }
  .legend { display: flex; gap: 16px; margin-top: 16px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; }
  .legend-color { width: 12px; height: 12px; border-radius: 2px; }
</style>
</head>
<body>
<h1>🔬 AgentProbe Trace Timeline</h1>
<div class="meta">Trace: ${trace.id} | Steps: ${summary.step_count} | Total: ${summary.total_ms}ms | Cost: $${summary.total_cost.toFixed(4)}</div>

<div class="legend">
  <div class="legend-item"><div class="legend-color" style="background:${TYPE_COLORS.llm_call}"></div>LLM Call</div>
  <div class="legend-item"><div class="legend-color" style="background:${TYPE_COLORS.tool_call}"></div>Tool Call</div>
  <div class="legend-item"><div class="legend-color" style="background:${TYPE_COLORS.tool_result}"></div>Tool Result</div>
  <div class="legend-item"><div class="legend-color" style="background:${TYPE_COLORS.output}"></div>Output</div>
  <div class="legend-item"><div class="legend-color" style="background:${TYPE_COLORS.thought}"></div>Thought</div>
</div>

<div class="timeline" id="timeline"></div>

<div class="summary">
  <div class="summary-item"><div class="summary-value">${summary.step_count}</div><div class="summary-label">Steps</div></div>
  <div class="summary-item"><div class="summary-value">${summary.total_ms}ms</div><div class="summary-label">Duration</div></div>
  <div class="summary-item"><div class="summary-value">$${summary.total_cost.toFixed(4)}</div><div class="summary-label">Est. Cost</div></div>
</div>

<script>
const events = ${eventsJSON};
const total = ${summary.total_ms || 1};
const colors = ${JSON.stringify(TYPE_COLORS)};
const container = document.getElementById('timeline');
const maxBarWidth = container.clientWidth - 180;

events.forEach(ev => {
  const row = document.createElement('div');
  row.className = 'event';
  const label = document.createElement('div');
  label.className = 'event-label';
  label.textContent = ev.label;
  const bar = document.createElement('div');
  bar.className = 'event-bar';
  const left = (ev.start_ms / total) * maxBarWidth;
  const width = Math.max(4, (ev.duration_ms / total) * maxBarWidth);
  bar.style.marginLeft = left + 'px';
  bar.style.width = width + 'px';
  bar.style.background = colors[ev.type] || '#64748b';
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.textContent = ev.label + ' — ' + ev.duration_ms + 'ms' + (ev.cost_usd > 0 ? ' ($' + ev.cost_usd.toFixed(4) + ')' : '') + (ev.detail ? '\\n' + ev.detail : '');
  bar.appendChild(tip);
  row.appendChild(label);
  row.appendChild(bar);
  container.appendChild(row);
});
</script>
</body>
</html>`;
}

/**
 * Write timeline HTML to a file.
 */
export function writeTimelineHTML(trace: AgentTrace, outputPath: string): void {
  const html = generateTimelineHTML(trace);
  fs.writeFileSync(outputPath, html, 'utf-8');
}
