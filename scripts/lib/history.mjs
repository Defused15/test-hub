import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export const HISTORY_MAX = 30;

/** Build the history snapshot stored for one run of a normalized project. */
export function toHistoryEntry(p) {
  return {
    id:           p.runId,
    date:         p.startTime,
    stats: {
      total:      p.stats.total,
      expected:   p.stats.expected,
      unexpected: p.stats.unexpected,
      flaky:      p.stats.flaky,
      skipped:    p.stats.skipped,
    },
    duration:     p.duration,
    projectNames: p.projectNames,
    // Per-test snapshots used by the panel History tab
    tests: p.tests.map(t => ({
      title:    t.title,
      project:  t.project,
      duration: t.duration,
      outcome:  t.outcome,
    })),
  };
}

/**
 * Merge entries into an existing list: one entry per run (same `id`, or same
 * `date` for legacy entries without an id), sorted oldest → newest, capped at
 * HISTORY_MAX. The first entry seen for a run wins.
 */
export function mergeHistory(existing, incoming) {
  const byKey = new Map();
  for (const e of [...existing, ...incoming]) {
    const key = e.id ?? 'date:' + e.date;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  // Legacy entries (no id) that share a date with an id'd entry are the same run.
  const idDates = new Set([...byKey.values()].filter(e => e.id).map(e => e.date));
  const merged = [...byKey.values()].filter(e => e.id || !idDates.has(e.date));
  merged.sort((a, b) => a.date - b.date);
  return merged.slice(-HISTORY_MAX);
}

function readHistory(histPath) {
  if (!existsSync(histPath)) return [];
  try {
    const entries = JSON.parse(readFileSync(histPath, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/**
 * Record the current run in history/<project>.json, skipping it if that run is
 * already stored (the build runs for every project whenever any one publishes).
 * Returns the full updated entries array.
 *
 * @param {object} p       - Normalized project object from parsers.mjs
 * @param {string} histDir - Absolute path to the history/ directory
 * @returns {Array}        - Updated history entries
 */
export function updateHistory(p, histDir) {
  mkdirSync(histDir, { recursive: true });
  const histPath = join(histDir, p.name + '.json');
  const entries  = mergeHistory(readHistory(histPath), [toHistoryEntry(p)]);
  writeFileSync(histPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  return entries;
}

/** Overwrite history/<name>.json with exactly these entries (deduped, capped). */
export function writeHistory(name, entries, histDir) {
  mkdirSync(histDir, { recursive: true });
  const merged = mergeHistory([], entries);
  writeFileSync(join(histDir, name + '.json'), JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

/**
 * Compact form embedded in the pages: test titles, runner names and outcomes are
 * stored once in lookup tables and each run lists its tests as index tuples
 * [title, project, duration, outcome]. hub.js expands it back with the same shape.
 */
export function packHistory(entries = []) {
  const tables = { titles: [], projects: [], outcomes: [] };
  const index = { titles: new Map(), projects: new Map(), outcomes: new Map() };
  const ref = (kind, v) => {
    if (!index[kind].has(v)) { index[kind].set(v, tables[kind].length); tables[kind].push(v); }
    return index[kind].get(v);
  };
  const runs = entries.map(({ tests = [], ...run }) => ({
    ...run,
    tests: tests.map(t => [ref('titles', t.title), ref('projects', t.project ?? null), t.duration ?? null, ref('outcomes', t.outcome)]),
  }));
  return { packed: 1, ...tables, runs };
}

/** Inverse of packHistory (used by the tests; hub.js has its own copy). */
export function unpackHistory(h) {
  if (!h || Array.isArray(h)) return h ?? [];
  return h.runs.map(r => ({
    ...r,
    tests: r.tests.map(([ti, pi, duration, oi]) => ({ title: h.titles[ti], project: h.projects[pi] ?? undefined, duration, outcome: h.outcomes[oi] })),
  }));
}
