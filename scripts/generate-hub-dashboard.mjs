import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync, cpSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');
const PROJECTS   = join(ROOT, 'projects');
const DIST       = join(ROOT, 'dist');

// ── Read all project reports ──────────────────────────────────────────────────

if (!existsSync(PROJECTS)) {
  console.error('projects/ folder not found. Nothing to build.');
  process.exit(1);
}

const projectDirs = readdirSync(PROJECTS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

if (projectDirs.length === 0) {
  console.warn('No project folders found in projects/. Dashboard will be empty.');
}

// ── Detect report format ──────────────────────────────────────────────────────

function detectReportType(raw) {
  if (Array.isArray(raw.testResults)) return 'jest';
  if (Array.isArray(raw.suites))      return 'playwright';
  return 'unknown';
}

// ── Flatten Playwright JSON suites into a flat test array ─────────────────────

function flattenSpecs(suites = [], path = []) {
  const tests = [];
  for (const suite of suites) {
    const nextPath = suite.title ? [...path, suite.title] : path;
    for (const spec of (suite.specs ?? [])) {
      for (const test of (spec.tests ?? [])) {
        const result = test.results?.[0] ?? {};
        tests.push({
          title:    spec.title,
          file:     spec.file ?? nextPath[0] ?? '',
          line:     spec.line ?? 0,
          project:  test.projectName ?? 'default',
          outcome:  test.status,
          duration: result.duration ?? 0,
          retries:  result.retry ?? 0,
          error:    result.error?.message ?? null,
        });
      }
    }
    if (suite.suites) {
      tests.push(...flattenSpecs(suite.suites, nextPath));
    }
  }
  return tests;
}

// ── Flatten Jest JSON into the same flat test array format ────────────────────

function flattenJest(testResults = []) {
  const tests = [];
  for (const suite of testResults) {
    const file = suite.testFilePath ?? '';
    for (const t of (suite.assertionResults ?? [])) {
      let outcome;
      if (t.status === 'passed')       outcome = 'expected';
      else if (t.status === 'failed')  outcome = 'unexpected';
      else                             outcome = 'skipped'; // pending, todo
      tests.push({
        title:    t.fullName ?? t.title ?? '',
        file,
        line:     t.location?.line ?? 0,
        project:  'unit',
        outcome,
        duration: t.duration ?? 0,
        retries:  0,
        error:    t.failureMessages?.[0] ?? null,
      });
    }
  }
  return tests;
}

// ── Parse a Playwright report ─────────────────────────────────────────────────

function parsePlaywrightProject(raw, name) {
  const stats = raw.stats ?? {};
  const tests = flattenSpecs(raw.suites ?? []);
  const total = (stats.expected ?? 0) + (stats.unexpected ?? 0)
              + (stats.flaky ?? 0)    + (stats.skipped ?? 0);
  return {
    name,
    type:      'playwright',
    startTime: new Date(stats.startTime ?? Date.now()).getTime(),
    duration:  stats.duration ?? 0,
    workers:   raw.config?.workers ?? 1,
    stats: {
      total,
      expected:   stats.expected   ?? 0,
      unexpected: stats.unexpected ?? 0,
      flaky:      stats.flaky      ?? 0,
      skipped:    stats.skipped    ?? 0,
      ok:         (stats.unexpected ?? 0) === 0,
    },
    projectNames: [...new Set(tests.map(t => t.project))],
    tests,
  };
}

// ── Parse a Jest report ───────────────────────────────────────────────────────

function parseJestProject(raw, name) {
  const tests      = flattenJest(raw.testResults ?? []);
  const expected   = raw.numPassedTests  ?? 0;
  const unexpected = raw.numFailedTests  ?? 0;
  const skipped    = (raw.numPendingTests ?? 0) + (raw.numTodoTests ?? 0);
  const total      = raw.numTotalTests   ?? tests.length;
  return {
    name,
    type:      'jest',
    startTime: raw.startTime ?? Date.now(),
    duration:  0,
    workers:   1,
    stats: {
      total,
      expected,
      unexpected,
      flaky:   0,
      skipped,
      ok:      unexpected === 0,
    },
    projectNames: ['unit'],
    tests,
  };
}

// ── Build per-project data ────────────────────────────────────────────────────

const projects = projectDirs.map(name => {
  const jsonPath = join(PROJECTS, name, 'latest.json');

  if (!existsSync(jsonPath)) {
    console.warn(`${name}/latest.json not found, skipping`);
    return null;
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.warn(`Could not parse ${name}/latest.json, skipping`);
    return null;
  }

  const type = detectReportType(raw);
  if (type === 'playwright') return parsePlaywrightProject(raw, name);
  if (type === 'jest')       return parseJestProject(raw, name);
  console.warn(`${name}/latest.json: unknown report format, skipping`);
  return null;
}).filter(Boolean);

// ── Global aggregates ─────────────────────────────────────────────────────────

const global = projects.reduce((acc, p) => {
  acc.total      += p.stats.total;
  acc.expected   += p.stats.expected;
  acc.unexpected += p.stats.unexpected;
  acc.flaky      += p.stats.flaky;
  acc.skipped    += p.stats.skipped;
  return acc;
}, { total: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0 });

global.ok       = global.unexpected === 0;
global.passRate = global.total
  ? ((global.expected / global.total) * 100).toFixed(1)
  : '0';

// ── Build project detail page HTML ───────────────────────────────────────────

function buildProjectPage(p, cacheBust) {
  // Compute insights
  const nonZero   = p.tests.filter(t => t.duration > 0);
  const passed    = p.tests.filter(t => t.outcome === 'expected' && t.duration > 0);
  const avgDur    = nonZero.length
    ? Math.round(nonZero.reduce((s, t) => s + t.duration, 0) / nonZero.length)
    : 0;
  const slowest   = nonZero.length
    ? nonZero.reduce((a, b) => a.duration > b.duration ? a : b)
    : null;
  const fastest   = passed.length
    ? passed.reduce((a, b) => a.duration < b.duration ? a : b)
    : null;
  const browserColor = { chromium:'#1a56a0', firefox:'#b54800', webkit:'#5c3080', unit:'#2d7a4f' };
  const chipMap      = { expected:'pass', unexpected:'fail', flaky:'flaky', skipped:'skip' };
  const chipLabel    = { expected:'Passed', unexpected:'Failed', flaky:'Flaky', skipped:'Skipped' };

  const fmtDur = ms => ms >= 1000 ? (ms/1000).toFixed(2)+'s' : ms+'ms';

  const insightCards = [
    {
      label: 'Avg Duration',
      value: fmtDur(avgDur),
      sub:   nonZero.length + ' tests measured',
    },
    {
      label: 'Slowest Test',
      value: slowest ? fmtDur(slowest.duration) : '—',
      sub:   slowest ? slowest.title : 'no data',
    },
    {
      label: 'Fastest Passing',
      value: fastest ? fmtDur(fastest.duration) : '—',
      sub:   fastest ? fastest.title : 'no data',
    },
    {
      label: 'Browsers / Projects',
      value: p.projectNames.length.toString(),
      sub:   p.projectNames.join(', ') || '—',
    },
  ].map(c =>
    '<div class="insight-card">'
    + '<div class="insight-label">'+c.label+'</div>'
    + '<div class="insight-value">'+c.value+'</div>'
    + '<div class="insight-sub" title="'+c.sub.replace(/"/g,'&quot;')+'">'+c.sub+'</div>'
    + '</div>'
  ).join('');

  const statsRow = [
    { cls:'',   label:'Total',    val: p.stats.total },
    { cls:'p',  label:'Passed',   val: p.stats.expected },
    { cls:'f',  label:'Failed',   val: p.stats.unexpected },
    { cls:'fl', label:'Flaky',    val: p.stats.flaky },
    { cls:'',   label:'Skipped',  val: p.stats.skipped },
    { cls:'dur',label:'Duration', val: fmtDur(p.duration) },
  ].map(s =>
    '<div class="gc '+s.cls+'"><div class="gn">'+s.val+'</div><div class="gl">'+s.label+'</div></div>'
  ).join('');

  const rows = p.tests.map(t => {
    const bColor = browserColor[t.project] || '#888';
    const cls    = chipMap[t.outcome]   || 'skip';
    const lbl    = chipLabel[t.outcome] || t.outcome;
    return '<tr data-outcome="'+t.outcome+'" data-test="'+t.title.replace(/"/g,'&quot;')+'" data-browser="'+t.project+'" data-duration="'+t.duration+'">'
      + '<td><div class="tt">'+t.title+'</div><div class="tf">'+t.file+':'+t.line+'</div></td>'
      + '<td><span class="bchip"><span class="bdot" style="background:'+bColor+'"></span>'+t.project+'</span></td>'
      + '<td><span class="chip '+cls+'">'+lbl+'</span></td>'
      + '<td><span class="dur">'+fmtDur(t.duration)+'</span></td>'
      + '</tr>';
  }).join('');

  const statusClass = p.stats.ok ? 'ok' : 'fail';
  const statusText  = p.stats.ok ? 'All passed' : 'Failures detected';
  const typeLabel   = p.type === 'playwright' ? 'E2E' : 'Unit';
  const genDate     = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });

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
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{font-size:15px}
  body{background:#faf9f7;color:#1a1814;font-family:'DM Sans',sans-serif;line-height:1.5;min-height:100vh}
  .page{max-width:1120px;margin:0 auto;padding:52px 36px 80px}
  .header{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:24px;border-bottom:1.5px solid #1a1814;margin-bottom:36px}
  h1{font-size:26px;font-weight:300;letter-spacing:-.02em} h1 strong{font-weight:600}
  .eyebrow{font-size:10px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:#6b6560;margin-bottom:4px}
  .gstats{grid-template-columns:repeat(6,1fr)}
</style>
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
<script>
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
  const start    = (currentPage - 1) * pageSize;
  const end      = start + pageSize;
  const pageSet  = new Set(filtered.slice(start, end));
  const tbody    = document.getElementById('tbody');
  filtered.forEach(r => tbody.appendChild(r));
  allRows.forEach(r => r.classList.toggle('hidden', !pageSet.has(r)));
  const from = total === 0 ? 0 : start + 1;
  document.getElementById('fcount').textContent =
    total === 0 ? '0 tests' : from + '–' + Math.min(end, total) + ' of ' + total + ' tests';
  const pag = document.getElementById('pagination-pages');
  if (pages <= 1) { pag.innerHTML = ''; return; }
  let html = '<button class="pbtn" data-page="'+(currentPage-1)+'" '+(currentPage===1?'disabled':'')+'>‹</button>';
  const ps = [];
  if (pages <= 7) { for (let i=1;i<=pages;i++) ps.push(i); }
  else {
    ps.push(1);
    if (currentPage > 3) ps.push('…');
    for (let i=Math.max(2,currentPage-1);i<=Math.min(pages-1,currentPage+1);i++) ps.push(i);
    if (currentPage < pages-2) ps.push('…');
    ps.push(pages);
  }
  ps.forEach(p => {
    if (p==='…') html+='<span class="pellipsis">…</span>';
    else html+='<button class="pbtn'+(p===currentPage?' active':'')+'" data-page="'+p+'">'+p+'</button>';
  });
  html += '<button class="pbtn" data-page="'+(currentPage+1)+'" '+(currentPage===pages?'disabled':'')+'>›</button>';
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
  document.querySelector('.table-wrap').scrollIntoView({ behavior:'smooth', block:'start' });
});

document.getElementById('page-size').addEventListener('change', e => {
  pageSize = Number(e.target.value); currentPage = 1; updateTable();
});

document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) { sortDir *= -1; th.className = 'sortable sort-'+(sortDir===1?'asc':'desc'); }
    else { document.querySelectorAll('th.sortable').forEach(t => t.className='sortable'); sortCol=col; sortDir=1; th.className='sortable sort-asc'; }
    currentPage = 1; updateTable();
  });
});

