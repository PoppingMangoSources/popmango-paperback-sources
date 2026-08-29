/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

/**
 * Getting a chapter's page images.
 *
 * The reader page carries its images as one encrypted, scrambled blob, and the
 * script that unlocks it is packed. Asked as a desktop browser, one request is
 * usually enough: the whole chapter comes back at once. A few older titles
 * only have a numbered reader that hands back one image per page, and those
 * are walked page by page instead.
 */

import { Application, CloudflareError, resolveUrl } from "../../common";

import {
    decodePageList,
    extractDescrambleCols,
    extractImgsrcs,
    findHexEncodedVariable,
    getDescramblingKey,
    sojsonV4Decode,
} from "./crypto";
import { isScrambledImageUrl, rememberImageContext } from "./descramble";
import { READER_USER_AGENT } from "./models";
import { READER_NAVIGATION_HEADERS, fetchPage } from "./network";
import {
    absoluteUrl,
    canonicalReaderUrl,
    numericChapterCandidates,
    readerOrigin,
} from "./urls";

/** Page lists and unpacked scripts, kept for as long as the source is loaded. */
const pageCache = new Map<string, string[]>();
const scriptCache = new Map<string, string>();

/** The shortest gap between two reader fetches, so a walk is not seen as a flood. */
const READER_FETCH_INTERVAL_MS = 350;
let lastReaderFetch = 0;

/** How many times a reader page is asked for before it is given up on. */
const READER_FETCH_ROUNDS = 3;

interface ReaderScript {
    script: string;
    keyHex: string;
    ivHex: string;
    cols: number;
}

