/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Reading the desktop reader's packed scripts as text.
 *
 * The desktop reader hides its key and page addresses in scripts packed with
 * the common `eval(function(p,a,c,k,e,d){…})` packer. That packer only swaps
 * each word for a short base-62 code and keeps the words in a list, so it is
 * undone with a lookup. The scripts are never run: 0.8 sources parse site
 * code, they do not evaluate it.
 */

const PACKER = /eval\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/;

/** The digits the packer writes its codes in, for any base up to 62. */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };

/** Reads the JavaScript string literal that opens at `start`. */
function readString(source: string, start: number): { value: string; end: number } {
    const quote = source[start];
    if (quote !== "'" && quote !== '"') {
        throw new Error("The reader script has a value this source cannot read.");
    }

    let value = "";
    for (let index = start + 1; index < source.length; index += 1) {
        const character = source[index]!;
        if (character === quote) {
            return { value, end: index + 1 };
        }
        if (character !== "\\") {
            value += character;
            continue;
        }

        const next = source[index + 1] ?? "";
        if (next === "x" || next === "u") {
            const length = next === "x" ? 2 : 4;
            const hex = source.slice(index + 2, index + 2 + length);
            if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== length) {
                throw new Error("The reader script has a malformed escape.");
            }
            value += String.fromCharCode(Number.parseInt(hex, 16));
            index += 1 + length;
        } else if (next === "\n") {
            // A backslash at a line end continues the string on the next line.
            index += 1;
        } else {
            value += ESCAPES[next] ?? next;
            index += 1;
        }
    }

    throw new Error("The reader script ends inside a string.");
}

function skipSpaces(source: string, index: number): number {
    while (index < source.length && /\s/.test(source[index]!)) {
        index += 1;
    }
    return index;
}

/** The list position a packed code stands for, or nothing for an ordinary word. */
function decodeWord(word: string, radix: number): number | undefined {
    // The packer never writes a leading zero, so "00" is a word, not a code.
    if (word.length > 1 && word.startsWith("0")) {
        return undefined;
    }

    let value = 0;
    for (const character of word) {
        const digit = DIGITS.indexOf(character);
        if (digit === -1 || digit >= radix) {
            return undefined;
        }
        value = value * radix + digit;
    }
    return value;
}

/** Whether a script is wrapped in the packer this file can undo. */
export function isPacked(script: string): boolean {
    return PACKER.test(script);
}

/** Undoes the packer, returning the script it wraps. */
export function unpack(script: string): string {
    const start = script.search(PACKER);
    if (start === -1) {
        throw new Error("The reader script is not packed in a form this source can read.");
    }

    // The packed words follow the packer's own function body.
    const bodyEnd = script.indexOf("}(", script.indexOf("return p", start));
    if (bodyEnd === -1) {
        throw new Error("The reader script is not packed in a form this source can read.");
    }

    const payload = readString(script, skipSpaces(script, bodyEnd + 2));
    const counts = /^\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*/.exec(script.slice(payload.end));
    if (counts === null) {
        throw new Error("The reader script is not packed in a form this source can read.");
    }

    const radix = Number(counts[1]);
    const count = Number(counts[2]);
    const words = readString(script, payload.end + counts[0].length);
    if (radix < 2 || radix > DIGITS.length || !/^\.split\(\s*(['"])\|\1\s*\)/.test(script.slice(words.end))) {
        throw new Error("The reader script is not packed in a form this source can read.");
    }

    const keywords = words.value.split("|");
    return payload.value.replace(/\b\w+\b/g, (word) => {
        const index = decodeWord(word, radix);
        const keyword = index !== undefined && index < count ? keywords[index] : undefined;
        return keyword !== undefined && keyword.length > 0 ? keyword : word;
    });
}

/** Reads a run of string literals joined with `+`, as the reader builds its key. */
function readConcatenation(expression: string): string {
    let value = "";
    let index = skipSpaces(expression, 0);

    while (index < expression.length) {
        if (expression[index] !== "'" && expression[index] !== '"') {
            throw new Error("The reader key is built in a way this source cannot read.");
        }
        const literal = readString(expression, index);
        value += literal.value;
        index = skipSpaces(expression, literal.end);
        if (index >= expression.length) {
            break;
        }
        if (expression[index] !== "+") {
            throw new Error("The reader key is built in a way this source cannot read.");
        }
        index = skipSpaces(expression, index + 1);
    }
    return value;
}

/** Reads an array of string literals, `['a', "b"]`. */
function readStringArray(source: string, start: number): { values: string[]; end: number } {
    if (source[start] !== "[") {
        throw new Error("The reader script has a list this source cannot read.");
    }

    const values: string[] = [];
    let index = skipSpaces(source, start + 1);
    while (source[index] !== "]") {
        const literal = readString(source, index);
        values.push(literal.value);
        index = skipSpaces(source, literal.end);
        if (source[index] === ",") {
            index = skipSpaces(source, index + 1);
        } else if (source[index] !== "]") {
            throw new Error("The reader script has a list this source cannot read.");
        }
    }
    return { values, end: index + 1 };
}

/** Reads a string or string-array variable, `name = …`. */
function readVariable(script: string, name: string): { start: number; value: string | string[] } | undefined {
    const match = new RegExp(`\\b${name}\\s*=\\s*`).exec(script);
    if (match === null) {
        return undefined;
    }

    const start = match.index + match[0].length;
    if (script[start] === "[") {
        return { start, value: readStringArray(script, start).values };
    }
    return { start, value: readString(script, start).value };
}

/** The key the desktop reader sends with each page request. */
export function parseReaderKey(unpacked: string): string {
    const expression = /\bguidkey\s*=\s*([^;]+);/.exec(unpacked)?.[1];
    if (expression === undefined) {
        throw new Error("No reader key was found in the reader script.");
    }
    return readConcatenation(expression);
}

/** Every page of a chapter whose reader lists them all, as some titles do. */
export function parseEmbeddedPages(unpacked: string): string[] {
    const pages = readVariable(unpacked, "newImgs")?.value;
    if (!Array.isArray(pages) || pages.length === 0 || pages.some((page) => page.length === 0)) {
        throw new Error("No embedded pages were found in the reader script.");
    }
    return pages;
}

/** The host the answer writes in front of its first path, when it names one. */
const FIRST_PATH_BASE = /if\s*\(\s*i\s*==\s*0\s*\)\s*\{\s*pvalue\s*\[\s*i\s*\]\s*=\s*(?=["'])/;

/**
 * The image a page request answers with.
 *
 * The answer lists the page asked for and the one after it (`pvalue`) as
 * paths, and builds their URLs from a shared base (`pix`) — except the first,
 * which is given a base of its own.
 */
export function parsePageImage(unpacked: string): string {
    const paths = readVariable(unpacked, "pvalue")?.value;
    const first = FIRST_PATH_BASE.exec(unpacked);
    const base =
        first !== null ? readString(unpacked, first.index + first[0].length).value : readVariable(unpacked, "pix")?.value;

    if (typeof base !== "string" || !Array.isArray(paths) || paths[0] === undefined || paths[0].length === 0) {
        throw new Error("No chapter image was found in the reader response.");
    }
    return `${base}${paths[0]}`;
}
