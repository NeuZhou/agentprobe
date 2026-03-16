/**
 * Agent Governance Dashboard - HTML dashboard summarizing agent fleet status.
 *
 * Shows fleet overview, cost trends, safety scores, SLA compliance,
 * top issues, recommendations, and per-agent drilldown.
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export interface AgentReport {
  agent: string;
  timestamp: string;
  status: 'active' | 'inactive' | 'error';
  passed: number;
  failed: number;
  total: number;
  cost_usd: number;
  safety_score: number;
  sla_compliance: number;
  latency_avg_ms: number;
  issues: string[];
  recommendations: string[];
}

export interface GovernanceData {
  reports: AgentReport[];
  generated_at: string;
}

/**
 * Load reports from a directory of JSON/YAML files.
 */
export function loadGovernanceData(dataDir: string): GovernanceData {
  const reports: AgentReport[] = [];

  if (!fs.existsSync(dataDir)) {
    return { reports: [], generated_at: new Date().toISOString() };
  }

  const files = fs.readdirSync(dataDir).filter(f =>
    f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml')
  );

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
      const data = file.endsWith('.json') ? JSON.parse(content) : YAML.parse(content);

      if (Array.isArray(data)) {
        reports.push(...data.map(normalizeReport));
      } else if (data.reports && Array.isArray(data.reports)) {
        reports.push(...data.reports.map(normalizeReport));
      } else {
        reports.push(normalizeReport(data));
      }
    } catch {
      // skip invalid files
    }
  }

  return { reports, generated_at: new Date().toISOString() };
}

function normalizeReport(raw: any): AgentReport {
  return {
    agent: raw.agent ?? raw.name ?? 'unknown',
    timestamp: raw.timestamp ?? raw.date ?? new Date().toISOString(),
    status: raw.status ?? (raw.failed > 0 ? 'error' : 'active'),
    passed: raw.passed ?? 0,
    failed: raw.failed ?? 0,
    total: raw.total ?? (raw.passed ?? 0) + (raw.failed ?? 0),
    cost_usd: raw.cost_usd ?? raw.cost ?? 0,
    safety_score: raw.safety_score ?? raw.safety ?? 100,
    sla_compliance: raw.sla_compliance ?? raw.sla ?? 100,
    latency_avg_ms: raw.latency_avg_ms ?? raw.latency ?? 0,
    issues: raw.issues ?? [],
    recommendations: raw.recommendations ?? [],
  };
}

export interface FleetOverview {
  totalAgents: number;
  activeAgents: number;
  inactiveAgents: number;
  errorAgents: number;
  complianceRate: number;
  avgSafetyScore: number;
  totalCost: number;
  avgLatency: number;
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
}

export function computeFleetOverview(data: GovernanceData): FleetOverview {
  const agents = new Map<string, AgentReport>();
  // Use latest report per agent
  for (const r of data.reports) {
    const existing = agents.get(r.agent);
    if (!existing || r.timestamp > existing.timestamp) {
      agents.set(r.agent, r);
    }
  }

  const latest = [...agents.values()];
  const active = latest.filter(a => a.status === 'active').length;
  const inactive = latest.filter(a => a.status === 'inactive').length;
  const error = latest.filter(a => a.status === 'error').length;

  const totalTests = latest.reduce((s, a) => s + a.total, 0);
  const totalPassed = latest.reduce((s, a) => s + a.passed, 0);
  const totalFailed = latest.reduce((s, a) => s + a.failed, 0);
  const totalCost = data.reports.reduce((s, r) => s + r.cost_usd, 0);
  const avgSafety = latest.length > 0
    ? latest.reduce((s, a) => s + a.safety_score, 0) / latest.length
    : 0;
  const avgSla = latest.length > 0
    ? latest.reduce((s, a) => s + a.sla_compliance, 0) / latest.length
    : 0;
  const avgLatency = latest.length > 0
    ? latest.reduce((s, a) => s + a.latency_avg_ms, 0) / latest.length
    : 0;

  return {
    totalAgents: latest.length,
    activeAgents: active,
    inactiveAgents: inactive,
    errorAgents: error,
    complianceRate: avgSla,
    avgSafetyScore: avgSafety,
    totalCost,
    avgLatency,
    totalTests,
    totalPassed,
    totalFailed,
  };
}

/**
 * Generate the HTML governance dashboard.
 */
