/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

const [branch, ...extra] = process.argv.slice(2);
if (!branch || extra.length) throw new Error('Usage: node scripts/publish-folder.mjs <branch>');

// Both publication and deletion must resolve valid Git refs to the same safe path.
console.log(branch === 'main' ? 'all' : branch
  .replace(/[^A-Za-z0-9._-]/g, '-')
  .replace(/^[^A-Za-z0-9]/, 'branch-$&'));
