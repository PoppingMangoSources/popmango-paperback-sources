/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Drives MangaDot through the calls the app makes, against a fake site that
// records every request, so what is checked is what the source asks the site
// for and what it hands the app back. The real common/ and src/MangaDot/ are
// transpiled into tmp/, where their packages still resolve, and the app's
// App.* factories hand back what they are given.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const out = path.join(repo, 'tmp', 'check-mangadot');
rmSync(out, { recursive: true, force: true });
for (const dir of ['common', 'src/MangaDot']) {
  mkdirSync(path.join(out, dir), { recursive: true });
  for (const file of readdirSync(path.join(repo, dir)).filter((f) => f.endsWith('.ts'))) {
    const { outputText } = ts.transpileModule(readFileSync(path.join(repo, dir, file), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } });
    writeFileSync(path.join(out, dir, file.replace(/\.ts$/, '.js')), outputText);
  }
}

// --- the fake site -------------------------------------------------------------
// Shapes as the 0.9 source reads them. Every request is recorded by path, with
// its query and headers.
const stamp = '2026-06-01 12:34:56.123456+00';
const manga = (id, extra = {}) => ({
  id, title: `Title ${id}`, photo: `/covers/${id}.webp`, status: 'Ongoing', avg_rating: 8.66, chapter_count: 12,
  last_chapter_date: stamp, is_blurworthy: 0, authors: '["Ann","Bo"]', genres: ['Action', 'Slice of Life', 'Shounen', 'Gore'],
  ...extra,
});
const chapters = [
  { id: 110, chapter_number: 3, volume_number: null, chapter_title: 'Chapter 3', group_name: 'Night Owls', language: 'en', date_added: stamp },
  { id: 105, chapter_number: 1, volume_number: 2, chapter_title: 'A New Start', group_name: 'Night Owls', language: 'en', uploader_upload_status: 'trusted', date_added: stamp },
  { id: 102, chapter_number: 2, volume_number: 1, chapter_title: 'Chapter 2', scanlator_name: 'Solo TL', language: 'en', date_added: stamp },
  { id: 101, chapter_number: 1, volume_number: 1, chapter_title: 'Chapter 1', group_name: 'Night Owls', language: 'en', date_added: stamp },
];
const site = { requests: [], totalPages: 3, mode: 'normal', genreFetches: 0 };
const answer = (url) => {
  const p = url.pathname;
  if (p === '/api/search' || p.startsWith('/api/manga/section/')) {
    return site.mode === 'malformed' ? { results: [] } : { manga_list: [manga(1), manga(2)], pagination: { total_pages: site.totalPages } };
  }
  if (p === '/api/manga/section') return { items: [manga(3, { authors: undefined, genres: undefined })] };
  if (p === '/api/manga/genres') { site.genreFetches++; return ['Romance', 'Action', 'Slice of Life', 'Shounen', 'Gore', 'Horror']; }
  if (p === '/api/manga/people-suggest') return { suggestions: ['Odagiri Hotaru', 'Oda Eiichiro'] };
  if (p === '/api/manga/7') return { manga: manga(7, { alt_titles: '["Alt Title","Title 7"]', banner_image: '/banners/7.webp', description: 'One &amp; two', artists: ['Bo'], is_adult: false, content_rating: 'safe' }) };
  if (p === '/api/manga/7/chapters/list') return chapters;
  if (/^\/api\/(?:chapters|uploads)\/\d+\/images$/.test(p)) return { images: [{ url: `${p}/1.webp` }, { url: 'https://cdn.example/2.webp' }, null] };
  throw new Error(`The fake site has no answer for ${p}`);
};
const respond = (request) => {
  // The runtime reuses an identical read from the last few seconds; each check
  // here wants its own request.
  Application.inFlight.clear();
  const url = new globalThis.URL(request.url);
  site.requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: request.headers });
  if (site.mode === 'challenge') {
    return { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }, data: '<title>Just a moment...</title>', request };
  }
  if (site.mode === 'html') {
    return { status: 200, headers: { 'content-type': 'text/html' }, data: '<!DOCTYPE html><html><body>checking</body></html>', request };
  }
  return { status: 200, headers: { 'content-type': 'application/json' }, data: JSON.stringify(answer(url)), request };
};

