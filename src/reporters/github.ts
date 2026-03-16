/**
 * GitHub Actions Reporter — Output annotations for CI integration.
 * @since 4.5.0
 */

import type { SuiteResult } from '../types';

export interface GitHubAnnotation {
  level: 'error' | 'warning' | 'notice';
  message: string;
  title?: string;
  file?: string;
  line?: number;
}

/**
 * Generate GitHub Actions annotations from test results.
 */
export function reportGitHub(result: SuiteResult): string {
  const lines: string[] = [];

  for (const test of result.results) {
    if (test.skipped) {
      lines.push(formatAnnotation({
        level: 'notice',
        title: `⏭️ Skipped: ${test.name}`,
        message: test.skipReason ?? 'Test skipped',
      }));
      continue;
    }

    if (!test.passed) {
      const failedAssertions = test.assertions.filter(a => !a.passed);
      const messages = failedAssertions.map(a => {
        return a.message ?? `${a.name}: expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`;
      });

      if (test.error) {
        messages.push(`Error: ${test.error}`);
      }

      lines.push(formatAnnotation({
        level: 'error',
        title: `❌ Failed: ${test.name}`,
        message: messages.join('\n'),
      }));
    }
  }

  // Summary as notice
  const pct = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;
  lines.push(formatAnnotation({
    level: result.failed > 0 ? 'warning' : 'notice',
    title: `🔬 AgentProbe: ${result.name}`,
    message: `${result.passed}/${result.total} passed (${pct}%) in ${result.duration_ms}ms`,
  }));

  // GitHub Actions step summary (markdown)
  lines.push('');
  lines.push(generateStepSummary(result));

  return lines.join('\n');
}

/**
 * Format a single annotation line.
 */
export function formatAnnotation(annotation: GitHubAnnotation): string {
  const { level, message, title, file, line } = annotation;
  const parts: string[] = [`::${level}`];
  const attrs: string[] = [];

  if (file) attrs.push(`file=${file}`);
  if (line) attrs.push(`line=${line}`);
  if (title) attrs.push(`title=${escapeProperty(title)}`);

  if (attrs.length > 0) {
    parts[0] += ` ${attrs.join(',')}`;
  }

  parts.push(`::${escapeData(message)}`);
  return parts.join('');
}

/**
 * Generate GitHub Actions step summary (Markdown for GITHUB_STEP_SUMMARY).
 */
export function generateStepSummary(result: SuiteResult): string {
  const pct = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;
  const lines: string[] = [];

  lines.push('### 🔬 AgentProbe Results');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Tests | ${result.total} |`);
  lines.push(`| Passed | ${result.passed} |`);
  lines.push(`| Failed | ${result.failed} |`);
  lines.push(`| Pass Rate | ${pct}% |`);
  lines.push(`| Duration | ${result.duration_ms}ms |`);
  lines.push('');

  if (result.failed > 0) {
    lines.push('<details><summary>❌ Failed Tests</summary>');
    lines.push('');
    for (const test of result.results.filter(t => !t.passed && !t.skipped)) {
      lines.push(`**${test.name}**`);
      for (const a of test.assertions.filter(a => !a.passed)) {
        lines.push(`- ${a.name}: ${a.message ?? 'failed'}`);
      }
      lines.push('');
    }
    lines.push('</details>');
  }

  return lines.join('\n');
}

/**
 * Parse annotations from reporter output.
 */
export function parseAnnotations(output: string): GitHubAnnotation[] {
  const annotations: GitHubAnnotation[] = [];
  const regex = /^::(error|warning|notice)\s*([^:]*)::(.*)$/gm;
  let match;

  while ((match = regex.exec(output)) !== null) {
    const level = match[1] as 'error' | 'warning' | 'notice';
    const attrs = match[2].trim();
    const message = unescapeData(match[3]);

    let title: string | undefined;
    let file: string | undefined;
    let line: number | undefined;

    if (attrs) {
      const titleMatch = attrs.match(/title=([^,]*)/);
      if (titleMatch) title = unescapeProperty(titleMatch[1]);
      const fileMatch = attrs.match(/file=([^,]*)/);
      if (fileMatch) file = fileMatch[1];
      const lineMatch = attrs.match(/line=(\d+)/);
      if (lineMatch) line = parseInt(lineMatch[1], 10);
    }

    annotations.push({ level, message, title, file, line });
  }

  return annotations;
}

function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function unescapeData(s: string): string {
  return s.replace(/%0A/g, '\n').replace(/%0D/g, '\r').replace(/%25/g, '%');
}

function escapeProperty(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function unescapeProperty(s: string): string {
  return s.replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%0A/g, '\n').replace(/%0D/g, '\r').replace(/%25/g, '%');
}
