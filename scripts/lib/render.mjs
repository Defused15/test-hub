import { fmtDur } from './utils.mjs';

// ── Shared lookup tables ──────────────────────────────────────────────────────

const BROWSER_COLOR = { chromium: '#1a56a0', firefox: '#b54800', webkit: '#5c3080', unit: '#2d7a4f', api: '#ff6c37' };
const CHIP_MAP      = { expected: 'pass', unexpected: 'fail', flaky: 'flaky', skipped: 'skip' };
const CHIP_LABEL    = { expected: 'Passed', unexpected: 'Failed', flaky: 'Flaky', skipped: 'Skipped' };

// ── Sub-builders ──────────────────────────────────────────────────────────────

function buildInsightCards(p) {
  const nonZero = p.tests.filter(t => t.duration > 0);
  const passed  = p.tests.filter(t => t.outcome === 'expected' && t.duration > 0);
  const avgDur  = nonZero.length
    ? Math.round(nonZero.reduce((s, t) => s + t.duration, 0) / nonZero.length)
    : 0;
  const slowest = nonZero.length ? nonZero.reduce((a, b) => a.duration > b.duration ? a : b) : null;
  const fastest = passed.length  ? passed.reduce((a, b)  => a.duration < b.duration ? a : b) : null;

  return [
    { label: 'Avg Duration',       value: fmtDur(avgDur),                  sub: nonZero.length + ' tests measured' },
    { label: 'Slowest Test',       value: slowest ? fmtDur(slowest.duration) : '—', sub: slowest ? slowest.title : 'no data' },
    { label: 'Fastest Passing',    value: fastest ? fmtDur(fastest.duration) : '—', sub: fastest ? fastest.title : 'no data' },
    { label: 'Browsers / Projects', value: p.projectNames.length.toString(),  sub: p.projectNames.join(', ') || '—' },
  ].map(c =>
    '<div class="insight-card">'
    + '<div class="insight-label">' + c.label + '</div>'
    + '<div class="insight-value">' + c.value + '</div>'
    + '<div class="insight-sub" title="' + c.sub.replace(/"/g, '&quot;') + '">' + c.sub + '</div>'
    + '</div>'
  ).join('');
}

function buildStatsRow(p) {
  return [
    { cls: '',    label: 'Total',    val: p.stats.total },
    { cls: 'p',   label: 'Passed',  val: p.stats.expected },
    { cls: 'f',   label: 'Failed',  val: p.stats.unexpected },
    { cls: 'fl',  label: 'Flaky',   val: p.stats.flaky },
    { cls: '',    label: 'Skipped', val: p.stats.skipped },
    { cls: 'dur', label: 'Duration', val: fmtDur(p.duration) },
  ].map(s =>
    '<div class="gc ' + s.cls + '"><div class="gn">' + s.val + '</div><div class="gl">' + s.label + '</div></div>'
  ).join('');
}

function buildTableRows(p) {
  return p.tests.map((t, idx) => {
    const bColor = BROWSER_COLOR[t.project] || '#888';
    const cls    = CHIP_MAP[t.outcome]   || 'skip';
    const lbl    = CHIP_LABEL[t.outcome] || t.outcome;
    return '<tr data-outcome="' + t.outcome
      + '" data-test="'    + t.title.replace(/"/g, '&quot;')
      + '" data-browser="' + t.project
      + '" data-duration="' + t.duration
      + '" data-idx="'     + idx
      + '" class="clickable-row">'
      + '<td><div class="tt">' + t.title + '</div><div class="tf">' + t.file + ':' + t.line + '</div></td>'
      + '<td><span class="bchip"><span class="bdot" style="background:' + bColor + '"></span>' + t.project + '</span></td>'
      + '<td><span class="chip ' + cls + '">' + lbl + '</span></td>'
      + '<td><span class="dur">' + fmtDur(t.duration) + '</span></td>'
      + '</tr>';
  }).join('');
}

// ── Inline styles for the project page (no external CSS for panel/charts) ────

const INLINE_STYLES = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{font-size:15px}
  body{background:#faf9f7;color:#1a1814;font-family:'DM Sans',sans-serif;line-height:1.5;min-height:100vh}
  .page{max-width:1120px;margin:0 auto;padding:52px 36px 80px}
  .header{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:24px;border-bottom:1.5px solid #1a1814;margin-bottom:36px}
  h1{font-size:26px;font-weight:300;letter-spacing:-.02em} h1 strong{font-weight:600}
  .eyebrow{font-size:10px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:#6b6560;margin-bottom:4px}
  .gstats{grid-template-columns:repeat(6,1fr)}
  .charts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(280px, 100%),1fr));gap:16px;animation:up .5s .14s ease both;will-change:opacity,transform}
  .chart-card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px 18px 14px;box-shadow:var(--shadow);min-width:0;position:relative;width:100%}
  .chart-card canvas{max-width:100%}
  .chart-title{font-size:9.5px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;color:var(--ink4);margin-bottom:12px}
  .chart-empty{font-size:11px;color:var(--ink3);padding:28px 0;text-align:center}
  tr.clickable-row{cursor:pointer} tr.clickable-row:hover td{background:var(--paper2)}
  .panel-backdrop{display:none;position:fixed;inset:0;background:rgba(26,24,20,.32);z-index:90;opacity:0;transition:opacity .22s}
  .panel-backdrop.visible{display:block;opacity:1}
  .detail-panel{position:fixed;top:0;right:0;width:460px;max-width:100vw;height:100vh;background:var(--paper);border-left:1.5px solid var(--line2);box-shadow:-4px 0 24px rgba(26,24,20,.12);z-index:100;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .25s cubic-bezier(.32,0,.15,1);overflow:hidden}
  .detail-panel.open{transform:translateX(0)}
  .dp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 14px;border-bottom:1px solid var(--line);flex-shrink:0}
  .dp-title{font-size:13px;font-weight:600;color:var(--ink);line-height:1.45;word-break:break-word}
  .dp-close{flex-shrink:0;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid var(--line2);background:#fff;color:var(--ink3);font-size:11px;cursor:pointer;transition:all .15s;margin-top:1px}
  .dp-close:hover{border-color:var(--ink4);color:var(--ink)}
  .dp-meta-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 20px;border-bottom:1px solid var(--line);flex-shrink:0}
  .dp-meta-item{font-family:"DM Mono","DM Mono Fallback",monospace;font-size:11px;color:var(--ink3);display:inline-flex;align-items:center;gap:4px}
  .dp-file-bar{display:flex;align-items:center;gap:8px;padding:8px 20px 10px;border-bottom:1px solid var(--line);flex-shrink:0}
  .dp-file-path{font-family:"DM Mono","DM Mono Fallback",monospace;font-size:11px;color:var(--ink3);word-break:break-all;flex:1}
  .dp-copy-btn{flex-shrink:0;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:3px;border:1px solid var(--line2);background:transparent;color:var(--ink4);font-size:13px;cursor:pointer;transition:all .15s;line-height:1}
  .dp-copy-btn:hover{border-color:var(--ink4);color:var(--ink2)}
  .dp-tabs{display:flex;padding:0 20px;border-bottom:1px solid var(--line);flex-shrink:0}
  .dp-tab{flex:1;padding:10px 0;font-size:11px;font-weight:500;letter-spacing:.04em;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--ink4);cursor:pointer;transition:all .15s;margin-bottom:-1px}
  .dp-tab.active{color:var(--ink);border-bottom-color:var(--ink)}
  .dp-tab:hover:not(.active){color:var(--ink2)}
  .dp-body{flex:1;overflow-y:auto}
  .dp-tab-body{padding:16px 20px 32px;display:flex;flex-direction:column;gap:16px}
  .dp-steps{display:flex;flex-direction:column}
  .dp-step{display:grid;grid-template-columns:24px 1fr auto 16px;align-items:center;gap:8px;padding:9px 20px;border-bottom:1px solid var(--line)}
  .dp-step:last-child{border-bottom:none}
  .step-num{font-family:"DM Mono","DM Mono Fallback",monospace;font-size:10px;color:var(--ink4);text-align:right}
  .step-title{font-family:"DM Mono","DM Mono Fallback",monospace;font-size:10.5px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dp-step--fail .step-title{color:var(--fail)}
  .step-dur{font-family:"DM Mono","DM Mono Fallback",monospace;font-size:10px;color:var(--ink4);white-space:nowrap}
  .step-pass{color:var(--pass);font-size:11px} .step-fail{color:var(--fail);font-size:11px}
  .step-err-row{grid-column:1/-1;font-family:"DM Mono","DM Mono Fallback",monospace;font-size:10px;color:var(--fail);padding:4px 20px 10px 52px;line-height:1.5}
  .dp-hist-hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:16px}
  .dp-hist-title{font-size:13px;font-weight:600;color:var(--ink);margin-bottom:3px}
  .dp-hist-sub{font-size:11px;color:var(--ink3)}
  .dp-hist-stats{display:flex;gap:20px;flex-shrink:0}
  .dp-hist-stat-lbl{font-size:9px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--ink4);margin-bottom:2px}
  .dp-hist-stat-val{font-family:"DM Mono","DM Mono Fallback",monospace;font-size:20px;font-weight:600;line-height:1}
  .dp-hist-stat-val.pass{color:var(--pass)} .dp-hist-stat-val.fail{color:var(--fail)}
  .dp-section{display:flex;flex-direction:column;gap:8px}
  .dp-section-title{font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--ink4)}
  .dp-details{display:flex;flex-direction:column;gap:8px} .dp-details summary{cursor:pointer}
  .dp-error{font-family:"DM Mono","DM Mono Fallback",monospace;font-size:11px;line-height:1.6;color:var(--fail);background:var(--fail-bg);border:1px solid #e8c4c4;border-radius:6px;padding:12px 14px;white-space:pre-wrap;word-break:break-word;margin:0}
  .dp-stack{font-family:"DM Mono","DM Mono Fallback",monospace;font-size:10px;line-height:1.6;color:var(--ink3);background:var(--paper2);border:1px solid var(--line);border-radius:6px;padding:12px 14px;white-space:pre-wrap;word-break:break-word;margin:0;max-height:260px;overflow-y:auto}
  .dp-empty-tab{font-size:11px;color:var(--ink3);text-align:center;padding:40px 20px;line-height:1.8}
  body.panel-open{overflow:hidden}
  @media(max-width:500px){.detail-panel{width:100vw;border-left:none}}
  .heatmap-section{overflow-x:auto;-webkit-overflow-scrolling:touch;background:#fff;border:1px solid var(--line);border-radius:8px;padding:18px 20px 16px;box-shadow:var(--shadow)}
  .heatmap-grid{display:grid;gap:2px;align-items:center;width:max-content;min-width:100%}
  .hm-date-lbl{font-size:8.5px;font-family:"DM Mono","DM Mono Fallback",monospace;color:var(--ink4);writing-mode:vertical-lr;transform:rotate(180deg);white-space:nowrap;height:42px;display:flex;align-items:center}
  .hm-row-label{font-size:10.5px;font-family:"DM Mono","DM Mono Fallback",monospace;color:var(--ink3);text-align:right;padding-right:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;height:14px;line-height:14px}
  .hm-cell{width:13px;height:13px;border-radius:2px;cursor:default;transition:transform .1s,opacity .1s}
  .hm-cell:hover{transform:scale(1.3);opacity:.85}
  .hm-pass{background:#2d6a3f} .hm-fail{background:#8b2020} .hm-flaky{background:#7a5c10} .hm-skip{background:#b8b0a4} .hm-none{background:var(--line)}
  .hm-legend{display:flex;gap:16px;align-items:center;margin-top:14px;flex-wrap:wrap}
  .hm-legend-item{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--ink3)}
  .hm-legend-swatch{width:11px;height:11px;border-radius:2px;flex-shrink:0}
  .hm-sub{font-size:10px;color:var(--ink4);margin-top:6px;font-family:"DM Mono","DM Mono Fallback",monospace}
`.trim();

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate the full HTML string for a project detail page.
 *
 * @param {object} p              - Normalized project object
 * @param {string} cacheBust      - Cache-busting suffix for style.css
 * @param {Array}  projectHistory - History entries for this project
 * @returns {string}              - Complete HTML page
 */
export function buildProjectPage(p, cacheBust, projectHistory) {
  const insightCards = buildInsightCards(p);
  const statsRow     = buildStatsRow(p);
  const rows         = buildTableRows(p);

  const statusClass = p.stats.ok ? 'ok' : 'fail';
  const statusText  = p.stats.ok ? 'All passed' : 'Failures detected';
  const typeLabel   = p.type === 'playwright' ? 'E2E' : p.type === 'newman' ? 'API' : 'Unit';
  const genDate     = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const browserChartCard = p.type === 'playwright' ? `
    <div class="chart-card">
      <div class="chart-title">Browser Pass / Fail</div>
      <canvas id="proj-chart-browser" height="180"></canvas>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${p.name} · QA Hub</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style"
  href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@300;400&display=swap"
  onload="this.onload=null;this.rel='stylesheet'">
<noscript>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@300;400&display=swap">
</noscript>
<link rel="preload" as="style" href="../style.css?v=${cacheBust}"
  onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="../style.css?v=${cacheBust}"></noscript>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" defer></script>
<style>${INLINE_STYLES}</style>
</head>
<body>
<main class="page">

  <a class="back-link" href="../index.html">All Projects</a>

  <header class="header">
    <div>
      <div class="eyebrow">QA Hub · ${typeLabel} Report</div>
      <h1><strong>${p.name}</strong></h1>
    </div>
    <div class="header-meta" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
      <span class="mono">generated ${genDate}</span>
      <span class="pill ${statusClass}"><span class="dot"></span>${statusText}</span>
    </div>
  </header>

  <div class="sl">Summary</div>
  <div class="gstats">${statsRow}</div>

  <div class="sl">Insights</div>
  <div class="insights-row">${insightCards}</div>

  <div class="sl">History Trends</div>
  <div class="charts-grid" id="proj-charts-grid">
    <div class="chart-card">
      <div class="chart-title">Pass Rate Trend</div>
      <canvas id="proj-chart-passrate" height="180"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">Duration Trend</div>
      <canvas id="proj-chart-duration" height="180"></canvas>
    </div>
    ${browserChartCard}
  </div>

  <div class="sl">Reliability Heatmap</div>
  <div id="heatmap-wrap"><div class="heatmap-section"><div class="chart-empty">Not enough history yet — run tests a few more times to see trends.</div></div></div>

  <div class="sl">Tests</div>
  <div class="table-wrap">
    <div class="table-controls">
      <div class="filter-btns" id="filter-btns">
        <button class="fbtn active all" data-filter="all">All</button>
        <button class="fbtn pass" data-filter="expected">Passed</button>
        <button class="fbtn fail" data-filter="unexpected">Failed</button>
        <button class="fbtn flaky" data-filter="flaky">Flaky</button>
        <button class="fbtn skip" data-filter="skipped">Skipped</button>
      </div>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th class="sortable" data-col="test">Test</th>
          <th class="sortable" data-col="browser">Browser</th>
          <th class="sortable" data-col="status">Status</th>
          <th class="sortable" data-col="duration">Duration</th>
        </tr></thead>
        <tbody id="tbody">${rows}</tbody>
      </table>
    </div>
    <div class="pagination">
      <span class="fcount" id="fcount"></span>
      <div class="pagination-pages" id="pagination-pages"></div>
      <div class="page-size-wrap">
        <label class="fcount" for="page-size">Rows</label>
        <select id="page-size" class="page-size-select">
          <option value="10">10</option>
          <option value="25" selected>25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>
    </div>
  </div>

  <footer class="footer">
    <span class="ft">${p.stats.total} tests · ${p.projectNames.join(', ')}</span>
    <span class="ft">qa hub · auto-generated</span>
  </footer>
</main>

<div class="panel-backdrop" id="panel-backdrop"></div>
<aside class="detail-panel" id="detail-panel" aria-hidden="true">
  <div class="dp-head">
    <div class="dp-title" id="dp-title"></div>
    <button class="dp-close" id="dp-close" aria-label="Close">✕</button>
  </div>
  <div class="dp-meta-bar" id="dp-meta-bar"></div>
  <div class="dp-file-bar" id="dp-file-bar"></div>
  <div class="dp-tabs" id="dp-tabs">
    <button class="dp-tab active" data-tab="steps">Steps</button>
    <button class="dp-tab" data-tab="history">History</button>
  </div>
  <div class="dp-body" id="dp-body"></div>
</aside>

<script>
// ── Table: filter / sort / pagination ─────────────────────────────────────────
let activeFilter = 'all', sortCol = null, sortDir = 1, currentPage = 1, pageSize = 25;

function getFilteredSorted() {
  let rows = [...document.querySelectorAll('#tbody tr')];
  rows = rows.filter(r => activeFilter === 'all' || r.dataset.outcome === activeFilter);
  if (sortCol) {
    rows.sort((a, b) => {
      const av = a.dataset[sortCol] || '', bv = b.dataset[sortCol] || '';
      if (sortCol === 'duration') return (Number(av) - Number(bv)) * sortDir;
      return av.localeCompare(bv) * sortDir;
    });
  }
  return rows;
}

function updateTable() {
  const allRows  = [...document.querySelectorAll('#tbody tr')];
  const filtered = getFilteredSorted();
  const total    = filtered.length;
  const pages    = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > pages) currentPage = pages;
  const start   = (currentPage - 1) * pageSize;
  const end     = start + pageSize;
  const pageSet = new Set(filtered.slice(start, end));
  const tbody   = document.getElementById('tbody');
  filtered.forEach(r => tbody.appendChild(r));
  allRows.forEach(r => r.classList.toggle('hidden', !pageSet.has(r)));
  const from = total === 0 ? 0 : start + 1;
  document.getElementById('fcount').textContent =
    total === 0 ? '0 tests' : from + '–' + Math.min(end, total) + ' of ' + total + ' tests';
  const pag = document.getElementById('pagination-pages');
  if (pages <= 1) { pag.innerHTML = ''; return; }
  let html = '<button class="pbtn" data-page="' + (currentPage - 1) + '" ' + (currentPage === 1 ? 'disabled' : '') + '>‹</button>';
  const ps = [];
  if (pages <= 7) { for (let i = 1; i <= pages; i++) ps.push(i); }
  else {
    ps.push(1);
    if (currentPage > 3) ps.push('…');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(pages - 1, currentPage + 1); i++) ps.push(i);
    if (currentPage < pages - 2) ps.push('…');
    ps.push(pages);
  }
  ps.forEach(p => {
    if (p === '…') html += '<span class="pellipsis">…</span>';
    else html += '<button class="pbtn' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
  });
  html += '<button class="pbtn" data-page="' + (currentPage + 1) + '" ' + (currentPage === pages ? 'disabled' : '') + '>›</button>';
  pag.innerHTML = html;
}