// One store for every instance, so a new instance is the app after a restart.
const state = new Map();
globalThis.App = new Proxy({
  createSourceStateManager: () => ({ retrieve: async (key) => state.get(key), store: async (key, value) => { state.set(key, value); } }),
  // Requests go through the source's own interceptor chain, as the app sends them.
  createRequestManager: ({ interceptor }) => ({
    getDefaultUserAgent: async () => 'Test',
    schedule: async (request) => interceptor.interceptResponse(respond(await interceptor.interceptRequest(request))),
  }),
}, { get: (stubs, name) => stubs[name] ?? ((value) => value) });

const load = (file) => require(path.join(out, file));
const cheerio = require('cheerio');
const { MangaDot } = load('src/MangaDot/MangaDot.js');
const { parseSiteDate } = load('src/MangaDot/parsers.js');
const { Application, CloudflareError } = load('common/index.js');

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const rejects = async (fn) => { try { await fn(); return undefined; } catch (error) { return error; } };

const source = (settings = {}) => {
  const instance = new MangaDot(cheerio);
  for (const [key, value] of Object.entries(settings)) instance.settings.set(key, value);
  return instance;
};
const asked = () => site.requests.map(({ path, query }) => `${path}${Object.keys(query).length ? '?' + new URLSearchParams(query) : ''}`);
const search = async (instance, { title = '', include = [], exclude = [], parameters = {} } = {}, metadata) => {
  site.requests = [];
  const tag = (id) => ({ id, label: id });
  const page = await instance.getSearchResults({ title, includedTags: include.map(tag), excludedTags: exclude.map(tag), parameters }, metadata);
  return { page, query: site.requests.at(-1)?.query };
};

// --- search ------------------------------------------------------------------
console.log('search, as the site\'s own filters send it:');
{
  const plain = source();
  const { page, query } = await search(plain);
  t('  browsing: newest first, adult results off by default',
    query, { page: '1', sortBy: 'latest', sortOrder: 'desc', adult: '0' });
  t('  results carry their authors and absolute covers',
    page.results.map(({ mangaId, subtitle, image }) => [mangaId, subtitle, image]),
    [['1', 'Ann, Bo', 'https://mangadot.net/covers/1.webp'], ['2', 'Ann, Bo', 'https://mangadot.net/covers/2.webp']]);
  t('  a further page while the site has one', page.metadata, { page: 2 });
  t('  and none after its last', (await search(plain, {}, { page: 3 })).page.metadata, undefined);

  t('  a search term ranks by relevance', (await search(plain, { title: 'solo' })).query,
    { search: 'solo', page: '1', sortBy: 'relevance', sortOrder: 'desc', adult: '0' });
  t('  relevance without a term falls back to the newest',
    (await search(plain, { include: ['sort::relevance'] })).query.sortBy, 'latest');
  t('  a title order starts at A', Object.values((await search(plain, { include: ['sort::alphabetical'] })).query).slice(1, 3), ['alphabetical', 'asc']);
  t('  unless the order says otherwise',
    (await search(plain, { include: ['sort::alphabetical', 'order::desc'] })).query.sortOrder, 'desc');

  const hiding = source({ hidden_tags: ['Gore', 'Romance'], search_origins: ['KR'], adult: 'both' });
  t('  included and excluded genres, with the hidden tags ruled out too',
    (await search(hiding, { include: ['genre::Slice%20of%20Life'], exclude: ['genre::Horror'] })).query.genres,
    'Slice of Life,-Horror,-Gore,-Romance');
  t('  a hidden tag a search asks for is not ruled out',
    (await search(hiding, { include: ['genre::Romance'] })).query.genres, 'Romance,-Gore');
  t('  the default content types and adult setting apply',
    [(await search(hiding)).query.origin, site.requests.at(-1).query.adult], ['KR', 'both']);
  t('  a search\'s own content type and adult choice win; Manhua is both Chinese origins',
    Object.entries((await search(hiding, { include: ['origin::CN', 'origin::JP', 'adult::1', 'status::Hiatus'] })).query)
      .filter(([key]) => ['origin', 'adult', 'status'].includes(key)),
    [['origin', 'JP,CN,TW'], ['status', 'Hiatus'], ['adult', '1']]);

  const people = await search(plain, { parameters: { author: 'oda eiichiro, Bo', artist: 'od' } });
  t('  typed names are matched to the site\'s suggestions; two letters are sent as typed',
    [asked().filter((request) => request.includes('people-suggest')), people.query.author, people.query.artist],
    [['/api/manga/people-suggest?kind=author&q=oda+eiichiro'], 'Oda Eiichiro,Bo', 'od']);

  site.mode = 'malformed';
  t('  an answer in the wrong shape is an error, not an empty list',
    (await rejects(() => search(plain)))?.message, 'MangaDot\'s search results came back in an unexpected shape. The source may need an update.');
  site.mode = 'normal';
}

