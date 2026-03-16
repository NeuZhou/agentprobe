/**
 * Test Report Portal - Generate a static HTML dashboard from test results.
 *
 * Features:
 * - Test trend chart (pass/fail over time)
 * - Flaky test leaderboard
 * - Slowest test leaderboard
 * - Cost breakdown by suite
 * - Coverage gaps
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SuiteResult } from './types';

export interface PortalOptions {
  /** Directory containing JSON report files */
  reportsDir: string;
  /** Output directory for the dashboard */
  outputDir: string;
}

export interface ReportEntry {
  filename: string;
  timestamp: string;
  suite: SuiteResult;
}

export interface TrendPoint {
  date: string;
  passed: number;
  failed: number;
  total: number;
}

export interface FlakyEntry {
  name: string;
  flakyCount: number;
  totalRuns: number;
  flakyRate: number;
}

export interface SlowestEntry {
  name: string;
  avgDuration: number;
  maxDuration: number;
  runs: number;
}

export interface CostEntry {
  suite: string;
  totalCost: number;
  testCount: number;
  avgCost: number;
}

export interface CoverageGap {
  area: string;
  reason: string;
}

export interface PortalData {
  trends: TrendPoint[];
  flaky: FlakyEntry[];
  slowest: SlowestEntry[];
  costs: CostEntry[];
  gaps: CoverageGap[];
  totalReports: number;
  lastUpdated: string;
}

/**
 * Load all JSON report files from a directory.
 */
export function loadReports(dir: string): ReportEntry[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const entries: ReportEntry[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      const suite: SuiteResult = raw.suite || raw;
      if (suite.results && Array.isArray(suite.results)) {
        entries.push({
          filename: file,
          timestamp: raw.timestamp || raw.date || file.replace('.json', ''),
          suite,
        });
      }
    } catch { /* skip invalid files */ }
  }
  return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Compute trend data from report entries.
 */
export function computeTrends(entries: ReportEntry[]): TrendPoint[] {
  return entries.map(e => ({
    date: e.timestamp,
    passed: e.suite.passed,
    failed: e.suite.failed,
    total: e.suite.total,
  }));
}

/**
 * Identify flaky tests (tests that both pass and fail across runs).
 */
export function computeFlaky(entries: ReportEntry[]): FlakyEntry[] {
  const testMap = new Map<string, { passed: number; failed: number; total: number }>();
  for (const entry of entries) {
    for (const r of entry.suite.results) {
      const existing = testMap.get(r.name) || { passed: 0, failed: 0, total: 0 };
      existing.total++;
      if (r.passed) existing.passed++;
      else existing.failed++;
      testMap.set(r.name, existing);
    }
  }
  const flaky: FlakyEntry[] = [];
  for (const [name, stats] of testMap) {
    if (stats.passed > 0 && stats.failed > 0) {
      flaky.push({
        name,
        flakyCount: Math.min(stats.passed, stats.failed),
        totalRuns: stats.total,
        flakyRate: Math.round((Math.min(stats.passed, stats.failed) / stats.total) * 100),
      });
    }
  }
  return flaky.sort((a, b) => b.flakyRate - a.flakyRate);
}

/**
 * Find slowest tests by average duration.
 */
export function computeSlowest(entries: ReportEntry[]): SlowestEntry[] {
  const testMap = new Map<string, { durations: number[] }>();
  for (const entry of entries) {
    for (const r of entry.suite.results) {
      const existing = testMap.get(r.name) || { durations: [] };
      existing.durations.push(r.duration_ms);
      testMap.set(r.name, existing);
    }
  }
  const slowest: SlowestEntry[] = [];
  for (const [name, stats] of testMap) {
    const avg = stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length;
    slowest.push({
      name,
      avgDuration: Math.round(avg),
      maxDuration: Math.max(...stats.durations),
      runs: stats.durations.length,
    });
  }
  return slowest.sort((a, b) => b.avgDuration - a.avgDuration).slice(0, 20);
}

/**
 * Compute cost breakdown by suite.
 */
