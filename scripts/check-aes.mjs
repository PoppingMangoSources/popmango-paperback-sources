/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import crypto from 'node:crypto';

// Compiled from the real src/Mangago/aes.ts, so this tests the shipped code.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const out = mkdtempSync(path.join(tmpdir(), 'aes-check-'));
execFileSync('npx', ['tsc', 'src/Mangago/aes.ts', '--outDir', out,
  '--module', 'esnext', '--target', 'es2019', '--moduleResolution', 'bundler', '--strict', 'false'],
  { stdio: 'inherit' });
const { aesCbcDecrypt, stripZeroPadding } = await import(path.join(out, 'aes.js'));

const hex = h => Uint8Array.from(Buffer.from(h,'hex'));
let fail = 0;
const t = (name, got, want) => { const ok = got === want; if (!ok) fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${name}${ok?'':`\n        got  ${got}\n        want ${want}`}`); };

console.log('NIST FIPS-197 known-answer vectors (single block, zero IV = ECB):');
t('  AES-128',
  Buffer.from(aesCbcDecrypt(hex('69c4e0d86a7b0430d8cdb78070b4c55a'),
    hex('000102030405060708090a0b0c0d0e0f'), new Uint8Array(16))).toString('hex'),
  '00112233445566778899aabbccddeeff');
t('  AES-192',
  Buffer.from(aesCbcDecrypt(hex('dda97ca4864cdfe06eaf70a0ec0d7191'),
    hex('000102030405060708090a0b0c0d0e0f1011121314151617'), new Uint8Array(16))).toString('hex'),
  '00112233445566778899aabbccddeeff');
t('  AES-256',
  Buffer.from(aesCbcDecrypt(hex('8ea2b7ca516745bfeafc49904b496089'),
    hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'), new Uint8Array(16))).toString('hex'),
  '00112233445566778899aabbccddeeff');

console.log('\nNIST SP 800-38A CBC vector (real IV, multi-block):');
t('  AES-128-CBC 4 blocks',
  Buffer.from(aesCbcDecrypt(
    hex('7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b273bed6b8e3c1743b7116e69e222295163ff1caa1681fac09120eca307586e1a7'),
    hex('2b7e151628aed2a6abf7158809cf4f3c'), hex('000102030405060708090a0b0c0d0e0f'))).toString('hex'),
  '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710');

console.log('\nCross-check against Node crypto (200 random cases, all key sizes):');
let mismatches = 0;
for (let i = 0; i < 200; i++) {
  const bits = [16,24,32][i % 3];
  const key = crypto.randomBytes(bits), iv = crypto.randomBytes(16);
  const blocks = 1 + (i % 12);
  const plain = crypto.randomBytes(blocks * 16);
  const c = crypto.createCipheriv(`aes-${bits*8}-cbc`, key, iv); c.setAutoPadding(false);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  const mine = Buffer.from(aesCbcDecrypt(new Uint8Array(ct), new Uint8Array(key), new Uint8Array(iv)));
  if (!mine.equals(plain)) mismatches++;
}
t('  200/200 random round-trips match', mismatches, 0);

console.log('\nzero-padding strip and input guards:');
t('  strips trailing zeros', Buffer.from(stripZeroPadding(Uint8Array.from([65,66,0,0,0]))).toString(), 'AB');
t('  leaves interior zeros', Buffer.from(stripZeroPadding(Uint8Array.from([65,0,66]))).toString(), 'A\0B');
const rejects = (fn) => { try { fn(); return false; } catch { return true; } };
t('  rejects a non-block-aligned message', rejects(()=>aesCbcDecrypt(new Uint8Array(17), new Uint8Array(16), new Uint8Array(16))), true);
t('  rejects a bad IV length', rejects(()=>aesCbcDecrypt(new Uint8Array(16), new Uint8Array(16), new Uint8Array(8))), true);
t('  rejects a bad key length', rejects(()=>aesCbcDecrypt(new Uint8Array(16), new Uint8Array(20), new Uint8Array(16))), true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
