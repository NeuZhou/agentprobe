/**
 * Interactive Test Explorer — Terminal UI for browsing test results.
 * Simple text-based UI using readline (no curses dependency).
 */

import * as fs from 'fs';
import chalk from 'chalk';
import type { SuiteResult, TestResult } from './types';

export interface ExplorerOptions {
  reportPath: string;
}

/**
 * Load a suite result from a JSON report file.
 */
export function loadReport(reportPath: string): SuiteResult {
  const raw = fs.readFileSync(reportPath, 'utf-8');
  return JSON.parse(raw) as SuiteResult;
}

/**
 * Format a test list with pass/fail indicators.
 */
export function formatTestList(result: SuiteResult, selectedIndex: number): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold(`  🔬 ${result.name}`));
  lines.push(chalk.gray(`  ${result.passed}/${result.total} passed · ${result.duration_ms}ms`));
  lines.push('');

  for (let i = 0; i < result.results.length; i++) {
    const test = result.results[i];
    const icon = test.skipped ? '⏭️' : test.passed ? '✅' : '❌';
    const prefix = i === selectedIndex ? chalk.cyan(' ▶ ') : '   ';
    const name = i === selectedIndex ? chalk.cyan.bold(test.name) : test.name;
    const duration = chalk.gray(`${test.duration_ms}ms`);
    lines.push(`${prefix}${icon} ${name} ${duration}`);
  }

  lines.push('');
  lines.push(chalk.gray('  ↑/↓ Navigate · Enter: Details · q: Quit'));
  return lines.join('\n');
}

/**
 * Format test detail view.
 */
export function formatTestDetail(test: TestResult): string {
  const lines: string[] = [];
  const icon = test.skipped ? '⏭️' : test.passed ? '✅' : '❌';

  lines.push('');
  lines.push(chalk.bold(`  ${icon} ${test.name}`));
  lines.push(chalk.gray(`  Duration: ${test.duration_ms}ms`));
  if (test.tags?.length) {
    lines.push(chalk.gray(`  Tags: ${test.tags.join(', ')}`));
  }
  if (test.attempts && test.attempts > 1) {
    lines.push(chalk.gray(`  Attempts: ${test.attempts}`));
  }
  if (test.error) {
    lines.push(chalk.red(`  Error: ${test.error}`));
  }
  if (test.skipped) {
    lines.push(chalk.yellow(`  Skipped: ${test.skipReason ?? 'unknown reason'}`));
  }

  lines.push('');
  lines.push(chalk.bold('  Assertions:'));

  if (test.assertions.length === 0) {
    lines.push(chalk.gray('    (none)'));
  }

  for (const a of test.assertions) {
    const aIcon = a.passed ? chalk.green('✓') : chalk.red('✗');
    lines.push(`    ${aIcon} ${a.name}`);
    if (!a.passed && a.message) {
      for (const msgLine of a.message.split('\n')) {
        lines.push(chalk.red(`      ${msgLine}`));
      }
    }
    if (a.expected !== undefined && !a.passed) {
      lines.push(chalk.gray(`      Expected: ${JSON.stringify(a.expected)}`));
      lines.push(chalk.gray(`      Actual:   ${JSON.stringify(a.actual)}`));
    }
  }

  // Show trace summary if available
  if (test.trace) {
    lines.push('');
    lines.push(chalk.bold('  Trace Steps:'));
    const steps = test.trace.steps;
    const stepIcons: Record<string, string> = {
      llm_call: '🧠', tool_call: '🔧', tool_result: '📦', thought: '💭', output: '💬',
    };

    for (const step of steps.slice(0, 20)) {
      const sIcon = stepIcons[step.type] ?? '❓';
      const detail = step.data.tool_name
        ? `${step.data.tool_name}(${JSON.stringify(step.data.tool_args ?? {}).slice(0, 60)})`
        : (step.data.content?.slice(0, 80) ?? step.data.model ?? '');
      const dur = step.duration_ms ? chalk.gray(` ${step.duration_ms}ms`) : '';
      lines.push(`    ${sIcon} ${step.type} ${detail}${dur}`);
    }
    if (steps.length > 20) {
      lines.push(chalk.gray(`    ... and ${steps.length - 20} more steps`));
    }
  }

  lines.push('');
  lines.push(chalk.gray('  Press b to go back'));
  return lines.join('\n');
}

/**
 * Run the interactive explorer in the terminal.
 */
export async function runExplorer(reportPath: string): Promise<void> {
  if (!fs.existsSync(reportPath)) {
    console.error(chalk.red(`❌ File not found: ${reportPath}`));
    process.exit(1);
  }

  const result = loadReport(reportPath);

  if (result.results.length === 0) {
    console.log(chalk.yellow('No test results to explore.'));
    return;
  }

  let selectedIndex = 0;
  let mode: 'list' | 'detail' = 'list';

  const render = () => {
    console.clear();
    if (mode === 'list') {
      console.log(formatTestList(result, selectedIndex));
    } else {
      console.log(formatTestDetail(result.results[selectedIndex]));
    }
  };

  // Enable raw mode for keypress handling
  if (!process.stdin.isTTY) {
    // Non-interactive: just print the list
    console.log(formatTestList(result, -1));
    return;
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  render();

  return new Promise<void>((resolve) => {
    process.stdin.on('data', (key: string) => {
      if (key === 'q' || key === '\u0003') {
        // q or Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve();
        return;
      }

      if (mode === 'list') {
        if (key === '\u001b[A' || key === 'k') {
          // Up arrow or k
          selectedIndex = Math.max(0, selectedIndex - 1);
        } else if (key === '\u001b[B' || key === 'j') {
          // Down arrow or j
          selectedIndex = Math.min(result.results.length - 1, selectedIndex + 1);
        } else if (key === '\r' || key === '\n') {
          // Enter
          mode = 'detail';
        }
      } else {
        if (key === 'b' || key === '\u001b' || key === '\u001b[A') {
          mode = 'list';
        }
      }

      render();
    });
  });
}
