/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

/**
 * Undoing what the reader page does to its page list.
 *
 * The list of image URLs is encrypted, then the decrypted text is scrambled
 * again by a routine that lives in the site's own obfuscated script. Every
 * step needed to get back to plain URLs is here.
 */

import { Application } from "../../common";

import { aesCbcDecrypt, stripZeroPadding } from "./aes";

/** Pulls the encrypted page list out of a reader page's inline script. */
export function extractImgsrcs(input: string): string | undefined {
    return /var\s+imgsrcs\s*=\s*["']([^"']+)["']/.exec(input)?.[1];
}

/**
 * Unpacks the site's obfuscated chapter script.
 *
 * The packer stores the original source as a run of decimal character codes
 * separated by letters, wrapped in a fixed preamble and trailer. Both are a
 * known length, so the codes are simply the middle of the string.
 */
export function sojsonV4Decode(packed: string): string {
    if (!packed.startsWith("['sojson.v4']")) {
        throw new Error("The chapter script is not packed in the form this source can unpack.");
    }
    if (packed.length < 299) {
        throw new Error("The chapter script is too short to be a packed script.");
    }

    return packed
        .slice(240, packed.length - 59)
        .split(/[a-zA-Z]+/g)
        .filter((part) => part.length > 0)
        .map((code) => String.fromCharCode(Number(code)))
        .join("");
}

/** Finds a hex-encoded constant — the AES key and its IV are both stored this way. */
export function findHexEncodedVariable(input: string, variable: string): string | undefined {
    const pattern = new RegExp(
        `var\\s+${variable}\\s*=\\s*CryptoJS\\.enc\\.Hex\\.parse\\(["']([0-9a-fA-F]+)["']\\)`,
    );
    return pattern.exec(input)?.[1];
}

export function decodeHex(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) {
        throw new Error("A hex constant must have an even number of digits.");
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < hex.length; index += 2) {
        bytes[index / 2] = parseInt(hex.slice(index, index + 2), 16);
    }
    return bytes;
}

/** How many tiles a scrambled image is cut into, along each axis. */
export function extractDescrambleCols(input: string): number {
    const match = /var\s+widthnum\s*=\s*heightnum\s*=\s*(\d+)/.exec(input);
    return match !== null ? Number(match[1]) : 0;
}

/**
 * Decrypts the page list and hands back the URLs.
 *
 * The plaintext is padded with zero bytes and may end in stray commas, both of
 * which are trimmed before the list is split. Blanks are worth keeping when
 * the caller is filling numbered slots, because a blank means "this page is
 * served by another request" rather than "there is nothing here".
 */
export function decodePageList(
    encoded: string,
    script: string,
    keyHex: string,
    ivHex: string,
    keepBlanks: boolean,
): string[] {
    const decrypted = stripZeroPadding(
        aesCbcDecrypt(Application.base64DecodeBytes(encoded), decodeHex(keyHex), decodeHex(ivHex)),
    );

    const text = Application.utf8Decode(decrypted).replace(/,+$/g, "");
    const images = unscramblePageList(text, script)
        .split(",")
        .map((url) => url.trim());

    return keepBlanks ? images : images.filter((url) => url.length > 0);
}

/**
 * Puts the decrypted list back in order.
 *
 * A few digits of the key are hidden inside the list itself, at positions the
 * site's script names as it reads them. Those digits are read out, removed,
 * and then used to undo a series of pairwise swaps.
 */
export function unscramblePageList(list: string, script: string): string {
    const characters = list.split("");
    const positions = findKeyPositions(script);
    const key: number[] = [];

    for (const position of positions) {
        const digit = characters[position];
        if (digit === undefined || !/[0-9]/.test(digit)) {
            // The script no longer matches the list; leaving it alone at least
            // yields something readable rather than nonsense.
            return list;
        }
        key.push(Number(digit));
    }

    // Removed highest first, so an earlier removal cannot shift the positions
    // still to come — the script names them in the order it reads them, which
    // is not necessarily ascending.
    for (const position of [...positions].sort((a, b) => b - a)) {
        if (position >= 0 && position < characters.length) {
            characters.splice(position, 1);
        }
    }

    for (const step of [...key].reverse()) {
        for (let index = characters.length - 1; index >= step; index -= 1) {
            if (index % 2 !== 0) {
                const other = index - step;
                const held = characters[other] ?? "";
                characters[other] = characters[index] ?? "";
                characters[index] = held;
            }
        }
    }

    return characters.join("");
}

/** The offsets the script reads its key digits from, in the order it reads them. */
function findKeyPositions(script: string): number[] {
    const positions: number[] = [];
    const marker = "str.charAt(";
    let cursor = 0;

    for (;;) {
        const found = script.indexOf(marker, cursor);
        if (found < 0) {
            break;
        }

        let index = found + marker.length;
        while (index < script.length && !/[0-9]/.test(script[index] ?? "")) {
            index += 1;
        }

        const start = index;
        while (index < script.length && /[0-9]/.test(script[index] ?? "")) {
            index += 1;
        }

        const position = Number(script.slice(start, index));
        if (Number.isFinite(position) && !positions.includes(position)) {
            positions.push(position);
        }

        cursor = index;
    }

    return positions;
}

/**
 * Lines that mean the snippet is reaching for something it should not.
 *
 * The tile order for an image is worked out by a short routine the site ships
 * inside its chapter script, from the image's own URL. It changes often
 * enough that reimplementing it here would break on the site's next change,
 * so the routine is run as written — which means being careful about what is
 * handed to it.
 *
 * Every line touching the page, the document or a canvas is dropped first, so
 * what runs is arithmetic over a string this source supplies. Nothing from the
 * network reaches the script other than the script itself, and the result is
 * read back as a plain string.
 */
const DISALLOWED_IN_SNIPPET = [
    "jQuery",
    "document",
    "window",
    "globalThis",
    "getContext",
    "toDataURL",
    "getImageData",
    "width",
    "height",
];

/** A helper the extracted routine calls but does not carry with it. */
const REPLACE_POS = `
function replacePos(strObj, pos, replacetext) {
  return strObj.substr(0, pos) + replacetext + strObj.substring(pos + 1, strObj.length);
}
`;

/**
 * Works out the tile order for one image.
 *
 * Returns the site's own key string, which the descrambler splits apart.
 */
export function getDescramblingKey(script: string, imageUrl: string): string {
    const afterStart = script.split("var renImg = function(img,width,height,id){");
    if (afterStart.length < 2) {
        throw new Error("The chapter script no longer contains the image routine.");
    }

    const beforeSplit = (afterStart[1] ?? "").split("key = key.split(");
    if (beforeSplit.length < 2) {
        throw new Error("The chapter script no longer builds a descrambling key.");
    }

    const body = (beforeSplit[0] ?? "")
        .split("\n")
        .filter((line) => DISALLOWED_IN_SNIPPET.every((word) => !line.includes(word)))
        .join("\n")
        .replace(/img\.src/g, "url");

    // Reached through a variable rather than by name, so the routine is
    // evaluated at the top level and cannot see anything in this function.
    const evaluate: (source: string) => unknown = eval;
    const derive = evaluate(`(function (url) {\n${REPLACE_POS}\n${body}\nreturn key;\n})`) as (
        url: string,
    ) => unknown;

    return String(derive(imageUrl));
}