// --- filters and genres ------------------------------------------------------
console.log('\nfilters, from the site\'s genre list:');
{
  state.clear();
  site.genreFetches = 0;
  const first = source();
  const sections = await first.getSearchTags();
  t('  the genre list is grouped as the 0.9 search form groups it',
    sections.map(({ id, tags }) => `${id}:${tags.map(({ label }) => label).join('/')}`),
    ['sort:Relevance/Latest/Title/Chapters/Most viewed/Most tracked/Top rated', 'order:Descending/Ascending',
      'genre-genres:Action/Horror/Romance/Slice of Life', 'genre-demographic:Shounen', 'genre-more:Gore',
      'status:Ongoing/Completed/Interrupted', 'origin:Manga/Manhwa/Manhua/Oneshot', 'adult:No/Yes/Both']);
  await first.getSearchTags();
  await source().getSearchTags();
  t('  it is asked for once, then kept across a restart', site.genreFetches, 1);
  state.set('genres_fetched_at', Date.now() - 3 * 24 * 60 * 60 * 1000);
  await source().getSearchTags();
  t('  and asked for again once two days old', site.genreFetches, 2);

  const details = await source().getMangaDetails('7');
  const filterIds = new Set(sections.flatMap(({ tags }) => tags.map(({ id }) => id)));
  t('  a details tag is the same tag as its search filter, so tapping it searches',
    details.mangaInfo.tags.flatMap(({ tags }) => tags.map(({ id }) => [id, filterIds.has(id)])),
    [['genre::Action', true], ['genre::Slice%20of%20Life', true], ['genre::Shounen', true], ['genre::Gore', true]]);
  t('  details: entities decoded, the title not repeated in its alternatives, rating out of ten',
    [details.mangaInfo.desc, details.mangaInfo.titles, details.mangaInfo.rating, details.mangaInfo.author, details.mangaInfo.artist, details.mangaInfo.banner],
    ['One & two', ['Title 7', 'Alt Title'], 0.866, 'Ann, Bo', 'Bo', 'https://mangadot.net/banners/7.webp']);
}

