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

// Copy public/ assets (favicons, etc.) to dist/ if the folder exists
const PUBLIC = join(__dirname, 'public');
if (existsSync(PUBLIC)) {
  cpSync(PUBLIC, DIST, { recursive: true });
  console.log('Public assets copied to dist/');
}

console.log('Dashboard written to dist/');
console.log('Projects: ' + projects.length + '  |  Total: ' + global.total + '  |  Failed: ' + global.unexpected);
