/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Drives XCOMIC through the calls the app makes, against a fake site that
// records every request: how the shared base class finds a chapter it is only
// given the ids of, with XCOMIC's chapterFromIds hook and with a source that
// has none, and where paging stops now that a full page stands in for the
// site's own next-page answer, and which mirrors a request moves on to when the
// one it starts at fails. The real common/ and src/XCOMIC/ are transpiled
// into tmp/, where their packages still resolve, and the app's App.* factories
// hand back what they are given.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const out = path.join(repo, 'tmp', 'check-xcomic-flow');
rmSync(out, { recursive: true, force: true });
for (const dir of ['common', 'src/XCOMIC']) {
  mkdirSync(path.join(out, dir), { recursive: true });
  for (const file of readdirSync(path.join(repo, dir)).filter((f) => f.endsWith('.ts'))) {
    const { outputText } = ts.transpileModule(readFileSync(path.join(repo, dir, file), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } });
    writeFileSync(path.join(out, dir, file.replace(/\.ts$/, '.js')), outputText);
  }
}

// --- the fake site -------------------------------------------------------------
// Every XCOMIC query is a POST, which the runtime never reuses, so each one the
// source makes is recorded here: browse pages by number, the rest by name.
// A mirror listed in `statuses` fails with that status instead of answering;
// `hosts` records every mirror asked, in order.
const site = { total: 0, hidden: new Set(), requests: [], statuses: {}, hosts: [] };
const title = (n) => ({
  data: { id: `t${n}`, name: `Title ${n}`, urlCover: site.hidden.has(n) ? '' : `/covers/${n}.jpg`, type: 'manhwa' },
  comicNodes: [{ data: { id: `c${n}`, name: `Title ${n}`, translatedLanguage: 'en', chaps_normal: 3 } }],
});
const chapter = (comic, n) => ({
  data: { id: `5${n}`, dbStatus: 'normal', chaNum: n, dname: `Chapter ${n}`, urlPath: `/comic/${comic}/chapter/5${n}-ch-${n}` },
});
const answer = ({ query, variables }) => {
  const name = /query (\w+)/.exec(query)[1];
  const { select } = variables;
  site.requests.push(name === 'get_title_browse_items' ? `page ${select.page}` : name);
  switch (name) {
    case 'get_title_browse_items': {
      const first = (select.page - 1) * select.size;
      const count = Math.max(0, Math.min(select.size, site.total - first));
      return { get_title_browse_items: Array.from({ length: count }, (_, i) => title(first + i + 1)) };
    }
    case 'get_comicNode':
      return { get_comicNode: { data: { id: variables.id, name: 'A Work', urlCover: '/c.jpg', type: 'manhwa' } } };
    case 'get_comic_chapterList_uniqList':
      return { get_comic_chapterList_uniqList: { paging: { pages: 1 }, items: [3, 2, 1].map((n) => chapter(select.comic_id, n)) } };
    case 'get_chapterNode':
      return { get_chapterNode: { data: { imageUrls: [`/pages/${variables.id}/1.webp`] } } };
    default:
      throw new Error(`The fake site has no answer for ${name}.`);
  }
};

let savedSettings = {};
globalThis.App = new Proxy({
  createSourceStateManager: () => ({ retrieve: async (key) => savedSettings[key], store: async () => {} }),
  // Requests go through the source's own interceptor chain, as the app sends them.
  createRequestManager: ({ interceptor }) => ({
    getDefaultUserAgent: async () => 'Test',
    schedule: async (request) => {
      const sent = await interceptor.interceptRequest(request);
      const origin = new URL(sent.url).origin;
      site.hosts.push(origin);
      const status = site.statuses[origin];
      if (status !== undefined) {
        // What the site sends a bodiless GET, as following a redirect leaves the POST.
        const data = status === 400 ? '{"errors":[{"message":"Internal Server Error","extensions":{"code":"BAD_REQUEST"}}]}' : '';
        return interceptor.interceptResponse({ status, headers: { 'content-type': 'application/json' }, data, request: sent });
      }
      const data = JSON.stringify({ data: answer(JSON.parse(sent.data)) });
      return interceptor.interceptResponse({ status: 200, headers: { 'content-type': 'application/json' }, data, request: sent });
    },
  }),
}, { get: (stubs, name) => stubs[name] ?? ((value) => value) });

const load = (file) => require(path.join(out, file));
const cheerio = require('cheerio');
const { PopmangoSource } = load('common/index.js');
const { XCOMIC } = load('src/XCOMIC/XCOMIC.js');
const { HOME_ROW_SIZE, MIRROR_IDS, PAGE_SIZE, SECTIONS, STATE_KEYS } = load('src/XCOMIC/models.js');

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

// A new instance is what the app has after a restart: nothing fetched yet.
const fresh = () => new XCOMIC(cheerio);
// The chapter each getPages call was handed.
const watchPages = (source) => {
  const seen = [];
  const getPages = source.getPages.bind(source);
  source.getPages = (chapter) => (seen.push(chapter), getPages(chapter));
  return seen;
};

