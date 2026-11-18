import { safeJson, escHtml } from './utils.mjs';

const SITE_URL  = 'https://qa.rcastillo.dev/';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';
const TYPE_LABEL = { playwright: 'E2E', jest: 'Unit', newman: 'API' };
const TYPE_TOOL  = { playwright: 'Playwright', jest: 'Jest', newman: 'Newman' };

const ARROW_LEFT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5"/></svg>';

/**
 * Shared document shell. `root` is the relative path to the site root ('' or '../').
 * Page data goes in a non-executable JSON block that hub.js reads.
 */
function shell({ title, description, url, root, cacheBust, data, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(description)}">
<meta name="theme-color" content="#fbfbfb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e0e10" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escHtml(url)}">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_CSS}">
<link rel="stylesheet" href="${root}hub.css?v=${cacheBust}">
<link rel="icon" href="${root}favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="${root}favicon-32x32.png">
<link rel="apple-touch-icon" sizes="180x180" href="${root}apple-touch-icon.png">
<link rel="manifest" href="${root}site.webmanifest">
</head>
<body>
<div class="page">
${body}
</div>
<noscript><p class="page muted">This dashboard needs JavaScript to display results.</p></noscript>
<script id="hub-data" type="application/json">${safeJson(data)}</script>
<script src="${root}hub.js?v=${cacheBust}" defer></script>
</body>
</html>
`;
}

const section = (id, heading, inner, note = '') => `
  <section class="sec" id="${id}">
    <div class="sec-head"><h2>${heading}</h2><span class="sec-note">${note}</span></div>
    <div class="sec-body">${inner}</div>
  </section>`;

// ── Dashboard (index.html) ────────────────────────────────────────────────────

export function buildDashboardPage({ projects, global, history, cacheBust }) {
  const generatedAt = Date.now();
  const body = `
  <header class="top">
    <a class="brand" href="./"><img src="favicon-32x32.png" alt="">QA Hub</a>
    <span>Test results from ${projects.length === 1 ? '1 project' : projects.length + ' projects'}</span>
  </header>

  <section class="hero">
    <h1 id="lead">Loading results</h1>
    <p class="sub" id="lead-sub"></p>
  </section>
${section('projects-sec', 'Projects', '<ul class="projects" id="projects"></ul>', 'Each bar is one CI run, oldest to newest')}
  <div class="grid-2">
${section('attention', 'Needs attention', '')}
${section('slowest-sec', 'Slowest tests', '<div id="slowest"></div>', 'Latest run')}
  </div>
${section('tests-sec', 'All tests', '<div id="tests"></div>', 'Failures first. Press / to search.')}

  <footer class="foot">
    <span>Each project's CI publishes its report here after every run.</span>
    <span>Built ${new Date(generatedAt).toISOString().slice(0, 10)}</span>
  </footer>`;

  return shell({
    title: 'QA Hub',
    description: `Automated test results across ${projects.length} projects: end-to-end, API and unit suites.`,
    url: SITE_URL,
    root: '',
    cacheBust,
    data: { page: 'dashboard', generatedAt, projects, global, history },
    body,
  });
}

// ── Project page (projects/<name>.html) ───────────────────────────────────────

export function buildProjectPage(p, cacheBust, projectHistory) {
  const runners = p.projectNames.length > 1 || p.type === 'playwright' ? ', ' + p.projectNames.join(', ') : '';
  const body = `
  <header class="top">
    <a class="back" href="../">${ARROW_LEFT}All projects</a>
    <a class="brand" href="../"><img src="../favicon-32x32.png" alt="">QA Hub</a>
  </header>

  <section class="hero">
    <p class="kicker"><span class="tag">${TYPE_LABEL[p.type] ?? ''}</span>${TYPE_TOOL[p.type] ?? ''}${escHtml(runners)}</p>
    <h1>${escHtml(p.name)}</h1>
    <p class="sub"><span id="lead"></span> <span id="lead-sub"></span></p>
  </section>
${section('runs-sec', 'Recent runs', '<div class="runs" id="runs"></div>', 'Hover a bar for that run')}
  <div class="grid-2">
${section('rate-sec', 'Pass rate', '<div id="chart-rate"></div>')}
${section('dur-sec', 'Run duration', '<div id="chart-dur"></div>')}
  </div>
  <div class="grid-2">
${section('attention', 'Needs attention', '')}
${section('runners', p.type === 'playwright' ? 'By browser' : 'By runner', '')}
  </div>
${section('slowest-sec', 'Slowest tests', '<div id="slowest"></div>', 'Latest run')}
${section('tests-sec', 'Tests', '<div id="tests"></div>', 'Failures first. Press / to search.')}

  <footer class="foot">
    <a class="back" href="../">${ARROW_LEFT}All projects</a>
    <span>${p.stats.total} tests</span>
  </footer>`;

  return shell({
    title: `${p.name} · QA Hub`,
    description: `${TYPE_TOOL[p.type] ?? ''} test results for ${p.name}.`,
    url: SITE_URL + 'projects/' + encodeURIComponent(p.name) + '.html',
    root: '../',
    cacheBust,
    data: { page: 'project', project: p, history: projectHistory },
    body,
  });
}
