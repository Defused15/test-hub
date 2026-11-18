import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync, cpSync, rmSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

import { parseReport } from './lib/parsers.mjs';
import { updateHistory, packHistory } from './lib/history.mjs';
import { buildDashboardPage, buildProjectPage } from './lib/render.mjs';

// ── Paths ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');
const PROJECTS   = join(ROOT, 'projects');
const DIST       = join(ROOT, 'dist');
const HISTORY    = join(ROOT, 'history');
const PUBLIC     = join(__dirname, 'public');

// ── Validate project directory ────────────────────────────────────────────────

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

// ── Parse all project reports ─────────────────────────────────────────────────

const projects = projectDirs.map(name => {
  const jsonPath = join(PROJECTS, name, 'latest.json');

  if (!existsSync(jsonPath)) {
    console.warn(`${name}/latest.json not found, skipping`);
    return null;
  }

  let p;
  try {
    p = parseReport(readFileSync(jsonPath, 'utf8'), name);
  } catch {
    console.warn(`Could not parse ${name}/latest.json, skipping`);
    return null;
  }
  if (!p) console.warn(`${name}/latest.json: unknown report format, skipping`);
  return p;
}).filter(Boolean);

// Optional per-project links (source repo, full report, live site)
const LINKS_PATH = join(__dirname, 'project-links.json');
const projectLinks = existsSync(LINKS_PATH) ? JSON.parse(readFileSync(LINKS_PATH, 'utf8')) : {};
for (const p of projects) p.links = projectLinks[p.name] ?? {};

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

// ── Update history files (history/<project>.json) ─────────────────────────────

const historyMap = {};
for (const p of projects) {
  historyMap[p.name] = updateHistory(p, HISTORY);
}

// ── Write dist/ ───────────────────────────────────────────────────────────────

rmSync(DIST, { recursive: true, force: true }); // drop files from older builds
mkdirSync(DIST, { recursive: true });

// Changes only when the client files change, so browsers keep them cached across report-only deploys.
const SITE_FILES = ['hub.js', 'hub.css', 'theme.js'];
const cacheBust = createHash('sha1')
  .update(SITE_FILES.map(f => readFileSync(join(__dirname, 'site', f))).join('\0'))
  .digest('hex').slice(0, 10);
const packedHistory = Object.fromEntries(Object.entries(historyMap).map(([k, v]) => [k, packHistory(v)]));

writeFileSync(join(DIST, 'index.html'), buildDashboardPage({ projects, global, history: packedHistory, cacheBust }), 'utf8');
for (const f of SITE_FILES) copyFileSync(join(__dirname, 'site', f), join(DIST, f));

// ── Generate per-project detail pages ────────────────────────────────────────

const PROJ_DIST = join(DIST, 'projects');
mkdirSync(PROJ_DIST, { recursive: true });

for (const p of projects) {
  const pagePath = join(PROJ_DIST, encodeURIComponent(p.name) + '.html');
  writeFileSync(pagePath, buildProjectPage(p, cacheBust, packedHistory[p.name] ?? packHistory([])), 'utf8');
}
console.log(`Project pages written to dist/projects/ (${projects.length})`);

// ── Copy public/ assets ───────────────────────────────────────────────────────

if (existsSync(PUBLIC)) {
  cpSync(PUBLIC, DIST, { recursive: true });
  console.log('Public assets copied to dist/');
}

console.log('Dashboard written to dist/');
console.log(`Projects: ${projects.length}  |  Total: ${global.total}  |  Failed: ${global.unexpected}`);
