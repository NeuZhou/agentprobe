import chalk from 'chalk';
import type { SuiteResult, ReportFormat, TestResult } from './types';
import { reportHTML } from './reporters/html';

export function report(result: SuiteResult, format: ReportFormat = 'console'): string {
  switch (format) {
    case 'json':
      return reportJSON(result);
    case 'markdown':
      return reportMarkdown(result);
    case 'html':
      return reportHTML(result);
    case 'console':
    default:
      return reportConsole(result);
  }
}

function reportConsole(result: SuiteResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold(`  🔬 ${result.name}`));
  lines.push(chalk.dim(`  ${'━'.repeat(50)}`));

  for (const test of result.results) {
    const icon = test.passed ? chalk.green('✅') : chalk.red('❌');
    const name = test.passed ? chalk.green(test.name) : chalk.red(test.name);
    const duration = chalk.dim(`(${test.duration_ms}ms)`);
    const tags = test.tags?.length ? chalk.dim(` [${test.tags.join(', ')}]`) : '';
    lines.push(`  ${icon} ${name} ${duration}${tags}`);

    if (!test.passed) {
      for (const a of test.assertions.filter(a => !a.passed)) {
        const msg = a.message ?? `expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`;
        lines.push(chalk.red(`     ↳ ${a.name}: ${msg}`));
      }
      if (test.error) {
        lines.push(chalk.red(`     ↳ Error: ${test.error}`));
      }
    }
  }

  lines.push(chalk.dim(`  ${'━'.repeat(50)}`));

  // Summary
  const pct = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;
  const summary = `${result.passed}/${result.total} passed (${pct}%) in ${result.duration_ms}ms`;
  lines.push(result.failed > 0 ? chalk.red(`  ${summary}`) : chalk.green(`  ${summary}`));

  // Progress bar
  if (result.total > 0) {
    const barLen = 30;
    const filled = Math.round((result.passed / result.total) * barLen);
    const bar = chalk.green('█'.repeat(filled)) + chalk.red('█'.repeat(barLen - filled));
    lines.push(`  [${bar}]`);
  }

  // Stats
  if (result.results.length > 0) {
    lines.push('');
    const durations = result.results.map(r => ({ name: r.name, ms: r.duration_ms }));
    durations.sort((a, b) => b.ms - a.ms);
    const slowest = durations[0];
    lines.push(chalk.dim(`  🐢 Slowest: ${slowest.name} (${slowest.ms}ms)`));

    const totalAssertions = result.results.reduce((sum, r) => sum + r.assertions.length, 0);
    lines.push(chalk.dim(`  📋 Total assertions: ${totalAssertions}`));

    const mostAssertions = result.results.reduce((max, r) =>
      r.assertions.length > max.assertions.length ? r : max, result.results[0]);
    lines.push(chalk.dim(`  🏆 Most assertions: ${mostAssertions.name} (${mostAssertions.assertions.length})`));
  }

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
  lines.push(`| Test | Status | Duration | Tags |`);
  lines.push(`|------|--------|----------|------|`);

  for (const test of result.results) {
    const icon = test.passed ? '✅' : '❌';
    const tags = test.tags?.join(', ') ?? '';
    lines.push(`| ${test.name} | ${icon} | ${test.duration_ms}ms | ${tags} |`);
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
