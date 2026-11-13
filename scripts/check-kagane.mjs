/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Kagane page re-signing, run on common/ and src/Kagane/ transpiled into tmp/ against a counting site stub.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const out = path.join(repo, 'tmp', 'check-kagane');
rmSync(out, { recursive: true, force: true });
for (const dir of ['common', 'src/Kagane']) {
  mkdirSync(path.join(out, dir), { recursive: true });
  for (const file of readdirSync(path.join(repo, dir)).filter(f => f.endsWith('.ts'))) {
    const js = ts.transpileModule(readFileSync(path.join(repo, dir, file), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
    writeFileSync(path.join(out, dir, file.replace(/\.ts$/, '.js')), js);
  }
}

const CHAPTER = '01a11fa7-75e7-7369-a117-879a61b2b264';
const FILES = ['01a11fa7-0000-7000-8000-000000000001.jxl', '01a11fa7-0000-7000-8000-000000000002.avif'];
const jwt = exp => ['e30', Buffer.from(JSON.stringify({ book_id: CHAPTER, exp: Math.floor(exp / 1000) })).toString('base64url'), 'sig'].join('.');

const asked = { front: 0, integrity: 0, reader: 0, tags: 0, genres: 0, sources: 0 };
let readerExp = 0;
let readerFiles = FILES;
let refuseIntegrity = 0;
let refuseReader = 0;
let readerFailure;
let searchBody;
const reply = (status, body) => ({ status, headers: { 'content-type': 'application/json' }, data: JSON.stringify(body), rawData: undefined });
const schedule = async request => {
  await new Promise(resolve => setImmediate(resolve));
  if (request.url === 'https://kagane.moe/') { asked.front++; return reply(200, {}); }
  if (request.url.endsWith('/api/integrity')) {
    asked.integrity++;
    if (refuseIntegrity > 0) { refuseIntegrity--; return reply(403, { error: 'no session' }); }
    return reply(200, { token: 'integrity', exp: Math.floor(Date.now() / 1000) + 300 });
  }
  if (/\/api\/v2\/books\//.test(request.url)) {
    asked.reader++;
    if (readerFailure) throw readerFailure;
    if (refuseReader > 0) { refuseReader--; return reply(403, { error: 'stale token' }); }
    return reply(200, {
      access_token: jwt(readerExp), cache_url: 'https://akari.kstatic.to',
      manifest: { pages: readerFiles.map((file, i) => ({ page_no: i + 1, page_id: file.split('.')[0], ext: file.split('.')[1] })) },
    });
  }
  // Case variants share a name, as on the site
  if (request.url.endsWith('/api/v2/tags/list')) {
    asked.tags++;
    return reply(200, [{ id: 't1', tag_name: 'Gore' }, { id: 't2', tag_name: 'gore' }, { id: 't3', tag_name: 'Isekai' }, { id: 't4', tag_name: 'Harem' }]);
  }
  if (request.url.endsWith('/api/v2/genres/list')) {
    asked.genres++;
    return reply(200, [{ id: 'g1', genre_name: 'Action', genre_type: 'genre', created_at: 'unused' }]);
  }
  if (request.url.endsWith('/api/v2/sources/list')) {
    asked.sources++;
    return reply(200, { sources: [{ source_id: 's1', source_type: 'Official', title: 'Publisher', created_at: 'unused' }] });
  }
  if (request.url.includes('/api/v2/search/series')) { searchBody = JSON.parse(request.data); return reply(200, { content: [], last: true }); }
  throw new Error(`unexpected request ${request.url}`);
};
// One store for every instance, so a fresh load below is the app after a restart.
const state = new Map();
const managers = [];
globalThis.App = {
  createSourceStateManager: () => ({ retrieve: async key => state.get(key), store: async (key, value) => { state.set(key, value); } }),
  createRequestManager: options => { managers.push(options.requestsPerSecond); return { ...options, getDefaultUserAgent: async () => 'UA', schedule }; },
  createRequest: r => ({ ...r }), createCookie: c => c,
  createPagedResults: r => r, createPartialSourceManga: r => r, createTagSection: r => r, createTag: r => r,
};
const load = file => require(path.join(out, file));
const { freshPageUrl, tokenExpiry, pageUrl, KaganeInterceptor } = load('src/Kagane/network.js');
new (load('src/Kagane/Kagane.js').Kagane)(require('cheerio'));
const requestRates = [...managers];
// Module state starts over, as when the app starts the source again; the store survives.
const restarted = () => {
  for (const key of Object.keys(require.cache)) if (key.startsWith(out)) delete require.cache[key];
  return new (load('src/Kagane/Kagane.js').Kagane)(require('cheerio'));
};

let fail = 0;
const t = (name, got, want) => { const ok = got === want; if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${got}\n        want ${want}`}`); };
const reset = () => { for (const key of Object.keys(asked)) asked[key] = 0; };
const site = 'https://kagane.moe';
const now = Date.now();
const tokenOf = url => new URL(url).searchParams.get('token');

console.log('A reader token says when it ends:');
t('  expiry read from its claims', tokenExpiry(jwt(now + 600_000)), Math.floor((now + 600_000) / 1000) * 1000);
t('  a token that is not a JWT is unreadable', tokenExpiry('opaque'), undefined);

console.log('\nA page whose token is still good is left alone:');
const good = pageUrl('https://akari.kstatic.to', CHAPTER, FILES[0], jwt(now + 600_000));
reset();
t('  current page path includes original quality', new URL(good).pathname, '/api/v2/books/page/original/' + CHAPTER + '/' + FILES[0]);
t('  image quality is not a query parameter', new URL(good).searchParams.has('is_datasaver'), false);
t('  same address', await freshPageUrl(site, good), good);
const legacy = `https://akari.kstatic.to/api/v2/books/page/${CHAPTER}/${FILES[0]}?token=${jwt(now + 600_000)}&is_datasaver=false`;
t('  an unexpired legacy page is migrated without a token request', await freshPageUrl(site, legacy), good);
t('  nothing asked of the site', asked.reader + asked.integrity, 0);
t('  an address that is not a page is untouched', await freshPageUrl(site, `${site}/api/v2/series/x`), `${site}/api/v2/series/x`);

console.log('\nPages past their token are signed again, once for the whole chapter:');
const stale = FILES.map(file => pageUrl('https://akari.kstatic.to', CHAPTER, file, jwt(now - 1_000)));
readerExp = now + 20 * 60_000;
reset();
const fresh = await Promise.all([...stale, ...stale].map(url => freshPageUrl(site, url)));
t('  one reader session for four pages', asked.reader, 1);
t('  one integrity token', asked.integrity, 1);
t('  asked for directly, without the 1.3 MB front page', asked.front, 0);
t('  every page carries the new token', fresh.every(url => tokenOf(url) === jwt(readerExp)), true);
t('  each page keeps its own file', fresh.map(url => new URL(url).pathname.split('/').pop()).join(), [...FILES, ...FILES].join());
reset();
await freshPageUrl(site, stale[0]);
t('  a later page reuses the renewal', asked.reader, 0);

console.log('\nA token about to end counts as ended:');
reset();
t('  ten seconds left is renewed', tokenOf(await freshPageUrl(site, pageUrl(site, CHAPTER, FILES[0], jwt(now + 10_000)))), jwt(readerExp));

console.log('\nA renewal that cannot help:');
readerFiles = [FILES[0]];
const otherChapter = pageUrl('https://akari.kstatic.to', '01a11fa7-75e7-7369-a117-879a61b2b265', FILES[1], jwt(now - 1_000));
let message = '';
try { await freshPageUrl(site, otherChapter); } catch (error) { message = error.message; }
t('  a page the new session no longer lists is an error', message, "Kagane changed this chapter's pages. Reopen the chapter.");

console.log('\nThrough the interceptor:');
readerFiles = FILES;
const interceptor = new KaganeInterceptor(() => 'kagane.moe');
const request = await interceptor.interceptRequest({ url: stale[1], method: 'GET', headers: {}, cookies: {} });
t('  the page request goes out re-signed', tokenOf(request.url), jwt(readerExp));
t('  with the site as referer', request.headers.referer, 'https://kagane.moe/');
const failing = pageUrl('https://akari.kstatic.to', '01a11fa7-75e7-7369-a117-879a61b2b266', FILES[1], jwt(now - 1_000));
readerFiles = [];
const unchanged = await interceptor.interceptRequest({ url: failing, method: 'GET', headers: {}, cookies: {} });
t('  a failed renewal sends the page as it was', unchanged.url, failing);
const foreign = 'https://example.com/api/v2/books/page/' + CHAPTER + '/' + FILES[0] + '?token=' + jwt(now - 1_000);
t('  a host it does not trust is never re-signed', (await interceptor.interceptRequest({ url: foreign, method: 'GET', headers: {}, cookies: {} })).url, foreign);

console.log('\nA refused integrity token:');
const refusedChapter = '01a11fa7-75e7-7369-a117-879a61b2b267';
readerFiles = FILES;
refuseReader = 1;
refuseIntegrity = 1;
reset();
await freshPageUrl(site, pageUrl('https://akari.kstatic.to', refusedChapter, FILES[0], jwt(now - 1_000)));
t('  loads the front page once and asks again', [asked.front, asked.integrity].join(), '1,2');

console.log('\nCloudflare during image-token renewal:');
const { CloudflareError } = load('common/Cloudflare.js');
readerFailure = new CloudflareError({ url: `${site}/`, method: 'GET', headers: { 'user-agent': 'UA' } });
let raised;
try {
  await interceptor.interceptRequest({
    url: pageUrl('https://akari.kstatic.to', '01a11fa7-75e7-7369-a117-879a61b2b268', FILES[0], jwt(now - 1_000)),
    method: 'GET', headers: {}, cookies: {},
  });
} catch (error) { raised = error; }
t('  a real verification request is propagated instead of hidden', raised, readerFailure);
readerFailure = undefined;

console.log('\nSelected mirror and verification:');
const { MIRRORS } = load('src/Kagane/models.js');
t('  only moe and org are offered', MIRRORS.join(), 'kagane.moe,kagane.org');
for (const host of [undefined, 'kagane.cx', 'kagane.si', 'kagane.net', 'kagane.org']) {
  state.delete('kagane_mirror');
  if (host !== undefined) state.set('kagane_mirror', host);
  const source = restarted();
  const bypass = await source.getCloudflareBypassRequestAsync();
  const expected = host === 'kagane.org' ? host : 'kagane.moe';
  t(`  ${host ?? 'unset'} verifies on the selected supported mirror`, bypass.url, `https://${expected}/`);
  t('  bypass uses the same browser identity as requests', bypass.headers['user-agent'], 'UA');
  t('  sharing uses that mirror too', source.getMangaShareUrl('series'), `https://${expected}/series/series`);
}
state.delete('kagane_mirror');

console.log('\nRequest rates:');
t('  page images at 6 a second, the site\'s API at 3', requestRates.join(), '6,3');

console.log('\nHidden tags typed in the settings:');
const browse = source => source.getSearchResults({ title: '', includedTags: [], excludedTags: [], parameters: {} }, undefined);
let kagane = restarted();
kagane.settings.set('kagane_hidden_tags', 'Gore, isekai');
reset();
await browse(kagane);
t('  resolve through the tag list once', asked.tags, 1);
t('  every case variant is ruled out', searchBody.tags.exclude.join(), 't1,t2,t3');
reset();
await browse(kagane);
await browse(restarted());
t('  and are not looked up again, even after a restart', asked.tags, 0);
kagane = restarted();
kagane.settings.set('kagane_hidden_tags', 'Harem');
reset();
await browse(kagane);
t('  changing them looks them up again', [asked.tags, searchBody.tags.exclude.join()].join(' '), '1 t4');
state.set('kagane_hidden_tag_ids', { ...state.get('kagane_hidden_tag_ids'), at: Date.now() - 25 * 60 * 60 * 1000 });
reset();
await browse(restarted());
t('  and a day later they are looked up again', asked.tags, 1);
kagane = restarted();
kagane.settings.set('kagane_hidden_tags', 'Nope');
message = '';
try { await browse(kagane); } catch (error) { message = error.message; }
t('  a name the site lacks is still reported', message, 'Kagane has no tag named Nope.');

console.log('\nThe filter sheet\'s lists:');
reset();
await restarted().getSearchTags();
t('  genres and upload sources are fetched once', [asked.genres, asked.sources].join(), '1,1');
reset();
await restarted().getSearchTags();
t('  and kept across a restart', [asked.genres, asked.sources].join(), '0,0');
t('  keeping only the fields used', JSON.stringify([state.get('kagane_genre_list').value, state.get('kagane_source_list').value]),
  JSON.stringify([[{ id: 'g1', genre_name: 'Action', genre_type: 'genre' }], [{ source_id: 's1', source_type: 'Official', title: 'Publisher' }]]));

rmSync(out, { recursive: true, force: true });
if (fail) { console.error(`\n${fail} failed`); process.exit(1); }
console.log('\nall passed');
