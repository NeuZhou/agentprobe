/**
 * Trace Visualization — Mermaid sequence diagrams from traces.
 *
 * Generates Mermaid sequence diagram syntax from AgentProbe traces,
 * showing the flow between User, Agent, and Tools.
 */

import type { AgentTrace } from './types';

export type VizFormat = 'mermaid' | 'text' | 'html';

export interface VizOptions {
  format: VizFormat;
  showTimings?: boolean;
  showTokens?: boolean;
  maxSteps?: number;
  title?: string;
}

/**
 * Escape special Mermaid characters in a string.
 */
function escape(s: string): string {
  return s.replace(/"/g, "'").replace(/[<>{}]/g, '').replace(/\n/g, ' ').slice(0, 80);
}

/**
 * Format milliseconds nicely.
 */
function fmtMs(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Generate Mermaid sequence diagram from a trace.
 */
export function traceToMermaid(trace: AgentTrace, options: Partial<VizOptions> = {}): string {
  const { showTimings = true, showTokens = false, maxSteps, title } = options;
  const steps = maxSteps ? trace.steps.slice(0, maxSteps) : trace.steps;

  const lines: string[] = [];
  lines.push('sequenceDiagram');
  if (title) {
    lines.push(`    title ${title}`);
  }
  lines.push('    participant U as User');
  lines.push('    participant A as Agent');

  // Collect unique tools
  const tools = new Set<string>();
  for (const step of steps) {
    if (step.type === 'tool_call' && step.data.tool_name) {
      tools.add(step.data.tool_name);
    }
  }
  for (const tool of tools) {
    lines.push(`    participant T_${sanitize(tool)} as ${tool}`);
  }

  // Track state for grouping
  let lastUserMessage = '';

  for (const step of steps) {
    const timing = showTimings && step.duration_ms ? ` (${fmtMs(step.duration_ms)})` : '';
    const tokens = showTokens && step.data.tokens
      ? ` [${step.data.tokens.input || 0}→${step.data.tokens.output || 0} tok]`
      : '';

    switch (step.type) {
      case 'llm_call': {
        // Find user message in messages array
        const userMsg = step.data.messages?.find(m => m.role === 'user');
        if (userMsg && userMsg.content !== lastUserMessage) {
          lastUserMessage = userMsg.content;
          lines.push(`    U->>A: "${escape(userMsg.content)}"`);
        }
        if (step.data.model) {
          lines.push(`    Note right of A: model: ${step.data.model}${tokens}`);
        }
        break;
      }
      case 'tool_call': {
        const tool = step.data.tool_name || 'unknown';
        const args = step.data.tool_args
          ? escape(JSON.stringify(step.data.tool_args))
          : '';
        lines.push(`    A->>T_${sanitize(tool)}: ${args}${timing}`);
        break;
      }
      case 'tool_result': {
        const tool = step.data.tool_name || 'unknown';
        const result = step.data.tool_result
          ? escape(typeof step.data.tool_result === 'string' ? step.data.tool_result : JSON.stringify(step.data.tool_result))
          : 'result';
        lines.push(`    T_${sanitize(tool)}-->>A: ${result}`);
        break;
      }
      case 'thought': {
        if (step.data.content) {
          lines.push(`    Note over A: 💭 ${escape(step.data.content)}`);
        }
        break;
      }
      case 'output': {
        if (step.data.content) {
          lines.push(`    A->>U: "${escape(step.data.content)}"`);
        }
        break;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Sanitize a tool name for use as a Mermaid participant ID.
 */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Generate plain text sequence from a trace.
 */
export function traceToText(trace: AgentTrace, options: Partial<VizOptions> = {}): string {
  const { maxSteps } = options;
  const steps = maxSteps ? trace.steps.slice(0, maxSteps) : trace.steps;
  const lines: string[] = [];

  for (const step of steps) {
    const timing = step.duration_ms ? ` (${fmtMs(step.duration_ms)})` : '';
    switch (step.type) {
      case 'llm_call': {
        const userMsg = step.data.messages?.find(m => m.role === 'user');
        if (userMsg) lines.push(`User → Agent: "${userMsg.content.slice(0, 100)}"`);
        break;
      }
      case 'tool_call':
        lines.push(`Agent → ${step.data.tool_name}: ${JSON.stringify(step.data.tool_args || {}).slice(0, 100)}${timing}`);
        break;
      case 'tool_result':
        lines.push(`${step.data.tool_name} → Agent: ${JSON.stringify(step.data.tool_result || '').slice(0, 100)}`);
        break;
      case 'thought':
        lines.push(`Agent thinks: "${(step.data.content || '').slice(0, 100)}"`);
        break;
      case 'output':
        lines.push(`Agent → User: "${(step.data.content || '').slice(0, 100)}"`);
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Generate HTML with embedded Mermaid diagram.
 */
export function traceToHtml(trace: AgentTrace, options: Partial<VizOptions> = {}): string {
  const mermaid = traceToMermaid(trace, options);
  return `<!DOCTYPE html>
<html>
<head>
  <title>AgentProbe Trace Visualization</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body { font-family: sans-serif; padding: 2rem; background: #f8f9fa; }
    h1 { color: #2d3748; }
    .mermaid { background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .meta { color: #718096; font-size: 0.9rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>🔍 AgentProbe Trace</h1>
  <div class="meta">
    <p>Trace ID: ${trace.id} | Steps: ${trace.steps.length} | ${trace.timestamp}</p>
  </div>
  <div class="mermaid">
${mermaid}
  </div>
  <script>mermaid.initialize({ startOnLoad: true, theme: 'default' });</script>
</body>
</html>`;
}

/**
 * Generate visualization in the requested format.
 */
export function visualizeTrace(trace: AgentTrace, options: Partial<VizOptions> = {}): string {
  const format = options.format || 'mermaid';
  switch (format) {
    case 'mermaid': return traceToMermaid(trace, options);
    case 'text': return traceToText(trace, options);
    case 'html': return traceToHtml(trace, options);
    default: return traceToMermaid(trace, options);
  }
}