export function computeCosts(entries: ReportEntry[]): CostEntry[] {
  const suiteMap = new Map<string, { totalCost: number; testCount: number }>();
  for (const entry of entries) {
    const suiteName = entry.suite.name || entry.filename;
    const existing = suiteMap.get(suiteName) || { totalCost: 0, testCount: 0 };
    for (const r of entry.suite.results) {
      existing.testCount++;
      // Estimate cost from trace tokens if available
      if (r.trace?.steps) {
        for (const step of r.trace.steps) {
          const tokens = step.data?.tokens;
          if (tokens) {
            // Rough cost: $0.03/1K input, $0.06/1K output (GPT-4 rates)
            existing.totalCost += ((tokens.input || 0) * 0.03 + (tokens.output || 0) * 0.06) / 1000;
          }
        }
      }
    }
    suiteMap.set(suiteName, existing);
  }
  const costs: CostEntry[] = [];
  for (const [suite, stats] of suiteMap) {
    costs.push({
      suite,
      totalCost: Math.round(stats.totalCost * 100) / 100,
      testCount: stats.testCount,
      avgCost: stats.testCount > 0 ? Math.round((stats.totalCost / stats.testCount) * 100) / 100 : 0,
    });
  }
  return costs.sort((a, b) => b.totalCost - a.totalCost);
}

/**
 * Detect coverage gaps.
 */
