/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const runner = path.resolve('scripts/test-source.mjs');
const root = mkdtempSync(path.join(tmpdir(), 'paperback-live-runner-'));
try {
  mkdirSync(path.join(root, 'bundles', 'Fixture'), { recursive: true });
  writeFileSync(path.join(root, 'bundles', 'versioning.json'), '{"sources":[{"id":"Fixture"}]}');
  const fixture = `
    class Fixture {
      async getHomePageSections(callback) {
        await new Promise(resolve => setTimeout(resolve, 10));
        callback({id:'recent',items:[{mangaId:'title',title:'Example'}]});
      }
      async getMangaDetails(id) { return {id,mangaInfo:{}}; }
      async getChapters() { return [{id:'chapter'}]; }
      async getChapterDetails(mangaId,id) { return {id,mangaId,pages:PAGES}; }
      async getSearchResults() { return {results:[{mangaId:'title'}]}; }
    }
    exports.Sources = {Fixture};
  `;
  for (const shouldPass of [true, false]) {
    writeFileSync(path.join(root, 'bundles', 'Fixture', 'source.js'), fixture.replace('PAGES', shouldPass ? "['https://example.invalid/page.png']" : '[]'));
    const result = spawnSync(process.execPath, [runner, 'Fixture'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, shouldPass ? 0 : 1, result.stdout + result.stderr);
    assert.match(result.stdout, shouldPass ? /5 passed, 0 failed/ : /4 passed, 1 failed/);
  }
  const unknown = spawnSync(process.execPath, [runner, '../Fixture'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  assert.equal(unknown.status, 1, 'Invalid source names must fail');
  console.log('Verified official live-test adapter: awaited success, empty-page failure, and invalid selection; no network requests.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
