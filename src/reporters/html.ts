import type { SuiteResult, TestResult } from '../types';
import { calculateCost } from '../cost';

/**
 * Generate a self-contained HTML test report.
 */
export function reportHTML(result: SuiteResult): string {
  const pct = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;
  const testRows = result.results.map(renderTestRow).join('\n');

  // Cost data
  const costData = result.results
    .filter((r) => r.trace)
    .map((r) => {
      const cost = calculateCost(r.trace!);
      return { name: r.name, ...cost };
    });
  const totalCost = costData.reduce((s, c) => s + c.total_cost, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🔬 AgentProbe Report — ${esc(result.name)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem}
.container{max-width:1000px;margin:0 auto}
h1{font-size:1.8rem;margin-bottom:.5rem;color:#f0f6fc}
.summary{display:flex;gap:1.5rem;margin:1.5rem 0;flex-wrap:wrap}
.stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem 1.5rem;min-width:140px}
.stat-value{font-size:2rem;font-weight:700}
.stat-label{font-size:.85rem;color:#8b949e;margin-top:.25rem}
.pass{color:#3fb950}.fail{color:#f85149}
.bar{height:8px;border-radius:4px;background:#21262d;margin:1rem 0;overflow:hidden}
.bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#3fb950,#56d364)}
.test{background:#161b22;border:1px solid #30363d;border-radius:8px;margin:.75rem 0;overflow:hidden}
.test-header{padding:1rem 1.5rem;cursor:pointer;display:flex;align-items:center;gap:.75rem;user-select:none}
.test-header:hover{background:#1c2129}
.test-body{padding:0 1.5rem 1rem;display:none;border-top:1px solid #30363d}
.test.open .test-body{display:block}
.icon{font-size:1.2rem}
.test-name{flex:1;font-weight:500}
.test-dur{color:#8b949e;font-size:.85rem}
.tags{display:flex;gap:.4rem;margin-left:.5rem}
.tag{background:#30363d;color:#8b949e;padding:2px 8px;border-radius:12px;font-size:.75rem}
.assertion{padding:.4rem 0;font-size:.9rem;border-bottom:1px solid #21262d}
.assertion:last-child{border:none}
.a-pass{color:#3fb950}.a-fail{color:#f85149}
.timeline{margin:1rem 0;position:relative}
.step{display:flex;align-items:flex-start;gap:.75rem;padding:.4rem 0;font-size:.85rem}
.step-icon{width:24px;text-align:center;flex-shrink:0}
.step-content{flex:1;word-break:break-all}
.step-dur{color:#8b949e;flex-shrink:0}
.cost-section{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1.5rem;margin:1.5rem 0}
table{width:100%;border-collapse:collapse;margin:.75rem 0}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #21262d;font-size:.85rem}
th{color:#8b949e;font-weight:500}
.chart{margin:1rem 0}
.chart-bar{display:flex;align-items:center;gap:.5rem;margin:.3rem 0}
.chart-label{width:120px;font-size:.8rem;text-align:right;color:#8b949e}
.chart-fill{height:20px;border-radius:4px;background:#58a6ff;min-width:2px}
.chart-val{font-size:.8rem;color:#8b949e}
footer{text-align:center;color:#484f58;font-size:.8rem;margin-top:2rem;padding-top:1rem;border-top:1px solid #21262d}
</style>
</head>
<body>
<div class="container">
  <h1>🔬 ${esc(result.name)}</h1>
  <p style="color:#8b949e">Generated ${new Date().toISOString()}</p>

  <div class="summary">
    <div class="stat"><div class="stat-value">${result.total}</div><div class="stat-label">Total Tests</div></div>
    <div class="stat"><div class="stat-value pass">${result.passed}</div><div class="stat-label">Passed</div></div>
    <div class="stat"><div class="stat-value fail">${result.failed}</div><div class="stat-label">Failed</div></div>
    <div class="stat"><div class="stat-value">${pct}%</div><div class="stat-label">Pass Rate</div></div>
    <div class="stat"><div class="stat-value">${result.duration_ms}ms</div><div class="stat-label">Duration</div></div>
    <div class="stat"><div class="stat-value">$${totalCost.toFixed(4)}</div><div class="stat-label">Total Cost</div></div>
  </div>

  <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>

  <h2 style="margin:1.5rem 0 .75rem">Test Results</h2>
  ${testRows}

  ${costData.length > 0 ? renderCostSection(costData) : ''}

</div>
<footer>AgentProbe v0.4.0 — Playwright for AI Agents</footer>
<script>
document.querySelectorAll('.test-header').forEach(h=>{
  h.addEventListener('click',()=>h.parentElement.classList.toggle('open'));
});
</script>
</body>
</html>`;
}

function renderTestRow(test: TestResult): string {
  const icon = test.passed ? '✅' : '❌';
  const cls = test.passed ? 'pass' : 'fail';
  const tags = (test.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

  const assertions = test.assertions
    .map((a) => {
      const ac = a.passed ? 'a-pass' : 'a-fail';
      const ai = a.passed ? '✓' : '✗';
      const msg =
        a.message ??
        (a.passed
          ? 'OK'
          : `expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`);
      return `<div class="assertion ${ac}">${ai} ${esc(a.name)}: ${esc(msg)}</div>`;
    })
    .join('\n');

  const timeline = test.trace ? renderTimeline(test) : '';

  return `<div class="test">
  <div class="test-header">
    <span class="icon">${icon}</span>
    <span class="test-name ${cls}">${esc(test.name)}</span>
    <div class="tags">${tags}</div>
    <span class="test-dur">${test.duration_ms}ms</span>
  </div>
  <div class="test-body">
    ${assertions}
    ${timeline}
    ${test.error ? `<div class="a-fail" style="margin-top:.5rem">Error: ${esc(test.error)}</div>` : ''}
  </div>
</div>`;
}

function renderTimeline(test: TestResult): string {
  if (!test.trace?.steps.length) return '';
  const icons: Record<string, string> = {
    llm_call: '🧠',
    tool_call: '🔧',
    tool_result: '📦',
    thought: '💭',
    output: '💬',
  };
  const steps = test.trace.steps
    .map((s) => {
      const icon = icons[s.type] ?? '❓';
      const detail = s.data.tool_name
        ? `${s.data.tool_name}(${JSON.stringify(s.data.tool_args ?? {}).slice(0, 80)})`
        : (s.data.content?.slice(0, 120) ?? s.data.model ?? '');
      const dur = s.duration_ms ? `${s.duration_ms}ms` : '';
      return `<div class="step"><span class="step-icon">${icon}</span><span class="step-content">${esc(s.type)}: ${esc(detail)}</span><span class="step-dur">${dur}</span></div>`;
    })
    .join('\n');
  return `<div class="timeline"><strong>Trace Timeline</strong>${steps}</div>`;
}

function renderCostSection(costData: any[]): string {
  const rows = costData
    .map((c) => {
      const models = c.breakdowns
        .map(
          (b: any) =>
            `<tr><td>${esc(c.name)}</td><td>${esc(b.model)}</td><td>${b.input_tokens}</td><td>${b.output_tokens}</td><td>$${b.total_cost.toFixed(4)}</td></tr>`,
        )
        .join('');
      return (
        models || `<tr><td>${esc(c.name)}</td><td>-</td><td>0</td><td>0</td><td>$0.0000</td></tr>`
      );
    })
    .join('\n');

  return `<div class="cost-section">
  <h2>💰 Cost Breakdown</h2>
  <table><thead><tr><th>Test</th><th>Model</th><th>Input Tokens</th><th>Output Tokens</th><th>Cost</th></tr></thead>
  <tbody>${rows}</tbody></table>
</div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
