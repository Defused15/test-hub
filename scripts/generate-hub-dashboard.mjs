#!/usr/bin/env node
/**
 * scripts/generate-hub-dashboard.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads all projects/*/latest.json files, aggregates the data, and writes
 * dist/index.html — a self-contained combined dashboard.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT      = resolve(__dirname, '..');
const PROJECTS  = join(ROOT, 'projects');
const DIST      = join(ROOT, 'dist');

// ── Read all project reports ──────────────────────────────────────────────────

if (!existsSync(PROJECTS)) {
  console.error('❌  projects/ folder not found. Nothing to build.');
  process.exit(1);
}

const projectDirs = readdirSync(PROJECTS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

if (projectDirs.length === 0) {
  console.warn('⚠️  No project folders found in projects/. Dashboard will be empty.');
}

// ── Flatten Playwright JSON suites → test array ───────────────────────────────

function flattenSpecs(suites = [], path = []) {
  const tests = [];
  for (const suite of suites) {
    const nextPath = suite.title ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
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
    if (suite.suites) tests.push(...flattenSpecs(suite.suites, nextPath));
  }
  return tests;
}

// ── Build per-project data objects ───────────────────────────────────────────

const projects = projectDirs.map(name => {
  const jsonPath = join(PROJECTS, name, 'latest.json');

  if (!existsSync(jsonPath)) {
    console.warn(`⚠️  ${name}/latest.json not found — skipping`);
    return null;
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.warn(`⚠️  Could not parse ${name}/latest.json — skipping`);
    return null;
  }

  const stats = raw.stats ?? {};
  const tests = flattenSpecs(raw.suites ?? []);
  const total = (stats.expected ?? 0) + (stats.unexpected ?? 0)
              + (stats.flaky ?? 0)    + (stats.skipped ?? 0);

  return {
    name,
    startTime:    new Date(stats.startTime ?? Date.now()).getTime(),
    duration:     stats.duration ?? 0,
    workers:      raw.config?.workers ?? 1,
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
global.passRate = global.total ? ((global.expected / global.total) * 100).toFixed(1) : '0';

// ── Write dist/index.html ─────────────────────────────────────────────────────

mkdirSync(DIST, { recursive: true });

const DATA_JSON = JSON.stringify({ projects, global }, null, 2);

const html = buildHTML(DATA_JSON);
writeFileSync(join(DIST, 'index.html'), html, 'utf8');

console.log(`✅  Hub dashboard written to dist/index.html`);
console.log(`    Projects: ${projects.length}  |  Total tests: ${global.total}  |  Failed: ${global.unexpected}`);

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildHTML(dataJson) {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QA Hub · Test Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@300;400&display=swap" rel="stylesheet">
<style>
  :root {
    --paper:   #faf9f7; --paper2: #f4f2ee; --paper3: #ede9e3;
    --ink:     #1a1814; --ink2:   #4a4640; --ink3:   #8c877f; --ink4: #b8b2a8;
    --line:    #e4dfd7; --line2:  #d8d1c7;
    --pass:    #2d6a3f; --pass-bg: #edf5f0;
    --fail:    #8b2020; --fail-bg: #fdf0f0;
    --flaky:   #7a5c10; --flaky-bg:#fdf6e3;
    --skip:    #5a5450; --skip-bg: #f2f0ed;
    --shadow:  0 1px 3px rgba(26,24,20,.06);
    --shadow2: 0 2px 8px rgba(26,24,20,.09);
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{font-size:15px}
  body{background:var(--paper);color:var(--ink);font-family:'DM Sans',sans-serif;line-height:1.5;min-height:100vh}
  .page{max-width:1120px;margin:0 auto;padding:52px 36px 80px}

  /* Header */
  .header{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:24px;border-bottom:1.5px solid var(--ink);margin-bottom:36px;animation:up .5s ease both}
  .eyebrow{font-size:10px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--ink3);margin-bottom:4px}
  h1{font-size:26px;font-weight:300;letter-spacing:-.02em}
  h1 strong{font-weight:600}
  .header-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
  .mono{font-family:'DM Mono',monospace;font-size:11px;color:var(--ink3);font-weight:300}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;border:1px solid}
  .pill.ok  {background:var(--pass-bg);color:var(--pass);border-color:#b8d9c2}
  .pill.fail{background:var(--fail-bg);color:var(--fail);border-color:#e8bbbb}
  .dot{width:6px;height:6px;border-radius:50%;background:currentColor}

  /* Section label */
  .sl{font-size:10px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--ink4);margin:36px 0 14px}

  /* Global stats */
  .gstats{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--line2);border-radius:8px;overflow:hidden;background:#fff;box-shadow:var(--shadow);animation:up .5s .06s ease both}
  .gc{padding:20px 18px;border-right:1px solid var(--line)}
  .gc:last-child{border-right:none}
  .gn{font-family:'DM Mono',monospace;font-size:28px;line-height:1;margin-bottom:5px}
  .gc.p .gn{color:var(--pass)} .gc.f .gn{color:var(--fail)} .gc.fl .gn{color:var(--flaky)}
  .gl{font-size:10px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--ink4)}

  /* Project cards grid */
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;animation:up .5s .12s ease both}
  .card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:22px 22px 18px;box-shadow:var(--shadow);transition:box-shadow .2s,border-color .2s}
  .card:hover{box-shadow:var(--shadow2);border-color:var(--line2)}
  .card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--line)}
  .card-name{font-size:14px;font-weight:600;color:var(--ink)}
  .card-date{font-family:'DM Mono',monospace;font-size:10px;color:var(--ink4);margin-top:3px}
  .card-stats{display:flex;gap:16px;margin-bottom:16px}
  .cs{display:flex;flex-direction:column}
  .cs-n{font-family:'DM Mono',monospace;font-size:22px;line-height:1;margin-bottom:2px}
  .cs.p .cs-n{color:var(--pass)} .cs.f .cs-n{color:var(--fail)} .cs.fl .cs-n{color:var(--flaky)}
  .cs-l{font-size:9px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--ink4)}
  .progress-track{height:5px;background:var(--paper3);border-radius:3px;overflow:hidden;margin-bottom:14px}
  .progress-fill{height:100%;border-radius:3px;transition:width 1.2s cubic-bezier(.16,1,.3,1)}

  /* Browsers inside card */
  .browsers{display:flex;gap:6px;flex-wrap:wrap}
  .bchip{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:3px;font-size:10px;background:var(--paper2);color:var(--ink2);border:1px solid var(--line)}
  .bdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}

  /* Test detail table */
  .table-wrap{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;box-shadow:var(--shadow);animation:up .5s .18s ease both}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  thead{background:var(--paper2);border-bottom:1px solid var(--line2)}
  th{font-size:9.5px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;color:var(--ink4);text-align:left;padding:10px 16px;white-space:nowrap}
  td{padding:12px 16px;border-bottom:1px solid var(--line);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:var(--paper)}
  .tt{font-size:12.5px;font-weight:500;color:var(--ink)}
  .tf{font-family:'DM Mono',monospace;font-size:10px;color:var(--ink4);margin-top:2px}
  .chip{display:inline-flex;align-items:center;padding:2px 7px;border-radius:3px;font-size:9.5px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;border:1px solid transparent}
  .chip.pass {background:var(--pass-bg);color:var(--pass);border-color:#c6dece}
  .chip.fail {background:var(--fail-bg);color:var(--fail);border-color:#e8c4c4}
  .chip.flaky{background:var(--flaky-bg);color:var(--flaky);border-color:#e5d9a8}
  .chip.skip {background:var(--skip-bg);color:var(--skip);border-color:#d8d5d0}
  .dur{font-family:'DM Mono',monospace;font-size:11px;color:var(--ink2)}

  /* Footer */
  .footer{margin-top:52px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between}
  .ft{font-size:10px;color:var(--ink4);font-family:'DM Mono',monospace}

  @keyframes up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @media(max-width:700px){.gstats{grid-template-columns:repeat(3,1fr)}.page{padding:32px 18px 60px}}
</style>
</head>
<body>
<div class="page">

  <header class="header">
    <div>
      <div class="eyebrow">QA Hub · Combined Test Report</div>
      <h1><strong>All Projects</strong> Dashboard</h1>
    </div>
    <div class="header-meta">
      <span class="mono" id="gen-date"></span>
      <span class="pill ok" id="global-pill"><span class="dot"></span><span id="pill-text">All passed</span></span>
    </div>
  </header>

  <div class="sl">Global Summary</div>
  <div class="gstats" id="gstats"></div>

  <div class="sl">Projects</div>
  <div class="cards" id="cards"></div>

  <div class="sl">All Tests</div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Project</th><th>Test</th><th>Browser</th><th>Status</th><th>Duration</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>

  <footer class="footer">
    <span class="ft" id="footer-l"></span>
    <span class="ft">qa hub · auto-generated</span>
  </footer>
</div>

<script>
const { projects, global } = ${dataJson};

const fmtDur  = ms => ms >= 1000 ? (ms/1000).toFixed(2)+'s' : ms+'ms';
const fmtDate = ts => new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
const browserColor = { chromium:'#1a56a0', firefox:'#b54800', webkit:'#5c3080' };
const chipMap   = { expected:'pass', unexpected:'fail', flaky:'flaky', skipped:'skip' };
const chipLabel = { expected:'Passed', unexpected:'Failed', flaky:'Flaky', skipped:'Skipped' };

// Header
document.getElementById('gen-date').textContent = 'generated ' + fmtDate(Date.now());
if (!global.ok) {
  const p = document.getElementById('global-pill');
  p.className = 'pill fail';
  document.getElementById('pill-text').textContent = 'Failures detected';
}

// Global stats
document.getElementById('gstats').innerHTML = [
  { cls:'',   label:'Total',   val: global.total },
  { cls:'p',  label:'Passed',  val: global.expected },
  { cls:'f',  label:'Failed',  val: global.unexpected },
  { cls:'fl', label:'Flaky',   val: global.flaky },
  { cls:'',   label:'Skipped', val: global.skipped },
].map(s => \`<div class="gc \${s.cls}"><div class="gn">\${s.val}</div><div class="gl">\${s.label}</div></div>\`).join('');

document.getElementById('footer-l').textContent = \`\${projects.length} project\${projects.length!==1?'s':''} · \${global.total} tests total\`;

// Project cards
document.getElementById('cards').innerHTML = projects.map(p => {
  const passRate = p.stats.total ? ((p.stats.expected / p.stats.total)*100).toFixed(0) : 0;
  const barColor = p.stats.ok ? '#2d6a3f' : '#8b2020';
  const browsers = p.projectNames.map(b => {
    const c = browserColor[b] || '#888';
    return \`<span class="bchip"><span class="bdot" style="background:\${c}"></span>\${b}</span>\`;
  }).join('');
  return \`
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-name">\${p.name}</div>
          <div class="card-date">\${fmtDate(p.startTime)}</div>
        </div>
        <span class="pill \${p.stats.ok?'ok':'fail'}">
          <span class="dot"></span>
          \${p.stats.ok ? 'Passed' : 'Failed'}
        </span>
      </div>
      <div class="card-stats">
        <div class="cs"><div class="cs-l">Total</div><div class="cs-n">\${p.stats.total}</div></div>
        <div class="cs p"><div class="cs-l">Passed</div><div class="cs-n">\${p.stats.expected}</div></div>
        <div class="cs f"><div class="cs-l">Failed</div><div class="cs-n">\${p.stats.unexpected}</div></div>
        <div class="cs fl"><div class="cs-l">Flaky</div><div class="cs-n">\${p.stats.flaky}</div></div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:\${passRate}%;background:\${barColor}"></div>
      </div>
      <div class="browsers">\${browsers}</div>
    </div>\`;
}).join('');

// All tests table
document.getElementById('tbody').innerHTML = projects.flatMap(p =>
  p.tests.map(t => {
    const bColor = browserColor[t.project] || '#888';
    const cls   = chipMap[t.outcome]   || 'skip';
    const lbl   = chipLabel[t.outcome] || t.outcome;
    return \`
      <tr>
        <td><span class="dur">\${p.name}</span></td>
        <td>
          <div class="tt">\${t.title}</div>
          <div class="tf">\${t.file}:\${t.line}</div>
        </td>
        <td><span class="bchip"><span class="bdot" style="background:\${bColor}"></span>\${t.project}</span></td>
        <td><span class="chip \${cls}">\${lbl}</span></td>
        <td><span class="dur">\${fmtDur(t.duration)}</span></td>
      </tr>\`;
  })
).join('');
</script>
</body>
</html>`;
}
