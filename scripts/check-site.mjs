/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { load } from 'cheerio';

const root = process.cwd();
const folder = process.argv.find(arg => arg.startsWith('--folder='))?.slice(9) ?? '';
const original = readFileSync(path.join(root, 'bundles', folder, 'versioning.json'), 'utf8');
const temporary = mkdtempSync(path.join(tmpdir(), 'paperback-site-'));
try {
  const output = path.join(temporary, 'bundles', folder);
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'versioning.json'), original);
  writeFileSync(path.join(temporary, 'package.json'), readFileSync('package.json'));
  writeFileSync(path.join(temporary, 'next.json'), '{"sources":[]}');
  symlinkSync(path.join(root, 'media'), path.join(temporary, 'media'), 'junction');
  const env = { ...process.env, GITHUB_REPOSITORY: 'PoppingMangoSources/popmango-paperback-sources' };
  execFileSync(process.execPath, [path.join(root, 'scripts/build-site.mjs'), `--folder=${folder}`, '--next-manifest=next.json'], { cwd: temporary, env, stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(root, 'scripts/customize-site.mjs'), `--folder=${folder}`], { cwd: temporary, env, stdio: 'pipe' });
  const $ = load(readFileSync(path.join(output, 'index.html'), 'utf8'));
  const repos = JSON.parse($('#repo-data').text());
  const current = repos.find(repo => repo.label === '0.8');
  const base = `https://poppingmangosources.github.io/popmango-paperback-sources${folder ? `/${folder}` : ''}`;
  assert.equal(current.url, base);
  assert.equal(current.iconFolder, 'includes');
  assert.deepEqual(current.sources.map(source => source.id).sort(), JSON.parse(original).sources.map(source => source.id).sort());

  // Run the shipped link builders and initial render without network access.
  const elements = Object.fromEntries(['repo-data', 'repo-sections', 'ticker-track', 'source-filter'].map(id => [id, { textContent: '', innerHTML: '', value: '', addEventListener() {} }]));
  elements['repo-data'].textContent = JSON.stringify(repos);
  const context = {
    document: { getElementById: id => elements[id], querySelectorAll: () => [] },
    window: { addEventListener() {} },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch: () => new Promise(() => {}),
  };
  $('script:not([type="application/json"]):not([src])').each((_index, element) => {
    vm.runInNewContext($(element).html(), context, { timeout: 1000 });
  });
  const rendered = load(elements['repo-sections'].innerHTML);
  const addLink = rendered('a').toArray().map(element => rendered(element).attr('href')).find(href => href.startsWith('paperback://addRepo') && new URL(href).searchParams.get('url') === base);
  assert(addLink, 'Missing native addRepo link for the selected 0.8 repository');
  const installs = rendered('a.source-card').toArray().map(element => {
    const link = new URL(rendered(element).attr('href'));
    assert.equal(link.protocol, 'paperback:');
    assert.equal(link.hostname, 'installExtensions');
    return JSON.parse(Buffer.from(link.searchParams.get('data'), 'base64').toString('utf8'))[0];
  });
  assert.deepEqual(installs.map(([id]) => id).sort(), current.sources.map(source => source.id).sort());
  assert(installs.every(([, url]) => url === base), 'Install links point to the wrong repository');
  const icons = rendered('a.source-card img').toArray().map(element => rendered(element).attr('src'));
  assert(icons.every(src => src.startsWith('./') && src.includes('/includes/')), '0.8 icons must retain the includes path');
  console.log(`Verified existing repository page and native add/install links for ${current.sources.length} sources (${folder || 'root'}).`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
