/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Scans the built bundles for globals the Paperback 0.8 runtime does not have.
//
// This exists because `setTimeout` shipped in every source and nothing caught
// it: the typechecker accepts it, because @types/node declares it globally and
// cheerio pulls those declarations in. It only failed on a device, as
// "ReferenceError: Can't find variable: setTimeout". The bundle is the artifact
// that actually runs, so it is the thing worth checking.
//
// Only unambiguous names are listed. `fetch` and `document` are deliberately
// absent: both are used as ordinary local names in these sources (a callback
// parameter, a parsed cheerio document), so matching them by text produces
// false positives. The typechecker covers the real globals of that pair, since
// the DOM library is switched off in tsconfig.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FORBIDDEN = [
  ['setTimeout', /\bsetTimeout\s*\(/g],
  ['setInterval', /\bsetInterval\s*\(/g],
  ['clearTimeout', /\bclearTimeout\s*\(/g],
  ['clearInterval', /\bclearInterval\s*\(/g],
  ['requestAnimationFrame', /\brequestAnimationFrame\s*\(/g],
  ['queueMicrotask', /\bqueueMicrotask\s*\(/g],
  ['atob', /\batob\s*\(/g],
  ['btoa', /\bbtoa\s*\(/g],
  ['Buffer', /\bBuffer\s*(?:\.|\[|\()/g],
  ['TextDecoder', /\bnew\s+TextDecoder\b/g],
  ['TextEncoder', /\bnew\s+TextEncoder\b/g],
  ['XMLHttpRequest', /\bnew\s+XMLHttpRequest\b/g],
  ['Image', /\bnew\s+Image\s*\(/g],
  ['ImageData', /\bnew\s+ImageData\b/g],
  ['HTMLCanvasElement', /\bnew\s+HTMLCanvasElement\b/g],
  ['crypto.subtle', /\bcrypto\s*\.\s*subtle\b/g],
  ['localStorage', /\blocalStorage\s*\./g],
  ['sessionStorage', /\bsessionStorage\s*\./g],
  ['window', /\bwindow\s*\./g],
  ['process', /\bprocess\s*\.\s*(?:env|exit|argv|cwd)\b/g],
];

// The bundles are what ships, so they are rebuilt rather than trusted to be
// current.
const folder = process.argv.find(arg => arg.startsWith('--folder='))?.slice(9) ?? '';
const directory = path.join('bundles', folder);
if (!process.argv.includes('--skip-bundle')) {
  execFileSync(process.execPath, ['node_modules/@paperback/toolchain/bin/run', 'bundle',
    ...(folder ? [`--folder=${folder}`] : [])], { stdio: 'pipe' });
}

if (!existsSync(directory)) {
  console.log('FAIL  no bundles directory to scan');
  process.exit(1);
}

const offences = [];
let scanned = 0;

for (const name of readdirSync(directory)) {
  const file = path.join(directory, name, 'source.js');
  if (!existsSync(file)) continue;

  scanned += 1;
  const source = readFileSync(file, 'utf8');

  for (const [global, pattern] of FORBIDDEN) {
    const found = source.match(pattern);
    if (found) offences.push({ name, global, count: found.length });
  }
}

console.log(`Scanned ${scanned} bundles for globals Paperback 0.8 does not provide.`);

if (scanned === 0) {
  console.log('FAIL  no source bundles were scanned');
  process.exit(1);
}

if (offences.length > 0) {
  for (const { name, global, count } of offences) {
    console.log(`FAIL  ${name}: uses ${global} (${count}×) — not available on 0.8`);
  }
  console.log(`\n${offences.length} FAILED`);
  process.exit(1);
}

console.log('ok    none of them use a global the runtime lacks');
process.exit(0);
