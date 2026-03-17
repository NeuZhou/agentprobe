/**
 * Contract Reporter — Pretty-print contract violations and compliance reports
 */

import type { ContractResult, ContractViolation } from './schema';

/**
 * Format a single contract result as a human-readable string.
 */
export function formatContractResult(result: ContractResult): string {
  const icon = result.passed ? '✅' : '❌';
  const lines: string[] = [
    `${icon} Contract: ${result.contract} v${result.version}`,
    `   Rules checked: ${result.checkedRules}`,
    `   Errors: ${result.summary.errors} | Warnings: ${result.summary.warnings}`,
    `   Duration: ${result.duration_ms}ms`,
  ];

  if (result.violations.length > 0) {
    lines.push('');
    lines.push('   Violations:');
    for (const v of result.violations) {
      lines.push(formatViolation(v, '   '));
    }
  }

  return lines.join('\n');
}

function formatViolation(v: ContractViolation, indent: string = ''): string {
  const icon = v.severity === 'error' ? '❌' : v.severity === 'warning' ? '⚠️' : 'ℹ️';
  let line = `${indent}  ${icon} [${v.type}] ${v.rule}: ${v.message}`;
  if (v.expected !== undefined) {
    line += `\n${indent}     Expected: ${JSON.stringify(v.expected)}`;
    line += `\n${indent}     Actual:   ${JSON.stringify(v.actual)}`;
  }
  return line;
}

/**
 * Generate a Markdown compliance report from multiple contract results.
 */
export function generateMarkdownReport(
  results: ContractResult[],
  options?: { title?: string; includeTimestamp?: boolean },
): string {
  const title = options?.title ?? 'Agent Contract Compliance Report';
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push('');

  if (options?.includeTimestamp !== false) {
    lines.push(`> Generated: ${new Date().toISOString()}`);
    lines.push('');
  }

  // Summary table
  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.length - totalPassed;
  const totalViolations = results.reduce((s, r) => s + r.violations.length, 0);
  const totalErrors = results.reduce((s, r) => s + r.summary.errors, 0);
  const totalWarnings = results.reduce((s, r) => s + r.summary.warnings, 0);

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Contracts | ${results.length} |`);
  lines.push(`| Passed | ${totalPassed} |`);
  lines.push(`| Failed | ${totalFailed} |`);
  lines.push(`| Total Violations | ${totalViolations} |`);
  lines.push(`| Errors | ${totalErrors} |`);
  lines.push(`| Warnings | ${totalWarnings} |`);
  lines.push('');

  // Per-contract details
  lines.push('## Details');
  lines.push('');

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    lines.push(`### ${icon} ${result.contract} v${result.version}`);
    lines.push('');
    lines.push(`- **Status:** ${result.passed ? 'PASSED' : 'FAILED'}`);
    lines.push(`- **Rules checked:** ${result.checkedRules}`);
    lines.push(`- **Duration:** ${result.duration_ms}ms`);

    if (result.violations.length > 0) {
      lines.push('');
      lines.push('| Severity | Type | Rule | Message |');
      lines.push('| --- | --- | --- | --- |');
      for (const v of result.violations) {
        const sev = v.severity === 'error' ? '❌ Error' : v.severity === 'warning' ? '⚠️ Warning' : 'ℹ️ Info';
        lines.push(`| ${sev} | ${v.type} | \`${v.rule}\` | ${v.message} |`);
      }
    } else {
      lines.push('');
      lines.push('*No violations found.*');
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format results as a JSON report.
 */
export function generateJSONReport(results: ContractResult[]): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      totalViolations: results.reduce((s, r) => s + r.violations.length, 0),
    },
    results,
  }, null, 2);
}
