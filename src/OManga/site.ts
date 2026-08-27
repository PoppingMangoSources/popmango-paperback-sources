/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DEFAULT_DOMAIN } from "./models";

/**
 * The site's address and the reader's chapter preference.
 *
 * Both are consulted from the interceptor and the parsers, neither of which
 * can wait for a stored setting to be read. The source hands over readers for
 * them during construction. One source per bundle, so this holds one site.
 */
let readDomain: (() => string) | undefined;
let readAllVersions: (() => boolean) | undefined;

export function bindSite(domain: () => string, allVersions: () => boolean): void {
    readDomain = domain;
    readAllVersions = allVersions;
}

export function getDomain(): string {
    return readDomain?.() ?? DEFAULT_DOMAIN;
}

/** Whether every team's version of a chapter is listed, or only one. */
export function getShowAllVersions(): boolean {
    return readAllVersions?.() ?? true;
}
