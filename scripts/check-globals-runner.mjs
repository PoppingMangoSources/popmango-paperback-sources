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
    'const root = globalThis; root.Buffer.from(data)',
    "const root = globalThis; const other = (root); other['Buffer'].from(data)",
    'const root = globalThis; function read() { return root.Buffer; }',
    'const {Buffer: Bytes} = Buffer;',
    'var root = globalThis; root.Buffer.from(data)',
    'let root = globalThis; const other = root; other.Buffer.from(data)',
    'const {Buffer: Bytes} = globalThis; Bytes.from(data)',
    'const {Buffer} = globalThis; Buffer.from(data)',
    "let root = globalThis; const {['Buffer']: Bytes} = root; Bytes.from(data)",
    'let root = globalThis; root.Buffer.from(data); root = codec',
    'let root; root = globalThis; root.Buffer.from(data)',
    'let root = globalThis; const saved = root; root = codec; saved.Buffer.from(data)',
    'let root = globalThis; if (flag) root = codec; root.Buffer.from(data)',
    'let root = codec; if (flag) root = globalThis; root.Buffer.from(data)',
    'global.Buffer.from(data)',
    "global['Buffer'].from(data)",
    'var root = global; root.Buffer.from(data)',
    'let Bytes; ({Buffer: Bytes} = globalThis); Bytes.from(data)',
    'const {Buffer: Bytes = fallback} = globalThis;',
    'const root = flag ? globalThis : codec; root.Buffer.from(data)',
    'const root = codec || globalThis; root.Buffer.from(data)',
    "globalThis[('Buffer')].from(data)",
    'typeof Buffer; Buffer.from(data)',
    'typeof Buffer.from',
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
    'function read(codec) { const {Buffer: Bytes} = codec; return Bytes; }',
    'function read({Buffer: Bytes}) { return Bytes; }',
    'const root = codec; root.Buffer.from(data)',
    'function read(globalThis) { const root = globalThis; return root.Buffer; }',
    'const root = globalThis; function read(root) { return root.Buffer; }',
    'const first = second; const second = first; first.Buffer.from(data)',
    'let root = globalThis; root = codec; root.Buffer.from(data)',
    'var root = globalThis; ({root} = codec); root.Buffer.from(data)',
    'let root = globalThis; [root] = codecs; root.Buffer.from(data)',
    'let root = globalThis; for (root of codecs) { root.Buffer.from(data); }',
    'function read(globalThis) { const {Buffer: Bytes} = globalThis; return Bytes; }',
    'const root = codec; const {Buffer: Bytes} = root;',
    "const Buffer = 'safe'; const {[Buffer]: Bytes} = globalThis;",
    'function read(globalThis) { return globalThis.Buffer.from(data); }',
    'Buffer: for (;;) { break Buffer; }',
    "exports.hasBuffer = typeof Buffer !== 'undefined'",
    "exports.hasBuffer = typeof (Buffer) !== 'undefined'",
    'function read(global) { return global.Buffer.from(data); }',
    'const global = codec; const root = global; root.Buffer.from(data)',
    'let Bytes; ({Buffer: Bytes} = codec); Bytes.from(data)',
    'let root = codec; const saved = root; root = globalThis; saved.Buffer.from(data)',
    'const root = globalThis; { const root = codec; root.Buffer.from(data); }',
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
  writeFileSync(path.join(root, 'bundles', 'Fixture', 'source.js'), 'response.rawData = App.createRawData({ byteArray: bytes });');
  const rawData = spawnSync(process.execPath, [runner, '--skip-bundle'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  assert.equal(rawData.status, 1, rawData.stdout);
  assert.match(rawData.stdout, /FAIL  Fixture: uses App\.createRawData .*returns null on 0\.8/);
  console.log('Verified free Buffer references, aliases, destructuring, and globalThis access; allowed text, object properties, local bindings and Node-only scripts; App.createRawData rejected.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
