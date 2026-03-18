import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export const HISTORY_MAX = 30;

/**
 * Append the current run snapshot to history/<project>.json (max HISTORY_MAX entries).
 * Creates the history/ directory on first call. Returns the full updated entries array.
 *
 * @param {object} p       - Normalized project object from parsers.mjs
 * @param {string} histDir - Absolute path to the history/ directory
 * @returns {Array}        - Updated history entries
 */
export function updateHistory(p, histDir) {
  mkdirSync(histDir, { recursive: true });
  const histPath = join(histDir, p.name + '.json');

  let entries = [];
  if (existsSync(histPath)) {
    try {
      entries = JSON.parse(readFileSync(histPath, 'utf8'));
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
  }

  entries.push({
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
  });

  if (entries.length > HISTORY_MAX) entries = entries.slice(-HISTORY_MAX);
  writeFileSync(histPath, JSON.stringify(entries, null, 2), 'utf8');
  return entries;
}
