// Regression test: report data embedded in inline <script> blocks must not be
// able to close the script tag or be mangled by String.prototype.replace
// substitution patterns ($&, $', $`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const REPO    = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD = `</script><img src=x onerror=alert(1)> $& $' $\` <!-- \u2028 end`;
const NAME    = 'evil-project';

let work;

function playwrightReport(title) {
  return {
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 10, startTime: new Date().toISOString() },
    suites: [{
      title: 'evil.spec.ts',
      file:  'evil.spec.ts',
      specs: [{
        title,
        file: 'evil.spec.ts',
        line: 1,
        tests: [{ projectName: 'chromium', status: 'expected', results: [{ status: 'passed', duration: 10, steps: [] }] }],
      }],
    }],
  };
}

/** Return the bodies of all inline (non-src) <script> blocks. */
function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
}

/** The JSON literal assigned by `marker`, evaluated as JS. */
function evalLiteral(script, marker) {
  const start = script.indexOf(marker);
  assert.ok(start >= 0, `marker not found: ${marker}`);
  const end = script.indexOf(';\n', start);
  return vm.runInNewContext('(' + script.slice(start + marker.length, end) + ')');
}

before(() => {
  work = mkdtempSync(join(tmpdir(), 'test-hub-'));
  cpSync(join(REPO, 'scripts'), join(work, 'scripts'), { recursive: true });
  mkdirSync(join(work, 'projects', NAME), { recursive: true });
  writeFileSync(join(work, 'projects', NAME, 'latest.json'), JSON.stringify(playwrightReport(PAYLOAD)));
  execFileSync(process.execPath, [join(work, 'scripts', 'build.mjs')], { cwd: work, stdio: 'pipe' });
});

after(() => rmSync(work, { recursive: true, force: true }));

for (const [label, rel, marker] of [
  ['dashboard index.html', 'dist/index.html',                'const { projects, global } = '],
  ['project detail page',  `dist/projects/${NAME}.html`,      'const projTests      = '],
]) {
  test(`${label}: payload cannot break out of inline script`, () => {
    const html = readFileSync(join(work, rel), 'utf8');

    assert.ok(!html.includes('</script><img'), 'raw </script><img found in output');
    assert.ok(!html.includes('<!-- \u2028'), 'raw <!-- found in script data');

    const scripts = inlineScripts(html);
    assert.equal(scripts.length, 1, 'expected exactly one inline script block');
    assert.doesNotThrow(() => new vm.Script(scripts[0]), 'inline script must parse');

    const data  = evalLiteral(scripts[0], marker);
    const tests = Array.isArray(data) ? data : data.projects.flatMap(p => p.tests);
    assert.equal(tests[0].title, PAYLOAD, 'title must round-trip unchanged (no $& expansion)');
  });
}
