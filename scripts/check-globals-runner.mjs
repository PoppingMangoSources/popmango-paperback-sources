/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const runner = path.resolve('scripts/check-globals.mjs');
const root = mkdtempSync(path.join(tmpdir(), 'paperback-globals-'));
try {
  mkdirSync(path.join(root, 'bundles', 'Fixture'), { recursive: true });
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(path.join(root, 'scripts', 'node-only.mjs'), "Buffer.from('allowed in Node');");
  const rejected = [
    "Buffer.from('unsafe')",
    'Buffer.alloc(8)',
    'new Buffer(8)',
    "globalThis.Buffer.from('unsafe')",
    "Buffer['from']('unsafe')",
    "globalThis['Buffer'].from('unsafe')",
    'const Bytes = Buffer; Bytes.from(data)',
    'const {from} = Buffer; from(data)',
    'exports.value = {Buffer}',
    'exports.value = `${Buffer}`',
    'const codec = {Buffer: 0}; const Bytes = Buffer;',
    'function other(Buffer) {} Buffer.from(data)',
  ];
  const accepted = [
    'exports.value = new Uint8Array(8)',
    "exports.value = 'Use Buffer.from only in Node tests'",
    '// Buffer.from(data)\nexports.value = 1',
    '/* const Bytes = Buffer; */ exports.value = 1',
    'exports.value = /Buffer.from/g',
    'exports.value = `Use Buffer.from only in Node tests`',
    'codec.Buffer.from(data)',
    "codec['Buffer'].from(data)",
    'exports.value = {Buffer: 1}',
    'function read(Buffer) { return Buffer.from(data); }',
    'const Buffer = codec; exports.value = {Buffer};',
    'function read({Buffer}) { return Buffer.from(data); }',
    'function read(globalThis) { return globalThis.Buffer.from(data); }',
    'Buffer: for (;;) { break Buffer; }',
  ];
  for (const [forbidden, code] of [
    ...rejected.map(code => [true, code]),
    ...accepted.map(code => [false, code]),
  ]) {
    writeFileSync(path.join(root, 'bundles', 'Fixture', 'source.js'), code);
    const result = spawnSync(process.execPath, [runner, '--skip-bundle'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, forbidden ? 1 : 0, code + '\n' + result.stdout + result.stderr);
    assert.match(result.stdout, forbidden ? /FAIL  Fixture: uses Buffer/ : /ok    none/);
  }
  console.log('Verified free Buffer references, aliases, destructuring, and globalThis access; allowed text, object properties, local bindings and Node-only scripts.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