export function generateGovernanceDashboard(data: GovernanceData): string {
  const overview = computeFleetOverview(data);

  // Aggregate cost by date
  const costByDate = new Map<string, number>();
  const safetyByDate = new Map<string, number[]>();
  for (const r of data.reports) {
    const date = r.timestamp.slice(0, 10);
    costByDate.set(date, (costByDate.get(date) ?? 0) + r.cost_usd);
    if (!safetyByDate.has(date)) safetyByDate.set(date, []);
    safetyByDate.get(date)!.push(r.safety_score);
  }

  const costDates = [...costByDate.keys()].sort();
  const costValues = costDates.map(d => costByDate.get(d)!.toFixed(2));
  const safetyDates = [...safetyByDate.keys()].sort();
  const safetyValues = safetyDates.map(d => {
    const scores = safetyByDate.get(d)!;
    return (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  });

  // Collect all issues and recommendations
  const allIssues: Array<{ agent: string; issue: string }> = [];
  const allRecs: Array<{ agent: string; rec: string }> = [];
  for (const r of data.reports) {
    for (const issue of r.issues) allIssues.push({ agent: r.agent, issue });
    for (const rec of r.recommendations) allRecs.push({ agent: r.agent, rec });
  }

  // Per-agent latest
  const agentMap = new Map<string, AgentReport>();
  for (const r of data.reports) {
    const existing = agentMap.get(r.agent);
    if (!existing || r.timestamp > existing.timestamp) {
      agentMap.set(r.agent, r);
    }
  }
  const agentList = [...agentMap.values()].sort((a, b) => a.agent.localeCompare(b.agent));

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const agentRows = agentList.map(a => `
    <tr>
      <td><strong>${esc(a.agent)}</strong></td>
      <td><span class="badge badge-${a.status}">${a.status}</span></td>
      <td>${a.passed}/${a.total}</td>
      <td>$${a.cost_usd.toFixed(2)}</td>
      <td><div class="score-bar"><div class="score-fill" style="width:${a.safety_score}%;background:${a.safety_score >= 80 ? 'var(--green)' : a.safety_score >= 60 ? 'var(--orange)' : 'var(--red)'}">${a.safety_score}%</div></div></td>
      <td>${a.sla_compliance.toFixed(1)}%</td>
      <td>${a.latency_avg_ms.toFixed(0)}ms</td>
    </tr>`).join('\n');

  const issueRows = allIssues.slice(0, 10).map(i =>
    `<li><strong>${esc(i.agent)}:</strong> ${esc(i.issue)}</li>`
  ).join('\n');

  const recRows = allRecs.slice(0, 10).map(r =>
    `<li><strong>${esc(r.agent)}:</strong> ${esc(r.rec)}</li>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🏛️ AgentProbe Governance Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0d1117;--bg-card:#161b22;--border:#30363d;--text:#c9d1d9;--text-muted:#8b949e;--green:#3fb950;--red:#f85149;--blue:#58a6ff;--orange:#d29922;--purple:#bc8cff;--cyan:#39d353}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);padding:2rem;line-height:1.6}
.container{max-width:1200px;margin:0 auto}
h1{font-size:2rem;margin-bottom:.5rem;color:var(--blue)}
.subtitle{color:var(--text-muted);margin-bottom:2rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:2rem}
.card{background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:1.5rem}
.card h3{color:var(--text-muted);font-size:.85rem;text-transform:uppercase;margin-bottom:.5rem}
.card .value{font-size:2rem;font-weight:700}
.card .value.green{color:var(--green)}
.card .value.red{color:var(--red)}
.card .value.blue{color:var(--blue)}
.card .value.orange{color:var(--orange)}
.section{background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:1.5rem;margin-bottom:1.5rem}
.section h2{color:var(--blue);margin-bottom:1rem;font-size:1.3rem}
table{width:100%;border-collapse:collapse}
th,td{padding:.75rem 1rem;text-align:left;border-bottom:1px solid var(--border)}
th{color:var(--text-muted);font-size:.85rem;text-transform:uppercase}
.badge{padding:2px 8px;border-radius:12px;font-size:.8rem;font-weight:600}
.badge-active{background:rgba(63,185,80,.15);color:var(--green)}
.badge-inactive{background:rgba(139,148,158,.15);color:var(--text-muted)}
.badge-error{background:rgba(248,81,73,.15);color:var(--red)}
.score-bar{background:var(--border);border-radius:4px;height:20px;overflow:hidden;min-width:80px}
.score-fill{height:100%;border-radius:4px;text-align:center;font-size:.75rem;line-height:20px;color:#fff;font-weight:600}
.chart-container{height:200px;display:flex;align-items:flex-end;gap:4px;padding:1rem 0}
.chart-bar{background:var(--blue);border-radius:4px 4px 0 0;min-width:20px;flex:1;position:relative;transition:height .3s}
.chart-bar:hover{opacity:.8}
.chart-bar .label{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:.65rem;color:var(--text-muted);white-space:nowrap}
ul{list-style:none;padding-left:0}
ul li{padding:.5rem 0;border-bottom:1px solid var(--border)}
ul li:last-child{border-bottom:none}
.footer{text-align:center;color:var(--text-muted);margin-top:2rem;font-size:.85rem}
</style>
</head>
<body>
<div class="container">
<h1>🏛️ Agent Governance Dashboard</h1>
<p class="subtitle">Generated ${esc(data.generated_at)} by AgentProbe</p>

<div class="grid">
  <div class="card"><h3>Total Agents</h3><div class="value blue">${overview.totalAgents}</div></div>
  <div class="card"><h3>Active</h3><div class="value green">${overview.activeAgents}</div></div>
  <div class="card"><h3>Errors</h3><div class="value ${overview.errorAgents > 0 ? 'red' : 'green'}">${overview.errorAgents}</div></div>
  <div class="card"><h3>Total Cost</h3><div class="value orange">$${overview.totalCost.toFixed(2)}</div></div>
  <div class="card"><h3>Safety Score</h3><div class="value ${overview.avgSafetyScore >= 80 ? 'green' : 'orange'}">${overview.avgSafetyScore.toFixed(1)}%</div></div>
  <div class="card"><h3>SLA Compliance</h3><div class="value ${overview.complianceRate >= 95 ? 'green' : 'orange'}">${overview.complianceRate.toFixed(1)}%</div></div>
  <div class="card"><h3>Tests Passed</h3><div class="value green">${overview.totalPassed}/${overview.totalTests}</div></div>
  <div class="card"><h3>Avg Latency</h3><div class="value blue">${overview.avgLatency.toFixed(0)}ms</div></div>
</div>

<div class="section">
<h2>📈 Cost Trend</h2>
<div class="chart-container">
${costDates.map((d, i) => {
  const max = Math.max(...costDates.map(dd => costByDate.get(dd)!), 1);
  const h = (costByDate.get(d)! / max) * 150;
  return `<div class="chart-bar" style="height:${Math.max(h, 4)}px" title="$${costValues[i]} on ${d}"><span class="label">${d.slice(5)}</span></div>`;
}).join('\n')}
</div>
</div>

<div class="section">
<h2>🛡️ Safety Score Trend</h2>
<div class="chart-container">
${safetyDates.map((d, i) => {
  const val = parseFloat(safetyValues[i]);
  const h = (val / 100) * 150;
  const color = val >= 80 ? 'var(--green)' : val >= 60 ? 'var(--orange)' : 'var(--red)';
  return `<div class="chart-bar" style="height:${Math.max(h, 4)}px;background:${color}" title="${safetyValues[i]}% on ${d}"><span class="label">${d.slice(5)}</span></div>`;
}).join('\n')}
</div>
</div>

<div class="section">
<h2>🤖 Per-Agent Drilldown</h2>
<table>
<thead><tr><th>Agent</th><th>Status</th><th>Tests</th><th>Cost</th><th>Safety</th><th>SLA</th><th>Latency</th></tr></thead>
<tbody>
${agentRows}
</tbody>
</table>
</div>

${allIssues.length > 0 ? `
<div class="section">
<h2>⚠️ Top Issues</h2>
<ul>${issueRows}</ul>
</div>` : ''}

${allRecs.length > 0 ? `
<div class="section">
<h2>💡 Recommendations</h2>
<ul>${recRows}</ul>
</div>` : ''}

<div class="footer">🦀 AgentProbe Governance Dashboard • ${overview.totalAgents} agents monitored</div>
</div>
</body>
</html>`;
}

/**
 * Format governance data as console output.
 */
export function formatGovernance(data: GovernanceData): string {
  const overview = computeFleetOverview(data);
  const lines: string[] = [
    '🏛️  Agent Governance Report',
    '═'.repeat(50),
    '',
    `Fleet: ${overview.totalAgents} agents (${overview.activeAgents} active, ${overview.inactiveAgents} inactive, ${overview.errorAgents} errors)`,
    `Tests: ${overview.totalPassed}/${overview.totalTests} passed`,
    `Cost:  $${overview.totalCost.toFixed(2)}`,
    `Safety: ${overview.avgSafetyScore.toFixed(1)}%`,
    `SLA:   ${overview.complianceRate.toFixed(1)}%`,
    `Latency: ${overview.avgLatency.toFixed(0)}ms avg`,
    '',
  ];

  // Per-agent
  const agentMap = new Map<string, AgentReport>();
  for (const r of data.reports) {
    const existing = agentMap.get(r.agent);
    if (!existing || r.timestamp > existing.timestamp) {
      agentMap.set(r.agent, r);
    }
  }

  for (const [name, a] of agentMap) {
    lines.push(`  ${a.status === 'active' ? '✅' : a.status === 'error' ? '❌' : '⏸️'} ${name}: ${a.passed}/${a.total} tests, safety ${a.safety_score}%, $${a.cost_usd.toFixed(2)}`);
    for (const issue of a.issues) lines.push(`    ⚠️  ${issue}`);
    for (const rec of a.recommendations) lines.push(`    💡 ${rec}`);
  }

  lines.push('');
  return lines.join('\n');
}
