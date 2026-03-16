/**
 * Trace Visualizer for AgentProbe v4.12.0
 *
 * Renders OTel spans as ASCII timeline, waterfall, and flame graph.
 */

import type { OTelSpan } from '../otel';

export class TraceVisualizer {
  /**
   * Render spans as a tree timeline:
   * ├─ test-1 ─────────────── 2.3s
   * │  ├─ tool:search ────── 1.1s
   * │  ├─ tool:calculate ─── 0.3s
   * │  └─ assertion ──────── 0.1s
   */
  renderTimeline(spans: OTelSpan[]): string {
    if (spans.length === 0) return '(no spans)';

    const rootSpans = spans.filter(s => !s.parentSpanId);
    const childMap = new Map<string, OTelSpan[]>();

    for (const span of spans) {
      if (span.parentSpanId) {
        if (!childMap.has(span.parentSpanId)) childMap.set(span.parentSpanId, []);
        childMap.get(span.parentSpanId)!.push(span);
      }
    }

    const lines: string[] = [];

    for (const root of rootSpans) {
      this.renderTimelineNode(root, childMap, lines, '', true);
    }

    return lines.join('\n');
  }

  private renderTimelineNode(
    span: OTelSpan,
    childMap: Map<string, OTelSpan[]>,
    lines: string[],
    prefix: string,
    isLast: boolean,
  ): void {
    const durationSec = (span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000_000;
    const durationStr = durationSec >= 1 ? `${durationSec.toFixed(1)}s` : `${(durationSec * 1000).toFixed(0)}ms`;
    const status = span.status.code === 'ERROR' ? '❌' : '✅';

    const nameWidth = 25;
    const name = span.operationName.length > nameWidth
      ? span.operationName.slice(0, nameWidth - 2) + '..'
      : span.operationName;
    const barLen = Math.max(1, Math.min(20, Math.round(durationSec * 5)));
    const bar = '─'.repeat(barLen);

    const connector = prefix === '' ? '' : (isLast ? '└─ ' : '├─ ');
    lines.push(`${prefix}${connector}${status} ${name.padEnd(nameWidth)} ${bar} ${durationStr}`);

    const children = childMap.get(span.spanId) || [];
    const childPrefix = prefix === '' ? '' : prefix + (isLast ? '   ' : '│  ');

    for (let i = 0; i < children.length; i++) {
      this.renderTimelineNode(children[i], childMap, lines, childPrefix, i === children.length - 1);
    }
  }

  /**
   * Render spans as a waterfall chart (horizontal bars showing relative timing).
   */
  renderWaterfall(spans: OTelSpan[]): string {
    if (spans.length === 0) return '(no spans)';

    const minStart = Math.min(...spans.map(s => s.startTimeUnixNano));
    const maxEnd = Math.max(...spans.map(s => s.endTimeUnixNano));
    const totalRange = maxEnd - minStart;
    if (totalRange === 0) return '(zero duration)';

    const WIDTH = 50;
    const lines: string[] = [];

    // Header
    const totalMs = totalRange / 1_000_000;
    lines.push(`Waterfall (total: ${(totalMs / 1000).toFixed(2)}s)`);
    lines.push('─'.repeat(WIDTH + 35));

    // Sort by start time
    const sorted = [...spans].sort((a, b) => a.startTimeUnixNano - b.startTimeUnixNano);

    for (const span of sorted) {
      const relStart = (span.startTimeUnixNano - minStart) / totalRange;
      const relEnd = (span.endTimeUnixNano - minStart) / totalRange;
      const barStart = Math.floor(relStart * WIDTH);
      const barEnd = Math.max(barStart + 1, Math.floor(relEnd * WIDTH));
      const durationMs = (span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000;

      const name = span.operationName.slice(0, 22).padEnd(22);
      const bar = ' '.repeat(barStart) + '█'.repeat(barEnd - barStart) + ' '.repeat(WIDTH - barEnd);
      const statusIcon = span.status.code === 'ERROR' ? '❌' : '  ';

      lines.push(`${statusIcon} ${name} |${bar}| ${durationMs.toFixed(0)}ms`);
    }

    lines.push('─'.repeat(WIDTH + 35));
    return lines.join('\n');
  }

  /**
   * Render spans as a flame graph (collapsed stack view).
   */
  renderFlameGraph(spans: OTelSpan[]): string {
    if (spans.length === 0) return '(no spans)';

    const minStart = Math.min(...spans.map(s => s.startTimeUnixNano));
    const maxEnd = Math.max(...spans.map(s => s.endTimeUnixNano));
    const totalRange = maxEnd - minStart;
    if (totalRange === 0) return '(zero duration)';

    const WIDTH = 60;
    const lines: string[] = [];
    lines.push('Flame Graph');
    lines.push('═'.repeat(WIDTH));

    // Build depth map
    const depthMap = new Map<string, number>();
    const rootSpans = spans.filter(s => !s.parentSpanId);
    for (const root of rootSpans) {
      depthMap.set(root.spanId, 0);
    }

    // BFS to assign depths
    const queue = [...rootSpans];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const depth = depthMap.get(current.spanId) ?? 0;
      const children = spans.filter(s => s.parentSpanId === current.spanId);
      for (const child of children) {
        depthMap.set(child.spanId, depth + 1);
        queue.push(child);
      }
    }

    // Sort by depth then start time
    const sorted = [...spans].sort((a, b) => {
      const da = depthMap.get(a.spanId) ?? 0;
      const db = depthMap.get(b.spanId) ?? 0;
      return da !== db ? da - db : a.startTimeUnixNano - b.startTimeUnixNano;
    });

    for (const span of sorted) {
      const depth = depthMap.get(span.spanId) ?? 0;
      const relWidth = (span.endTimeUnixNano - span.startTimeUnixNano) / totalRange;
      const barLen = Math.max(1, Math.round(relWidth * (WIDTH - depth * 2)));
      const indent = '  '.repeat(depth);
      const durationMs = (span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000;

      const name = span.operationName.slice(0, barLen - 2);
      const fill = barLen > name.length + 2 ? '░'.repeat(barLen - name.length - 2) : '';
      const statusChar = span.status.code === 'ERROR' ? '!' : ' ';

      lines.push(`${indent}[${statusChar}${name}${fill}] ${durationMs.toFixed(0)}ms`);
    }

    lines.push('═'.repeat(WIDTH));
    return lines.join('\n');
  }
}
