/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const [selection = 'all', ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Usage: node scripts/live-test-matrix.mjs [all|Source]');
const sources = readdirSync('src', { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(path.join('src', entry.name, `${entry.name}.ts`)))
  .map(entry => entry.name).sort();
assert(sources.length > 0, 'No source entry points found');
assert(sources.every(name => /^[A-Z][A-Za-z0-9]*$/.test(name)), 'Invalid source directory name');
const exclusions = JSON.parse(readFileSync('.github/live-test-exclusions.json', 'utf8'));
assert(exclusions && typeof exclusions === 'object' && !Array.isArray(exclusions), 'Exclusions must map source names to reasons');
for (const [name, reason] of Object.entries(exclusions)) {
  assert(sources.includes(name), `Unknown excluded source: ${name}`);
  assert(typeof reason === 'string' && reason.trim(), `${name}: an exclusion needs a reason`);
}
assert(selection === 'all' || sources.includes(selection), `Unknown source: ${selection}`);
// Explicit manual selection can recheck a source without removing its exclusion.
const selected = selection === 'all' ? sources.filter(name => !Object.hasOwn(exclusions, name)) : [selection];
assert(selected.length > 0, 'No live sources enabled; do not silently skip the entire catalog');
const matrix = JSON.stringify({ source: selected });
console.log(matrix);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${matrix}\n`);
const skipped = selection === 'all' ? Object.entries(exclusions) : [];
for (const [name, reason] of skipped) console.error(`SKIP ${name}: ${reason}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `Live tests selected: ${selected.join(', ')}\n\n` +
    (skipped.length ? skipped.map(([name, reason]) => `- Skipped **${name}**: ${reason}`).join('\n') : 'No exclusions applied.') + '\n');
}
