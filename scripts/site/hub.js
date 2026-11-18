// QA Hub client. Renders the dashboard (index.html) and the per-project pages
// from the JSON embedded in <script id="hub-data" type="application/json">.
(function () {
  'use strict';

  // ── Data ────────────────────────────────────────────────────────────────────

  const DATA = JSON.parse(document.getElementById('hub-data').textContent);
  // History arrives packed (see packHistory in scripts/lib/history.mjs).
  const unpack = h => !h || Array.isArray(h) ? h || [] : h.runs.map(r => ({
    ...r,
    tests: r.tests.map(([ti, pi, duration, oi]) => ({ title: h.titles[ti], project: h.projects[pi] ?? undefined, duration, outcome: h.outcomes[oi] })),
  }));
  if (DATA.page === 'project') DATA.history = unpack(DATA.history);
  else for (const k in DATA.history || {}) DATA.history[k] = unpack(DATA.history[k]);

  // ── Formatting ──────────────────────────────────────────────────────────────

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmtDur = ms => {
    if (ms == null || !Number.isFinite(ms)) return '';
    if (ms < 1000) return Math.round(ms) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
    const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    return m + ' min ' + s + ' s';
  };
  const fmtDate = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtDay  = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const daysAgo = ts => Math.floor((Date.now() - ts) / 86400000);
  const fmtAgo  = ts => {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.floor(h / 24);
    return d === 1 ? 'yesterday' : d + ' days ago';
  };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const pct = (a, b) => b ? Math.round((a / b) * 1000) / 10 : 0;

  const STALE_DAYS = 7;
  const TYPE_LABEL = { playwright: 'E2E', jest: 'Unit', newman: 'API' };
  const TYPE_TOOL  = { playwright: 'Playwright', jest: 'Jest', newman: 'Newman' };
  const OUTCOME = {
    unexpected: { label: 'Failed',  cls: 'fail',  rank: 0 },
    flaky:      { label: 'Flaky',   cls: 'flaky', rank: 1 },
    skipped:    { label: 'Skipped', cls: 'skip',  rank: 2 },
    expected:   { label: 'Passed',  cls: 'pass',  rank: 3 },
  };
  const outcomeOf = o => OUTCOME[o] || { label: o, cls: 'skip', rank: 2 };
  const runStatus = r => r.stats.unexpected > 0 ? 'fail' : r.stats.flaky > 0 ? 'flaky' : 'pass';
  const testKey   = (title, runner) => title + '\u0000' + runner;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Tooltip (one shared element; shows on hover/focus of [data-tip]) ────────

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let tipTarget = null;

  function showTip(el) {
    tipTarget = el;
    tip.textContent = el.dataset.tip;
    tip.classList.add('on');
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    const above = r.top - h - 8;
    tip.style.transform = 'translate(' + x + 'px,' + (above > 8 ? above : r.bottom + 8) + 'px)';
  }
  function hideTip() { tipTarget = null; tip.classList.remove('on'); }
  document.addEventListener('pointerover', e => {
    const el = e.target.closest('[data-tip]');
    if (el && el !== tipTarget) showTip(el); else if (!el && tipTarget) hideTip();
  });
  document.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
  document.addEventListener('focusout', hideTip);
  addEventListener('scroll', hideTip, { passive: true });

  // ── Toast ───────────────────────────────────────────────────────────────────

  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  document.body.appendChild(toastEl);
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1800);
  }

  // ── Small visual building blocks ────────────────────────────────────────────

  /** One bar per run, oldest → newest. `cols` pads the left with empty slots. */
  function runStrip(runs, { cols = runs.length, label, tipFor, statusFor = runStatus, size = '' } = {}) {
    const pad = Math.max(0, cols - runs.length);
    let html = '<div class="strip ' + size + '" role="img" aria-label="' + esc(label || '') + '" style="--cols:' + cols + '">';
    for (let i = 0; i < pad; i++) html += '<span class="bar none"></span>';
    runs.forEach((r, i) => {
      html += '<span class="bar ' + statusFor(r) + '" style="--i:' + (pad + i) + '" data-tip="' + esc(tipFor ? tipFor(r) : '') + '"></span>';
    });
    return html + '</div>';
  }

  function sparkline(values, { w = 120, h = 28 } = {}) {
    const v = values.filter(Number.isFinite);
    if (v.length < 2) return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"></svg>';
    const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
    const pts = v.map((y, i) => [(i / (v.length - 1)) * (w - 4) + 2, h - 3 - ((y - min) / span) * (h - 6)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const last = pts[pts.length - 1];
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + d + '"/>'
      + '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.25"/></svg>';
  }

  /**
   * Line chart in SVG. points: [{ y, status, tip }] in run order.
   * Status colors each point; the line shows the trend.
   */
  function lineChart(points, { yFmt = v => v, yMin, yMax, h = 180, w = 600 } = {}) {
    if (points.length === 0) return '<div class="empty">No runs recorded yet.</div>';
    const W = Math.max(280, Math.round(w)), H = h, L = 52, R = 10, T = 12, B = 26;
    const ys = points.map(p => p.y);
    let lo = yMin ?? Math.min(...ys), hi = yMax ?? Math.max(...ys);
    if (hi === lo) {
      const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
      if (yMax != null) lo = hi - pad; else if (yMin != null) hi = lo + pad; else { lo -= pad; hi += pad; }
    }
    const x = i => L + (points.length === 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R));
    const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ticks = [lo, (lo + hi) / 2, hi];
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    ticks.forEach(t => {
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>'
        + '<text class="axis" x="' + (L - 8) + '" y="' + (y(t) + 3.5) + '" text-anchor="end">' + esc(yFmt(t)) + '</text>';
    });
    const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.y).toFixed(1)).join('');
    svg += '<path class="area" d="' + d + 'L' + x(points.length - 1).toFixed(1) + ' ' + (H - B) + 'L' + x(0).toFixed(1) + ' ' + (H - B) + 'Z"/>';
    svg += '<path class="line" d="' + d + '"/>';
    points.forEach((p, i) => {
      svg += '<circle class="pt ' + (p.status || '') + '" cx="' + x(i).toFixed(1) + '" cy="' + y(p.y).toFixed(1) + '" r="3.5" tabindex="0" data-tip="' + esc(p.tip || '') + '"/>';
    });
    if (points.length > 1) {
      svg += '<text class="axis" x="' + L + '" y="' + (H - 6) + '">' + esc(points[0].xLabel || '') + '</text>'
        + '<text class="axis" x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(points[points.length - 1].xLabel || '') + '</text>';
    }
    return svg + '</svg>';
  }

  function statusChip(outcome) {
    const o = outcomeOf(outcome);
    return '<span class="chip ' + o.cls + '"><span class="dot"></span>' + o.label + '</span>';
  }

  // ── History helpers ─────────────────────────────────────────────────────────

  /** Per test: its outcome in each recorded run of the project. */
  function testRuns(history, title, runner) {
    const out = [];
    for (const r of history || []) {
      const m = (r.tests || []).find(t => t.title === title && t.project === runner);
      if (m) out.push({ date: r.date, outcome: m.outcome, duration: m.duration });
    }
    return out;
  }

  /** Tests that failed or were flaky in any recorded run, worst first. */
  function unreliableTests(project, history) {
    const stats = new Map();
    for (const r of history || []) {
      for (const t of r.tests || []) {
        const k = testKey(t.title, t.project);
        let s = stats.get(k);
        if (!s) stats.set(k, s = { title: t.title, runner: t.project, runs: 0, bad: 0, fails: 0 });
        s.runs++;
        if (t.outcome === 'unexpected' || t.outcome === 'flaky') s.bad++;
        if (t.outcome === 'unexpected') s.fails++;
      }
    }
    const current = new Map(project.tests.map(t => [testKey(t.title, t.project), t]));
    return [...stats.values()]
      .filter(s => s.bad > 0 && current.has(testKey(s.title, s.runner)))
      .map(s => ({ ...s, project, test: current.get(testKey(s.title, s.runner)) }))
      .sort((a, b) => outcomeOf(a.test.outcome).rank - outcomeOf(b.test.outcome).rank || b.bad / b.runs - a.bad / a.runs);
  }

  // ── Detail drawer ───────────────────────────────────────────────────────────

  const drawer = (function () {
    const root = document.createElement('div');
    root.className = 'drawer-root';
    root.innerHTML =
        '<div class="scrim" data-close></div>'
      + '<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title" tabindex="-1">'
      +   '<div class="grabber" aria-hidden="true"></div>'
      +   '<header class="dr-head">'
      +     '<div class="dr-meta" id="dr-meta"></div>'
      +     '<h2 class="dr-title" id="dr-title"></h2>'
      +     '<div class="dr-file" id="dr-file"></div>'
      +     '<button class="icon-btn dr-close" data-close aria-label="Close">'
      +       '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>'
      +   '</header>'
      +   '<div class="seg dr-tabs" role="tablist" id="dr-tabs">'
      +     '<span class="seg-ind" aria-hidden="true"></span>'
      +     '<button role="tab" data-tab="details" aria-selected="true">Details</button>'
      +     '<button role="tab" data-tab="history" aria-selected="false">History</button>'
      +   '</div>'
      +   '<div class="dr-body" id="dr-body"></div>'
      + '</aside>';
    document.body.appendChild(root);

    const panel = root.querySelector('.drawer');
    const body  = root.querySelector('#dr-body');
    const tabs  = root.querySelector('#dr-tabs');
    let current = null, returnFocus = null;

    function details(t) {
      let html = '';
      if (t.error) {
        html += '<section class="dr-sec"><h3>Error</h3><pre class="err">' + esc(t.error) + '</pre>'
          + (t.errorStack ? '<details class="stack"><summary>Stack trace</summary><pre>' + esc(t.errorStack) + '</pre></details>' : '')
          + '</section>';
      }
      if (t.steps && t.steps.length) {
        html += '<section class="dr-sec"><h3>Steps</h3><ol class="steps">';
        t.steps.forEach(s => {
          const st = s.error ? 'fail' : s.skipped ? 'skip' : 'pass';
          html += '<li class="step ' + st + '"><span class="step-dot"></span><span class="step-title">' + esc(s.title) + '</span>'
            + '<span class="step-dur">' + fmtDur(s.duration) + '</span>'
            + (s.error ? '<pre class="err step-err">' + esc(s.error) + '</pre>' : '') + '</li>';
        });
        html += '</ol></section>';
      } else {
        const hint = t.outcome === 'skipped'
          ? 'This test was skipped, so it did not run any steps.'
          : current.type === 'playwright'
          ? 'Playwright records steps for each <code>test.step()</code> block; this test has none.'
          : current.type === 'jest' ? 'Jest reports a single result per test, without steps.'
          : 'No assertions were recorded for this request.';
        html += '<section class="dr-sec"><h3>Steps</h3><p class="muted">' + hint + '</p></section>';
      }
      if (t.retries > 0) html += '<p class="muted dr-pad">' + (t.outcome === 'unexpected' ? 'Still failing after ' : 'Passed after ') + plural(t.retries, 'retry', 'retries') + '.</p>';
      return html;
    }

    function historyView(t) {
      const runs = testRuns(current.history, t.title, t.project);
      if (runs.length < 2) {
        return '<p class="muted dr-pad">This test has run ' + plural(runs.length, 'time') + ' since history began. A trend appears after the next run.</p>';
      }
      const passed = runs.filter(r => r.outcome === 'expected').length;
      const avg = runs.reduce((s, r) => s + r.duration, 0) / runs.length;
      const status = r => outcomeOf(r.outcome).cls;
      return '<div class="dr-stats">'
        + '<div><span class="num">' + runs.length + '</span><span class="lbl">Runs</span></div>'
        + '<div><span class="num">' + pct(passed, runs.length) + '%</span><span class="lbl">Passed</span></div>'
        + '<div><span class="num">' + fmtDur(avg) + '</span><span class="lbl">Average</span></div>'
        + '</div>'
        + runStrip(runs, { label: 'Result of each run', statusFor: status,
            tipFor: r => fmtDate(r.date) + ': ' + outcomeOf(r.outcome).label + ', ' + fmtDur(r.duration) })
        + '<section class="dr-sec"><h3>Duration</h3>'
        + lineChart(runs.map(r => ({ y: r.duration, status: status(r), xLabel: fmtDay(r.date),
            tip: fmtDate(r.date) + ': ' + fmtDur(r.duration) })), { yFmt: fmtDur, yMin: 0, h: 160, w: body.clientWidth - 48 })
        + '</section>';
    }

    function setTab(name) {
      tabs.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
      moveIndicator(tabs);
      body.innerHTML = name === 'history' ? historyView(current.test) : details(current.test);
      body.scrollTop = 0;
    }

    function open(test, project, history) {
      current = { test, type: project.type, history };
      returnFocus = document.activeElement;
      const o = outcomeOf(test.outcome);
      root.querySelector('#dr-meta').innerHTML = statusChip(test.outcome)
        + '<span>' + esc(project.name) + '</span>'
        + '<span>' + esc(test.project) + '</span>'
        + (test.duration ? '<span class="mono">' + fmtDur(test.duration) + '</span>' : '');
      root.querySelector('#dr-title').textContent = test.title;
      const loc = test.file ? test.file + (test.line ? ':' + test.line : '') : '';
      root.querySelector('#dr-file').innerHTML = loc
        ? '<code>' + esc(loc) + '</code><button class="icon-btn" id="dr-copy" aria-label="Copy file path" data-tip="Copy path">'
          + '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 10.5V4a1 1 0 0 1 1-1h6.5"/></svg></button>'
        : '';
      const copy = root.querySelector('#dr-copy');
      if (copy) copy.onclick = () => navigator.clipboard.writeText(loc).then(() => toast('Copied file path'), () => toast('Could not copy'));
      panel.dataset.status = o.cls;
      root.classList.add('open');
      document.documentElement.classList.add('locked');
      setTab('details');
      panel.focus({ preventScroll: true });
    }

    function close() {
      if (!root.classList.contains('open')) return;
      root.classList.remove('open');
      panel.style.transform = '';
      document.documentElement.classList.remove('locked');
      if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    }

    root.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
    tabs.addEventListener('click', e => { const b = e.target.closest('[role=tab]'); if (b) setTab(b.dataset.tab); });
    document.addEventListener('keydown', e => {
      if (!root.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') { // keep focus inside the dialog
        const f = [...panel.querySelectorAll('button, [href], summary, [tabindex="0"]')].filter(el => el.offsetParent);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });

    // Bottom sheet on small screens: drag the header down to dismiss.
    let drag = null;
    panel.addEventListener('pointerdown', e => {
      if (!matchMedia('(max-width: 720px)').matches || !e.target.closest('.grabber, .dr-head')) return;
      if (e.target.closest('button')) return;
      drag = { y: e.clientY, t: performance.now(), dy: 0 };
      panel.setPointerCapture(e.pointerId);
      panel.classList.add('dragging');
    });
    panel.addEventListener('pointermove', e => {
      if (!drag) return;
      drag.dy = Math.max(0, e.clientY - drag.y);
      panel.style.transform = 'translateY(' + drag.dy + 'px)';
    });
    const endDrag = () => {
      if (!drag) return;
      const v = drag.dy / Math.max(1, performance.now() - drag.t);
      panel.classList.remove('dragging');
      if (drag.dy > panel.offsetHeight * 0.3 || v > 0.6) close(); else panel.style.transform = '';
      drag = null;
    };
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);

    return { open };
  })();

  // ── Segmented control indicator ─────────────────────────────────────────────

  function moveIndicator(seg) {
    const ind = seg.querySelector('.seg-ind');
    const on  = seg.querySelector('[aria-selected="true"], [aria-pressed="true"]');
    if (!ind || !on) return;
    ind.style.width = on.offsetWidth + 'px';
    ind.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  }
  addEventListener('resize', () => document.querySelectorAll('.seg').forEach(moveIndicator));

  // ── Tests table ─────────────────────────────────────────────────────────────

  /**
   * rows: [{ test, project, history }]. Renders search, filters, sorting and
   * pagination into `mount`. Failures sort first by default.
   */
  function testsTable(mount, rows, { showProject }) {
    const counts = { all: rows.length };
    rows.forEach(r => { counts[r.test.outcome] = (counts[r.test.outcome] || 0) + 1; });
    const filters = [['all', 'All'], ['unexpected', 'Failed'], ['flaky', 'Flaky'], ['skipped', 'Skipped'], ['expected', 'Passed']]
      .filter(([k]) => k === 'all' || counts[k]);
    const projectNames = [...new Set(rows.map(r => r.project.name))];
    const showRunner = new Set(rows.map(r => r.test.project)).size > 1;

    const DEFAULTS = { q: '', outcome: 'all', project: 'all', sort: 'status', dir: 1, page: 1 };
    const state = { ...DEFAULTS, size: 25 };

    // Table state lives in the URL, so Back restores it and filtered views can be shared.
    const params = new URLSearchParams(location.search);
    state.q = params.get('q') || '';
    if (filters.some(([k]) => k === params.get('result'))) state.outcome = params.get('result');
    if (projectNames.includes(params.get('project'))) state.project = params.get('project');
    if (['title', 'project', 'runner', 'status', 'duration'].includes(params.get('sort'))) state.sort = params.get('sort');
    if (params.get('dir') === 'desc') state.dir = -1;
    state.page = Math.max(1, parseInt(params.get('page'), 10) || 1);

    function syncUrl() {
      const u = new URL(location.href);
      const set = (k, v, d) => (v === d ? u.searchParams.delete(k) : u.searchParams.set(k, v));
      set('q', state.q.trim(), '');
      set('result', state.outcome, 'all');
      set('project', state.project, 'all');
      set('sort', state.sort, 'status');
      set('dir', state.dir === -1 ? 'desc' : 'asc', 'asc');
      set('page', String(state.page), '1');
      if (u.href !== location.href) history.replaceState(history.state, '', u);
    }

    mount.innerHTML =
        '<div class="tt-bar">'
      +   '<label class="search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>'
      +     '<input type="search" placeholder="Search tests" aria-label="Search tests" autocomplete="off" spellcheck="false">'
      +     '<kbd>/</kbd></label>'
      +   '<div class="seg" role="group" aria-label="Filter by result"><span class="seg-ind" aria-hidden="true"></span>'
      +     filters.map(([k, l]) => '<button data-outcome="' + k + '" aria-pressed="' + (k === state.outcome) + '">' + l + ' <span class="count">' + counts[k] + '</span></button>').join('')
      +   '</div>'
      +   (showProject && projectNames.length > 1
          ? '<select class="select" aria-label="Filter by project"><option value="all">All projects</option>'
            + projectNames.map(n => '<option value="' + esc(n) + '"' + (n === state.project ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>'
          : '')
      + '</div>'
      + '<div class="tt-wrap"><table class="tt">'
      +   '<thead><tr>'
      +     '<th><button data-sort="title">Test</button></th>'
      +     (showProject ? '<th class="c-proj"><button data-sort="project">Project</button></th>' : '')
      +     (showRunner ? '<th class="c-run"><button data-sort="runner">Runner</button></th>' : '')
      +     '<th class="c-status"><button data-sort="status">Result</button></th>'
      +     '<th class="c-dur"><button data-sort="duration">Duration</button></th>'
      +   '</tr></thead><tbody></tbody></table></div>'
      + '<div class="tt-foot"><span class="tt-count" aria-live="polite"></span><nav class="pager" aria-label="Pages"></nav></div>';

    const $ = s => mount.querySelector(s);
    const input = $('input'), tbody = $('tbody'), seg = $('.seg');
    input.value = state.q;
    $('[data-sort="' + state.sort + '"]').setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
    requestAnimationFrame(() => moveIndicator(seg));

    const sorters = {
      title:    (a, b) => a.test.title.localeCompare(b.test.title),
      project:  (a, b) => a.project.name.localeCompare(b.project.name),
      runner:   (a, b) => a.test.project.localeCompare(b.test.project),
      status:   (a, b) => outcomeOf(a.test.outcome).rank - outcomeOf(b.test.outcome).rank,
      duration: (a, b) => a.test.duration - b.test.duration,
    };

    function visible() {
      const q = state.q.trim().toLowerCase();
      const list = rows.filter(r =>
        (state.outcome === 'all' || r.test.outcome === state.outcome)
        && (state.project === 'all' || r.project.name === state.project)
        && (!q || (r.test.title + ' ' + r.test.file + ' ' + r.project.name + ' ' + r.test.project).toLowerCase().includes(q)));
      const cmp = sorters[state.sort];
      return list.sort((a, b) => cmp(a, b) * state.dir || sorters.status(a, b) || sorters.project(a, b) || sorters.title(a, b));
    }

    function render() {
      const list  = visible();
      const pages = Math.max(1, Math.ceil(list.length / state.size));
      state.page  = Math.min(state.page, pages);
      const start = (state.page - 1) * state.size;
      const slice = list.slice(start, start + state.size);
      syncUrl();

      tbody.innerHTML = slice.length ? slice.map(r => {
        const t = r.test, o = outcomeOf(t.outcome);
        return '<tr data-i="' + rows.indexOf(r) + '" class="' + o.cls + '">'
          + '<td class="c-test"><button class="t-open">' + esc(t.title) + '</button>'
          +   (t.file ? '<span class="t-file">' + esc(t.file) + (t.line ? ':' + t.line : '') + '</span>' : '') + '</td>'
          + (showProject ? '<td class="c-proj">' + esc(r.project.name) + '</td>' : '')
          + (showRunner ? '<td class="c-run">' + esc(t.project) + '</td>' : '')
          + '<td class="c-status">' + statusChip(t.outcome) + '</td>'
          + '<td class="c-dur mono">' + fmtDur(t.duration) + '</td></tr>';
      }).join('') : '<tr class="none"><td colspan="5"><div class="empty">No tests match '
        + (state.q ? '“' + esc(state.q) + '”' : 'this filter') + '. <button class="link" data-reset>Clear filters</button></div></td></tr>';

      $('.tt-count').textContent = list.length
        ? (start + 1) + '–' + (start + slice.length) + ' of ' + plural(list.length, 'test')
        : '0 tests';

      const pager = $('.pager');
      if (pages <= 1) { pager.innerHTML = ''; return; }
      const nums = [];
      for (let p = 1; p <= pages; p++) {
        if (p === 1 || p === pages || Math.abs(p - state.page) <= 1) nums.push(p);
        else if (nums[nums.length - 1] !== '…') nums.push('…');
      }
      pager.innerHTML = '<button data-page="' + (state.page - 1) + '" aria-label="Previous page"' + (state.page === 1 ? ' disabled' : '') + '>‹</button>'
        + nums.map(p => p === '…' ? '<span>…</span>' : '<button data-page="' + p + '"' + (p === state.page ? ' aria-current="page"' : '') + '>' + p + '</button>').join('')
        + '<button data-page="' + (state.page + 1) + '" aria-label="Next page"' + (state.page === pages ? ' disabled' : '') + '>›</button>';
    }

    /**
     * Re-render after a filter change. The control under the cursor stays put,
     * and when the table gets shorter it collapses with a short transition
     * instead of the page snapping up.
     */
    let collapse = null;
    function refilter(anchor) {
      if (collapse) collapse();
      const before = anchor.getBoundingClientRect().top;
      const from = mount.offsetHeight;
      mount.style.minHeight = from + 'px';          // hold the height while re-rendering
      render();
      window.scrollBy(0, anchor.getBoundingClientRect().top - before);
      // Measure the new natural height, then restore the held height and the
      // scroll position in the same frame, so nothing is painted in between.
      const y = window.scrollY;
      mount.style.minHeight = '';
      const to = mount.offsetHeight;
      if (reduceMotion || to >= from) return;
      mount.style.minHeight = from + 'px';
      window.scrollTo(0, y);
      mount.offsetHeight; // commit the start height before transitioning
      mount.style.transition = 'min-height .28s cubic-bezier(.23, 1, .32, 1)';
      mount.style.minHeight = to + 'px';
      const done = () => { mount.style.transition = ''; mount.style.minHeight = ''; mount.removeEventListener('transitionend', onEnd); clearTimeout(timer); collapse = null; };
      const timer = setTimeout(done, 400);
      // Children (the segmented control's indicator) bubble their own transitionend events.
      const onEnd = e => { if (e.target === mount && e.propertyName === 'min-height') done(); };
      mount.addEventListener('transitionend', onEnd);
      collapse = done;
    }

    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { state.q = input.value; state.page = 1; refilter(input); }, 80);
    });
    seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      moveIndicator(seg);
      state.outcome = b.dataset.outcome; state.page = 1; refilter(seg);
    });
    const sel = $('.select');
    if (sel) sel.addEventListener('change', () => { state.project = sel.value; state.page = 1; refilter(sel); });
    mount.querySelector('thead').addEventListener('click', e => {
      const b = e.target.closest('[data-sort]'); if (!b) return;
      if (state.sort === b.dataset.sort) state.dir *= -1; else { state.sort = b.dataset.sort; state.dir = 1; }
      mount.querySelectorAll('[data-sort]').forEach(x => x.removeAttribute('aria-sort'));
      b.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
      render();
    });
    $('.pager').addEventListener('click', e => {
      const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
      // Keep the pager where it is on screen: no jump to the top of the table,
      // even when the new page is shorter (e.g. the last page).
      const pager = $('.pager');
      const before = pager.getBoundingClientRect().top;
      const label = b.getAttribute('aria-label');
      state.page = Number(b.dataset.page); render();
      window.scrollBy(0, pager.getBoundingClientRect().top - before);
      // The buttons were re-rendered; keep keyboard focus on the equivalent one.
      const again = label ? pager.querySelector('[aria-label="' + label + '"]:not(:disabled)') : pager.querySelector('[aria-current]');
      (again || pager.querySelector('[aria-current]'))?.focus({ preventScroll: true });
    });
    tbody.addEventListener('click', e => {
      if (e.target.closest('[data-reset]')) {
        input.value = ''; state.q = ''; state.outcome = 'all'; state.project = 'all';
        if (sel) sel.value = 'all';
        seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.outcome === 'all')));
        moveIndicator(seg); refilter(seg); return;
      }
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      const r = rows[Number(tr.dataset.i)];
      drawer.open(r.test, r.project, r.history);
    });

    // "/" or Cmd/Ctrl+K focuses search
    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault(); input.focus(); input.select();
      }
    });

    render();
  }

  // ── Shared sections ─────────────────────────────────────────────────────────

  function attentionList(items, { showProject, limit = 8 }) {
    if (!items.length) return '';
    return '<ul class="attn">' + items.slice(0, limit).map((it, i) => {
      const runs = testRuns(it.project.history, it.title, it.runner);
      const why = it.test.outcome === 'unexpected'
        ? 'Failing now' + (it.fails > 1 ? ', failed ' + it.fails + ' of ' + it.runs + ' runs' : '')
        : 'Failed or flaky in ' + it.bad + ' of ' + it.runs + ' runs';
      return '<li><button class="attn-row" data-u="' + i + '">'
        + '<span class="attn-main"><span class="attn-title">' + esc(it.title) + '</span>'
        + '<span class="attn-sub">' + (showProject ? esc(it.project.name) + ', ' : '') + esc(it.runner) + '. ' + why + '.</span></span>'
        + runStrip(runs.slice(-20), { cols: 20, size: 'sm', label: 'Last runs of this test', statusFor: r => outcomeOf(r.outcome).cls,
            tipFor: r => fmtDate(r.date) + ': ' + outcomeOf(r.outcome).label })
        + '</button></li>';
    }).join('') + '</ul>';
  }

  function slowestList(rows, { showProject, limit = 5 }) {
    const top = rows.filter(r => r.test.duration > 0).sort((a, b) => b.test.duration - a.test.duration).slice(0, limit);
    if (!top.length) return '<p class="muted">No durations recorded.</p>';
    const max = top[0].test.duration;
    return '<ol class="slow">' + top.map(r =>
      '<li><button class="slow-row" data-i="' + r.i + '">'
      + '<span class="slow-title">' + esc(r.test.title) + '</span>'
      + '<span class="slow-sub">' + (showProject ? esc(r.project.name) + ', ' : '') + esc(r.test.project) + '</span>'
      + '<span class="slow-bar"><span style="--w:' + (r.test.duration / max * 100).toFixed(1) + '%"></span></span>'
      + '<span class="slow-dur mono">' + fmtDur(r.test.duration) + '</span>'
      + '</button></li>').join('') + '</ol>';
  }

  function wireOpeners(scope, rows, unreliable) {
    scope.addEventListener('click', e => {
      const s = e.target.closest('.slow-row');
      if (s) { const r = rows[Number(s.dataset.i)]; drawer.open(r.test, r.project, r.history); return; }
      const a = e.target.closest('.attn-row');
      if (a) {
        const it = unreliable[Number(a.dataset.u)];
        if (it) drawer.open(it.test, it.project, it.project.history);
      }
    });
  }

  function staleNote(p) {
    const d = daysAgo(p.startTime);
    return d >= STALE_DAYS ? '<span class="stale" data-tip="Last run ' + esc(fmtDate(p.startTime)) + '">No runs in ' + d + ' days</span>' : '';
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────

  function dashboard() {
    const { projects, global } = DATA;
    const history = DATA.history || {};
    projects.forEach(p => { p.history = history[p.name] || []; });
    const rows = projects.flatMap(p => p.tests.map(t => ({ test: t, project: p, history: p.history })));
    rows.forEach((r, i) => { r.i = i; });

    // Summary sentence
    const failing = projects.filter(p => p.stats.unexpected > 0);
    const lead = document.getElementById('lead');
    lead.innerHTML = global.total === 0
      ? 'No reports yet.'
      : global.unexpected === 0
        ? 'All <span class="num">' + global.total.toLocaleString('en-US') + '</span> tests passed in the latest runs.'
        : '<span class="num">' + global.expected.toLocaleString('en-US') + '</span> of <span class="num">' + global.total.toLocaleString('en-US') + '</span> tests passed.';
    document.getElementById('lead-sub').classList.toggle('alert', global.unexpected > 0);
    document.getElementById('lead-sub').textContent = global.unexpected === 0
      ? 'Across ' + plural(projects.length, 'project') + (global.flaky ? ', with ' + plural(global.flaky, 'flaky test') : '') + '.'
      : plural(global.unexpected, 'test') + ' failing in ' + failing.map(p => p.name).join(' and ') + '.';
    document.documentElement.dataset.health = global.unexpected ? 'fail' : 'pass';

    // Projects
    const cols = Math.max(1, ...projects.map(p => p.history.length));
    document.getElementById('projects').innerHTML = projects.map(p => {
      const rate = pct(p.stats.expected, p.stats.total);
      return '<li><a class="proj" href="projects/' + encodeURIComponent(p.name) + '.html">'
        + '<span class="proj-id"><span class="proj-name">' + esc(p.name) + '</span>'
        +   '<span class="proj-sub"><span class="tag">' + TYPE_LABEL[p.type] + '</span>' + TYPE_TOOL[p.type]
        +   ', <span data-tip="' + esc(fmtDate(p.startTime)) + '">' + fmtAgo(p.startTime) + '</span>' + staleNote(p) + '</span></span>'
        + '<span class="proj-runs">' + runStrip(p.history, { cols, label: 'Last ' + p.history.length + ' runs',
            tipFor: r => fmtDate(r.date) + ': ' + r.stats.expected + '/' + r.stats.total + ' passed' + (r.stats.flaky ? ', ' + r.stats.flaky + ' flaky' : '') + ', ' + fmtDur(r.duration) }) + '</span>'
        + '<span class="proj-rate ' + (p.stats.unexpected ? 'fail' : 'pass') + '"><span class="num">' + p.stats.expected + '/' + p.stats.total + '</span>'
        +   '<span class="lbl">' + (p.stats.unexpected ? plural(p.stats.unexpected, 'failure') : rate + '% passed') + '</span></span>'
        + '<span class="proj-dur" data-tip="Run duration, last ' + p.history.length + ' runs">'
        +   sparkline(p.history.map(r => r.duration)) + '<span class="mono">' + fmtDur(p.duration) + '</span></span>'
        + '</a></li>';
    }).join('');

    // Needs attention
    const unreliable = projects.flatMap(p => unreliableTests(p, p.history))
      .sort((a, b) => outcomeOf(a.test.outcome).rank - outcomeOf(b.test.outcome).rank || b.bad / b.runs - a.bad / a.runs);
    const attn = document.getElementById('attention');
    if (unreliable.length) {
      attn.querySelector('.sec-note').textContent = plural(unreliable.length, 'test') + (unreliable.length === 1 ? ' failed or was' : ' failed or were') + ' flaky in recent runs.';
      attn.querySelector('.sec-body').innerHTML = attentionList(unreliable, { showProject: true });
    } else {
      attn.hidden = true;
    }

    document.getElementById('slowest').innerHTML = slowestList(rows, { showProject: true });
    wireOpeners(document.querySelector('.page'), rows, unreliable);
    testsTable(document.getElementById('tests'), rows, { showProject: true });
  }

  // ── Project page ────────────────────────────────────────────────────────────

  function projectPage() {
    const p = DATA.project;
    p.history = DATA.history || [];
    const rows = p.tests.map((t, i) => ({ test: t, project: p, history: p.history, i }));

    const lead = document.getElementById('lead');
    lead.innerHTML = p.stats.unexpected === 0
      ? 'All <span class="num">' + p.stats.total + '</span> tests passed.'
      : '<span class="num">' + p.stats.expected + '</span> of <span class="num">' + p.stats.total + '</span> tests passed.';
    document.getElementById('lead-sub').innerHTML =
        'Last run <span data-tip="' + esc(fmtDate(p.startTime)) + '">' + fmtAgo(p.startTime) + '</span>, took ' + fmtDur(p.duration)
      + (p.stats.flaky ? '. ' + plural(p.stats.flaky, 'flaky test') : '')
      + '.' + staleNote(p);
    document.documentElement.dataset.health = p.stats.unexpected ? 'fail' : 'pass';

    const h = p.history;
    document.getElementById('runs').innerHTML = h.length
      ? runStrip(h, { size: 'lg', label: 'Last ' + h.length + ' runs',
          tipFor: r => fmtDate(r.date) + ': ' + r.stats.expected + '/' + r.stats.total + ' passed' + (r.stats.flaky ? ', ' + r.stats.flaky + ' flaky' : '') + ', ' + fmtDur(r.duration) })
        + '<div class="runs-axis"><span>' + fmtDay(h[0].date) + '</span><span>' + plural(h.length, 'run') + '</span><span>' + fmtDay(h[h.length - 1].date) + '</span></div>'
      : '<p class="muted">No runs recorded yet.</p>';

    const pts = f => h.map(r => ({ ...f(r), status: runStatus(r), xLabel: fmtDay(r.date) }));
    const rateEl = document.getElementById('chart-rate'), durEl = document.getElementById('chart-dur');
    const drawCharts = () => {
      const minRate = Math.min(100, ...h.map(r => pct(r.stats.expected, r.stats.total)));
      rateEl.innerHTML = lineChart(pts(r => ({
        y: pct(r.stats.expected, r.stats.total),
        tip: fmtDate(r.date) + ': ' + pct(r.stats.expected, r.stats.total) + '% (' + r.stats.expected + '/' + r.stats.total + ')',
      })), { yFmt: v => Math.round(v) + '%', yMax: 100, yMin: minRate === 100 ? undefined : Math.max(0, Math.floor(minRate / 5) * 5 - 5), w: rateEl.clientWidth });
      durEl.innerHTML = lineChart(pts(r => ({
        y: r.duration, tip: fmtDate(r.date) + ': ' + fmtDur(r.duration),
      })), { yFmt: fmtDur, yMin: 0, w: durEl.clientWidth });
    };
    drawCharts();
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawCharts, 120); });

    // Results per runner (browser, or unit/api)
    const byRunner = {};
    p.tests.forEach(t => {
      const b = byRunner[t.project] || (byRunner[t.project] = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, total: 0 });
      b[t.outcome] = (b[t.outcome] || 0) + 1; b.total++;
    });
    const runnersEl = document.getElementById('runners');
    if (Object.keys(byRunner).length > 1) {
      runnersEl.querySelector('.sec-body').innerHTML = '<ul class="runners">' + Object.entries(byRunner).map(([name, b]) =>
        '<li><span class="r-name">' + esc(name) + '</span>'
        + '<span class="r-bar">' + ['expected', 'flaky', 'unexpected', 'skipped'].map(k => b[k]
            ? '<span class="' + outcomeOf(k).cls + '" style="flex:' + b[k] + '" data-tip="' + esc(name + ': ' + b[k] + ' ' + outcomeOf(k).label.toLowerCase()) + '"></span>' : '').join('') + '</span>'
        + '<span class="r-num mono">' + b.expected + '/' + b.total + '</span></li>').join('') + '</ul>';
    } else {
      runnersEl.hidden = true;
    }

    const unreliable = unreliableTests(p, h);
    const attn = document.getElementById('attention');
    if (unreliable.length) {
      attn.querySelector('.sec-note').textContent = plural(unreliable.length, 'test') + (unreliable.length === 1 ? ' failed or was' : ' failed or were') + ' flaky in the last ' + plural(h.length, 'run') + '.';
      attn.querySelector('.sec-body').innerHTML = attentionList(unreliable, { showProject: false, limit: 12 });
    } else {
      attn.hidden = true;
    }

    document.getElementById('slowest').innerHTML = slowestList(rows, { showProject: false });
    wireOpeners(document.querySelector('.page'), rows, unreliable);
    testsTable(document.getElementById('tests'), rows, { showProject: false });
  }

  // ── Theme toggle (light ↔ dark; the default follows the system) ─────────────

  (function () {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const sys = matchMedia('(prefers-color-scheme: dark)');
    const current = () => document.documentElement.dataset.theme || (sys.matches ? 'dark' : 'light');
    const label = () => btn.setAttribute('aria-label', current() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    label();
    sys.addEventListener('change', label);
    btn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      if (window.qaHubSetTheme) window.qaHubSetTheme(next); else document.documentElement.dataset.theme = next;
      try { localStorage.setItem('qa-hub-theme', next); } catch (e) { /* not persisted */ }
      label();
    });
  })();

  // ── Boot ────────────────────────────────────────────────────────────────────

  if (DATA.page === 'project') projectPage(); else dashboard();

  // One orchestrated entrance: run strips draw in, oldest to newest.
  if (!reduceMotion) requestAnimationFrame(() => document.documentElement.classList.add('ready'));
  else document.documentElement.classList.add('ready', 'still');
})();