// --- chapterFromIds --------------------------------------------------------------
console.log('Opening a chapter with the chapterFromIds hook (XCOMIC):');
{
  const xcomic = fresh();
  const seen = watchPages(xcomic);
  site.requests = [];
  const details = await xcomic.getChapterDetails('m1', '/comic/m1/chapter/52-ch-2');
  t('  straight from history, only the pages are asked for', site.requests, ['get_chapterNode']);
  t('  for the chapter the app named', details.pages, ['https://xcomic.me/pages/52/1.webp']);
  t('  from a chapter rebuilt from the ids', [seen[0].chapterId, seen[0].sourceManga.mangaId], ['/comic/m1/chapter/52-ch-2', 'm1']);
}
{
  const xcomic = fresh();
  const seen = watchPages(xcomic);
  await xcomic.getMangaDetails('m1');
  await xcomic.getChapters('m1');
  site.requests = [];
  await xcomic.getChapterDetails('m1', '/comic/m1/chapter/52-ch-2');
  t('  from the list just shown, the listed chapter is reused', [site.requests, seen[0].chapNum], [['get_chapterNode'], 2]);
}

console.log('\nOpening a chapter without the hook (every other source):');
{
  // Records what it is asked for instead of fetching anything.
  const lists = { s1: ['c1', 'c2'], s2: ['c1'] };
  class Plain extends PopmangoSource {
    constructor() { super(cheerio, { domain: 'https://plain.invalid' }); this.calls = []; }
    async getDiscoverSections() { return []; }
    async getDiscoverSectionItems() { return { items: [] }; }
    async getSearchResultItems() { return { items: [] }; }
    async getMangaInfo(mangaId) {
      this.calls.push(`details ${mangaId}`);
      return { mangaId, mangaInfo: { primaryTitle: mangaId, secondaryTitles: [], thumbnailUrl: '', synopsis: '', status: '' } };
    }
    async getChapterList(manga) {
      this.calls.push(`list ${manga.mangaId}`);
      return lists[manga.mangaId].map((chapterId) => ({ chapterId, chapNum: 1, sourceManga: manga }));
    }
    async getPages(chapter) {
      this.calls.push(`pages ${chapter.sourceManga.mangaId} ${chapter.chapterId}`);
      return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages: [] };
    }
  }

  const restarted = new Plain();
  await restarted.getChapterDetails('s1', 'c2');
  t('  straight from history, the chapter list is fetched first', restarted.calls, ['details s1', 'list s1', 'pages s1 c2']);

  const plain = new Plain();
  await plain.getMangaDetails('s1');
  await plain.getChapters('s1');
  plain.calls = [];
  await plain.getChapterDetails('s1', 'c1');
  t('  from the list just shown, nothing is fetched again', plain.calls, ['pages s1 c1']);

  plain.calls = [];
  await plain.getChapterDetails('s2', 'c1');
  t('  the same id under another series is looked up in that series', plain.calls, ['details s2', 'list s2', 'pages s2 c1']);

  plain.calls = [];
  let error = '';
  try { await plain.getChapterDetails('s1', 'gone'); } catch (e) { error = e.message; }
  t('  a chapter no longer listed is an error after one refetch',
    [plain.calls, error], [['details s1', 'list s1'], 'Chapter gone is no longer listed under s1.']);
}

// --- paging ----------------------------------------------------------------------
// Pages on as the app does while the reader scrolls, until it is told there is
// nothing more; the cap only keeps a broken stop from running forever.
const walk = async (total, fetchPage, hidden = []) => {
  Object.assign(site, { total, hidden: new Set(hidden), requests: [] });
  let metadata;
  let shown = 0;
  for (let pages = 0; pages < 10; pages++) {
    const page = await fetchPage(metadata);
    shown += page.results.length;
    metadata = page.metadata;
    if (metadata === undefined) break;
  }
  return { shown, asked: site.requests, more: metadata !== undefined };
};
const search = (source) => (metadata) =>
  source.getSearchResults({ title: '', includedTags: [], excludedTags: [], parameters: {} }, metadata);
const pages = (...numbers) => numbers.map((n) => `page ${n}`);

console.log(`\nPaging search results, ${PAGE_SIZE} to a page, by whether a page came back full:`);
{
  const xcomic = fresh();
  t('  no results: one request, and no next page',
    await walk(0, search(xcomic)), { shown: 0, asked: pages(1), more: false });
  t('  one result short of a page: stops after it',
    await walk(PAGE_SIZE - 1, search(xcomic)), { shown: PAGE_SIZE - 1, asked: pages(1), more: false });
  t('  a partly full final page: stops after it, one request per page',
    await walk(PAGE_SIZE + 6, search(xcomic)), { shown: PAGE_SIZE + 6, asked: pages(1, 2), more: false });
  t('  ending exactly on a full page: one empty request, then it stops',
    await walk(PAGE_SIZE * 2, search(xcomic)), { shown: PAGE_SIZE * 2, asked: pages(1, 2, 3), more: false });
  t('  a full page thinned out by the reader\'s filters still leads on',
    await walk(PAGE_SIZE + 1, search(xcomic), [3, 4, 5]), { shown: PAGE_SIZE - 2, asked: pages(1, 2), more: false });
}

