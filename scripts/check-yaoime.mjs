/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Yaoi.me page-list crypto and chapter ordering, run on common/ and src/YaoiMe/ transpiled into tmp/.

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const cheerio = require('cheerio');
const out = path.join(repo, 'tmp', 'check-yaoime');
rmSync(out, { recursive: true, force: true });
for (const dir of ['common', 'src/YaoiMe']) {
  mkdirSync(path.join(out, dir), { recursive: true });
  for (const file of readdirSync(path.join(repo, dir)).filter(f => f.endsWith('.ts'))) {
    const js = ts.transpileModule(readFileSync(path.join(repo, dir, file), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
    writeFileSync(path.join(out, dir, file.replace(/\.ts$/, '.js')), js);
  }
}

globalThis.App = {
  createSourceStateManager: () => ({ retrieve: async () => undefined, store: async () => {} }),
  createRequestManager: options => ({ ...options, getDefaultUserAgent: async () => 'UA', schedule: async () => { throw new Error('offline'); } }),
  createRequest: r => ({ ...r }), createCookie: c => c,
};
const load = file => require(path.join(out, file));
const { sha256, aesGcmDecrypt } = load('src/YaoiMe/crypto.js');
const { decryptPageList, parseChapters, parseSealKey } = load('src/YaoiMe/parsers.js');
new (load('src/YaoiMe/YaoiMe.js').YaoiMe)(cheerio);

let fail = 0;
const t = (name, got, want) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) fail++;
  console.log(`${a === b ? 'ok  ' : 'FAIL'}  ${name}${a === b ? '' : `\n        got  ${a}\n        want ${b}`}`);
};
const hex = bytes => Buffer.from(bytes).toString('hex');

// Lengths around the 55/56/64-byte padding boundaries
for (const length of [0, 3, 55, 56, 63, 64, 65, 1000]) {
  const data = randomBytes(length);
  t(`sha256 of ${length} bytes`, hex(sha256(new Uint8Array(data))), createHash('sha256').update(data).digest('hex'));
}

for (const length of [1, 16, 33, 4096]) {
  const key = randomBytes(32), iv = randomBytes(12), plain = randomBytes(length);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  t(`AES-GCM decrypt of ${length} bytes`, hex(aesGcmDecrypt(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(sealed))), hex(plain));
}

// The site's layout: base64url(salt || iv || ciphertext || tag), keyed by SHA-256(seed || salt)
const seed = randomBytes(32), salt = randomBytes(16), iv = randomBytes(12);
const manifest = JSON.stringify({ p: ['hash-a', 'hash-b', ''], n: 3, s: 1 });
const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(Buffer.concat([seed, salt])).digest(), iv);
const sealed = Buffer.concat([salt, iv, cipher.update(manifest), cipher.final(), cipher.getAuthTag()]).toString('base64url');
const attempt = run => { try { return run(); } catch (error) { return String(error); } };
t('page list decrypts with the right key', attempt(() => decryptPageList(sealed, hex(seed))), ['hash-a', 'hash-b']);
let threw = false;
try { decryptPageList(sealed, hex(randomBytes(32))); } catch { threw = true; }
t('page list with a wrong key throws', threw, true);

const mask = [...randomBytes(32)];
const script = `"use strict";var m=[${mask.join(',')}];e.s(["sealKey",0,()=>r([${[...seed].map((b, i) => b ^ mask[i]).join(',')}].map((n,i)=>n^m[i]))])`;
t('seal key is unmasked from the script', parseSealKey(script), hex(seed));

const group = (label, num, extra = {}) => ({ label, num, numReal: 1, createdAt: 1_700_000_000_000, variants: [{ id: Math.round(num * 10) + 1, s: 1, lang: 'en' }], ...extra });
const groups = [
  group('Ch.3', 3, { variants: [{ id: 31, s: 1, lang: 'en', b: 21_306_384 }, { id: 32, s: 2, lang: 'en' }, { id: 33, s: 1, lang: 'es' }] }),
  group('Creator\'s Note', 70, { numReal: 0, extra: true }),
  group('Ch.2.5', 2.5, { extra: true }),
  group('Ch.2', 2, { vol: 1 }),
  group('Ch.1', 1, { vol: 1, variants: [{ id: 11, s: 1, lang: 'en', d: 1 }, { id: 12, s: 2, lang: 'en' }] }),
];
const page = cheerio.load(`<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ groups, sources: { 1: 'alpha', 2: 'beta2026' } }))}])</script>`);
const row = c => `${c.sortingIndex}:${c.chapNum}${c.volume ? `v${c.volume}` : ''}:${c.chapterId}:${c.group ?? ''}`;
const chapters = (options = {}) => parseChapters(page, {}, { languages: ['en'], dedupe: false, showSize: false, sources: [], sourcesOnly: false, ...options });
t('chapters follow the site order with extras numbered 0', chapters().map(row), [
  '1:1v1:/chapter/1/11:Alpha', '2:1v1:/chapter/2/12:Beta2026', '3:2v1:/chapter/1/21:Alpha', '4:2.5:/chapter/1/26:Alpha',
  '5:0:/chapter/1/701:Alpha', '6:3:/chapter/1/31:Alpha', '7:3:/chapter/2/32:Beta2026',
]);
t('dedupe keeps one upload per chapter and skips duplicates', chapters({ dedupe: true }).map(row), [
  '1:1v1:/chapter/2/12:Beta2026', '2:2v1:/chapter/1/21:Alpha', '3:3:/chapter/1/31:Alpha',
]);
t('listed upload sources are hidden, matching longer names', chapters({ sources: ['Beta'] }).map(c => c.chapterId),
  ['/chapter/1/11', '/chapter/1/21', '/chapter/1/26', '/chapter/1/701', '/chapter/1/31']);
t('only the listed upload sources are shown', chapters({ sources: ['beta 2026'], sourcesOnly: true }).map(c => c.chapterId),
  ['/chapter/2/12', '/chapter/2/32']);
t('dedupe picks from the sources left', chapters({ dedupe: true, sources: ['alpha'] }).map(row),
  ['1:1v1:/chapter/2/12:Beta2026', '2:3:/chapter/2/32:Beta2026']);
t('upload size is added to the title', chapters({ showSize: true }).filter(c => c.title).map(c => c.title),
  ["Creator's Note", '21.3 MB']);
t('hiding every source says so', attempt(() => chapters({ sources: ['alpha', 'beta'] })),
  'Error: Every upload of this title comes from a source your Upload sources setting hides.');

rmSync(out, { recursive: true, force: true });
if (fail) {
  console.error(`${fail} Yaoi.me check(s) failed.`);
  process.exit(1);
}
console.log('Yaoi.me checks passed.');