updateTable();
</script>
</body>
</html>`;
}

// ── Write dist/ ───────────────────────────────────────────────────────────────

mkdirSync(DIST, { recursive: true });

// Inject JSON data into HTML template
const dataJson   = JSON.stringify({ projects, global });
const cacheBust  = Date.now().toString(36); // short base-36 timestamp
const htmlTpl    = readFileSync(join(__dirname, 'dashboard.html'), 'utf8');
const htmlOutput = htmlTpl
  .replace('/*%%DATA%%*/null', dataJson)
  .replace('href="style.css"', `href="style.css?v=${cacheBust}"`);

writeFileSync(join(DIST, 'index.html'), htmlOutput, 'utf8');
copyFileSync(join(__dirname, 'dashboard.css'), join(DIST, 'style.css'));

// Generate one detail page per project
const PROJ_DIST = join(DIST, 'projects');
mkdirSync(PROJ_DIST, { recursive: true });
for (const p of projects) {
  const pagePath = join(PROJ_DIST, encodeURIComponent(p.name) + '.html');
  writeFileSync(pagePath, buildProjectPage(p, cacheBust), 'utf8');
}
console.log('Project pages written to dist/projects/ (' + projects.length + ')');

// Copy public/ assets (favicons, etc.) to dist/ if the folder exists
const PUBLIC = join(__dirname, 'public');
if (existsSync(PUBLIC)) {
  cpSync(PUBLIC, DIST, { recursive: true });
  console.log('Public assets copied to dist/');
}

console.log('Dashboard written to dist/');
console.log('Projects: ' + projects.length + '  |  Total: ' + global.total + '  |  Failed: ' + global.unexpected);
