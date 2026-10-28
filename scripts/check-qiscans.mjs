/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Qi Scans paid-chapter handling, run on common/ and src/QiScans/ transpiled into tmp/.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const out = path.join(repo, 'tmp', 'check-qiscans');
rmSync(out, { recursive: true, force: true });
for (const dir of ['common', 'src/QiScans']) {
  mkdirSync(path.join(out, dir), { recursive: true });
  for (const file of readdirSync(path.join(repo, dir)).filter(f => f.endsWith('.ts'))) {
    const js = ts.transpileModule(readFileSync(path.join(repo, dir, file), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
    writeFileSync(path.join(out, dir, file.replace(/\.ts$/, '.js')), js);
  }
}

// The v2 chapter list pages by cursor; the second page repeats its cursor, as a broken API might.
const asked = [];
const pages = {
  '': { data: [{ slug: 'chapter-3' }, { slug: 'chapter-2' }], hasMore: true, nextCursor: 'c1' },
  c1: { data: [{ slug: 'chapter-1' }], hasMore: true, nextCursor: 'c1' },
};
const reply = async request => {
  const url = new URL(request.url);
  asked.push(`${url.pathname}?${url.searchParams}`);
  return { status: 200, headers: {}, data: JSON.stringify(pages[url.searchParams.get('cursor') ?? '']) };
};
globalThis.App = {
  createSourceStateManager: () => ({ retrieve: async () => undefined, store: async () => {} }),
  createRequestManager: options => ({ ...options, getDefaultUserAgent: async () => 'UA', schedule: async request => reply(request) }),
  createRequest: r => ({ ...r }), createCookie: c => c,
};
const load = file => require(path.join(out, file));
const { isLocked, toChapters, toPages } = load('src/QiScans/parsers.js');
const { fetchAllChapters } = load('src/QiScans/network.js');
new (load('src/QiScans/QiScans.js').QiScans)(require('cheerio'));

let fail = 0;
const t = (name, got, want) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) fail++;
  console.log(`${a === b ? 'ok  ' : 'FAIL'}  ${name}${a === b ? '' : `\n        got  ${a}\n        want ${b}`}`);
};
const attempt = run => { try { return run(); } catch (error) { return String(error); } };

const chapter = (number, extra = {}) => ({ slug: `chapter-${number}`, number, price: 0, createdAt: '2026-10-01T00:00:00.000Z', ...extra });
t('a chapter marked paid is locked', isLocked(chapter(1, { price: 75, requiresPurchase: true })), true);
t('a paid chapter the reader owns is not', isLocked(chapter(1, { price: 75, requiresPurchase: false })), false);
t('a free chapter without the flag is not', isLocked(chapter(1)), false);
t('a priced chapter without the flag is', isLocked(chapter(1, { price: 30 })), true);
t('a discount decides the price', isLocked(chapter(1, { price: 30, discountedPrice: 0 })), false);
t('a chapter needing sign-in is locked', isLocked(chapter(1, { requiresPurchase: false, requiresAuth: true })), true);

const list = [chapter(2, { price: 75, discountedPrice: 50, requiresPurchase: true }), chapter(1, { requiresPurchase: false })];
const titles = paid => toChapters(list, {}, paid).map(c => `${c.sortingIndex}:${c.chapNum}:${c.title ?? ''}`);
t('paid chapters are hidden by default', titles(false), ['1:1:']);
t('shown, they carry their price', titles(true), ['1:1:', '2:2:🔒 50 coins']);
t('a title with only paid chapters says so', attempt(() => toChapters([list[0]], {}, false)),
  'Error: Every chapter of this title is paid on Qi Scans. Turn on Show paid chapters to list them.');

t('a paid page list names its length', attempt(() => toPages({ requiresPurchase: true, totalImages: 12, images: [] })),
  'Error: This chapter (12 pages) is paid on Qi Scans. Unlock it on the website, signed in through the cloud button.');
t('an unknown length is left out', attempt(() => toPages({ requiresPurchase: true, totalImages: 0, images: [] })),
  'Error: This chapter is paid on Qi Scans. Unlock it on the website, signed in through the cloud button.');
t('pages come back in order', toPages({ images: [{ url: 'b', order: 2 }, { url: 'a', order: 1 }] }), ['a', 'b']);

const all = await fetchAllChapters('series-a');
t('the chapter list follows the cursor and stops on a repeat', [all.map(c => c.slug), asked], [
  ['chapter-3', 'chapter-2', 'chapter-1'],
  ['/api/v2/series/series-a/chapters?limit=100&sort=desc', '/api/v2/series/series-a/chapters?limit=100&sort=desc&cursor=c1'],
]);

rmSync(out, { recursive: true, force: true });
if (fail) {
  console.error(`${fail} Qi Scans check(s) failed.`);
  process.exit(1);
}
console.log('Qi Scans checks passed.');
