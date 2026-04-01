import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync, cpSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { detectReportType, parsePlaywrightProject, parseJestProject, parseNewmanProject } from './lib/parsers.mjs';
import { updateHistory } from './lib/history.mjs';
import { buildProjectPage } from './lib/render.mjs';

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

  let raw;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch {
    console.warn(`Could not parse ${name}/latest.json, skipping`);
    return null;
  }

  const type = detectReportType(raw);
  if (type === 'playwright') return parsePlaywrightProject(raw, name);
  if (type === 'jest')       return parseJestProject(raw, name);
  if (type === 'newman')     return parseNewmanProject(raw, name);
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

// ── Update history files (history/<project>.json) ─────────────────────────────

const historyMap = {};
for (const p of projects) {
  historyMap[p.name] = updateHistory(p, HISTORY);
}

// ── Write dist/ ───────────────────────────────────────────────────────────────

mkdirSync(DIST, { recursive: true });

const dataJson    = JSON.stringify({ projects, global });
const historyJson = JSON.stringify(historyMap);
const cacheBust   = Date.now().toString(36);
const htmlTpl     = readFileSync(join(__dirname, 'dashboard.html'), 'utf8');
const htmlOutput  = htmlTpl
  .replace('/*%%DATA%%*/null',    dataJson)
  .replace('/*%%HISTORY%%*/null', historyJson)
  .replace('href="style.css"',    `href="style.css?v=${cacheBust}"`);

writeFileSync(join(DIST, 'index.html'), htmlOutput, 'utf8');
copyFileSync(join(__dirname, 'dashboard.css'), join(DIST, 'style.css'));

// ── Generate per-project detail pages ────────────────────────────────────────

const PROJ_DIST = join(DIST, 'projects');
mkdirSync(PROJ_DIST, { recursive: true });

for (const p of projects) {
  const pagePath = join(PROJ_DIST, encodeURIComponent(p.name) + '.html');
  writeFileSync(pagePath, buildProjectPage(p, cacheBust, historyMap[p.name] ?? []), 'utf8');
}
console.log(`Project pages written to dist/projects/ (${projects.length})`);

// ── Copy public/ assets ───────────────────────────────────────────────────────

if (existsSync(PUBLIC)) {
  cpSync(PUBLIC, DIST, { recursive: true });
  console.log('Public assets copied to dist/');
}

console.log('Dashboard written to dist/');
console.log(`Projects: ${projects.length}  |  Total: ${global.total}  |  Failed: ${global.unexpected}`);