// --- home page ---------------------------------------------------------------
console.log('\nhome rows:');
{
  const home = source({ section_origins: ['JP'] });
  const row = async (id, metadata) => { site.requests = []; const page = await home.getViewMoreItems(id, metadata); return { page, request: asked()[0] }; };
  const viewed = await row('most_viewed');
  t('  most viewed is a search by views, in the rows\' content types',
    [viewed.request, viewed.page.results[0].subtitle, viewed.page.metadata],
    ['/api/search?origin=JP&adult=0&page=1&sortBy=views&sortOrder=desc', '★ 8.7 • Ongoing', { page: 2 }]);
  t('  an all-time ranking is the site\'s paged section',
    (await row('top_rated', { page: 2 })).request, '/api/manga/section/top-rated?origin=JP&adult=0&page=2');
  const latest = await row('latest_updates');
  t('  latest updates is one list, with chapter count and date',
    [latest.request, latest.page.results[0].subtitle, latest.page.metadata],
    ['/api/manga/section?id=latest_updates&origin=JP&adult=0&limit=100', '12 Chapters • ★ 8.7', undefined]);
  home.settings.set('time_range', 'weekly');
  const weekly = await row('most_tracked');
  t('  with a time range, a ranked row is the site\'s list for that span',
    [weekly.request, weekly.page.results[0].subtitle, weekly.page.metadata],
    ['/api/manga/section?id=most_tracked&origin=JP&adult=0&range=weekly&limit=100', '★ 8.7', undefined]);
  t('  most viewed has no span on the site, so it stays paged', (await row('most_viewed')).page.metadata, { page: 2 });
  home.settings.set('visible_sections', ['latest_updates', 'top_rated']);
  t('  only the rows chosen are shown, in the site\'s order',
    (await home.getDiscoverSections()).map(({ id }) => id), ['top_rated', 'latest_updates']);
}

// --- chapters and pages ------------------------------------------------------
console.log('\nchapters and pages:');
{
  const reader = source();
  await reader.getMangaDetails('7');
  const list = await reader.getChapters('7');
  t('  volumes in turn, a volume restarting at 1 after the one before, unassigned newest',
    [...list].sort((a, b) => a.sortingIndex - b.sortingIndex).map(({ id, volume, chapNum }) => `${id}:v${volume}c${chapNum}`),
    ['101:v1c1', '102:v1c2', '105:v2c1', '110:vundefinedc3']);
  t('  the group falls back to the scanlator, titles and dates are kept',
    list.filter(({ id }) => id === '102' || id === '105').map(({ group, name, time }) => [group, name, time.toISOString()]),
    [['Solo TL', 'Chapter 2', '2026-06-01T12:34:56.000Z'], ['Night Owls', 'A New Start', '2026-06-01T12:34:56.000Z']]);

  site.requests = [];
  const pages = await reader.getChapterDetails('7', '101');
  t('  a chapter\'s pages, with the series as referer',
    [asked(), site.requests[0].headers.referer, pages.pages],
    [['/api/chapters/101/images'], 'https://mangadot.net/manga/7', ['https://mangadot.net/api/chapters/101/images/1.webp', 'https://cdn.example/2.webp']]);
  site.requests = [];
  await reader.getChapterDetails('7', '105');
  t('  a trusted upload is read from the uploads', asked(), ['/api/uploads/105/images']);

  site.requests = [];
  await source().getChapterDetails('7', '105');
  t('  after a restart the chapter list is read first, so the upload is still known',
    asked(), ['/api/manga/7', '/api/manga/7/chapters/list', '/api/uploads/105/images']);

  t('  timestamps as the API writes them', [
    parseSiteDate('2026-06-01 12:34:56.123456+00')?.toISOString(),
    parseSiteDate('2026-06-01T12:34:56Z')?.toISOString(),
    parseSiteDate('2026-06-01 12:34:56')?.toISOString(),
    parseSiteDate('not a date'),
  ], ['2026-06-01T12:34:56.000Z', '2026-06-01T12:34:56.000Z', '2026-06-01T12:34:56.000Z', undefined]);
}

// --- Cloudflare ----------------------------------------------------------------
console.log('\nCloudflare:');
{
  const blocked = source();
  site.mode = 'challenge';
  const error = await rejects(() => search(blocked));
  t('  a challenge is a bypass prompt, not an error or an empty list', error instanceof CloudflareError, true);
  t('  and the cloud button opens the site, where it can be cleared',
    (await blocked.getCloudflareBypassRequestAsync()).url, 'https://mangadot.net/');
  site.mode = 'html';
  t('  a challenge page without its header is one too', (await rejects(() => search(blocked))) instanceof CloudflareError, true);
  site.mode = 'normal';
  t('  every request carries the app\'s user agent, which the clearance is tied to',
    site.requests.every(({ headers }) => headers['user-agent'] === 'Test'), true);
}

rmSync(out, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
