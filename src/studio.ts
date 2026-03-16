/**
 * Visual Test Studio — Interactive HTML test dashboard.
 *
 * Generates a self-contained HTML dashboard with:
 * - Test list with pass/fail/flaky status
 * - Trace viewer with step-by-step execution
 * - Cost & latency charts over time
 * - Coverage heatmap
 * - Test builder (create tests visually)
 *
 * @example
 * ```bash
 * agentprobe studio --port 3000
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SuiteResult, TestResult, AgentTrace } from './types';

export interface StudioConfig {
  port: number;
  reportDir: string;
  traceDir?: string;
  title?: string;
  theme?: 'light' | 'dark';
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
}

export interface StudioTestEntry {
  name: string;
  status: 'pass' | 'fail' | 'flaky' | 'skipped';
  duration_ms: number;
  attempts?: number;
  tags?: string[];
  trace?: AgentTrace;
  cost?: number;
  timestamp?: string;
}

export interface StudioData {
  title: string;
  generated: string;
  tests: StudioTestEntry[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
    totalDuration: number;
    totalCost: number;
  };
  costHistory: Array<{ date: string; cost: number }>;
  latencyHistory: Array<{ date: string; avg_ms: number; p95_ms: number }>;
  coverageMap: Record<string, number>;
}

/**
 * Load test results from report directory.
 */
export function loadStudioData(config: StudioConfig): StudioData {
  const tests: StudioTestEntry[] = [];
  const costHistory: Array<{ date: string; cost: number }> = [];
  const latencyHistory: Array<{ date: string; avg_ms: number; p95_ms: number }> = [];
  const coverageMap: Record<string, number> = {};

  // Load JSON reports
  if (fs.existsSync(config.reportDir)) {
    const files = fs.readdirSync(config.reportDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(config.reportDir, file), 'utf-8');
        const data = JSON.parse(raw);
        if (data.results && Array.isArray(data.results)) {
          const suiteResult = data as SuiteResult;
          for (const r of suiteResult.results) {
            const entry = resultToEntry(r);
            tests.push(entry);
            // Track coverage
            for (const tag of r.tags ?? []) {
              coverageMap[tag] = (coverageMap[tag] ?? 0) + 1;
            }
          }
          // Aggregate cost/latency history
          const date = file.replace('.json', '');
          const totalCost = suiteResult.results.reduce((s, r) => {
            const tokens = r.trace?.steps.reduce((t, step) => {
              return t + (step.data.tokens?.input ?? 0) + (step.data.tokens?.output ?? 0);
            }, 0) ?? 0;
            return s + tokens * 0.00001; // rough estimate
          }, 0);
          costHistory.push({ date, cost: totalCost });

          const durations = suiteResult.results.map(r => r.duration_ms).sort((a, b) => a - b);
          const avg = durations.reduce((s, d) => s + d, 0) / (durations.length || 1);
          const p95idx = Math.floor(durations.length * 0.95);
          latencyHistory.push({ date, avg_ms: avg, p95_ms: durations[p95idx] ?? avg });
        }
      } catch {
        // skip malformed files
      }
    }
  }

  // Load individual traces
  if (config.traceDir && fs.existsSync(config.traceDir)) {
    const traceFiles = fs.readdirSync(config.traceDir).filter(f => f.endsWith('.json'));
    for (const file of traceFiles) {
      try {
        const raw = fs.readFileSync(path.join(config.traceDir!, file), 'utf-8');
        const trace = JSON.parse(raw) as AgentTrace;
        // Extract tool coverage
        for (const step of trace.steps) {
          if (step.type === 'tool_call' && step.data.tool_name) {
            coverageMap[step.data.tool_name] = (coverageMap[step.data.tool_name] ?? 0) + 1;
          }
        }
      } catch {
        // skip
      }
    }
  }

  const passed = tests.filter(t => t.status === 'pass').length;
  const failed = tests.filter(t => t.status === 'fail').length;
  const flaky = tests.filter(t => t.status === 'flaky').length;
  const skipped = tests.filter(t => t.status === 'skipped').length;

  return {
    title: config.title ?? 'AgentProbe Test Studio',
    generated: new Date().toISOString(),
    tests,
    summary: {
      total: tests.length,
      passed,
      failed,
      flaky,
      skipped,
      totalDuration: tests.reduce((s, t) => s + t.duration_ms, 0),
      totalCost: tests.reduce((s, t) => s + (t.cost ?? 0), 0),
    },
    costHistory,
    latencyHistory,
    coverageMap,
  };
}

