/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

export const DOMAIN = "https://rokaricomics.com";
export const MANGA_DIR = "manga";

export const NEXT_PAGE_SELECTOR = "div.hpage .r, div.pagination .next, a.next.page-numbers";

/** Setting keys, declared so the store can read them up front. */
export const BASE_URL_KEY = "rokaricomics.baseUrlOverride";
export const USE_POST_IDS_KEY = "rokaricomics.usePostIds";

export const SETTINGS_KEYS = [BASE_URL_KEY, USE_POST_IDS_KEY] as const;

/** Ids for the home page sections. */
export const SECTIONS = {
    FEATURED: "featured",
    POPULAR: "popular",
    LATEST_UPDATES: "latest_updates",
    RECOMMENDATION: "recommendation",
} as const;

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    GENRE: "genres",
    STATUS: "status",
    TYPE: "type",
    RANKING: "ranking",
} as const;

/** Separates a filter section id from the value within it. */
export const FILTER_SEPARATOR = "::";

export function filterTag(section: string, id: string, title: string): Tag {
    return { id: `${section}${FILTER_SEPARATOR}${id}`, title };
}

/** Splits a tag id back into the section it belongs to and its own value. */
export function splitFilterTag(tagId: string): { section: string; value: string } | undefined {
    const index = tagId.indexOf(FILTER_SEPARATOR);
    if (index <= 0) {
        return undefined;
    }
    return { section: tagId.slice(0, index), value: tagId.slice(index + FILTER_SEPARATOR.length) };
}

/** The windows the site's own chart covers. */
export const RANKING_RANGES: Array<{ id: string; title: string }> = [
    { id: "weekly", title: "Popular this week" },
    { id: "monthly", title: "Popular this month" },
    { id: "alltime", title: "Popular all time" },
];

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "title", title: "A-Z" },
    { id: "titlereverse", title: "Z-A" },
    { id: "update", title: "Update" },
    { id: "latest", title: "Added" },
    { id: "popular", title: "Popular" },
];

/** The month names the site writes its dates with. */
export const MONTHS: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
};

export interface PageMetadata {
    page: number;
}

export interface SearchCard {
    /** The series slug, which is the id unless post ids are turned on. */
    slug: string;
    /** The path the slug sits under, needed to look a post id up. */
    path: string;
    /** The post id the markup carried, when it carried one. */
    postId?: string;
    title: string;
    imageUrl: string;
    subtitle?: string;
}