document.getElementById('filter-btns').addEventListener('click', e => {
  const btn = e.target.closest('.fbtn');
  if (!btn) return;
  activeFilter = btn.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentPage = 1; updateTable();
});

document.getElementById('pagination-pages').addEventListener('click', e => {
  const btn = e.target.closest('.pbtn');
  if (!btn || btn.disabled) return;
  currentPage = Number(btn.dataset.page);
  updateTable();
  document.querySelector('.table-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('page-size').addEventListener('change', e => {
  pageSize = Number(e.target.value); currentPage = 1; updateTable();
});

document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) { sortDir *= -1; th.className = 'sortable sort-' + (sortDir === 1 ? 'asc' : 'desc'); }
    else { document.querySelectorAll('th.sortable').forEach(t => t.className = 'sortable'); sortCol = col; sortDir = 1; th.className = 'sortable sort-asc'; }
    currentPage = 1; updateTable();
  });
});

updateTable();

// ── Test detail panel ─────────────────────────────────────────────────────────
(function () {
  const panel     = document.getElementById('detail-panel');
  const backdrop  = document.getElementById('panel-backdrop');
  const dpTitle   = document.getElementById('dp-title');
  const dpMetaBar = document.getElementById('dp-meta-bar');
  const dpFileBar = document.getElementById('dp-file-bar');
  const dpTabs    = document.getElementById('dp-tabs');
  const dpBody    = document.getElementById('dp-body');

  const CHIP_CLS      = { expected: 'pass', unexpected: 'fail', flaky: 'flaky', skipped: 'skip' };
  const CHIP_LABEL    = { expected: 'Passed', unexpected: 'Failed', flaky: 'Flaky', skipped: 'Skipped' };
  const OUTCOME_ICON  = { expected: '✓', unexpected: '✗', flaky: '⚡', skipped: '—' };
  const BROWSER_COLOR = { chromium: '#1a56a0', firefox: '#b54800', webkit: '#5c3080', unit: '#2d7a4f', api: '#ff6c37' };
  const fmtD = ms => ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms';
  const esc  = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let currentTest = null;
  let currentHist = [];
  let dpChart     = null;

  function getTestHistory(t) {
    return projectHistory
      .filter(e => e.tests)
      .map(e => {
        const m = e.tests.find(h => h.title === t.title && h.project === t.project);
        return m ? { date: e.date, duration: m.duration, outcome: m.outcome } : null;
      })
      .filter(Boolean);
  }

  function openPanel(t) {
    currentTest = t;
    currentHist = getTestHistory(t);

    dpTitle.textContent = t.title;

    const cls    = CHIP_CLS[t.outcome] || 'skip';
    const bColor = BROWSER_COLOR[t.project] || '#888';
    dpMetaBar.innerHTML =
        '<span class="chip ' + cls + '">' + OUTCOME_ICON[t.outcome] + ' ' + (CHIP_LABEL[t.outcome] || t.outcome) + '</span>'
      + '<span class="dp-meta-item">⏱ ' + fmtD(t.duration) + '</span>'
      + '<span class="bchip"><span class="bdot" style="background:' + bColor + '"></span>' + esc(t.project) + '</span>';

    dpFileBar.innerHTML =
        '<span class="dp-file-path">' + esc(t.file) + ':' + t.line + '</span>'
      + '<button class="dp-copy-btn" id="dp-copy" title="Copy path">⧉</button>';
    document.getElementById('dp-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(t.file + ':' + t.line).catch(() => {});
    }, { once: true });

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('visible');
    document.body.classList.add('panel-open');
    setTab('steps');
  }

  function setTab(tab) {
    dpTabs.querySelectorAll('.dp-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'steps') renderSteps();
    else renderHistory();
  }

  function renderSteps() {
    const t = currentTest;
    if (t.steps && t.steps.length > 0) {
      let html = '<div class="dp-steps">';
      t.steps.forEach((s, i) => {
        const fail = !!s.error;
        html += '<div class="dp-step' + (fail ? ' dp-step--fail' : '') + '">'
          + '<span class="step-num">' + (i + 1) + '</span>'
          + '<span class="step-title" title="' + esc(s.title) + '">' + esc(s.title) + '</span>'
          + '<span class="step-dur">' + fmtD(s.duration) + '</span>'
          + '<span class="' + (fail ? 'step-fail' : 'step-pass') + '">' + (fail ? '✗' : '✓') + '</span>'
          + '</div>';
        if (fail && s.error) html += '<div class="step-err-row">' + esc(s.error) + '</div>';
      });
      dpBody.innerHTML = html + '</div>';
    } else if (t.error) {
      dpBody.innerHTML = '<div class="dp-tab-body">'
        + '<div class="dp-section"><div class="dp-section-title">Error</div><pre class="dp-error">' + esc(t.error) + '</pre></div>'
        + (t.errorStack ? '<details class="dp-details"><summary class="dp-section-title">Stack Trace</summary><pre class="dp-stack">' + esc(t.errorStack) + '</pre></details>' : '')
        + '</div>';
    } else {
      dpBody.innerHTML = '<div class="dp-empty-tab">No steps recorded for this test</div>';
    }
  }

  function renderHistory() {
    if (dpChart) { dpChart.destroy(); dpChart = null; }
    const hist = currentHist;
    if (hist.length < 1) {
      dpBody.innerHTML = '<div class="dp-empty-tab">Not enough history yet.<br>Run the tests a few more times to see trends.</div>';
      return;
    }
    const avgDur = Math.round(hist.reduce((s, r) => s + r.duration, 0) / hist.length);
    const passed = hist.filter(r => r.outcome === 'expected').length;
    const failed = hist.filter(r => r.outcome !== 'expected' && r.outcome !== 'skipped').length;
    dpBody.innerHTML = '<div class="dp-tab-body">'
      + '<div class="dp-hist-hdr">'
      + '<div><div class="dp-hist-title">Test Execution History</div><div class="dp-hist-sub">Track test duration and status trends over time</div></div>'
      + '<div class="dp-hist-stats">'
      + '<div><div class="dp-hist-stat-lbl">Avg Duration</div><div class="dp-hist-stat-val">' + fmtD(avgDur) + '</div></div>'
      + '<div><div class="dp-hist-stat-lbl">Passed</div><div class="dp-hist-stat-val pass">' + passed + '</div></div>'
      + '<div><div class="dp-hist-stat-lbl">Failed</div><div class="dp-hist-stat-val fail">' + failed + '</div></div>'
      + '</div></div>'
      + '<canvas id="dp-hist-canvas" height="180"></canvas>'
      + '</div>';
    if (typeof Chart !== 'undefined') {
      const labels      = hist.map(r => new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      const pointColors = hist.map(r => r.outcome === 'expected' ? '#2d6a3f' : '#8b2020');
      dpChart = new Chart(document.getElementById('dp-hist-canvas'), {
        type: 'line',
        data: {
          labels,
          datasets: [{ data: hist.map(r => r.duration),
            borderColor: '#1a56a0', backgroundColor: '#1a56a010',
            pointBackgroundColor: pointColors, pointBorderColor: pointColors,
            tension: 0.3, pointRadius: 4, fill: true }],
        },
        options: {
          responsive: true, maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: '#e4dfd7' }, ticks: { maxTicksLimit: 8, font: { size: 9 } } },
            y: { grid: { color: '#e4dfd7' }, beginAtZero: false,
              ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(1) + 's' : v + 'ms', font: { size: 9 } } },
          },
        },
      });
    }
  }

  function closePanel() {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('visible');
    document.body.classList.remove('panel-open');
    if (dpChart) { dpChart.destroy(); dpChart = null; }
  }

  dpTabs.addEventListener('click', e => {
    const btn = e.target.closest('.dp-tab');
    if (btn) setTab(btn.dataset.tab);
  });
  document.getElementById('dp-close').addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
  document.getElementById('tbody').addEventListener('click', e => {
    const row = e.target.closest('tr[data-idx]');
    if (!row) return;
    const t = projTests[Number(row.dataset.idx)];
    if (t) openPanel(t);
  });
})();

