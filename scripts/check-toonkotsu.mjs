/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Exercises Toonkotsu's reader against the real source files: common/ and
// src/Toonkotsu/ are transpiled into tmp/ (so their packages still resolve),
// with the app's App.* factories stubbed by plain objects.

import crypto from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const out = path.join(repo, 'tmp', 'check-toonkotsu');
rmSync(out, { recursive: true, force: true });
for (const dir of ['common', 'src/Toonkotsu']) {
  mkdirSync(path.join(out, dir), { recursive: true });
  for (const file of readdirSync(path.join(repo, dir)).filter(f => f.endsWith('.ts'))) {
    const js = ts.transpileModule(readFileSync(path.join(repo, dir, file), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
    writeFileSync(path.join(out, dir, file.replace(/\.ts$/, '.js')), js);
  }
}

// The app hands back plain objects here; createByteArray/createRawData copy, as the bridge does.
const raw = bytes => ({ bytes: Uint8Array.from(bytes), get length() { return this.bytes.length; } });
globalThis.App = {
  createSourceStateManager: () => ({ retrieve: async () => undefined, store: async () => {} }),
  createRequestManager: options => ({ ...options, getDefaultUserAgent: async () => 'UA', schedule: async () => { throw new Error('offline'); } }),
  createRequest: r => ({ ...r }), createCookie: c => c,
  createByteArray: r => Uint8Array.from(r.bytes), createRawData: ({ byteArray }) => raw(byteArray),
};
const load = file => require(path.join(out, file));
const c = load('src/Toonkotsu/crypto.js');
const { parseChapterPages, parseChapters } = load('src/Toonkotsu/parsers.js');
const { ToonkotsuInterceptor } = load('src/Toonkotsu/network.js');
const { InterceptorChain, CookieStorageInterceptor } = load('common/Interceptor.js');
new (load('src/Toonkotsu/Toonkotsu.js').Toonkotsu)(require('cheerio'));

let fail = 0;
const t = (name, got, want) => { const ok = got === want; if (!ok) fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${name}${ok?'':`\n        got  ${got}\n        want ${want}`}`); };
const hex = b => Buffer.from(b).toString('hex');
const bytes = s => Uint8Array.from(Buffer.from(s));
const ctr = (bits, key, nonce, plain) => { const x = crypto.createCipheriv(`aes-${bits}-ctr`, key, Buffer.concat([nonce, Buffer.alloc(8)]));
  return Buffer.concat([x.update(plain), x.final()]); };

console.log('SHA-256 and HMAC, which 0.8 has no crypto.subtle for:');
t('  FIPS 180-2 "abc"', hex(c.sha256(bytes('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
t('  FIPS 180-2 two-block message', hex(c.sha256(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
  '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
t('  RFC 4231 HMAC case 2', hex(c.hmacSha256(bytes('Jefe'), bytes('what do ya want for nothing?'))),
  '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
let mismatches = 0;
for (let n = 0; n < 300; n++) {
  const data = crypto.randomBytes(n), key = crypto.randomBytes(n % 130);
  if (hex(c.sha256(data)) !== crypto.createHash('sha256').update(data).digest('hex')) mismatches++;
  if (hex(c.hmacSha256(key, data)) !== crypto.createHmac('sha256', key).update(data).digest('hex')) mismatches++;
}
t('  300 random lengths and keys match Node', mismatches, 0);

console.log('\nAES-CTR page decryption (8-byte nonce, then a 64-bit block counter):');
mismatches = 0;
for (let i = 0; i < 60; i++) {
  const bits = [128, 192, 256][i % 3], key = crypto.randomBytes(bits / 8), nonce = crypto.randomBytes(8);
  const plain = crypto.randomBytes([0, 1, 15, 16, 17, 1023, 4099, 16 * 600][i % 8]);
  if (!Buffer.from(c.decryptPage(new Uint8Array(ctr(bits, key, nonce, plain)), key, nonce)).equals(plain)) mismatches++;
}
t('  60 random pages, all key sizes, odd lengths, over 256 blocks', mismatches, 0);
{
  const key = crypto.randomBytes(16), nonce = crypto.randomBytes(8), plain = crypto.randomBytes(1001);
  const view = new Uint8Array(1004); view.set(ctr(128, key, nonce, plain), 3);
  t('  a view off a 4-byte boundary', Buffer.from(c.decryptPage(view.subarray(3), key, nonce)).equals(plain), true);
}

console.log('\nreader signing and page keys, against Node doing what 0.9 does with WebCrypto:');
const hmacKey = crypto.randomBytes(32), secret = 'test-secret';
const mask = crypto.createHash('sha256').update(`sign:${secret}`).digest();
const readerKey = c.deriveReaderKey({ key: Buffer.from(hmacKey.map((v, i) => v ^ mask[i % 32])).toString('base64url'), build: 'b', now: Date.now() }, secret);
t('  the served key unmasks', hex(readerKey.key), hex(hmacKey));
const [v, time, sigNonce, sig] = c.signReaderPath(readerKey, '/api/manga/chapter/1').split('.');
t('  a signature the site can verify', `${v}.${sig}`, `v1.${crypto.createHmac('sha256', hmacKey).update(`${time}.${sigNonce}./api/manga/chapter/1`).digest('base64url').slice(0, 32)}`);
const pageKey = crypto.randomBytes(16), pageNonce = crypto.randomBytes(12).toString('base64url');
const pageMask = crypto.createHmac('sha256', hmacKey).update(`page.${pageNonce}`).digest();
const wrapped = Buffer.from(pageKey.map((b, i) => b ^ pageMask[i % 32])).toString('base64url');
t('  a v1-wrapped page key unwraps', c.unwrapPageKey(readerKey, wrapped, pageNonce), pageKey.toString('base64url'));

console.log('\npage list and the interceptor, on a response where only the bytes can be set:');
const plain = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 '), crypto.randomBytes(2000)]);
const key = crypto.randomBytes(16), nonce = crypto.randomBytes(12);
const src = 'https://toonkotsu.com/pages/1.webp';
const [encrypted, untouched] = parseChapterPages({ chapter: { pages: [
  { src, k: key.toString('base64url'), n: nonce.toString('base64url') }, { src: '/pages/2.webp' }] } });
t('  an encrypted page carries its key', encrypted.startsWith(`${src}#tk=`), true);
t('  a plain page is left alone', untouched, 'https://toonkotsu.com/pages/2.webp');
const rejects = fn => { try { fn(); return false; } catch { return true; } };
const masked = { wrap: 'v1', chapter: { pages: [{ src: '/pages/3.webp', k: wrapped, n: pageNonce }] } };
t('  masked keys without a reader key are refused', rejects(() => parseChapterPages(masked)), true);
t('  masked keys are unwrapped with one', parseChapterPages(masked, readerKey)[0], `https://toonkotsu.com/pages/3.webp#tk=${pageKey.toString('base64url')}.${pageNonce}`);

// A guest cookie saved by an older build, which would shadow the app's verified session.
const stored = { retrieve: async () => ({ guest: 'stale' }), store: async () => {} };
const chain = new InterceptorChain({ cookieStorage: new CookieStorageInterceptor(stored), interceptor: new ToonkotsuInterceptor() });
// The app's own response, shaped like the 0.8 export: only rawData can be set,
// and a write to data, status, headers or request throws.
class AppResponse {
  #raw; #request;
  constructor(rawData, request) { this.#raw = rawData; this.#request = request; }
  get data() { return ''; }
  get status() { return 200; }
  get headers() { return { 'content-type': 'application/octet-stream' }; }
  get request() { return this.#request; }
  get rawData() { return this.#raw; }
  set rawData(value) { this.#raw = value; }
}
const fetchThrough = async (url, native = true) => {
  const request = await chain.interceptRequest({ url, method: 'GET', headers: {}, cookies: [{ name: 'guest', value: 'stale' }] });
  const rawData = raw(ctr(128, key, nonce.subarray(0, 8), plain));
  const response = native ? new AppResponse(rawData, request)
    : { status: 200, data: '', rawData, headers: { 'content-type': 'application/octet-stream' }, request };
  return { request, response, returned: await chain.interceptResponse(response) };
};
const first = await fetchThrough(encrypted);
t('  the page decrypts', Buffer.from(App.createByteArray(first.response.rawData)).equals(plain), true);
t('  the app gets its own response back (error 303 otherwise)', first.returned === first.response, true);
t('  the source sends no cookies of its own', first.request.cookies.length, 0);
const open = await fetchThrough(encrypted, false);
t('  a response that takes it is labelled with the image\'s type', `${open.returned === open.response} ${open.response.headers['content-type']} ${open.response.mimeType}`, 'true image/webp image/webp');
const stripped = await fetchThrough(src);
t('  the key is still found when the app drops the fragment', Buffer.from(App.createByteArray(stripped.response.rawData)).equals(plain), true);

console.log('\nupload choice:');
const series = { chapters: [
  { id: 3, n: 3, label: 'Chapter 3', group: { slug: 'a', name: 'A' }, w: 800, mb: 12, alts: [{ id: 33, group: { slug: 'b', name: 'B' }, w: 720, mb: 9 }] },
  { id: 2, n: 2, label: 'Chapter 2', group: { slug: 'a', name: 'A' }, w: 800, mb: 11, alts: [{ id: 22, group: { slug: 'a', name: 'A' }, w: 720, mb: 7 }] },
] };
const ids = (options, from = series) => parseChapters(from, { mangaId: 'x' }, { showSize: false, ...options }).map(ch => ch.chapterId).join(',');
t('  Best Quality keeps each group\'s widest', ids({ mainOnly: false }), '3,33,2');
t('  Best Quality + Deduplicate keeps the first listed', ids({ mainOnly: true }), '3,2');
t('  Smallest keeps each group\'s lightest', ids({ mainOnly: false, choice: 'smallest' }), '3,33,22');
t('  Smallest + Deduplicate keeps each chapter\'s lightest', ids({ mainOnly: true, choice: 'smallest' }), '33,22');

console.log('\nvolumes:');
// Two volumes that each start again at chapter 1, from one group: fewer
// repeated numbers than the site needs before it splits a list by volume.
const restarted = { chapters: [[2, 2], [2, 1], [1, 2], [1, 1]].map(([vol, n]) =>
  ({ id: vol * 10 + n, n, vol, label: `Chapter ${n}`, group: { slug: 'a', name: 'A' } })) };
t('  two numbers repeated across volumes stay four chapters', ids({ mainOnly: false }, restarted), '22,21,12,11');
t('  and still four with Deduplicate Chapters on', ids({ mainOnly: true }, restarted), '22,21,12,11');
t('  and with Smallest Download', ids({ mainOnly: true, choice: 'smallest' }, restarted), '22,21,12,11');

rmSync(out, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
