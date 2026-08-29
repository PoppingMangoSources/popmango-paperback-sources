/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Exercises the Mangago page-list pipeline and its URL repair against the real
// source files: they are compiled with tsc, with the shared runtime stubbed by
// Node's own equivalents, so what runs here is the code that ships.

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const out = mkdtempSync(path.join(tmpdir(), 'mangago-check-'));
const src = path.join(out, 'src');

// The sources are copied out and their one import redirected before tsc runs,
// so nothing has to resolve outside the copy and no build output can land back
// in the repository. Everything else about the files is left as it ships.
writeFileSync(path.join(out, 'stub.ts'), `
export const Application = {
  base64DecodeBytes: (v: string) => new Uint8Array(Buffer.from(v, 'base64')),
  utf8Decode: (b: Uint8Array | number[]) => Buffer.from(b).toString('utf8'),
};
`);
// urls.ts only wants the domain from models.ts, which is all it needs.
writeFileSync(path.join(out, 'models.ts'), `export const DOMAIN = "https://www.mangago.me";`);

for (const file of ['aes.ts', 'crypto.ts', 'urls.ts']) {
  writeFileSync(
    path.join(out, file),
    readFileSync(path.join('src/Mangago', file), 'utf8')
      .replace(/["']\.\.\/\.\.\/common["']/g, '"./stub"'),
  );
}

execFileSync('npx', ['tsc', path.join(out, 'aes.ts'), path.join(out, 'crypto.ts'),
  path.join(out, 'urls.ts'), path.join(out, 'stub.ts'), path.join(out, 'models.ts'),
  '--outDir', src, '--rootDir', out,
  '--module', 'esnext', '--target', 'es2020', '--moduleResolution', 'bundler',
  '--strict', 'false', '--skipLibCheck'], { stdio: 'inherit' });

// Node's module resolution wants the extension the TypeScript sources omit.
for (const file of ['crypto.js', 'urls.js']) {
  const at = path.join(src, file);
  writeFileSync(at, readFileSync(at, 'utf8').replace(/(from\s+["']\.\/[A-Za-z]+)(["'])/g, '$1.js$2'));
}
const c = await import(path.join(src, 'crypto.js'));
const u = await import(path.join(src, 'urls.js'));

let fail = 0;
const t = (name, got, want) => { const ok = got === want; if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`); };

// --- the packed chapter script -------------------------------------------
console.log('sojsonV4Decode — unpacking the chapter script:');
{
  const source = 'var key = CryptoJS.enc.Hex.parse("00ff");';
  const codes = [...source].map((ch) => ch.charCodeAt(0)).join('x');
  // The packer's preamble is 240 characters and its trailer 59.
  const packed = "['sojson.v4']" + 'P'.repeat(240 - 13) + codes + 'T'.repeat(59);
  t('  round-trips a packed script', c.sojsonV4Decode(packed), source);
  const rejects = (fn) => { try { fn(); return false; } catch { return true; } };
  t('  rejects an unpacked script', rejects(() => c.sojsonV4Decode('var key = 1;')), true);
}

console.log('\nfindHexEncodedVariable / decodeHex / extractDescrambleCols:');
{
  const js = 'var key = CryptoJS.enc.Hex.parse("00112233"); var iv = CryptoJS.enc.Hex.parse("aabb");';
  t('  finds the key', c.findHexEncodedVariable(js, 'key'), '00112233');
  t('  finds the iv', c.findHexEncodedVariable(js, 'iv'), 'aabb');
  t('  ignores a name that is not there', c.findHexEncodedVariable(js, 'salt'), undefined);
  t('  decodes hex', Buffer.from(c.decodeHex('00ff10')).toString('hex'), '00ff10');
  t('  reads the tile count', c.extractDescrambleCols('var widthnum = heightnum = 5;'), 5);
  t('  no tile count means zero', c.extractDescrambleCols('nothing here'), 0);
}

// --- the page list, end to end -------------------------------------------
console.log('\ndecodePageList — decrypt, unpad, unscramble:');
{
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const encrypt = (text) => {
    const padded = Buffer.concat([Buffer.from(text, 'utf8')]);
    const whole = Buffer.concat([padded, Buffer.alloc((16 - (padded.length % 16)) % 16)]);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(whole), cipher.final()]).toString('base64');
  };
  const keyHex = key.toString('hex');
  const ivHex = iv.toString('hex');
  // A script with no `str.charAt(` markers scrambles nothing, so the list
  // comes back exactly as it went in.
  const plainScript = 'var renImg = function(){};';

  t('  a plain list survives the round trip',
    c.decodePageList(encrypt('//a.example/1.jpg,//a.example/2.jpg'), plainScript, keyHex, ivHex, false).join('|'),
    '//a.example/1.jpg|//a.example/2.jpg');
  t('  trailing commas are dropped',
    c.decodePageList(encrypt('//a/1.jpg,,,'), plainScript, keyHex, ivHex, false).length, 1);
  t('  blanks are kept when asked for',
    c.decodePageList(encrypt('//a/1.jpg,,//a/3.jpg'), plainScript, keyHex, ivHex, true).length, 3);
  t('  blanks are dropped otherwise',
    c.decodePageList(encrypt('//a/1.jpg,,//a/3.jpg'), plainScript, keyHex, ivHex, false).length, 2);
}

console.log('\nunscramblePageList — undoing the swap the site applies:');
{
  // Apply the site's own scramble forwards, then check it comes back. The
  // swap is its own inverse per step, so the forward pass is the same loop
  // with the steps in the other order.
  const script = 'x = str.charAt(2); y = str.charAt(0);'; // positions 2 then 0
  const original = '//a/1.jpg,//a/2.jpg,//a/3.jpg';
  const keyDigits = [7, 3]; // the digits that will sit at positions 2 and 0

  const scramble = (text, key) => {
    const chars = text.split('');
    for (const step of key) {
      for (let i = chars.length - 1; i >= step; i--) {
        if (i % 2 !== 0) { const o = i - step; [chars[o], chars[i]] = [chars[i], chars[o]]; }
      }
    }
    return chars;
  };
  // The source reverses the key, so scramble in forward order to match.
  const scrambled = scramble(original, keyDigits);
  // Re-insert the key digits at the positions the script names, lowest last so
  // each splice lands where the source will look for it.
  scrambled.splice(0, 0, String(keyDigits[1]));
  scrambled.splice(2, 0, String(keyDigits[0]));

  t('  recovers the original list', c.unscramblePageList(scrambled.join(''), script), original);
  t('  a list that does not match is left alone',
    c.unscramblePageList('//a/1.jpg', 'x = str.charAt(0);'), '//a/1.jpg');
}

// --- the derived tile order ----------------------------------------------
console.log('\ngetDescramblingKey — running the site\'s own routine:');
{
  const script = [
    'var renImg = function(img,width,height,id){',
    '  var key = "";',
    '  jQuery("#x").hide();',
    '  var canvas = document.createElement("canvas");',
    '  var ctx = canvas.getContext("2d");',
    '  key = img.src.length + "a" + 3;',
    '  key = key.split("a");',
    '};',
  ].join('\n');

  t('  derives a key from the image url', c.getDescramblingKey(script, 'https://x/y'), '11a3');
  const rejects = (fn) => { try { fn(); return false; } catch { return true; } };
  t('  rejects a script with no image routine', rejects(() => c.getDescramblingKey('nothing', 'u')), true);
  t('  the dropped lines really are dropped',
    // `document` would throw if the line survived the filter.
    c.getDescramblingKey(script, 'https://x/y').includes('a'), true);
}

// --- addresses ------------------------------------------------------------
console.log('\ncanonicalReaderUrl — repairing and pinning reader addresses:');
{
  t('  a bare path gets the main host',
    u.canonicalReaderUrl('/read-manga/foo/c001/'), 'https://www.mangago.me/read-manga/foo/c001/');
  t('  a doubled host is repaired',
    u.canonicalReaderUrl('https://www.mangago.me/read-manga/x/https://www.mangago.me/read-manga/foo/c001/'),
    'https://www.mangago.me/read-manga/foo/c001/');
  t('  a numeric reader keeps its mirror',
    u.canonicalReaderUrl('https://www.mangago.zone/chapter/123/456/'),
    'https://www.mangago.zone/chapter/123/456/');
  t('  a read-manga url on a mirror is pinned to the main host',
    u.canonicalReaderUrl('https://www.mangago.zone/read-manga/foo/c001/'),
    'https://www.mangago.me/read-manga/foo/c001/');
  t('  a query is kept',
    u.canonicalReaderUrl('/read-manga/foo/c001/?pg=2'), 'https://www.mangago.me/read-manga/foo/c001/?pg=2');
  t('  a read-manga inside a query is not mistaken for the path',
    u.canonicalReaderUrl('/read-manga/foo/c001/?next=/read-manga/bar/'),
    'https://www.mangago.me/read-manga/foo/c001/?next=/read-manga/bar/');
}

console.log('\nhost classification:');
{
  t('  the main host takes the reader cookie', u.isMangagoHost('https://www.mangago.me/x'), true);
  t('  a mirror takes it too', u.isMangagoHost('https://www.youhim.me/x'), true);
  t('  an image host does not', u.isMangagoHost('https://i3.mangapicgallery.com/x'), false);
  t('  a bare path counts as same-origin', u.isMangagoHost('/read-manga/x/'), true);
  t('  a lookalike host does not', u.isMangagoHost('https://mangago.me.evil.test/x'), false);

  t('  a chapter page wants the desktop agent', u.isReaderPageUrl('/read-manga/foo/c001/'), true);
  t('  a numeric chapter page does too', u.isReaderPageUrl('/chapter/12/34/'), true);
  t('  a series page does not', u.isReaderPageUrl('/read-manga/foo/'), false);
  t('  a browse page does not', u.isReaderPageUrl('/genre/all/1/'), false);

  t('  every mirror is offered for a numeric reader',
    u.numericChapterCandidates('https://www.mangago.me/chapter/12/34/').length, 3);
  t('  no mirrors for a read-manga url',
    u.numericChapterCandidates('https://www.mangago.me/read-manga/foo/c1/').length, 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