// ── Project charts ────────────────────────────────────────────────────────────
const projectHistory = ${JSON.stringify(projectHistory)};

(function aggregateProjectHistory() {
  const byDay = new Map();
  for (const r of projectHistory) {
    const d = new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!byDay.has(d)) {
      byDay.set(d, { ...r, _count: 1, stats: { ...r.stats }, tests: r.tests ? [...r.tests] : [] });
    } else {
      const acc = byDay.get(d);
      acc.duration += r.duration;
      acc.stats.total += r.stats.total;
      acc.stats.expected += r.stats.expected;
      acc.stats.unexpected += r.stats.unexpected;
      acc.stats.flaky += r.stats.flaky;
      acc.stats.skipped += r.stats.skipped;
      acc._count++;
      if (r.date > acc.date) acc.date = r.date;
      if (r.tests && r.tests.length) {
        const testMap = new Map();
        for (const t of acc.tests) testMap.set(t.title + '|' + t.project, t);
        for (const t of r.tests) testMap.set(t.title + '|' + t.project, t);
        acc.tests = Array.from(testMap.values());
      }
    }
  }
  projectHistory.splice(0, projectHistory.length, ...Array.from(byDay.values()).map(acc => {
    acc.duration /= acc._count;
    acc.stats.total /= acc._count;
    acc.stats.expected /= acc._count;
    acc.stats.unexpected /= acc._count;
    acc.stats.flaky /= acc._count;
    acc.stats.skipped /= acc._count;
    return acc;
  }).sort((a,b) => a.date - b.date));
})();

