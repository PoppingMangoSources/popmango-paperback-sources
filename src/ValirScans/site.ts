/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DOMAIN } from "./models";

/**
 * The site's address, as the parsers and the interceptor see it.
 *
 * Both turn relative links absolute and set a referer, and neither can wait
 * for a stored setting to be read. The source hands over a reader for its
 * settings during construction and everything else asks here. One source per
 * bundle, so this holds one address.
 */
let read: (() => string) | undefined;

export function bindBaseUrl(reader: () => string): void {
    read = reader;
}

export function baseUrl(): string {
    return read?.() ?? DOMAIN;
}

/** Turns a link from a page into one that can be fetched. */
export function toAbsoluteUrl(path: string | null | undefined): string {
    if (path === null || path === undefined || path.length === 0) {
        return "";
    }
    if (path.startsWith("http")) {
        return path;
    }
    return `${baseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
}
