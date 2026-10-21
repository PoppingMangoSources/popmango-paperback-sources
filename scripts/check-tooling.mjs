/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const matrixRunner = path.resolve('scripts/live-test-matrix.mjs');
const folderRunner = path.resolve('scripts/publish-folder.mjs');
const root = mkdtempSync(path.join(tmpdir(), 'paperback-tooling-'));
const run = (script, args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  cwd: root, encoding: 'utf8', timeout: 10_000,
  env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', ...env },
});
try {
  mkdirSync(path.join(root, '.github'));
  for (const name of ['Fixture', 'Second']) {
    mkdirSync(path.join(root, 'src', name), { recursive: true });
    writeFileSync(path.join(root, 'src', name, `${name}.ts`), '');
  }
  const exclude = value => writeFileSync(path.join(root, '.github/live-test-exclusions.json'), JSON.stringify(value));
  exclude({ Fixture: 'HTTP 502, recheck manually' });
  const output = path.join(root, 'outputs');
  const summary = path.join(root, 'summary');
  const all = run(matrixRunner, ['all'], { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary });
  assert.equal(all.status, 0, all.stderr);
  assert.deepEqual(JSON.parse(all.stdout), { source: ['Second'] });
  assert.match(all.stderr, /SKIP Fixture: HTTP 502/);
  assert.equal(readFileSync(output, 'utf8'), 'matrix={"source":["Second"]}\n');
  assert.match(readFileSync(summary, 'utf8'), /Skipped \*\*Fixture\*\*/);
  const manual = run(matrixRunner, ['Fixture']);
  assert.equal(manual.status, 0, manual.stderr);
  assert.deepEqual(JSON.parse(manual.stdout), { source: ['Fixture'] });
  assert.equal(manual.stderr, '');
  for (const name of ['Unknown', '../Fixture', 'all', '--flag']) {
    const result = run(matrixRunner, [name, 'unexpected']);
    assert.equal(result.status, 1, 'Invalid selection/arguments must fail');
  }
  assert.equal(run(matrixRunner, ['Unknown']).status, 1);
  for (const exclusions of [{ Unknown: 'HTTP 502' }, { Fixture: '' }, { Fixture: 'HTTP 502', Second: 'DNS failure' }, []]) {
    exclude(exclusions);
    assert.equal(run(matrixRunner, ['all']).status, 1, 'Bad exclusions or an empty matrix must fail');
  }
  exclude({});
  assert.deepEqual(JSON.parse(run(matrixRunner, []).stdout), { source: ['Fixture', 'Second'] });

  for (const [branch, expected] of [
    ['main', 'all'], ['feature/one', 'feature-one'], ['feature+one', 'feature-one'],
    ['release@candidate', 'release-candidate'], ['-preview', 'branch--preview'],
    ['feature/日本語', 'feature----'], ['feature/$(whoami)', 'feature---whoami-'],
  ]) {
    const result = run(folderRunner, [branch]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
    assert.match(result.stdout.trim(), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  }
  console.log('Verified live exclusions, manual override, invalid/empty selections, and publication folder mapping.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
