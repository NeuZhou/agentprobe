import type { SuiteResult, TestResult } from '../types';
import { calculateCost } from '../cost';

/**
 * Generate a self-contained HTML test report with Mermaid diagrams,
 * token usage charts, cost breakdown, and timeline visualization.
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

  // Token data for chart
  const tokenData = result.results
    .filter((r) => r.trace)
    .map((r) => {
      const inputTokens = r.trace!.steps.reduce((s, st) => s + (st.data.tokens?.input ?? 0), 0);
      const outputTokens = r.trace!.steps.reduce((s, st) => s + (st.data.tokens?.output ?? 0), 0);
      return { name: r.name, input: inputTokens, output: outputTokens };
    })
    .filter((d) => d.input + d.output > 0);

  // Mermaid flow diagram data
  const flowDiagrams = result.results
    .filter((r) => r.trace && r.trace.steps.length > 0)
    .map((r) => ({
      name: r.name,
      mermaid: generateMermaidFlow(r),
    }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🔬 AgentProbe Report — ${esc(result.name)}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0d1117;--bg-card:#161b22;--border:#30363d;--text:#c9d1d9;--text-muted:#8b949e;--green:#3fb950;--red:#f85149;--blue:#58a6ff;--purple:#bc8cff;--orange:#d29922;--cyan:#39d353}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);padding:2rem;line-height:1.6}
.container{max-width:1100px;margin:0 auto}
h1{font-size:2rem;margin-bottom:.25rem;color:#f0f6fc;letter-spacing:-0.5px}
h2{font-size:1.4rem;margin:2rem 0 1rem;color:#f0f6fc}
h3{font-size:1.1rem;margin:1rem 0 .5rem;color:#f0f6fc}
.subtitle{color:var(--text-muted);margin-bottom:1.5rem}

/* Summary cards */
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin:1.5rem 0}
.stat{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:1.25rem 1.5rem;text-align:center;transition:transform .15s}
.stat:hover{transform:translateY(-2px)}
.stat-value{font-size:2.2rem;font-weight:700;letter-spacing:-1px}
.stat-label{font-size:.8rem;color:var(--text-muted);margin-top:.25rem;text-transform:uppercase;letter-spacing:.5px}
.pass{color:var(--green)}.fail{color:var(--red)}

