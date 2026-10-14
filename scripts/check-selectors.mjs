/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

// Looks for attribute selectors whose value is unquoted and is not a bare CSS
// identifier, such as `meta[property=og:image]`.
//
// The app hands each source its own cheerio rather than using the one in the
// bundle, and that one rejects a selector like this instead of guessing what
// was meant. The query then throws and the screen it was feeding comes back
// empty. Nothing else catches it: it is a string, so it compiles, bundles and
// only fails on a device.
//
// Quoting the value — `meta[property="og:image"]` — is always valid, so the
// fix is to quote it whenever the value is not a plain identifier.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = process.argv.slice(2);
const SEARCH = ROOTS.length > 0 ? ROOTS : ['src', 'common'];

/** String literals: single, double and backtick quoted. */
const STRING = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** An attribute selector whose value is not quoted. */
const ATTRIBUTE = /\[\s*[a-zA-Z_-][\w-]*\s*(?:[~^$*|]?=)\s*([^"'\]\s][^\]]*?)\s*\]/g;

/**
 * A value safe to leave unquoted.
 *
 * CSS identifiers are letters, digits, hyphens and underscores, and may not
 * start with a digit. A colon, a slash, a dot or a space makes the selector
 * invalid, which is the case worth reporting.
 */
const BARE_IDENTIFIER = /^-?[A-Za-z_][\w-]*$/;

function walk(directory, found) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full, found);
        else if (full.endsWith('.ts')) found.push(full);
    }
    return found;
}

const files = [];
for (const root of SEARCH) {
    if (statSync(root).isDirectory()) walk(root, files);
    else files.push(root);
}

const offences = [];

for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        let literal;
        STRING.lastIndex = 0;

        while ((literal = STRING.exec(line)) !== null) {
            let attribute;
            ATTRIBUTE.lastIndex = 0;

            while ((attribute = ATTRIBUTE.exec(literal[2])) !== null) {
                if (!BARE_IDENTIFIER.test(attribute[1])) {
                    offences.push({ file, line: index + 1, selector: attribute[0] });
                }
            }
        }
    });
}

console.log(`Scanned ${files.length} files for attribute selectors the app's cheerio rejects.`);

if (offences.length > 0) {
    for (const { file, line, selector } of offences) {
        console.log(`FAIL  ${file}:${line}  ${selector}  — quote the value`);
    }
    console.log(`\n${offences.length} FAILED`);
    process.exit(1);
}

console.log('ok    every attribute selector is quoted or a bare identifier');
process.exit(0);
