import { stripAnsi } from './utils.mjs';

// ── Detect report format ──────────────────────────────────────────────────────

/** Returns 'playwright' | 'jest' | 'unknown' based on the raw JSON shape. */
export function detectReportType(raw) {
  if (Array.isArray(raw.testResults)) return 'jest';
  if (Array.isArray(raw.suites))      return 'playwright';
  return 'unknown';
}

// ── Playwright ────────────────────────────────────────────────────────────────

/** Recursively flatten Playwright suite tree into a normalized test array. */
function flattenSpecs(suites = [], path = []) {
  const tests = [];
  for (const suite of suites) {
    const nextPath = suite.title ? [...path, suite.title] : path;
    for (const spec of (suite.specs ?? [])) {
      for (const test of (spec.tests ?? [])) {
        const results      = test.results ?? [];
        const lastResult   = results[results.length - 1] ?? {};
        // Use the first failed result for error details; fall back to last
        const failedResult = results.find(r => r.status !== 'passed' && r.error) ?? lastResult;
        // Top-level steps from the last result (Playwright only)
        const steps = (lastResult.steps ?? []).map(s => ({
          title:    s.title,
          duration: s.duration ?? 0,
          error:    stripAnsi(s.error?.message ?? null),
        }));
        tests.push({
          title:      spec.title,
          file:       spec.file ?? nextPath[0] ?? '',
          line:       spec.line ?? 0,
          project:    test.projectName ?? 'default',
          outcome:    test.status,
          duration:   lastResult.duration ?? 0,
          retries:    results.length - 1,
          error:      stripAnsi(failedResult.error?.message ?? null),
          errorStack: stripAnsi(failedResult.error?.stack ?? null),
          steps,
        });
      }
    }
    if (suite.suites) {
      tests.push(...flattenSpecs(suite.suites, nextPath));
    }
  }
  return tests;
}

/** Parse a raw Playwright JSON report into the normalized project shape. */
export function parsePlaywrightProject(raw, name) {
  const stats = raw.stats ?? {};
  const tests = flattenSpecs(raw.suites ?? []);
  const total = (stats.expected   ?? 0) + (stats.unexpected ?? 0)
              + (stats.flaky      ?? 0) + (stats.skipped    ?? 0);
  return {
    name,
    type:         'playwright',
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
}

// ── Jest ──────────────────────────────────────────────────────────────────────

/** Flatten Jest assertionResults into the same normalized test array format. */
function flattenJest(testResults = []) {
  const tests = [];
  for (const suite of testResults) {
    const file = suite.testFilePath ?? '';
    for (const t of (suite.assertionResults ?? [])) {
      let outcome;
      if (t.status === 'passed')      outcome = 'expected';
      else if (t.status === 'failed') outcome = 'unexpected';
      else                            outcome = 'skipped'; // pending, todo

      // Jest failure messages often include the stack — split on the first frame
      const rawError  = t.failureMessages?.[0] ?? null;
      const stackStart = rawError ? rawError.indexOf('\n    at ') : -1;
      const errMsg    = rawError
        ? stripAnsi(stackStart > -1 ? rawError.slice(0, stackStart) : rawError)
        : null;
      const errStack  = rawError && stackStart > -1
        ? stripAnsi(rawError.slice(stackStart + 1))
        : null;

      tests.push({
        title:      t.fullName ?? t.title ?? '',
        file,
        line:       t.location?.line ?? 0,
        project:    'unit',
        outcome,
        duration:   t.duration ?? 0,
        retries:    0,
        error:      errMsg,
        errorStack: errStack,
        steps:      [],
      });
    }
  }
  return tests;
}

/** Parse a raw Jest JSON report into the normalized project shape. */
export function parseJestProject(raw, name) {
  const tests      = flattenJest(raw.testResults ?? []);
  const expected   = raw.numPassedTests  ?? 0;
  const unexpected = raw.numFailedTests  ?? 0;
  const skipped    = (raw.numPendingTests ?? 0) + (raw.numTodoTests ?? 0);
  const total      = raw.numTotalTests   ?? tests.length;
  return {
    name,
    type:         'jest',
    startTime:    raw.startTime ?? Date.now(),
    duration:     0,
    workers:      1,
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
