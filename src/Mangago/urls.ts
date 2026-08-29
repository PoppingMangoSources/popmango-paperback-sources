/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DOMAIN } from "./models";

/**
 * Hosts that serve the numeric `/chapter/` reader.
 *
 * A handful of titles have no `/read-manga/` reader at all, and the main host
 * answers their numeric URLs with a 404, so each of these is tried in turn
 * until one hands back a page list.
 */
const READER_MIRRORS = [DOMAIN, "https://www.mangago.zone", "https://www.youhim.me"];

/** The host of an absolute URL, lowercased, or nothing for a bare path. */
export function readerHostOf(url: string): string | undefined {
    const normalised = url.startsWith("//") ? `https:${url}` : url;
    return /^https?:\/\/([^/?#]+)/i.exec(normalised)?.[1]?.toLowerCase();
}

/** True for the rotating mirrors, which must keep their own host. */
export function isReaderMirrorHost(host: string): boolean {
    return /(?:^|\.)(?:mangago\.zone|youhim\.me)$/i.test(host);
}

/** The origin serving a URL, falling back to the main host. */
export function readerOrigin(url: string): string {
    const host = readerHostOf(url);
    return host !== undefined ? `https://${host}` : DOMAIN;
}

/** Everything after the host: path, query and fragment. */
export function readerPathAndQuery(url: string): string {
    const normalised = url.startsWith("//") ? `https:${url}` : url;
    const absolute = /^https?:\/\/[^/]+(\/[^\s]*)?$/i.exec(normalised);

    if (absolute !== null) {
        return absolute[1] !== undefined && absolute[1].length > 0 ? absolute[1] : "/";
    }
    return normalised.startsWith("/") ? normalised : `/${normalised}`;
}

/** The path alone. */
export function readerPathOf(url: string): string {
    const pathAndQuery = readerPathAndQuery(url);
    const cut = pathAndQuery.search(/[?#]/);
    return cut >= 0 ? pathAndQuery.slice(0, cut) : pathAndQuery;
}

export function absoluteUrl(url: string): string {
    if (url.length === 0) {
        return "";
    }
    if (url.startsWith("//")) {
        return `https:${url}`;
    }
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    return url.startsWith("/") ? `${DOMAIN}${url}` : `${DOMAIN}/${url}`;
}

/**
 * Pins a reader URL to a host that will actually serve it.
 *
 * Two things go wrong with the ids the site hands out. A chapter link is
 * sometimes stored with the domain already on the front, so replaying it
 * produces an address with the host in the middle of the path; and the
 * numeric reader only answers on the mirror it came from. This repairs the
 * first and preserves the second.
 */
export function canonicalReaderUrl(url: string): string {
    // Split the query off first, so a "/read-manga/" appearing inside one is
    // not mistaken for the real path.
    const queryStart = url.search(/[?#]/);
    let path = queryStart === -1 ? url : url.slice(0, queryStart);
    const suffix = queryStart === -1 ? "" : url.slice(queryStart);

    if (path.startsWith("//")) {
        path = `https:${path}`;
    }

    // With the host doubled and no reader segment to anchor on, the last
    // absolute URL in the string is the real one.
    const schemes = [...path.matchAll(/https?:\/\//g)];
    const lastScheme = schemes[schemes.length - 1];
    if (schemes.length > 1 && lastScheme !== undefined) {
        path = path.slice(lastScheme.index);
    }

    const host = readerHostOf(path);
    const mirror = host !== undefined && isReaderMirrorHost(host) ? `https://${host}` : undefined;

    const readerIndex = Math.max(path.lastIndexOf("/read-manga/"), path.lastIndexOf("/chapter/"));
    const working = (readerIndex > 0 ? path.slice(readerIndex) : path) + suffix;

    const numeric = /^\/chapter\/\d+\/\d+/.test(readerPathOf(working));
    const origin = numeric && mirror !== undefined ? mirror : DOMAIN;

    return `${origin}${readerPathAndQuery(working)}`;
}

/** The same numeric reader URL on every mirror; empty for other URLs. */
export function numericChapterCandidates(url: string): string[] {
    const pathAndQuery = readerPathAndQuery(url);
    if (!/^\/chapter\/\d+\/\d+/.test(pathAndQuery)) {
        return [];
    }
    return READER_MIRRORS.map((mirror) => `${mirror}${pathAndQuery}`);
}

/** True for the site's own hosts, which are the ones the reader cookie is for. */
export function isMangagoHost(url: string): boolean {
    const host = readerHostOf(url);
    if (host === undefined) {
        return url.startsWith("/");
    }
    return host === "mangago.me" || host.endsWith(".mangago.me") || isReaderMirrorHost(host);
}

/** True for a chapter's reader page, which is what wants the desktop agent. */
export function isReaderPageUrl(url: string): boolean {
    const path = readerPathOf(url);
    const readManga = /^\/read-manga\/[^/]+\/(.+)/.exec(path);

    if (readManga !== null && (readManga[1] ?? "").length > 0) {
        return true;
    }
    return /^\/chapter\/\d+\/\d+/.test(path);
}
