/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { originOf } from "../../common";

import { DOMAIN, MIRROR_IDS } from "./models";

/**
 * Which mirror the source is currently talking to.
 *
 * Parsers turn relative links into absolute ones and the interceptor sets a
 * referer, and both need the answer without being able to wait for it. The
 * source hands this module a reader for its settings during construction, and
 * everything else asks here. One source per bundle, so this holds one site.
 */
interface SiteBinding {
    /** The mirror the reader chose. */
    selected: () => string;
    /** Whether the source may move to another mirror when one is unreachable. */
    failover: () => boolean;
    /** The mirror last known to be answering. */
    active: () => string;
    /** Records a mirror that has just answered. */
    setActive: (origin: string) => void;
}

let binding: SiteBinding | undefined;

export function bindSite(site: SiteBinding): void {
    binding = site;
}

/** The mirror to send the next request to. */
export function baseUrl(): string {
    if (binding === undefined) {
        return DOMAIN;
    }
    return binding.failover() ? binding.active() : binding.selected();
}

export function selectedBaseUrl(): string {
    return binding?.selected() ?? DOMAIN;
}

export function automaticFailover(): boolean {
    return binding?.failover() ?? true;
}

/** Remembers the mirror that answered, so the next request starts there. */
export function setActiveBaseUrl(origin: string): void {
    if (binding !== undefined && binding.failover() && MIRROR_IDS.includes(origin)) {
        binding.setActive(origin);
    }
}

/** The mirror a URL belongs to, or nothing when it points somewhere else. */
export function mirrorOrigin(url: string): string | undefined {
    const origin = originOf(url);
    return MIRROR_IDS.includes(origin) ? origin : undefined;
}

/** Turns a link from a page into one that can be fetched. */
export function absoluteUrl(url: string): string {
    if (url.startsWith("http")) {
        return url;
    }
    return `${baseUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
}