function resultToEntry(r: TestResult): StudioTestEntry {
  let status: StudioTestEntry['status'] = r.passed ? 'pass' : 'fail';
  if (r.skipped) status = 'skipped';
  if ((r.attempts ?? 1) > 1 && r.passed) status = 'flaky';

  const cost = r.trace?.steps.reduce((s, step) => {
    const tokens = (step.data.tokens?.input ?? 0) + (step.data.tokens?.output ?? 0);
    return s + tokens * 0.00001;
  }, 0);

  return {
    name: r.name,
    status,
    duration_ms: r.duration_ms,
    attempts: r.attempts,
    tags: r.tags,
    trace: r.trace,
    cost,
    timestamp: r.trace?.timestamp,
  };
}

/**
 * Generate a self-contained HTML dashboard.
 */
export function generateStudioHTML(data: StudioData): string {
  const dataJson = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(data.title)}</title>
<style>
:root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #e6edf3; --text-muted: #8b949e; --green: #3fb950; --red: #f85149; --yellow: #d29922; --blue: #58a6ff; --purple: #bc8cff; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); }
.container { max-width: 1400px; margin: 0 auto; padding: 20px; }
header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
header h1 { font-size: 24px; }
header .generated { color: var(--text-muted); font-size: 13px; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
.stat-card .value { font-size: 32px; font-weight: 700; }
.stat-card .label { color: var(--text-muted); font-size: 13px; margin-top: 4px; }
.stat-card.pass .value { color: var(--green); }
.stat-card.fail .value { color: var(--red); }
.stat-card.flaky .value { color: var(--yellow); }
.tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
.tab { padding: 10px 20px; cursor: pointer; color: var(--text-muted); border-bottom: 2px solid transparent; }
.tab.active { color: var(--text); border-bottom-color: var(--blue); }
.tab:hover { color: var(--text); }
.panel { display: none; }
.panel.active { display: block; }
/* Test list */
.test-list { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.test-row { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer; }
.test-row:hover { background: rgba(88,166,255,0.05); }
.test-row:last-child { border-bottom: none; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 12px; flex-shrink: 0; }
.status-dot.pass { background: var(--green); }
.status-dot.fail { background: var(--red); }
.status-dot.flaky { background: var(--yellow); }
.status-dot.skipped { background: var(--text-muted); }
.test-name { flex: 1; font-size: 14px; }
.test-meta { color: var(--text-muted); font-size: 12px; display: flex; gap: 16px; }
.tag { background: rgba(88,166,255,0.15); color: var(--blue); padding: 2px 8px; border-radius: 12px; font-size: 11px; }
/* Trace viewer */
.trace-viewer { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-top: 12px; }
.trace-step { padding: 8px 12px; border-left: 3px solid var(--border); margin-bottom: 8px; font-family: 'Fira Code', monospace; font-size: 13px; }
.trace-step.llm_call { border-left-color: var(--purple); }
.trace-step.tool_call { border-left-color: var(--blue); }
.trace-step.tool_result { border-left-color: var(--green); }
.trace-step.output { border-left-color: var(--yellow); }
.trace-step .step-type { font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px; }
/* Charts */
.chart-container { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.chart-container h3 { margin-bottom: 12px; font-size: 16px; }
.bar-chart { display: flex; align-items: flex-end; gap: 4px; height: 200px; padding-top: 20px; }
.bar { background: var(--blue); border-radius: 3px 3px 0 0; min-width: 20px; position: relative; transition: background 0.2s; }
.bar:hover { background: var(--purple); }
.bar .bar-label { position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); font-size: 10px; color: var(--text-muted); white-space: nowrap; }
.bar .bar-value { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 10px; color: var(--text-muted); }
/* Coverage heatmap */
.heatmap { display: flex; flex-wrap: wrap; gap: 6px; }
.heat-cell { padding: 8px 12px; border-radius: 6px; font-size: 12px; color: white; }
/* Test builder */
.builder { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
.builder textarea { width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-family: 'Fira Code', monospace; font-size: 13px; min-height: 300px; resize: vertical; }
.builder .actions { margin-top: 12px; display: flex; gap: 8px; }
.btn { padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font-size: 13px; }
.btn:hover { background: rgba(88,166,255,0.1); }
.btn.primary { background: var(--blue); color: #000; border-color: var(--blue); }
.filter-bar { display: flex; gap: 8px; margin-bottom: 12px; }
.filter-bar input { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--text); font-size: 13px; flex: 1; }
.filter-bar select { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--text); font-size: 13px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>🔬 ${escHtml(data.title)}</h1>
    <span class="generated">Generated: ${escHtml(data.generated)}</span>
  </header>

  <div class="summary">
    <div class="stat-card"><div class="value">${data.summary.total}</div><div class="label">Total Tests</div></div>
    <div class="stat-card pass"><div class="value">${data.summary.passed}</div><div class="label">Passed</div></div>
    <div class="stat-card fail"><div class="value">${data.summary.failed}</div><div class="label">Failed</div></div>
    <div class="stat-card flaky"><div class="value">${data.summary.flaky}</div><div class="label">Flaky</div></div>
    <div class="stat-card"><div class="value">${(data.summary.totalDuration / 1000).toFixed(1)}s</div><div class="label">Duration</div></div>
    <div class="stat-card"><div class="value">$${data.summary.totalCost.toFixed(4)}</div><div class="label">Cost</div></div>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('tests')">Tests</div>
    <div class="tab" onclick="switchTab('traces')">Traces</div>
    <div class="tab" onclick="switchTab('charts')">Charts</div>
    <div class="tab" onclick="switchTab('coverage')">Coverage</div>
    <div class="tab" onclick="switchTab('builder')">Builder</div>
  </div>

  <div id="panel-tests" class="panel active"></div>
  <div id="panel-traces" class="panel"></div>
  <div id="panel-charts" class="panel"></div>
  <div id="panel-coverage" class="panel"></div>
  <div id="panel-builder" class="panel"></div>
</div>

<script>
const DATA = ${dataJson};

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const panels = ['tests','traces','charts','coverage','builder'];
    t.classList.toggle('active', panels[i] === name);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
}

function renderTests() {
  const panel = document.getElementById('panel-tests');
  let html = '<div class="filter-bar"><input id="search" placeholder="Filter tests..." oninput="filterTests()"><select id="statusFilter" onchange="filterTests()"><option value="">All</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="flaky">Flaky</option><option value="skipped">Skipped</option></select></div>';
  html += '<div class="test-list" id="testList">';
  for (const t of DATA.tests) {
    html += '<div class="test-row" data-status="' + t.status + '" data-name="' + escH(t.name) + '" onclick="showTrace(this)">';
    html += '<div class="status-dot ' + t.status + '"></div>';
    html += '<div class="test-name">' + escH(t.name) + '</div>';
    html += '<div class="test-meta">';
    if (t.tags) t.tags.forEach(tag => { html += '<span class="tag">' + escH(tag) + '</span>'; });
    html += '<span>' + t.duration_ms + 'ms</span>';
    if (t.attempts > 1) html += '<span>⟳' + t.attempts + '</span>';
    if (t.cost) html += '<span>$' + t.cost.toFixed(4) + '</span>';
    html += '</div></div>';
  }
  html += '</div><div id="traceDetail"></div>';
  panel.innerHTML = html;
}

function escH(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

function filterTests() {
  const q = document.getElementById('search').value.toLowerCase();
  const st = document.getElementById('statusFilter').value;
  document.querySelectorAll('.test-row').forEach(row => {
    const name = row.dataset.name.toLowerCase();
    const status = row.dataset.status;
    row.style.display = (name.includes(q) && (!st || status === st)) ? '' : 'none';
  });
}

function showTrace(el) {
  const name = el.dataset.name;
  const test = DATA.tests.find(t => t.name === name);
  if (!test || !test.trace) { document.getElementById('traceDetail').innerHTML = '<div class="trace-viewer"><p>No trace available</p></div>'; return; }
  let html = '<div class="trace-viewer"><h3>Trace: ' + escH(name) + '</h3>';
  for (const step of test.trace.steps) {
    html += '<div class="trace-step ' + step.type + '">';
    html += '<div class="step-type">' + step.type + '</div>';
    if (step.data.tool_name) html += '<div>Tool: ' + escH(step.data.tool_name) + '</div>';
    if (step.data.content) html += '<div>' + escH(step.data.content.substring(0, 500)) + '</div>';
    if (step.data.tokens) html += '<div>Tokens: in=' + (step.data.tokens.input||0) + ' out=' + (step.data.tokens.output||0) + '</div>';
    if (step.duration_ms) html += '<div>' + step.duration_ms + 'ms</div>';
    html += '</div>';
  }
  html += '</div>';
  document.getElementById('traceDetail').innerHTML = html;
}

function renderCharts() {
  const panel = document.getElementById('panel-charts');
  let html = '';

  // Cost chart
  if (DATA.costHistory.length) {
    html += '<div class="chart-container"><h3>💰 Cost Over Time</h3><div class="bar-chart">';
    const maxCost = Math.max(...DATA.costHistory.map(c => c.cost), 0.001);
    for (const c of DATA.costHistory) {
      const h = Math.max((c.cost / maxCost) * 180, 2);
      html += '<div class="bar" style="height:' + h + 'px"><div class="bar-value">$' + c.cost.toFixed(3) + '</div><div class="bar-label">' + escH(c.date.slice(-8)) + '</div></div>';
    }
    html += '</div></div>';
  }

  // Latency chart
  if (DATA.latencyHistory.length) {
    html += '<div class="chart-container"><h3>⏱️ Latency Over Time</h3><div class="bar-chart">';
    const maxLat = Math.max(...DATA.latencyHistory.map(l => l.p95_ms), 1);
    for (const l of DATA.latencyHistory) {
      const h = Math.max((l.p95_ms / maxLat) * 180, 2);
      html += '<div class="bar" style="height:' + h + 'px"><div class="bar-value">' + Math.round(l.p95_ms) + 'ms</div><div class="bar-label">' + escH(l.date.slice(-8)) + '</div></div>';
    }
    html += '</div></div>';
  }

  // Pass/fail distribution
  html += '<div class="chart-container"><h3>📊 Status Distribution</h3><div style="display:flex;gap:8px;align-items:flex-end;height:100px">';
  const statuses = [{label:'Pass',count:DATA.summary.passed,color:'var(--green)'},{label:'Fail',count:DATA.summary.failed,color:'var(--red)'},{label:'Flaky',count:DATA.summary.flaky,color:'var(--yellow)'},{label:'Skip',count:DATA.summary.skipped,color:'var(--text-muted)'}];
  const maxS = Math.max(...statuses.map(s=>s.count), 1);
  for (const s of statuses) {
    const h = Math.max((s.count/maxS)*80, 2);
    html += '<div style="text-align:center;flex:1"><div style="background:'+s.color+';height:'+h+'px;border-radius:3px 3px 0 0;margin:0 auto;width:40px"></div><div style="font-size:11px;margin-top:4px;color:var(--text-muted)">'+s.label+'</div><div style="font-size:16px;font-weight:700">'+s.count+'</div></div>';
  }
  html += '</div></div>';

  panel.innerHTML = html || '<p style="color:var(--text-muted)">No historical data available. Run tests to generate charts.</p>';
}

function renderCoverage() {
  const panel = document.getElementById('panel-coverage');
  const entries = Object.entries(DATA.coverageMap).sort((a,b) => b[1] - a[1]);
  if (!entries.length) { panel.innerHTML = '<p style="color:var(--text-muted)">No coverage data. Tag your tests or run traces.</p>'; return; }
  const max = Math.max(...entries.map(e => e[1]), 1);
  let html = '<div class="chart-container"><h3>🗺️ Coverage Heatmap</h3><div class="heatmap">';
  for (const [name, count] of entries) {
    const intensity = Math.round((count / max) * 200 + 55);
    const r = Math.round(255 - intensity * 0.5);
    const g = Math.round(intensity * 0.8);
    const b = Math.round(80);
    html += '<div class="heat-cell" style="background:rgb('+r+','+g+','+b+')">' + escH(name) + ' (' + count + ')</div>';
  }
  html += '</div></div>';
  panel.innerHTML = html;
}

function renderBuilder() {
  const panel = document.getElementById('panel-builder');
  panel.innerHTML = '<div class="builder"><h3>🔨 Test Builder</h3><p style="color:var(--text-muted);margin:8px 0">Create test cases visually. Write YAML below and copy to your test files.</p>' +
    '<textarea id="builderYaml" placeholder="name: my-test\\ninput: \\"Hello, help me with...\\"\\"\\nexpect:\\n  tool_called: search\\n  output_contains: \\"result\\"\\n  max_steps: 10">name: my-test\\ninput: "Hello, help me with..."\\nexpect:\\n  tool_called: search\\n  output_contains: "result"\\n  max_steps: 10</textarea>' +
    '<div class="actions"><button class="btn primary" onclick="copyBuilder()">📋 Copy YAML</button><button class="btn" onclick="validateBuilder()">✅ Validate</button><button class="btn" onclick="templateBuilder()">📄 Template</button></div>' +
    '<div id="builderOutput" style="margin-top:12px;font-size:13px;color:var(--text-muted)"></div></div>';
}

function copyBuilder() {
  const ta = document.getElementById('builderYaml');
  navigator.clipboard.writeText(ta.value).then(() => {
    document.getElementById('builderOutput').textContent = '✅ Copied to clipboard!';
  });
}

function validateBuilder() {
  const ta = document.getElementById('builderYaml');
  try {
    const lines = ta.value.split('\\n');
    const hasName = lines.some(l => l.startsWith('name:'));
    const hasInput = lines.some(l => l.startsWith('input:'));
    const hasExpect = lines.some(l => l.startsWith('expect:'));
    const issues = [];
    if (!hasName) issues.push('Missing "name" field');
    if (!hasInput) issues.push('Missing "input" field');
    if (!hasExpect) issues.push('Missing "expect" field');
    document.getElementById('builderOutput').textContent = issues.length ? '⚠️ ' + issues.join(', ') : '✅ Looks valid!';
  } catch(e) { document.getElementById('builderOutput').textContent = '❌ Parse error: ' + e.message; }
}

function templateBuilder() {
  document.getElementById('builderYaml').value = 'name: example-test\\ntags: [smoke]\\ninput: "What is the weather in Tokyo?"\\nexpect:\\n  tool_called: get_weather\\n  output_contains: "Tokyo"\\n  max_steps: 5\\n  max_tokens: 2000';
}

// Init
renderTests();
renderCharts();
renderCoverage();
renderBuilder();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Write studio HTML to a file.
 */
export function writeStudio(outputPath: string, data: StudioData): void {
  const html = generateStudioHTML(data);
  fs.writeFileSync(outputPath, html, 'utf-8');
}

/**
 * Generate studio data from a suite result directly.
 */
export function studioFromSuiteResult(result: SuiteResult, title?: string): StudioData {
  const tests = result.results.map(resultToEntry);
  const passed = tests.filter(t => t.status === 'pass').length;
  const failed = tests.filter(t => t.status === 'fail').length;
  const flaky = tests.filter(t => t.status === 'flaky').length;
  const skipped = tests.filter(t => t.status === 'skipped').length;
  const coverageMap: Record<string, number> = {};
  for (const r of result.results) {
    for (const tag of r.tags ?? []) {
      coverageMap[tag] = (coverageMap[tag] ?? 0) + 1;
    }
  }

  return {
    title: title ?? 'AgentProbe Test Studio',
    generated: new Date().toISOString(),
    tests,
    summary: {
      total: tests.length, passed, failed, flaky, skipped,
      totalDuration: tests.reduce((s, t) => s + t.duration_ms, 0),
      totalCost: tests.reduce((s, t) => s + (t.cost ?? 0), 0),
    },
    costHistory: [],
    latencyHistory: [],
    coverageMap,
  };
}
