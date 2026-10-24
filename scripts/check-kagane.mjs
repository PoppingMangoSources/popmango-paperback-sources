/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Exercises Kagane's page re-signing against the real source files: common/
// and src/Kagane/ are transpiled into tmp/, and the site is a stub that counts
// what it is asked for.

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

// The site: the front page, integrity tokens and reader sessions, each counted.
const asked = { front: 0, integrity: 0, reader: 0 };
let readerExp = 0;
let readerFiles = FILES;
const reply = (status, body) => ({ status, headers: { 'content-type': 'application/json' }, data: JSON.stringify(body), rawData: undefined });
const schedule = async request => {
  await new Promise(resolve => setImmediate(resolve));
  if (request.url === 'https://kagane.cx/') { asked.front++; return reply(200, {}); }
  if (request.url.endsWith('/api/integrity')) { asked.integrity++; return reply(200, { token: 'integrity', exp: Math.floor(Date.now() / 1000) + 300 }); }
  if (/\/api\/v2\/books\//.test(request.url)) {
    asked.reader++;
    return reply(200, {
      access_token: jwt(readerExp), cache_url: 'https://akari.kstatic.to',
      manifest: { pages: readerFiles.map((file, i) => ({ page_no: i + 1, page_id: file.split('.')[0], ext: file.split('.')[1] })) },
    });
  }
  throw new Error(`unexpected request ${request.url}`);
};
globalThis.App = {
  createSourceStateManager: () => ({ retrieve: async () => undefined, store: async () => {} }),
  createRequestManager: options => ({ ...options, getDefaultUserAgent: async () => 'UA', schedule }),
  createRequest: r => ({ ...r }), createCookie: c => c,
};
const load = file => require(path.join(out, file));
const { freshPageUrl, tokenExpiry, pageUrl, KaganeInterceptor } = load('src/Kagane/network.js');
new (load('src/Kagane/Kagane.js').Kagane)(require('cheerio'));

let fail = 0;
const t = (name, got, want) => { const ok = got === want; if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${got}\n        want ${want}`}`); };
const reset = () => { for (const key of Object.keys(asked)) asked[key] = 0; };
const site = 'https://kagane.cx';
const now = Date.now();
const tokenOf = url => new URL(url).searchParams.get('token');

console.log('A reader token says when it ends:');
t('  expiry read from its claims', tokenExpiry(jwt(now + 600_000)), Math.floor((now + 600_000) / 1000) * 1000);
t('  a token that is not a JWT is unreadable', tokenExpiry('opaque'), undefined);

console.log('\nA page whose token is still good is left alone:');
const good = pageUrl('https://akari.kstatic.to', CHAPTER, FILES[0], jwt(now + 600_000));
reset();
t('  same address', await freshPageUrl(site, good), good);
t('  nothing asked of the site', asked.reader + asked.integrity, 0);
t('  an address that is not a page is untouched', await freshPageUrl(site, `${site}/api/v2/series/x`), `${site}/api/v2/series/x`);

console.log('\nPages past their token are signed again, once for the whole chapter:');
const stale = FILES.map(file => pageUrl('https://akari.kstatic.to', CHAPTER, file, jwt(now - 1_000)));
readerExp = now + 20 * 60_000;
reset();
const fresh = await Promise.all([...stale, ...stale].map(url => freshPageUrl(site, url)));
t('  one reader session for four pages', asked.reader, 1);
t('  one integrity token', asked.integrity, 1);
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
const interceptor = new KaganeInterceptor(() => 'kagane.cx');
const request = await interceptor.interceptRequest({ url: stale[1], method: 'GET', headers: {}, cookies: {} });
t('  the page request goes out re-signed', tokenOf(request.url), jwt(readerExp));
t('  with the site as referer', request.headers.referer, 'https://kagane.cx/');
const failing = pageUrl('https://akari.kstatic.to', '01a11fa7-75e7-7369-a117-879a61b2b266', FILES[1], jwt(now - 1_000));
readerFiles = [];
const unchanged = await interceptor.interceptRequest({ url: failing, method: 'GET', headers: {}, cookies: {} });
t('  a failed renewal sends the page as it was', unchanged.url, failing);
const foreign = 'https://example.com/api/v2/books/page/' + CHAPTER + '/' + FILES[0] + '?token=' + jwt(now - 1_000);
t('  a host it does not trust is never re-signed', (await interceptor.interceptRequest({ url: foreign, method: 'GET', headers: {}, cookies: {} })).url, foreign);

rmSync(out, { recursive: true, force: true });
if (fail) { console.error(`\n${fail} failed`); process.exit(1); }
console.log('\nall passed');
