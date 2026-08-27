/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

export const DEFAULT_DOMAIN = "https://kingofshojo.com";
export const MANGA_DIR = "manga";

export const NEXT_PAGE_SELECTOR = "div.pagination .next, div.hpage .r, a:has(img[alt=Next])";

/** Setting keys, declared so the store can read them up front. */
export const BASE_URL_KEY = "kingofshojo.baseUrlOverride";
export const IMAGE_MODE_KEY = "kingofshojo.imageMode";

export const SETTINGS_KEYS = [BASE_URL_KEY, IMAGE_MODE_KEY] as const;

/** How reader images are fetched. */
export const IMAGE_MODES = ["saver", "quality", "original"] as const;

export type ImageMode = (typeof IMAGE_MODES)[number];

export const IMAGE_MODE_DEFAULT: ImageMode = "saver";

export const IMAGE_MODE_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "saver", title: "Data saver (recommended)" },
    { id: "quality", title: "Higher quality (compressed)" },
    { id: "original", title: "Original (full size, slow)" },
];

/** Ids for the home page sections. */
export const SECTIONS = {
    POPULAR_TODAY: "popular_today",
    LATEST_UPDATE: "latest_update",
    RECOMMENDATION: "recommendation",
} as const;

/** Headings the home page widgets sit under. */
export const HOME_HEADINGS = {
    POPULAR_TODAY: "Popular Today",
    RECOMMENDATION: "Recommendation",
    LATEST_UPDATE: "Latest Update",
    POPULAR_SERIES: "Popular Series",
} as const;

/** Genre names that make a title explicit rather than merely mature. */
export const ADULT_GENRE_NAMES: ReadonlySet<string> = new Set([
    "adult",
    "adult content",
    "smut",
    "hentai",
    "erotica",
    "pornographic",
    "ecchi",
    "mature",
    "18+",
    "nsfw",
]);

export interface PageMetadata {
    page: number;
}

export interface OptionItem {
    id: string;
    value: string;
}

export interface MangaCard {
    mangaId: string;
    title: string;
    imageUrl: string;
    subtitle?: string;
    rating?: string;
    isAdult?: boolean;
}

export interface LatestCard extends MangaCard {
    chapterId?: string;
    chapterName?: string;
    publishDate?: Date;
}

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    STATUS: "status",
    TYPE: "type",
    GENRE: "genre",
    POPULAR: "popular",
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

/** The free-text boxes offered beside the filters. */
export const AUTHOR_FIELD = "author";
export const YEAR_FIELD = "year";

export const POPULAR_RANGE_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "wpop-weekly", title: "Popular this week" },
    { id: "wpop-monthly", title: "Popular this month" },
    { id: "wpop-alltime", title: "Popular all time" },
];

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "ongoing", title: "Ongoing" },
    { id: "completed", title: "Completed" },
    { id: "hiatus", title: "Hiatus" },
    { id: "dropped", title: "Dropped" },
];

export const TYPE_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "Manga", title: "Manga" },
    { id: "Manhwa", title: "Manhwa" },
    { id: "Manhua", title: "Manhua" },
    { id: "Comic", title: "Comic" },
];

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "title", title: "A-Z" },
    { id: "titlereverse", title: "Z-A" },
    { id: "update", title: "Latest Update" },
    { id: "latest", title: "Latest Added" },
    { id: "popular", title: "Popular" },
];