/* Progress bar */
.bar{height:10px;border-radius:6px;background:#21262d;margin:1rem 0;overflow:hidden}
.bar-fill{height:100%;border-radius:6px;transition:width .5s ease}
.bar-fill.good{background:linear-gradient(90deg,var(--green),var(--cyan))}
.bar-fill.warn{background:linear-gradient(90deg,var(--orange),#e3b341)}
.bar-fill.bad{background:linear-gradient(90deg,var(--red),#da3633)}

/* Test cards */
.test{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;margin:.75rem 0;overflow:hidden;transition:box-shadow .15s}
.test:hover{box-shadow:0 4px 12px rgba(0,0,0,.3)}
.test-header{padding:1rem 1.5rem;cursor:pointer;display:flex;align-items:center;gap:.75rem;user-select:none}
.test-header:hover{background:rgba(255,255,255,.02)}
.test-body{padding:0 1.5rem 1.25rem;display:none;border-top:1px solid var(--border)}
.test.open .test-body{display:block}
.icon{font-size:1.2rem}
.test-name{flex:1;font-weight:600}
.test-dur{color:var(--text-muted);font-size:.85rem;font-variant-numeric:tabular-nums}
.chevron{color:var(--text-muted);transition:transform .2s;font-size:.8rem}
.test.open .chevron{transform:rotate(90deg)}
.tags{display:flex;gap:.4rem;margin-left:.5rem;flex-wrap:wrap}
.tag{background:rgba(88,166,255,.15);color:var(--blue);padding:2px 10px;border-radius:12px;font-size:.75rem;font-weight:500}

/* Assertions */
.assertion{padding:.6rem 0;font-size:.9rem;border-bottom:1px solid rgba(48,54,61,.5);display:flex;align-items:flex-start;gap:.5rem}
.assertion:last-child{border:none}
.a-icon{flex-shrink:0;width:20px;text-align:center}
.a-pass{color:var(--green)}.a-fail{color:var(--red)}
.a-details{cursor:pointer;color:var(--blue);font-size:.8rem;margin-left:.5rem;text-decoration:underline}
.a-detail-body{display:none;margin:.5rem 0 .5rem 1.5rem;padding:.75rem;background:rgba(0,0,0,.2);border-radius:8px;font-size:.85rem;font-family:'SF Mono',Consolas,monospace;white-space:pre-wrap;line-height:1.5}
.a-detail-body.open{display:block}

/* Timeline */
.timeline{margin:1rem 0;position:relative}
.timeline-bar{display:flex;height:32px;border-radius:6px;overflow:hidden;margin:.5rem 0;background:#21262d}
.tl-segment{display:flex;align-items:center;justify-content:center;font-size:.7rem;color:#fff;overflow:hidden;white-space:nowrap;min-width:2px}
.tl-llm{background:var(--purple)}
.tl-tool{background:var(--blue)}
.tl-output{background:var(--green)}
.tl-other{background:var(--orange)}
.timeline-legend{display:flex;gap:1rem;margin:.5rem 0;font-size:.8rem}
.legend-item{display:flex;align-items:center;gap:.4rem}
.legend-dot{width:10px;height:10px;border-radius:3px}

/* Charts */
.chart-section{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:1.5rem;margin:1.5rem 0}
.chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
@media(max-width:768px){.chart-grid{grid-template-columns:1fr}}
.token-bar-group{margin:.4rem 0}
.token-bar-label{font-size:.8rem;color:var(--text-muted);margin-bottom:.2rem;display:flex;justify-content:space-between}
.token-bar-track{height:20px;background:#21262d;border-radius:4px;overflow:hidden;display:flex}
.token-bar-input{background:var(--blue);height:100%}
.token-bar-output{background:var(--purple);height:100%}

/* Cost pie (CSS-only) */
.pie-container{display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap}
.pie-legend{font-size:.85rem}
.pie-legend-item{display:flex;align-items:center;gap:.5rem;margin:.3rem 0}
.pie-color{width:12px;height:12px;border-radius:3px;flex-shrink:0}

/* Mermaid */
.mermaid{background:rgba(255,255,255,.03);border-radius:8px;padding:1rem;margin:.75rem 0;overflow-x:auto}

/* Step list */
.step{display:flex;align-items:flex-start;gap:.75rem;padding:.4rem 0;font-size:.85rem}
.step-icon{width:24px;text-align:center;flex-shrink:0}
.step-content{flex:1;word-break:break-all}
.step-dur{color:var(--text-muted);flex-shrink:0;font-variant-numeric:tabular-nums}

/* Cost table */
.cost-section{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:1.5rem;margin:1.5rem 0}
table{width:100%;border-collapse:collapse;margin:.75rem 0}
th,td{text-align:left;padding:.6rem .75rem;border-bottom:1px solid rgba(48,54,61,.5);font-size:.85rem}
th{color:var(--text-muted);font-weight:600;text-transform:uppercase;font-size:.75rem;letter-spacing:.5px}
tr:hover td{background:rgba(255,255,255,.02)}
footer{text-align:center;color:#484f58;font-size:.8rem;margin-top:3rem;padding-top:1rem;border-top:1px solid var(--border)}
footer a{color:var(--blue);text-decoration:none}

/* Tabs */
.tab-container{margin:1rem 0}
.tab-buttons{display:flex;gap:0;border-bottom:2px solid var(--border)}
.tab-btn{padding:.6rem 1.2rem;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.9rem;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
.tab-btn:hover{color:var(--text)}
.tab-btn.active{color:var(--blue);border-bottom-color:var(--blue)}
.tab-panel{display:none;padding:1rem 0}
.tab-panel.active{display:block}
</style>
</head>
<body>
<div class="container">
  <h1>🔬 ${esc(result.name)}</h1>
  <p class="subtitle">Generated ${new Date().toISOString()} · AgentProbe v0.9.0</p>

  <div class="summary">
    <div class="stat"><div class="stat-value">${result.total}</div><div class="stat-label">Total Tests</div></div>
    <div class="stat"><div class="stat-value pass">${result.passed}</div><div class="stat-label">Passed</div></div>
    <div class="stat"><div class="stat-value fail">${result.failed}</div><div class="stat-label">Failed</div></div>
    <div class="stat"><div class="stat-value" style="color:${pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)'}">${pct}%</div><div class="stat-label">Pass Rate</div></div>
    <div class="stat"><div class="stat-value">${formatDuration(result.duration_ms)}</div><div class="stat-label">Duration</div></div>
    <div class="stat"><div class="stat-value">$${totalCost.toFixed(4)}</div><div class="stat-label">Total Cost</div></div>
  </div>

  <div class="bar"><div class="bar-fill ${pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad'}" style="width:${pct}%"></div></div>

  <h2>📋 Test Results</h2>
  ${testRows}

  ${tokenData.length > 0 || costData.length > 0 ? `
  <h2>📊 Analytics</h2>
  <div class="chart-grid">
    ${tokenData.length > 0 ? renderTokenChart(tokenData) : ''}
    ${costData.length > 0 ? renderCostPie(costData) : ''}
  </div>
  ` : ''}

  ${costData.length > 0 ? renderCostTable(costData) : ''}

  ${flowDiagrams.length > 0 ? `
  <h2>🔀 Tool Call Flows</h2>
  ${flowDiagrams.map((fd) => `
    <div class="chart-section">
      <h3>${esc(fd.name)}</h3>
      <div class="mermaid">${fd.mermaid}</div>
    </div>
  `).join('')}
  ` : ''}

</div>
<footer>
  <strong>AgentProbe v0.9.0</strong> — Playwright for AI Agents<br>
  <a href="https://github.com/neuzhou/agentprobe">github.com/neuzhou/agentprobe</a>
</footer>
<script>
mermaid.initialize({theme:'dark',themeVariables:{primaryColor:'#58a6ff',primaryTextColor:'#c9d1d9',primaryBorderColor:'#30363d',lineColor:'#8b949e',secondaryColor:'#161b22',tertiaryColor:'#21262d'}});
document.querySelectorAll('.test-header').forEach(h=>{
  h.addEventListener('click',()=>h.parentElement.classList.toggle('open'));
});
document.querySelectorAll('.a-details').forEach(d=>{
  d.addEventListener('click',(e)=>{e.stopPropagation();d.nextElementSibling.classList.toggle('open');});
});
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const group=btn.closest('.tab-container');
    group.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    group.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    group.querySelector('#'+btn.dataset.tab).classList.add('active');
  });
});
</script>
</body>
</html>`;
}

function renderTestRow(test: TestResult): string {
  const icon = test.passed ? '✅' : test.skipped ? '⏭️' : '❌';
  const cls = test.passed ? 'pass' : 'fail';
  const tags = (test.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

  const assertions = test.assertions
    .map((a) => {
      const ac = a.passed ? 'a-pass' : 'a-fail';
      const ai = a.passed ? '✓' : '✗';
      const summary = a.passed
        ? 'OK'
        : (a.message?.split('\n')[0] ?? `expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`);
      const hasDetails = !a.passed && a.message && a.message.includes('\n');

      return `<div class="assertion">
        <span class="a-icon ${ac}">${ai}</span>
        <span class="${ac}">${esc(a.name)}: ${esc(summary)}</span>
        ${hasDetails ? `<span class="a-details">details</span><div class="a-detail-body">${esc(a.message!)}</div>` : ''}
      </div>`;
    })
    .join('\n');

  // Timeline bar
  const timeline = test.trace ? renderTimelineBar(test) : '';

  return `<div class="test">
  <div class="test-header">
    <span class="icon">${icon}</span>
    <span class="test-name ${cls}">${esc(test.name)}</span>
    <div class="tags">${tags}</div>
    <span class="test-dur">${formatDuration(test.duration_ms)}</span>
    <span class="chevron">▶</span>
  </div>
  <div class="test-body">
    <div class="tab-container">
      <div class="tab-buttons">
        <button class="tab-btn active" data-tab="assert-${cssId(test.name)}">Assertions</button>
        ${test.trace ? `<button class="tab-btn" data-tab="timeline-${cssId(test.name)}">Timeline</button>` : ''}
        ${test.trace ? `<button class="tab-btn" data-tab="steps-${cssId(test.name)}">Steps</button>` : ''}
      </div>
      <div id="assert-${cssId(test.name)}" class="tab-panel active">
        ${assertions}
      </div>
      ${test.trace ? `<div id="timeline-${cssId(test.name)}" class="tab-panel">${timeline}</div>` : ''}
      ${test.trace ? `<div id="steps-${cssId(test.name)}" class="tab-panel">${renderStepList(test)}</div>` : ''}
    </div>
    ${test.error ? `<div class="a-fail" style="margin-top:.5rem;padding:.75rem;background:rgba(248,81,73,.1);border-radius:8px">⚠️ ${esc(test.error)}</div>` : ''}
  </div>
</div>`;
}

function renderTimelineBar(test: TestResult): string {
  if (!test.trace?.steps.length) return '';
  const steps = test.trace.steps;
  const totalDur = steps.reduce((s, st) => s + (st.duration_ms ?? 0), 0) || 1;

  const segments = steps
    .filter((s) => (s.duration_ms ?? 0) > 0)
    .map((s) => {
      const pct = Math.max(2, ((s.duration_ms ?? 0) / totalDur) * 100);
      const cls = s.type === 'llm_call' ? 'tl-llm' : s.type === 'tool_call' ? 'tl-tool' : s.type === 'output' ? 'tl-output' : 'tl-other';
      const label = s.data.tool_name ?? (s.type === 'llm_call' ? 'LLM' : '');
      return `<div class="tl-segment ${cls}" style="width:${pct}%" title="${esc(s.type)}${s.data.tool_name ? ': ' + esc(s.data.tool_name) : ''} (${s.duration_ms}ms)">${pct > 8 ? esc(label) : ''}</div>`;
    })
    .join('');

  return `<div class="timeline">
    <div class="timeline-bar">${segments}</div>
    <div class="timeline-legend">
      <div class="legend-item"><div class="legend-dot" style="background:var(--purple)"></div>LLM</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--blue)"></div>Tool</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div>Output</div>
    </div>
  </div>`;
}

function renderStepList(test: TestResult): string {
  if (!test.trace?.steps.length) return '';
  const icons: Record<string, string> = {
    llm_call: '🧠', tool_call: '🔧', tool_result: '📦', thought: '💭', output: '💬',
  };
  return test.trace.steps
    .map((s) => {
      const icon = icons[s.type] ?? '❓';
      const detail = s.data.tool_name
        ? `${s.data.tool_name}(${JSON.stringify(s.data.tool_args ?? {}).slice(0, 80)})`
        : (s.data.content?.slice(0, 120) ?? s.data.model ?? '');
      const dur = s.duration_ms ? `${s.duration_ms}ms` : '';
      return `<div class="step"><span class="step-icon">${icon}</span><span class="step-content">${esc(s.type)}: ${esc(detail)}</span><span class="step-dur">${dur}</span></div>`;
    })
    .join('\n');
}

function renderTokenChart(tokenData: { name: string; input: number; output: number }[]): string {
  const maxTotal = Math.max(...tokenData.map((d) => d.input + d.output), 1);
  const bars = tokenData
    .map((d) => {
      const inputPct = (d.input / maxTotal) * 100;
      const outputPct = (d.output / maxTotal) * 100;
      return `<div class="token-bar-group">
        <div class="token-bar-label"><span>${esc(d.name.slice(0, 30))}</span><span>${d.input + d.output} tokens</span></div>
        <div class="token-bar-track">
          <div class="token-bar-input" style="width:${inputPct}%"></div>
          <div class="token-bar-output" style="width:${outputPct}%"></div>
        </div>
      </div>`;
    })
    .join('');

  return `<div class="chart-section">
    <h3>📈 Token Usage</h3>
    ${bars}
    <div class="timeline-legend" style="margin-top:.75rem">
      <div class="legend-item"><div class="legend-dot" style="background:var(--blue)"></div>Input</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--purple)"></div>Output</div>
    </div>
  </div>`;
}

function renderCostPie(costData: any[]): string {
  const colors = ['#58a6ff', '#bc8cff', '#3fb950', '#d29922', '#f85149', '#39d353', '#db61a2'];
  const total = costData.reduce((s, c) => s + c.total_cost, 0) || 1;

  const items = costData.map((c, i) => {
    const pct = ((c.total_cost / total) * 100).toFixed(1);
    return `<div class="pie-legend-item">
      <div class="pie-color" style="background:${colors[i % colors.length]}"></div>
      <span>${esc(c.name.slice(0, 25))}: $${c.total_cost.toFixed(4)} (${pct}%)</span>
    </div>`;
  });

  return `<div class="chart-section">
    <h3>💰 Cost Distribution</h3>
    <div class="pie-container">
      <div class="pie-legend">${items.join('')}</div>
    </div>
  </div>`;
}

function renderCostTable(costData: any[]): string {
  const rows = costData
    .map((c) => {
      if (c.breakdowns?.length) {
        return c.breakdowns
          .map(
            (b: any) =>
              `<tr><td>${esc(c.name)}</td><td>${esc(b.model)}</td><td>${b.input_tokens.toLocaleString()}</td><td>${b.output_tokens.toLocaleString()}</td><td>$${b.total_cost.toFixed(4)}</td></tr>`,
          )
          .join('');
      }
      return `<tr><td>${esc(c.name)}</td><td>-</td><td>0</td><td>0</td><td>$0.0000</td></tr>`;
    })
    .join('\n');

  return `<div class="cost-section">
  <h2>💰 Cost Breakdown</h2>
  <table><thead><tr><th>Test</th><th>Model</th><th>Input Tokens</th><th>Output Tokens</th><th>Cost</th></tr></thead>
  <tbody>${rows}</tbody></table>
</div>`;
}

function generateMermaidFlow(test: TestResult): string {
  if (!test.trace?.steps.length) return 'graph LR\n  empty[No steps]';

  const lines: string[] = ['graph LR'];
  let nodeId = 0;
  const nodes: string[] = [];

  for (const step of test.trace.steps) {
    const id = `n${nodeId++}`;
    if (step.type === 'llm_call') {
      nodes.push(id);
      lines.push(`  ${id}[/"🧠 LLM${step.data.model ? '<br/>' + esc(step.data.model) : ''}"/]`);
    } else if (step.type === 'tool_call') {
      nodes.push(id);
      lines.push(`  ${id}["🔧 ${esc(step.data.tool_name ?? 'tool')}"]`);
    } else if (step.type === 'output') {
      nodes.push(id);
      lines.push(`  ${id}(["💬 Output"])`);
    } else {
      continue;
    }
  }

  // Connect sequential nodes
  for (let i = 1; i < nodes.length; i++) {
    lines.push(`  ${nodes[i - 1]} --> ${nodes[i]}`);
  }

  // Style
  lines.push('  classDef llm fill:#3d1f6e,stroke:#bc8cff,color:#f0f6fc');
  lines.push('  classDef tool fill:#0d2d5e,stroke:#58a6ff,color:#f0f6fc');
  lines.push('  classDef output fill:#0d3b1e,stroke:#3fb950,color:#f0f6fc');

  // Apply styles
  for (let i = 0; i < test.trace.steps.length; i++) {
    const step = test.trace.steps[i];
    if (step.type === 'llm_call') lines.push(`  class n${i} llm`);
    else if (step.type === 'tool_call') lines.push(`  class n${i} tool`);
    else if (step.type === 'output') lines.push(`  class n${i} output`);
  }

  return lines.join('\n');
}

function formatDuration(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function cssId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 40);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
