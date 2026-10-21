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
  for (const code of [
    "Buffer.from('unsafe')",
    'Buffer.alloc(8)',
    'new Buffer(8)',
    "globalThis.Buffer.from('unsafe')",
    "Buffer['from']('unsafe')",
    'exports.value = new Uint8Array(8)',
  ]) {
    writeFileSync(path.join(root, 'bundles', 'Fixture', 'source.js'), code);
    const result = spawnSync(process.execPath, [runner, '--skip-bundle'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    const forbidden = code.includes('Buffer');
    assert.equal(result.status, forbidden ? 1 : 0, result.stdout + result.stderr);
    assert.match(result.stdout, forbidden ? /FAIL  Fixture: uses Buffer/ : /ok    none/);
  }
  console.log('Verified Buffer rejection in device bundles and allowed Node-only scripts.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