const projBrowsers   = ${JSON.stringify(p.projectNames)};
const projTests      = ${JSON.stringify(p.tests)};

function initCharts() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = "'DM Mono', 'Courier New', monospace";
  Chart.defaults.font.size   = 10;
  Chart.defaults.color       = '#6b6560';
  const gridColor  = '#e4dfd7';
  const baseScales = {
    x: { grid: { color: gridColor }, ticks: { maxTicksLimit: 8 } },
    y: { grid: { color: gridColor }, beginAtZero: true },
  };

  if (projectHistory.length < 1) {
    ['proj-chart-passrate', 'proj-chart-duration'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.closest('.chart-card').innerHTML =
        '<div class="chart-title">' + (id.includes('passrate') ? 'Pass Rate Trend' : 'Duration Trend') + '</div>'
        + '<div class="chart-empty">Not enough history yet</div>';
    });
  } else {
    const labels = projectHistory.map(s =>
      new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    );

    const prEl = document.getElementById('proj-chart-passrate');
    if (prEl) {
      new Chart(prEl, {
        type: 'line',
        data: {
          labels,
          datasets: [{ data: projectHistory.map(s =>
              s.stats.total > 0 ? +((s.stats.expected / s.stats.total) * 100).toFixed(1) : 0),
            borderColor: '#2d6a3f', backgroundColor: '#2d6a3f18',
            tension: 0.35, pointRadius: 3, fill: true }],
        },
        options: {
          responsive: true, maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: { x: baseScales.x, y: { ...baseScales.y, max: 100, ticks: { callback: v => v + '%' } } },
        },
      });
    }

    const durEl = document.getElementById('proj-chart-duration');
    if (durEl) {
      new Chart(durEl, {
        type: 'line',
        data: {
          labels,
          datasets: [{ data: projectHistory.map(s => s.duration),
            borderColor: '#1a56a0', backgroundColor: '#1a56a018',
            tension: 0.35, pointRadius: 3, fill: true }],
        },
        options: {
          responsive: true, maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: { x: baseScales.x, y: { ...baseScales.y, ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(1) + 's' : v + 'ms' } } },
        },
      });
    }
  }

  const brEl = document.getElementById('proj-chart-browser');
  if (brEl && projBrowsers.length > 0) {
    const passed = {}, failed = {};
    for (const b of projBrowsers) { passed[b] = 0; failed[b] = 0; }
    for (const t of projTests) {
      if (t.outcome === 'expected')   passed[t.project] = (passed[t.project]  ?? 0) + 1;
      if (t.outcome === 'unexpected') failed[t.project] = (failed[t.project]  ?? 0) + 1;
    }
    new Chart(brEl, {
      type: 'bar',
      data: {
        labels: projBrowsers,
        datasets: [
          { label: 'Passed', data: projBrowsers.map(b => passed[b] ?? 0),
            backgroundColor: '#edf5f0', borderColor: '#2d6a3f', borderWidth: 1 },
          { label: 'Failed', data: projBrowsers.map(b => failed[b] ?? 0),
            backgroundColor: '#fdf0f0', borderColor: '#8b2020', borderWidth: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
        scales: { x: baseScales.x, y: { ...baseScales.y, ticks: { stepSize: 1 } } },
      },
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCharts);
} else {
  initCharts();
}

// ── Reliability Heatmap (test × run) ─────────────────────────────────────────

function buildProjectHeatmap() {
  const histWithTests = projectHistory.filter(e => e.tests && e.tests.length > 0);
  const wrap = document.getElementById('heatmap-wrap');

  if (histWithTests.length < 1) return; // keep default "not enough history" message

  // Build per-test reliability stats across all history entries
  const testMap = new Map(); // key: JSON [title, project] → { title, project, failures, runs }
  histWithTests.forEach(entry => {
    entry.tests.forEach(t => {
      const key = JSON.stringify([t.title, t.project]);
      if (!testMap.has(key)) testMap.set(key, { title: t.title, project: t.project, failures: 0, runs: 0 });
      const r = testMap.get(key);
      r.runs++;
      if (t.outcome === 'unexpected' || t.outcome === 'flaky') r.failures++;
    });
  });

  // Only show unreliable tests (at least 1 failure), sorted by failure rate, max 40
  const unreliable = [...testMap.values()]
    .filter(t => t.failures > 0)
    .sort((a, b) => (b.failures / b.runs) - (a.failures / a.runs))
    .slice(0, 40);

  if (unreliable.length === 0) {
    wrap.innerHTML = '<div class="heatmap-section"><div class="chart-empty" style="padding:24px 0">All tests have been reliable across all recorded runs ✓</div></div>';
    return;
  }

  // Lookup: [title, project, date] → outcome
  const outcomeLookup = new Map();
  histWithTests.forEach(entry => {
    entry.tests.forEach(t => {
      outcomeLookup.set(JSON.stringify([t.title, t.project, entry.date]), t.outcome);
    });
  });

  const dates    = histWithTests.map(e => e.date); // ascending
  const fmtD     = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const clsMap   = { expected: 'hm-pass', unexpected: 'hm-fail', flaky: 'hm-flaky', skipped: 'hm-skip' };
  const lblMap   = { expected: 'Passed', unexpected: 'Failed', flaky: 'Flaky', skipped: 'Skipped' };

  let html = '<div class="heatmap-section">';
  html += '<div class="heatmap-grid" style="grid-template-columns:220px repeat(' + dates.length + ',13px)">';

  // Header: corner + date labels
  html += '<div class="hm-corner"></div>';
  dates.forEach(d => { html += '<div class="hm-date-lbl" title="' + fmtD(d) + '">' + fmtD(d) + '</div>'; });

  // One row per unreliable test
  unreliable.forEach(({ title, project }) => {
    const trunc = title.length > 40 ? title.slice(0, 38) + '…' : title;
    html += '<div class="hm-row-label" title="' + title.replace(/"/g, '&quot;') + ' (' + project + ')">' + trunc.replace(/</g, '&lt;') + '</div>';
    dates.forEach(d => {
      const outcome = outcomeLookup.get(JSON.stringify([title, project, d]));
      const cls = outcome ? (clsMap[outcome] || 'hm-skip') : 'hm-none';
      const lbl = outcome ? (lblMap[outcome] || outcome) : 'No data';
      html += '<div class="hm-cell ' + cls + '" title="' + trunc.replace(/"/g, '') + ' · ' + fmtD(d) + ' · ' + lbl + '"></div>';
    });
  });

  html += '</div>'; // heatmap-grid
  html += '<div class="hm-sub">Showing ' + unreliable.length + ' unreliable test' + (unreliable.length !== 1 ? 's' : '') + ' · Each column = one CI run (oldest left → newest right)</div>';
  html += '<div class="hm-legend">'
    + '<div class="hm-legend-item"><div class="hm-legend-swatch hm-pass"></div>Passed</div>'
    + '<div class="hm-legend-item"><div class="hm-legend-swatch hm-fail"></div>Failed</div>'
    + '<div class="hm-legend-item"><div class="hm-legend-swatch hm-flaky"></div>Flaky</div>'
    + '<div class="hm-legend-item"><div class="hm-legend-swatch hm-skip"></div>Skipped</div>'
    + '<div class="hm-legend-item"><div class="hm-legend-swatch hm-none"></div>No data</div>'
    + '</div>';
  html += '</div>'; // heatmap-section

  wrap.innerHTML = html;
}

buildProjectHeatmap();
</script>
</body>
</html>`;
}
