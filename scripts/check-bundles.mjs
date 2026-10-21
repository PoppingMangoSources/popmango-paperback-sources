/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const folder = process.argv.find(arg => arg.startsWith('--folder='))?.slice(9) ?? '';
const directory = path.resolve('bundles', folder);
const manifest = JSON.parse(readFileSync(path.join(directory, 'versioning.json'), 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const name of ['toolchain', 'types']) {
  assert.equal(pkg.dependencies[`@paperback/${name}`], '0.8.7', `Keep @paperback/${name} pinned to 0.8.7`);
  assert.equal(require(`@paperback/${name}/package.json`).version, '0.8.7');
  assert.equal(manifest.builtWith?.[name], '0.8.7', `Incorrect builtWith.${name}`);
}
const expected = readdirSync('src', { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(path.join('src', entry.name, `${entry.name}.ts`)))
  .map(entry => entry.name).sort();
assert(expected.length > 0, 'No source entry points found');
assert(Array.isArray(manifest.sources), 'Manifest sources must be an array');
assert(manifest.sources.every(source => source && typeof source.id === 'string'), 'Null or malformed manifest source');
assert.deepEqual(manifest.sources.map(source => source.id).sort(), expected, 'Manifest must list every source exactly once');
assert(existsSync(path.join(directory, 'index.html')), 'Official repository page was not generated');

for (const source of manifest.sources) {
  const label = source.id;
  const exported = require(path.join(directory, label, 'source.js')).Sources;
  const info = exported?.[`${label}Info`];
  const Source = exported?.[label];
  assert.equal(typeof Source, 'function', `${label}: missing exported class`);
  assert(info, `${label}: missing ${label}Info`);
  for (const key of ['name', 'version', 'icon', 'websiteBaseURL', 'contentRating', 'intents']) {
    assert.deepEqual(info[key], source[key], `${label}: metadata mismatch for ${key}`);
  }
  assert.match(source.version, /^\d+\.\d+\.\d+$/, `${label}: expected a stable source version`);
  assert(['EVERYONE', 'MATURE', 'ADULT'].includes(source.contentRating), `${label}: invalid content rating`);
  assert(/^https?:\/\//.test(source.websiteBaseURL), `${label}: invalid site URL`);
  assert(Number.isInteger(source.intents) && source.intents >= 0 && source.intents < 64, `${label}: invalid 0.8 intent bits`);
  assert.equal(path.basename(source.icon), source.icon, `${label}: icon must be a filename`);
  const icon = readFileSync(path.join(directory, label, 'includes', source.icon));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label}: icon is not PNG`);
  for (const method of ['getMangaDetails', 'getSearchResults']) {
    assert.equal(typeof Source.prototype[method], 'function', `${label}: missing native ${method}`);
  }
  for (const [bit, methods] of [
    [1, ['getChapters', 'getChapterDetails']],
    [4, ['getHomePageSections', 'getViewMoreItems']],
    [16, ['getCloudflareBypassRequestAsync']],
    [32, ['getSourceMenu']],
  ]) {
    if (source.intents & bit) {
      for (const method of methods) assert.equal(typeof Source.prototype[method], 'function', `${label}: intent requires ${method}`);
    }
  }
}
console.log(`Verified ${expected.length} official Paperback 0.8.7 bundles, metadata, native methods and icons.`);