console.log(`\nPaging a home row, ${HOME_ROW_SIZE} to a page, the same way:`);
{
  const xcomic = fresh();
  const row = (metadata) => xcomic.getViewMoreItems(SECTIONS.TOP_RATED, metadata);
  t('  a partly full final page: stops after it',
    await walk(HOME_ROW_SIZE + 6, row), { shown: HOME_ROW_SIZE + 6, asked: pages(1, 2), more: false });
  t('  ending exactly on a full page: one empty request, then it stops',
    await walk(HOME_ROW_SIZE * 2, row), { shown: HOME_ROW_SIZE * 2, asked: pages(1, 2, 3), more: false });
}

// --- mirrors ---------------------------------------------------------------------
console.log('\nMoving to another mirror when the one a request starts at fails:');
const choose = (source, mirror) =>
  source.getSettingsSections().find((section) => section.id === 'mirror')
    .rows.find((row) => row.id === 'base_url').value.set([mirror]);
const openChapter = async (source, statuses) => {
  Object.assign(site, { statuses, hosts: [] });
  let error = '';
  try { await source.getChapterDetails('m1', '/comic/m1/chapter/52-ch-2'); } catch (e) { error = e.message; }
  return { hosts: site.hosts, error };
};
t('  only supported mirrors are offered', MIRROR_IDS, ['https://xcomic.me', 'https://comik.to']);
{
  const row = fresh().getSettingsSections().find((section) => section.id === 'mirror').rows[0];
  t('  the native mirror selector offers only those hosts', row.options, ['https://xcomic.me', 'https://comik.to']);
}
for (const retired of ['https://yona.to', 'https://xcomic.net']) {
  for (const [preferred, active, expected] of [
    [retired, retired, 'https://xcomic.me'],
    ['https://comik.to', retired, 'https://comik.to'],
    [retired, 'https://comik.to', 'https://comik.to'],
  ]) {
    savedSettings = { [STATE_KEYS.BASE_URL]: preferred, [STATE_KEYS.ACTIVE_BASE_URL]: active };
    const xcomic = fresh();
    const result = await openChapter(xcomic, {});
    savedSettings = {};
    t(`  saved ${preferred}, last working ${active}: only a supported host is requested`,
      result, { hosts: [expected], error: '' });
    t('  sharing uses the supported active host', xcomic.getMangaShareUrl('m1'), `${expected}/comic/m1`);
    const row = xcomic.getSettingsSections().find((section) => section.id === 'mirror').rows[0];
    t('  the selected value is supported', await row.value.get(),
      [preferred === retired ? 'https://xcomic.me' : preferred]);
  }
}
{
  const xcomic = fresh();
  for (const host of ['xcomic.me', 'comik.to', 'www.comik.to']) {
    site.requests = [];
    const result = await xcomic.getSearchResults({ title: `https://${host}/comic/m1`, includedTags: [], excludedTags: [], parameters: {} });
    t(`  a pasted ${host} comic opens directly`, [site.requests, result.results[0]?.mangaId], [['get_comicNode'], 'm1']);
  }
  for (const host of ['yona.to', 'xcomic.net']) {
    site.requests = [];
    await xcomic.getSearchResults({ title: `https://${host}/comic/m1`, includedTags: [], excludedTags: [], parameters: {} });
    t(`  a pasted ${host} URL is no longer a supported comic link`, site.requests, ['page 1']);
  }
}
{
  const xcomic = fresh();
  await choose(xcomic, 'https://comik.to');
  t('  the chosen mirror answers 400: the next is asked',
    await openChapter(xcomic, { 'https://comik.to': 400 }), { hosts: ['https://comik.to', 'https://xcomic.me'], error: '' });
  t('  and the next request starts at the mirror that answered',
    await openChapter(xcomic, { 'https://comik.to': 400 }), { hosts: ['https://xcomic.me'], error: '' });
}
{
  const xcomic = fresh();
  await choose(xcomic, 'https://comik.to');
  t('  the chosen mirror is down (502): the next is asked',
    await openChapter(xcomic, { 'https://comik.to': 502 }), { hosts: ['https://comik.to', 'https://xcomic.me'], error: '' });
}
{
  const xcomic = fresh();
  t('  a 404 is the same on every mirror, so no other is asked',
    await openChapter(xcomic, { 'https://xcomic.me': 404 }),
    { hosts: ['https://xcomic.me'], error: 'XCOMIC answered 404 on https://xcomic.me.' });
  t('  every mirror failing: each is asked once, and the last answer is the error',
    await openChapter(xcomic, Object.fromEntries(MIRROR_IDS.map((mirror) => [mirror, 400]))),
    { hosts: MIRROR_IDS, error: 'XCOMIC answered 400 on https://comik.to.' });
}

rmSync(out, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