async function paceReaderFetch(): Promise<void> {
    const wait = READER_FETCH_INTERVAL_MS - (Date.now() - lastReaderFetch);
    if (wait > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
    lastReaderFetch = Date.now();
}

/** How many images the chapter has, however the page happens to say it. */
function extractTotalPages(html: string): number {
    const candidates = [
        /total_pages\s*=\s*["']?(\d+)/.exec(html)?.[1],
        /class=["'][^"']*multi_pg_tip[^"']*["'][^>]*>\s*\(\s*\d+\s*\/\s*(\d+)\s*\)/i.exec(html)?.[1],
        /page\s+\d+\s+of\s+(\d+)/i.exec(html)?.[1],
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) {
            return value;
        }
    }
    return 0;
}

/** The encrypted page list, which sits in one of the page's inline scripts. */
function extractPageList(html: string): string | undefined {
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        const script = match[1] ?? "";
        if (script.includes("imgsrcs")) {
            return extractImgsrcs(script);
        }
    }
    return undefined;
}

function extractScriptUrl(html: string): string | undefined {
    return (
        /<script\b[^>]+src=["']([^"']*chapter\.js[^"']*)["'][^>]*>/i.exec(html)?.[1] ??
        /src=["']([^"']*chapter\.js[^"']*)["']/i.exec(html)?.[1]
    );
}

/** The site's "not found" body, which is worth telling apart from a bad moment. */
function isNotFoundPage(html: string): boolean {
    return (
        /<title>\s*404\s*-\s*mangago\s*<\/title>/i.test(html) ||
        /the page you have requested is not available/i.test(html)
    );
}

/**
 * Reduces a page template to a path.
 *
 * The template is later hung off whichever host is serving the chapter, so a
 * host left inside it would produce an address with two of them.
 */
function templatePath(template: string): string {
    const withoutOrigin = template.replace(/^(?:https?:)?\/\/[^/]+/i, "");
    const path = withoutOrigin.split(/[?#]/)[0] ?? withoutOrigin;

    if (path.length === 0) {
        return "/";
    }
    return path.startsWith("/") ? path : `/${path}`;
}

/** The reader's own page-URL template, when it ships a usable one. */
function extractPageTemplate(html: string): string | undefined {
    const curl = /<input[^>]*id=["']curl["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1]?.trim();
    if (curl !== undefined && curl.includes("{page}")) {
        return templatePath(curl);
    }

    // Some pages ship a template of "/" and put the current page's URL in a
    // variable instead; that URL turns back into a template.
    const pcurl = /\bpcurl\s*=\s*["']([^"']*\/pg-)\d+(\/[^"']*)?["']/.exec(html);
    if (pcurl?.[1] !== undefined) {
        return templatePath(`${pcurl[1]}{page}${pcurl[2] ?? ""}`);
    }

    return undefined;
}

/** Whether an unpacked script still has everything the rest of this needs. */
function isUsableScript(script: string): boolean {
    return (
        script.length > 1000 &&
        findHexEncodedVariable(script, "key") !== undefined &&
        findHexEncodedVariable(script, "iv") !== undefined &&
        extractDescrambleCols(script) > 0 &&
        script.includes("var renImg = function(img,width,height,id){") &&
        script.includes("key = key.split(")
    );
}

async function loadScript(scriptUrl: string): Promise<string> {
    const cached = scriptCache.get(scriptUrl);
    if (cached !== undefined) {
        return cached;
    }

    const unpacked = sojsonV4Decode((await fetchPage(scriptUrl)).html);
    scriptCache.set(scriptUrl, unpacked);
    return unpacked;
}

async function loadReaderScript(html: string, pageUrl: string): Promise<ReaderScript> {
    const scriptUrl = extractScriptUrl(html);
    if (scriptUrl === undefined) {
        throw new Error("The reader page no longer names the script that unlocks it.");
    }

    const absolute = resolveUrl(scriptUrl, pageUrl);
    const script = await loadScript(absolute);

    if (!isUsableScript(script)) {
        // Dropped rather than kept, so the next attempt fetches it again.
        scriptCache.delete(absolute);
        throw new Error("The reader script could not be unpacked.");
    }

    const keyHex = findHexEncodedVariable(script, "key");
    const ivHex = findHexEncodedVariable(script, "iv");
    if (keyHex === undefined || ivHex === undefined) {
        throw new Error("The reader script no longer carries the key its images are locked with.");
    }

    return { script, keyHex, ivHex, cols: extractDescrambleCols(script) };
}

/**
 * Notes what a scrambled image will need, and hands back its address.
 *
 * The tile order depends on the image's own URL, so it is worked out here
 * while the script is still at hand and remembered against that URL; by the
 * time the app fetches the image there is nothing left to derive it from.
 */
function noteImage(rawUrl: string, script: string, cols: number): string {
    const url = absoluteUrl(rawUrl);

    if (!isScrambledImageUrl(url) || cols <= 0) {
        return url;
    }

    try {
        rememberImageContext(url, { desckey: getDescramblingKey(script, url), cols });
    } catch {
        // Without a key the image is served as it arrived, scrambled but there.
    }

    return url;
}

/**
 * Fetches one reader page, retrying a few times before giving up.
 *
 * A single failed page would otherwise be read as the end of the chapter, and
 * a page can fail for a moment on its own — a rate limit, a cancelled request,
 * a network blip.
 */
async function fetchReaderPage(
    pageUrl: string,
    outcome?: { missing: boolean },
): Promise<{ html: string; url: string } | undefined> {
    const url = canonicalReaderUrl(pageUrl);
    let challenge: CloudflareError | undefined;
    let missing = false;

    for (let round = 1; round <= READER_FETCH_ROUNDS; round += 1) {
        try {
            await paceReaderFetch();
            const { html } = await fetchPage(url, {
                "user-agent": READER_USER_AGENT,
                ...READER_NAVIGATION_HEADERS,
            });

            if (extractPageList(html) !== undefined) {
                return { html, url };
            }
            if (isNotFoundPage(html)) {
                missing = true;
                break;
            }
        } catch (error: unknown) {
            if (error instanceof CloudflareError) {
                challenge = error;
            }
        }

        if (round < READER_FETCH_ROUNDS) {
            await new Promise<void>((resolve) => setTimeout(resolve, 400 * round));
        }
    }

    if (challenge !== undefined) {
        throw challenge;
    }
    if (outcome !== undefined) {
        outcome.missing = missing;
    }
    return undefined;
}

/**
 * Finds a host that will serve this chapter.
 *
 * The canonical address is tried first, then each mirror in turn, because a
 * few titles only exist behind the numbered reader and the main host answers
 * those with a 404.
 */
async function resolveReaderPage(chapterUrl: string): Promise<{ html: string; url: string }> {
    const canonical = canonicalReaderUrl(chapterUrl);
    const candidates = [canonical];

    for (const mirror of numericChapterCandidates(canonical)) {
        if (!candidates.includes(mirror)) {
            candidates.push(mirror);
        }
    }

    let challenge: CloudflareError | undefined;

    for (const candidate of candidates) {
        try {
            const { html } = await fetchPage(candidate, {
                "user-agent": READER_USER_AGENT,
                ...READER_NAVIGATION_HEADERS,
            });
            if (html.includes("imgsrcs")) {
                return { html, url: candidate };
            }
        } catch (error: unknown) {
            if (error instanceof CloudflareError) {
                challenge = error;
            }
        }
    }

    if (challenge !== undefined) {
        throw challenge;
    }
    throw new Error("This chapter has no reader page that could be read.");
}

/** Builds the address of one numbered page, on the host serving the chapter. */
function pageUrlFor(template: string, readerUrl: string, page: number): string {
    const path = template.replace("{page}", String(page));
    return canonicalReaderUrl(
        `${readerOrigin(readerUrl)}${path.startsWith("/") ? path : `/${path}`}`,
    );
}

/** Every page image of one chapter, in order. */
export async function getPageUrls(chapterUrl: string): Promise<string[]> {
    const cached = pageCache.get(chapterUrl);
    if (cached !== undefined && cached.length > 0) {
        return cached;
    }

    const { html, url } = await resolveReaderPage(chapterUrl);

    const encoded = extractPageList(html);
    if (encoded === undefined) {
        throw new Error("The reader page no longer carries a page list.");
    }

    const reader = await loadReaderScript(html, url);
    const note = (urls: string[]): string[] =>
        urls.map((image) => noteImage(image, reader.script, reader.cols));

    // Blanks are kept: on the numbered reader they mark the slots another
    // request is responsible for, rather than pages that do not exist.
    const first = decodePageList(encoded, reader.script, reader.keyHex, reader.ivHex, true);
    const totalPages = extractTotalPages(html);

    // Asked as a desktop browser, the reader normally answers with the whole
    // chapter at once, which is every `/read-manga/` title.
    if (
        first.length > 0 &&
        first.every((image) => image.trim().length > 0) &&
        (totalPages === 0 || first.length >= totalPages)
    ) {
        const pages = note(first);
        pageCache.set(chapterUrl, pages);
        return pages;
    }

    const template = extractPageTemplate(html);
    if (totalPages <= 0 || template === undefined) {
        // Nothing to walk with, so whatever the first page held is the best
        // that can be offered — and it is not worth remembering.
        return note(first.filter((image) => image.length > 0));
    }

    // The numbered reader puts image N in slot N, so the slots are filled from
    // whichever windows have already been fetched and only the gaps are asked for.
    const slots: string[] = Array.from({ length: totalPages }, () => "");
    const fill = (images: string[]): void => {
        for (let index = 0; index < images.length && index < totalPages; index += 1) {
            const image = images[index]?.trim() ?? "";
            if (image.length > 0 && (slots[index] ?? "").length === 0) {
                slots[index] = image;
            }
        }
    };
    fill(first);

    let complete = true;
    for (let page = 1; page <= totalPages; page += 1) {
        if ((slots[page - 1] ?? "").length > 0) {
            continue;
        }

        const fetched = await fetchReaderPage(pageUrlFor(template, url, page));
        const encodedPage = fetched !== undefined ? extractPageList(fetched.html) : undefined;

        if (encodedPage === undefined) {
            complete = false;
            continue;
        }

        fill(decodePageList(encodedPage, reader.script, reader.keyHex, reader.ivHex, true));
    }

    const images = slots.filter((slot) => slot.length > 0);
    const pages = note(images);

    // Only a whole chapter is remembered, so a partial one is tried again the
    // next time it is opened.
    if (pages.length > 0 && complete && images.length === totalPages) {
        pageCache.set(chapterUrl, pages);
    }

    return pages;
}
