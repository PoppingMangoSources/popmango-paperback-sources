/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const out = path.join(repo, 'tmp', 'check-myreadingmanga');
rmSync(out, { recursive: true, force: true });
for (const dir of ['common', 'src/MyReadingManga']) {
  mkdirSync(path.join(out, dir), { recursive: true });
  for (const file of readdirSync(path.join(repo, dir)).filter(file => file.endsWith('.ts'))) {
    const js = ts.transpileModule(readFileSync(path.join(repo, dir, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    }).outputText;
    writeFileSync(path.join(out, dir, file.replace(/\.ts$/, '.js')), js);
  }
}

globalThis.App = { createRequest: request => request };
const { Application, CloudflareError } = require(path.join(out, 'common/index.js'));
const { MyReadingMangaInterceptor } = require(path.join(out, 'src/MyReadingManga/network.js'));
Application.bind({ getDefaultUserAgent: async () => 'Device UA' }, require('cheerio'));

const interceptor = new MyReadingMangaInterceptor();
const request = { url: 'https://myreadingmanga.info/?s=test', method: 'GET', headers: {}, cookies: {} };
const response = Object.freeze({ status: 403, headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' } });
const challenge = { text: '<title>Just a moment...</title>' };
const expectChallenge = async () => {
  await assert.rejects(() => interceptor.interceptResponse(request, response, challenge), error => {
    assert(error instanceof CloudflareError, `Retry lost the Cloudflare error: ${error.message}`);
    assert.match(error.message, /press the cloud icon/);
    assert.equal(error.request.url, 'https://myreadingmanga.info/');
    assert.equal(error.request.headers['user-agent'], 'Device UA');
    return true;
  });
};

const originalNow = Date.now;
Date.now = () => 1_800_000_000_000;
try {
  await expectChallenge();
  await expectChallenge();
  console.log('ok    an immediate retry after a dismissed or failed challenge keeps the bypass instructions');

  const cleared = { text: '<html>Site loaded</html>' };
  assert.equal(await interceptor.interceptResponse(request, { status: 200, headers: {} }, cleared), cleared);
  await expectChallenge();
  console.log('ok    a successful page does not prevent a later challenge from being retried');

  await Promise.all([expectChallenge(), expectChallenge(), expectChallenge()]);
  console.log('ok    concurrent blocked sections all retain the Cloudflare error');

  const outgoing = await interceptor.interceptRequest(request);
  assert.equal(outgoing.headers['user-agent'], 'Device UA');
  assert.equal(outgoing.headers.referer, 'https://myreadingmanga.info/');
  console.log('ok    the bypass and source requests use the same device user agent');
} finally {
  Date.now = originalNow;
}
