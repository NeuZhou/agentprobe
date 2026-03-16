import type { SuiteResult, ReportFormat } from './types';

export function report(result: SuiteResult, format: ReportFormat = 'console'): string {
  switch (format) {
    case 'json':
      return reportJSON(result);
    case 'markdown':
      return reportMarkdown(result);
    case 'console':
    default:
      return reportConsole(result);
  }
}

function reportConsole(result: SuiteResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  ${result.name}`);
  lines.push(`  ${'─'.repeat(50)}`);

  for (const test of result.results) {
    const icon = test.passed ? '✅' : '❌';
    lines.push(`  ${icon} ${test.name} (${test.duration_ms}ms)`);
    if (!test.passed) {
      for (const a of test.assertions.filter(a => !a.passed)) {
        lines.push(`     └─ ${a.name}: ${a.message ?? `expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`}`);
      }
      if (test.error) {
        lines.push(`     └─ Error: ${test.error}`);
      }
    }
  }

  lines.push(`  ${'─'.repeat(50)}`);
  const pct = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;
  lines.push(`  ${result.passed}/${result.total} passed (${pct}%) in ${result.duration_ms}ms`);
  lines.push('');

  return lines.join('\n');
}

function reportJSON(result: SuiteResult): string {
  return JSON.stringify(result, null, 2);
}

function reportMarkdown(result: SuiteResult): string {
  const lines: string[] = [];
  lines.push(`## 🔬 AgentProbe: ${result.name}`);
  lines.push('');
  lines.push(`| Test | Status | Duration |`);
  lines.push(`|------|--------|----------|`);

  for (const test of result.results) {
    const icon = test.passed ? '✅' : '❌';
    lines.push(`| ${test.name} | ${icon} | ${test.duration_ms}ms |`);
  }

  lines.push('');
  const pct = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;
  lines.push(`**${result.passed}/${result.total} passed (${pct}%)** in ${result.duration_ms}ms`);

  if (result.failed > 0) {
    lines.push('');
    lines.push('### Failures');
    for (const test of result.results.filter(t => !t.passed)) {
      lines.push(`#### ❌ ${test.name}`);
      for (const a of test.assertions.filter(a => !a.passed)) {
        lines.push(`- ${a.name}: ${a.message ?? `expected \`${JSON.stringify(a.expected)}\`, got \`${JSON.stringify(a.actual)}\``}`);
      }
    }
  }

  return lines.join('\n');
}
