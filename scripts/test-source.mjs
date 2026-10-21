/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const [name, ...extra] = process.argv.slice(2);
if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name) || extra.length) {
  throw new Error('Usage: npm run test:live -- <Source>, after npm run verify');
}
assert.equal(require('@paperback/toolchain/package.json').version, '0.8.7');
const manifest = JSON.parse(readFileSync('bundles/versioning.json', 'utf8'));
assert(manifest.sources.some(source => source?.id === name), `Unknown or unbuilt source: ${name}`);

// Pinning keeps this adapter on the official 0.8 test implementation.
const { SourceTester } = require('@paperback/toolchain/dist/source-tester.js');
const cheerio = require('cheerio');
const Source = require(path.resolve('bundles', name, 'source.js')).Sources[name];
const dataFile = path.join('src', name, `${name}.test.json`);
const data = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : {};
const source = new Source(cheerio);
const tester = new SourceTester(path.resolve('bundles'));
let completed = 0;
let failed = 0;
const timeout = setTimeout(() => {
  console.error('FAIL  Live suite exceeded 120 seconds; site/device behavior remains unverified.');
  process.exit(1);
}, 120_000);

try {
  // The CLI's local path assumes emitting tsc output; this repo uses noEmit.
  // Await its actual cases against the bundle and propagate every failure.
  await tester.runTests(async (label, run) => {
    completed += 1;
    try {
      await run();
      console.log(`PASS  ${label}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, data, source);
  assert(completed > 0, 'No official tests ran');
  console.log(`${name}: ${completed - failed} passed, ${failed} failed. Node checks do not prove device rendering.`);
  if (failed) process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
