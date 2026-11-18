// Rebuild history/<project>.json from every version of projects/<project>/latest.json
// in git, re-parsed with the current parsers. One entry per distinct run, newest
// HISTORY_MAX kept. Use after a parser change or to repair a corrupted history.
//
//   node scripts/rebuild-history.mjs            # all projects
//   node scripts/rebuild-history.mjs <name>...  # selected projects

import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseReport } from './lib/parsers.mjs';
import { toHistoryEntry, writeHistory } from './lib/history.mjs';

const ROOT     = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS = join(ROOT, 'projects');
const HISTORY  = join(ROOT, 'history');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(PROJECTS, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

for (const name of names) {
  const rel     = `projects/${name}/latest.json`;
  const commits = git('log', '--format=%H', '--reverse', '--', rel).split('\n').filter(Boolean);
  const texts   = commits.map(h => {
    try { return git('show', `${h}:${rel}`); } catch { return null; } // deleted in that commit
  });
  if (existsSync(join(ROOT, rel))) texts.push(readFileSync(join(ROOT, rel), 'utf8'));

  const entries = [];
  let skipped = 0;
  for (const text of texts) {
    if (!text) continue;
    try {
      const p = parseReport(text, name);
      if (p) entries.push(toHistoryEntry(p)); else skipped++;
    } catch {
      skipped++;
    }
  }

  const kept = writeHistory(name, entries, HISTORY);
  const span = kept.length
    ? `${new Date(kept[0].date).toISOString().slice(0, 10)} → ${new Date(kept.at(-1).date).toISOString().slice(0, 10)}`
    : 'empty';
  console.log(`${name}: ${commits.length} versions, ${new Set(entries.map(e => e.id)).size} distinct runs, kept ${kept.length} (${span})${skipped ? `, ${skipped} unparseable` : ''}`);
}
