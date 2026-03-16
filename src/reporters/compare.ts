import * as fs from 'fs';
import type { SuiteResult } from '../types';

export interface ReportDelta {
  summary: {
    old: { passed: number; failed: number; total: number };
    new: { passed: number; failed: number; total: number };
    diff_passed: number;
    diff_failed: number;
  };
  new_failures: string[];
  fixed: string[];
  still_failing: string[];
  new_tests: string[];
  removed_tests: string[];
  duration_change_ms: number;
}

/**
 * Compare two report files (SuiteResult JSON or HTML with embedded data).
 */
export function compareReports(oldPath: string, newPath: string): ReportDelta {
  const oldResult = loadReportFile(oldPath);
  const newResult = loadReportFile(newPath);

  const oldNames = new Set(oldResult.results.map(r => r.name));
  const newNames = new Set(newResult.results.map(r => r.name));

  const oldFailing = new Set(oldResult.results.filter(r => !r.passed).map(r => r.name));
  const newFailing = new Set(newResult.results.filter(r => !r.passed).map(r => r.name));

  const newFailures = [...newFailing].filter(n => !oldFailing.has(n) && oldNames.has(n));
  const fixed = [...oldFailing].filter(n => !newFailing.has(n) && newNames.has(n));
  const stillFailing = [...newFailing].filter(n => oldFailing.has(n));
  const newTests = [...newNames].filter(n => !oldNames.has(n));
  const removedTests = [...oldNames].filter(n => !newNames.has(n));

  return {
    summary: {
      old: { passed: oldResult.passed, failed: oldResult.failed, total: oldResult.total },
      new: { passed: newResult.passed, failed: newResult.failed, total: newResult.total },
      diff_passed: newResult.passed - oldResult.passed,
      diff_failed: newResult.failed - oldResult.failed,
    },
    new_failures: newFailures,
    fixed,
    still_failing: stillFailing,
    new_tests: newTests,
    removed_tests: removedTests,
    duration_change_ms: newResult.duration_ms - oldResult.duration_ms,
  };
}

function loadReportFile(filePath: string): SuiteResult {
  const raw = fs.readFileSync(filePath, 'utf-8');

  if (filePath.endsWith('.html')) {
    // Try to extract JSON data from HTML report
    const match = raw.match(/data-report='([^']+)'/);
    if (match) {
      return JSON.parse(match[1]);
    }
    // Try embedded script
    const scriptMatch = raw.match(/const\s+reportData\s*=\s*(\{[\s\S]*?\});/);
    if (scriptMatch) {
      return JSON.parse(scriptMatch[1]);
    }
    throw new Error(`Cannot extract report data from HTML: ${filePath}`);
  }

  return JSON.parse(raw);
}

/**
 * Format report comparison for console output.
 */
export function formatReportDelta(delta: ReportDelta): string {
  const lines: string[] = [];
  const { summary: s } = delta;

  lines.push(`\n📊 Report Comparison\n`);
  lines.push(`  Old: ${s.old.passed}/${s.old.total} passed | New: ${s.new.passed}/${s.new.total} passed`);

  const passedSign = s.diff_passed >= 0 ? '+' : '';
  const failedSign = s.diff_failed >= 0 ? '+' : '';
  lines.push(`  Δ passed: ${passedSign}${s.diff_passed} | Δ failed: ${failedSign}${s.diff_failed}`);

  if (delta.duration_change_ms !== 0) {
    const sign = delta.duration_change_ms > 0 ? '+' : '';
    lines.push(`  Δ duration: ${sign}${delta.duration_change_ms}ms`);
  }

  if (delta.new_failures.length > 0) {
    lines.push(`\n  🔴 New failures (${delta.new_failures.length}):`);
    for (const f of delta.new_failures) lines.push(`     • ${f}`);
  }

  if (delta.fixed.length > 0) {
    lines.push(`\n  🟢 Fixed (${delta.fixed.length}):`);
    for (const f of delta.fixed) lines.push(`     • ${f}`);
  }

  if (delta.still_failing.length > 0) {
    lines.push(`\n  🟡 Still failing (${delta.still_failing.length}):`);
    for (const f of delta.still_failing) lines.push(`     • ${f}`);
  }

  if (delta.new_tests.length > 0) {
    lines.push(`\n  🆕 New tests (${delta.new_tests.length}):`);
    for (const t of delta.new_tests) lines.push(`     • ${t}`);
  }

  if (delta.removed_tests.length > 0) {
    lines.push(`\n  🗑️  Removed (${delta.removed_tests.length}):`);
    for (const t of delta.removed_tests) lines.push(`     • ${t}`);
  }

  return lines.join('\n');
}

/**
 * Generate an HTML delta report.
 */
export function generateDeltaHTML(delta: ReportDelta): string {
  const status = delta.new_failures.length > 0 ? '⚠️ Regressions' : delta.fixed.length > 0 ? '✅ Improvements' : '➡️ No change';

  return `<!DOCTYPE html>
<html>
<head>
  <title>AgentProbe Report Comparison</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
    .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem; }
    .card { background: #f8f9fa; padding: 1rem; border-radius: 8px; }
    .new-failure { color: #d63031; }
    .fixed { color: #00b894; }
    .still-failing { color: #fdcb6e; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
    ul { list-style: none; padding: 0; }
    li::before { content: "• "; }
  </style>
</head>
<body>
  <h1>${status}</h1>
  <div class="summary">
    <div class="card"><strong>Old:</strong> ${delta.summary.old.passed}/${delta.summary.old.total} passed</div>
    <div class="card"><strong>New:</strong> ${delta.summary.new.passed}/${delta.summary.new.total} passed</div>
  </div>
  ${delta.new_failures.length > 0 ? `<h2 class="new-failure">🔴 New Failures</h2><ul>${delta.new_failures.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
  ${delta.fixed.length > 0 ? `<h2 class="fixed">🟢 Fixed</h2><ul>${delta.fixed.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
  ${delta.still_failing.length > 0 ? `<h2 class="still-failing">🟡 Still Failing</h2><ul>${delta.still_failing.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
  ${delta.new_tests.length > 0 ? `<h2>🆕 New Tests</h2><ul>${delta.new_tests.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
  ${delta.removed_tests.length > 0 ? `<h2>🗑️ Removed</h2><ul>${delta.removed_tests.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
</body>
</html>`;
}