export function detectGaps(entries: ReportEntry[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  const allTests = entries.flatMap(e => e.suite.results);
  const allTags = new Set(allTests.flatMap(t => t.tags || []));

  // Check for common missing categories
  const expectedTags = ['error-handling', 'edge-case', 'performance', 'security', 'integration'];
  for (const tag of expectedTags) {
    if (!allTags.has(tag)) {
      gaps.push({ area: tag, reason: `No tests tagged with "${tag}"` });
    }
  }

  // Check for tests that never fail (may be too weak)
  const testResults = new Map<string, boolean[]>();
  for (const entry of entries) {
    for (const r of entry.suite.results) {
      const existing = testResults.get(r.name) || [];
      existing.push(r.passed);
      testResults.set(r.name, existing);
    }
  }
  for (const [name, results] of testResults) {
    if (results.length > 5 && results.every(r => r)) {
      gaps.push({ area: name, reason: 'Always passes — assertions may be too weak' });
    }
  }

  return gaps;
}

/**
 * Build the full portal data from reports directory.
 */
export function buildPortalData(reportsDir: string): PortalData {
  const entries = loadReports(reportsDir);
  return {
    trends: computeTrends(entries),
    flaky: computeFlaky(entries),
    slowest: computeSlowest(entries),
    costs: computeCosts(entries),
    gaps: detectGaps(entries),
    totalReports: entries.length,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Generate the static HTML dashboard.
 */
export function generatePortalHTML(data: PortalData): string {
  const trendsJSON = JSON.stringify(data.trends);
  const flakyJSON = JSON.stringify(data.flaky);
  const slowestJSON = JSON.stringify(data.slowest);
  const costsJSON = JSON.stringify(data.costs);
  const gapsJSON = JSON.stringify(data.gaps);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AgentProbe Test Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { color: #58a6ff; margin-bottom: 8px; }
  .subtitle { color: #8b949e; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; }
  .card h2 { color: #58a6ff; margin-bottom: 12px; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-weight: 600; }
  .pass { color: #3fb950; } .fail { color: #f85149; } .warn { color: #d29922; }
  .chart { width: 100%; height: 200px; position: relative; }
  .bar { display: inline-block; vertical-align: bottom; margin: 0 2px; min-width: 8px; }
  .bar-pass { background: #3fb950; } .bar-fail { background: #f85149; }
  .stat { font-size: 28px; font-weight: bold; }
  .stat-label { color: #8b949e; font-size: 12px; }
  .stats-row { display: flex; gap: 40px; margin-bottom: 20px; }
  .gap-item { padding: 8px; background: #1c2128; border-radius: 4px; margin-bottom: 8px; }
  .gap-area { color: #d29922; font-weight: 600; }
</style>
</head>
<body>
<h1>🔬 AgentProbe Test Dashboard</h1>
<p class="subtitle">Last updated: ${data.lastUpdated} | ${data.totalReports} report(s)</p>
<div class="stats-row">
  <div><div class="stat" id="totalTests">-</div><div class="stat-label">Total Tests</div></div>
  <div><div class="stat pass" id="passRate">-</div><div class="stat-label">Pass Rate</div></div>
  <div><div class="stat" id="flakyCount">-</div><div class="stat-label">Flaky Tests</div></div>
</div>
<div class="grid">
  <div class="card"><h2>📈 Test Trends</h2><div class="chart" id="trendChart"></div></div>
  <div class="card"><h2>🎲 Flaky Test Leaderboard</h2><table id="flakyTable"><thead><tr><th>Test</th><th>Flaky Rate</th><th>Runs</th></tr></thead><tbody></tbody></table></div>
  <div class="card"><h2>🐌 Slowest Tests</h2><table id="slowTable"><thead><tr><th>Test</th><th>Avg (ms)</th><th>Max (ms)</th></tr></thead><tbody></tbody></table></div>
  <div class="card"><h2>💰 Cost Breakdown</h2><table id="costTable"><thead><tr><th>Suite</th><th>Total ($)</th><th>Tests</th><th>Avg ($)</th></tr></thead><tbody></tbody></table></div>
  <div class="card"><h2>⚠️ Coverage Gaps</h2><div id="gapsList"></div></div>
</div>
<script>
const trends = ${trendsJSON};
const flaky = ${flakyJSON};
const slowest = ${slowestJSON};
const costs = ${costsJSON};
const gaps = ${gapsJSON};

// Stats
if (trends.length > 0) {
  const last = trends[trends.length - 1];
  document.getElementById('totalTests').textContent = last.total;
  document.getElementById('passRate').textContent = last.total > 0 ? Math.round((last.passed / last.total) * 100) + '%' : '-';
}
document.getElementById('flakyCount').textContent = flaky.length;

// Trend chart (simple bar chart)
const chart = document.getElementById('trendChart');
if (trends.length > 0) {
  const maxTotal = Math.max(...trends.map(t => t.total));
  trends.forEach(t => {
    const col = document.createElement('div');
    col.style.display = 'inline-block';
    col.style.verticalAlign = 'bottom';
    col.style.width = Math.max(8, Math.floor(chart.clientWidth / trends.length) - 4) + 'px';
    col.style.margin = '0 2px';
    const pH = maxTotal > 0 ? (t.passed / maxTotal) * 180 : 0;
    const fH = maxTotal > 0 ? (t.failed / maxTotal) * 180 : 0;
    col.innerHTML = '<div class="bar bar-fail" style="height:' + fH + 'px"></div><div class="bar bar-pass" style="height:' + pH + 'px"></div>';
    col.title = t.date + ': ' + t.passed + ' pass, ' + t.failed + ' fail';
    chart.appendChild(col);
  });
} else {
  chart.textContent = 'No data yet';
}

// Flaky table
const fTbody = document.querySelector('#flakyTable tbody');
flaky.slice(0, 10).forEach(f => {
  const row = fTbody.insertRow();
  row.innerHTML = '<td>' + f.name + '</td><td class="warn">' + f.flakyRate + '%</td><td>' + f.totalRuns + '</td>';
});
if (flaky.length === 0) fTbody.innerHTML = '<tr><td colspan="3">No flaky tests 🎉</td></tr>';

// Slowest table
const sTbody = document.querySelector('#slowTable tbody');
slowest.slice(0, 10).forEach(s => {
  const row = sTbody.insertRow();
  row.innerHTML = '<td>' + s.name + '</td><td>' + s.avgDuration + '</td><td>' + s.maxDuration + '</td>';
});
if (slowest.length === 0) sTbody.innerHTML = '<tr><td colspan="3">No data</td></tr>';

// Cost table
const cTbody = document.querySelector('#costTable tbody');
costs.forEach(c => {
  const row = cTbody.insertRow();
  row.innerHTML = '<td>' + c.suite + '</td><td>$' + c.totalCost.toFixed(2) + '</td><td>' + c.testCount + '</td><td>$' + c.avgCost.toFixed(2) + '</td>';
});
if (costs.length === 0) cTbody.innerHTML = '<tr><td colspan="4">No cost data</td></tr>';

// Gaps
const gList = document.getElementById('gapsList');
gaps.forEach(g => {
  const div = document.createElement('div');
  div.className = 'gap-item';
  div.innerHTML = '<span class="gap-area">' + g.area + '</span>: ' + g.reason;
  gList.appendChild(div);
});
if (gaps.length === 0) gList.textContent = 'No coverage gaps detected 🎉';
</script>
</body>
</html>`;
}

/**
 * Generate the portal dashboard to the output directory.
 */
export function generatePortal(options: PortalOptions): string {
  const data = buildPortalData(options.reportsDir);
  const html = generatePortalHTML(data);
  if (!fs.existsSync(options.outputDir)) {
    fs.mkdirSync(options.outputDir, { recursive: true });
  }
  const outPath = path.join(options.outputDir, 'index.html');
  fs.writeFileSync(outPath, html);

  // Also write raw data for programmatic access
  fs.writeFileSync(
    path.join(options.outputDir, 'data.json'),
    JSON.stringify(data, null, 2),
  );

  return outPath;
}
