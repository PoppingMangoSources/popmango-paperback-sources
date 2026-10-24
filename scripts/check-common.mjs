/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Shared adapter behavior the device depends on, run on common/ transpiled into tmp/ with stubbed App.* factories.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const out = path.join(repo, 'tmp', 'check-common');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'common'), { recursive: true });
for (const file of readdirSync(path.join(repo, 'common')).filter(f => f.endsWith('.ts'))) {
  const js = ts.transpileModule(readFileSync(path.join(repo, 'common', file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  writeFileSync(path.join(out, 'common', file.replace(/\.ts$/, '.js')), js);
}

// A state store that records how many calls overlap, as the Swift bridge would see them.
const store = { values: { a: 1, b: 2, c: 3 }, active: 0, peak: 0, writes: [] };
const tick = () => new Promise(resolve => setImmediate(resolve));
const track = async work => {
  store.active++; store.peak = Math.max(store.peak, store.active);
  await tick();
  try { return work(); } finally { store.active--; }
};
globalThis.App = {
  createSourceStateManager: () => ({
    retrieve: key => track(() => store.values[key]),
    store: (key, value) => track(() => { store.writes.push(key); store.values[key] = value; }),
  }),
  createRequestManager: options => ({ ...options, getDefaultUserAgent: async () => 'UA', schedule: async () => { throw new Error('offline'); } }),
  createRequest: r => ({ ...r }), createCookie: c => c,
  createChapter: c => c, createChapterDetails: c => c, createPagedResults: r => r, createPartialSourceManga: p => p,
};
const { SettingsStore } = require(path.join(out, 'common', 'Settings.js'));
const { PopmangoSource } = require(path.join(out, 'common', 'Source.js'));
const { plainQuotes } = require(path.join(out, 'common', 'Convert.js'));

let fail = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };

console.log('Settings reach the state store one call at a time:');
const settings = new SettingsStore(App.createSourceStateManager(), ['a', 'b', 'c']);
await settings.load();
t('  loading three keys never overlaps', store.peak, 1);
t('  values are read', [settings.get('a'), settings.get('b'), settings.get('c')], [1, 2, 3]);
store.peak = 0;
settings.set('a', 10); settings.set('b', 20); settings.set('a', 11);
for (let i = 0; i < 10; i++) await tick();
t('  writes are queued in order without overlapping', [store.peak, store.writes], [1, ['a', 'b', 'a']]);
t('  the last write wins', store.values.a, 11);

console.log('\nCurly quotes from iOS autocorrect:');
t('  single and double quotes become straight', plainQuotes('Boys’ Love “foo”'), 'Boys\' Love "foo"');

class Fixture extends PopmangoSource {
  constructor(chapters) { super(require('cheerio'), { domain: 'https://example.com', settingsKeys: [] }); this.chapters = chapters; this.seen = undefined; }
  async getMangaInfo(mangaId) { return { mangaId, mangaInfo: { primaryTitle: 'T', secondaryTitles: [], thumbnailUrl: '', synopsis: '' } }; }
  async getChapterList() { return this.chapters; }
  async getPages() { return { id: 'c', mangaId: 'm', pages: [] }; }
  async getSearchResultItems(query) { this.seen = query; return { items: [] }; }
  async getDiscoverSections() { return []; }
  async getDiscoverSectionItems() { return { items: [] }; }
}

console.log('\nThe adapter, through the calls the app makes:');
let message = '';
try { await new Fixture([]).getChapters('m'); } catch (error) { message = error.message; }
t('  an empty chapter list is an error, so progress is kept', /No chapters were found/.test(message), true);
const listed = await new Fixture([{ chapterId: 'c1', chapNum: 1, sourceManga: { mangaId: 'm' } }]).getChapters('m');
t('  a listed chapter still comes through', listed.length, 1);
const searching = new Fixture([]);
await searching.getSearchResults({ title: 'Boys’ Love', includedTags: [], excludedTags: [], parameters: { tags: '‘Gore’', page: 2 } }, undefined);
t('  search text and typed fields lose curly quotes', [searching.seen.title, searching.seen.parameters], ['Boys\' Love', { tags: '\'Gore\'', page: 2 }]);

rmSync(out, { recursive: true, force: true });
if (fail) { console.error(`\n${fail} failed`); process.exit(1); }
console.log('\nall passed');
