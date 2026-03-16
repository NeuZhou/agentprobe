/**
 * Agent Health Dashboard — generate static HTML for real-time monitoring.
 * @module health-dashboard
 */
import * as fs from 'fs';
import * as path from 'path';

export interface DashboardConfig {
  port?: number;
  dataDir: string;
  refreshIntervalSec?: number;
  title?: string;
}

export interface DashboardMetrics {
  uptime: string;
  totalRuns: number;
  passRate: number;
  errorRate: number;
  avgLatencyMs: number;
  totalCost: number;
  slaStatus: 'healthy' | 'degraded' | 'critical';
  lastUpdated: string;
  recentRuns: DashboardRun[];
}

export interface DashboardRun {
  name: string;
  timestamp: string;
  passed: number;
  failed: number;
  durationMs: number;
  cost: number;
}

/**
 * Scan a reports directory and extract dashboard metrics.
 */
export function collectDashboardMetrics(dataDir: string): DashboardMetrics {
  const runs: DashboardRun[] = [];

  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort();
    for (const file of files.slice(-50)) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'));
        runs.push({
          name: raw.name ?? file,
          timestamp: raw.timestamp ?? new Date().toISOString(),
          passed: raw.passed ?? 0,
          failed: raw.failed ?? 0,
          durationMs: raw.duration_ms ?? 0,
          cost: raw.cost ?? 0,
        });
      } catch { /* skip */ }
    }
  }

  const totalPassed = runs.reduce((s, r) => s + r.passed, 0);
  const totalFailed = runs.reduce((s, r) => s + r.failed, 0);
  const totalTests = totalPassed + totalFailed;
  const passRate = totalTests > 0 ? (totalPassed / totalTests) * 100 : 100;
  const errorRate = totalTests > 0 ? (totalFailed / totalTests) * 100 : 0;
  const avgLatencyMs = runs.length > 0 ? runs.reduce((s, r) => s + r.durationMs, 0) / runs.length : 0;
  const totalCost = runs.reduce((s, r) => s + r.cost, 0);

  let slaStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
  if (errorRate > 20) slaStatus = 'critical';
  else if (errorRate > 5) slaStatus = 'degraded';

  // Calculate uptime from first run to now
  const firstRun = runs[0]?.timestamp;
  const uptime = firstRun ? formatUptime(Date.now() - new Date(firstRun).getTime()) : 'N/A';

  return {
    uptime,
    totalRuns: runs.length,
    passRate,
    errorRate,
    avgLatencyMs,
    totalCost,
    slaStatus,
    lastUpdated: new Date().toISOString(),
    recentRuns: runs.slice(-10).reverse(),
  };
}

/**
 * Format millisecond duration as human-readable uptime.
 */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Generate a standalone HTML dashboard page.
 */
export function generateDashboardHTML(metrics: DashboardMetrics, config?: Partial<DashboardConfig>): string {
  const title = config?.title ?? 'AgentProbe Health Dashboard';
  const refreshSec = config?.refreshIntervalSec ?? 30;

  const statusColor = metrics.slaStatus === 'healthy' ? '#22c55e'
    : metrics.slaStatus === 'degraded' ? '#eab308' : '#ef4444';
  const statusEmoji = metrics.slaStatus === 'healthy' ? '✅'
    : metrics.slaStatus === 'degraded' ? '⚠️' : '🔴';

  const runsHTML = metrics.recentRuns.map(r => `
    <tr>
      <td>${escapeHTML(r.name)}</td>
      <td>${r.timestamp.slice(0, 19).replace('T', ' ')}</td>
      <td style="color:#22c55e">${r.passed}</td>
      <td style="color:${r.failed > 0 ? '#ef4444' : '#666'}">${r.failed}</td>
      <td>${(r.durationMs / 1000).toFixed(1)}s</td>
      <td>$${r.cost.toFixed(2)}</td>
    </tr>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="${refreshSec}">
<title>${escapeHTML(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 40px auto; background: #0f172a; color: #e2e8f0; padding: 0 20px; }
  h1 { text-align: center; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 24px 0; }
  .card { background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; }
  .card .value { font-size: 2em; font-weight: bold; margin: 8px 0; }
  .card .label { font-size: 0.85em; color: #94a3b8; }
  .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { padding: 10px; text-align: left; border-bottom: 1px solid #334155; }
  th { color: #94a3b8; font-weight: 600; }
  .footer { text-align: center; color: #64748b; font-size: 0.8em; margin-top: 32px; }
</style></head><body>
<h1>🔬 ${escapeHTML(title)}</h1>
<div class="cards">
  <div class="card"><div class="label">Status</div><div class="value"><span class="status" style="background:${statusColor}33;color:${statusColor}">${statusEmoji} ${metrics.slaStatus.toUpperCase()}</span></div></div>
  <div class="card"><div class="label">Uptime</div><div class="value">${metrics.uptime}</div></div>
  <div class="card"><div class="label">Pass Rate</div><div class="value">${metrics.passRate.toFixed(1)}%</div></div>
  <div class="card"><div class="label">Error Rate</div><div class="value">${metrics.errorRate.toFixed(1)}%</div></div>
  <div class="card"><div class="label">Avg Latency</div><div class="value">${(metrics.avgLatencyMs / 1000).toFixed(1)}s</div></div>
  <div class="card"><div class="label">Total Cost</div><div class="value">$${metrics.totalCost.toFixed(2)}</div></div>
</div>
<h2>Recent Runs</h2>
<table><thead><tr><th>Name</th><th>Time</th><th>✓</th><th>✗</th><th>Duration</th><th>Cost</th></tr></thead>
<tbody>${runsHTML}</tbody></table>
<div class="footer">Last updated: ${metrics.lastUpdated.slice(0, 19).replace('T', ' ')} · Auto-refresh: ${refreshSec}s</div>
</body></html>`;
}

function escapeHTML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
