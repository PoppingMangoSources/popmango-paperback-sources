/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

export const DOMAIN = "https://rinkocomics.com";

export const AJAX_ENDPOINT = `${DOMAIN}/wp-admin/admin-ajax.php`;

/** Marks a chapter id the site will not serve without a purchase. */
export const LOCK_SUFFIX = "#lock";

/**
 * Where chapters are listed.
 *
 * Detail pages use list rows and reader sidebars use anchors, so both shapes
 * are collected.
 */
export const CHAPTER_SELECTOR = "li.chapter, div.chapter, a.chapter-item";

/** Setting keys, declared so the store can read them up front. */
export const HIDE_LOCKED_KEY = "rinkocomics.hideLocked";

export const SETTINGS_KEYS = [HIDE_LOCKED_KEY] as const;

/**
 * Ids for the home page sections.
 *
 * The site also publishes novels, which this extension leaves out: 0.8 reads
 * chapters as page images only and has no way to show prose.
 */
export const SECTIONS = {
    HOT: "hot",
    PINNED: "pinned",
    LATEST: "latest",
} as const;

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    GENRE: "genre",
} as const;

/** Separates a filter section id from the value within it. */
export const FILTER_SEPARATOR = "::";

export function filterTag(section: string, id: string, title: string): { id: string; title: string } {
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

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "newest", title: "Newest First" },
    { id: "oldest", title: "Oldest First" },
    { id: "az", title: "A-Z" },
    { id: "za", title: "Z-A" },
];

/** Carried between pages of a paginated listing. */
export interface PageMetadata {
    page: number;
}

export interface ComicCard {
    mangaId: string;
    title: string;
    imageUrl: string;
}

export interface Genre {
    slug: string;
    name: string;
}

/** The chapter list endpoint's reply. */
export interface AjaxChapterResponse {
    success?: boolean;
    data?: { html?: string };
}
