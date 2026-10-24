/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const folder = args.find(arg => arg.startsWith('--folder='))?.slice(9) ?? '';
if (folder && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(folder)) {
  throw new Error('Use a single publication folder name, without slashes or traversal.');
}
if (args.some(arg => arg !== '--skip-bundle' && !arg.startsWith('--folder='))) {
  throw new Error('Usage: npm run verify -- [--folder=name] [--skip-bundle]');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const run = (...command) => execFileSync(process.execPath, command, { cwd: root, stdio: 'inherit' });

run('node_modules/typescript/bin/tsc', '--noEmit');
for (const check of ['runtime', 'menu', 'common', 'selectors', 'globals-runner', 'live-runner', 'tooling']) {
  run(`scripts/check-${check}.mjs`);
}
const target = folder ? [`--folder=${folder}`] : [];
if (!args.includes('--skip-bundle')) {
  run('node_modules/@paperback/toolchain/bin/run', 'bundle', ...target);
}
run('scripts/check-globals.mjs', '--skip-bundle', ...target);
run('scripts/check-bundles.mjs', ...target);
run('scripts/check-site.mjs', ...target);
console.log('Offline verification passed. Live site and device behavior require separate checks.');
