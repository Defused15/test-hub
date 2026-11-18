import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mergeHistory, updateHistory, HISTORY_MAX } from '../scripts/lib/history.mjs';
import { parseReport } from '../scripts/lib/parsers.mjs';

const entry = (id, date) => ({ id, date, stats: { total: 1, expected: 1, unexpected: 0, flaky: 0, skipped: 0 }, duration: 1, tests: [] });

const jestReport = (startTime, ends) => JSON.stringify({
  startTime, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
  testResults: ends.map((endTime, i) => ({
    name: `/repo/src/t${i}.test.ts`, startTime, endTime,
    assertionResults: [{ fullName: `t${i}`, status: 'passed', duration: 1 }],
  })),
});

test('re-running the build for an unchanged report does not add a history entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hist-'));
  try {
    const p = parseReport(jestReport(1000, [1500]), 'proj');
    updateHistory(p, dir);
    updateHistory(p, dir);
    const saved = updateHistory(p, dir);
    assert.equal(saved.length, 1);
    assert.equal(JSON.parse(readFileSync(join(dir, 'proj.json'), 'utf8')).length, 1);

    const next = parseReport(jestReport(2000, [2600]), 'proj');
    assert.equal(updateHistory(next, dir).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mergeHistory collapses legacy duplicates, sorts by date and caps the size', () => {
  const legacy = [{ ...entry(undefined, 5) }, { ...entry(undefined, 5) }, { ...entry(undefined, 3) }];
  const merged = mergeHistory(legacy, [entry('t:9', 9), entry('t:5', 5)]);
  assert.deepEqual(merged.map(e => e.date), [3, 5, 9]);
  assert.equal(merged.find(e => e.date === 5).id, 't:5', 'id entry supersedes legacy entry of same run');

  const many = Array.from({ length: HISTORY_MAX + 10 }, (_, i) => entry('t:' + i, i));
  const capped = mergeHistory([], many);
  assert.equal(capped.length, HISTORY_MAX);
  assert.equal(capped.at(-1).date, HISTORY_MAX + 9, 'keeps the newest runs');
});

test('jest run duration comes from file timings', () => {
  const p = parseReport(jestReport(1000, [1400, 2300, 1900]), 'proj');
  assert.equal(p.duration, 1300);
  assert.equal(p.runId, 't:1000');
});

test('newman assertions become steps, after the HTTP exchange', () => {
  const report = JSON.stringify({
    run: {
      stats: { items: { total: 1, failed: 1 } },
      timings: { started: 5000, completed: 5300 },
      executions: [{
        item: { name: 'Get booking' },
        request: { method: 'GET', url: { path: ['booking', '1'] } },
        response: { code: 404, status: 'Not Found', responseTime: 42 },
        assertions: [
          { assertion: 'Status is 200', error: { message: 'expected 404 to equal 200' } },
          { assertion: 'Has body', skipped: true },
        ],
      }],
    },
  });
  const p = parseReport(report, 'api');
  assert.equal(p.runId, 't:5000');
  assert.deepEqual(p.tests[0].steps, [
    { title: 'GET /booking/1 → 404 Not Found', duration: 42, error: null },
    { title: 'Status is 200', duration: null, error: 'expected 404 to equal 200', skipped: false },
    { title: 'Has body', duration: null, error: null, skipped: true },
  ]);
  assert.equal(p.tests[0].outcome, 'unexpected');
});
