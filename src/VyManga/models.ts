/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

export const DEFAULT_DOMAIN = "https://mangavyvy.net";
export const SEARCH_PATH = "search";

/** Setting keys, declared so the store can read them up front. */
export const BASE_URL_KEY = "vymanga.baseUrlOverride";
export const GENRES_KEY = "vymanga.searchGenres";

export const SETTINGS_KEYS = [BASE_URL_KEY, GENRES_KEY] as const;

/** Ids for the home page sections, referenced when the app asks for more. */
export const SECTIONS = {
    POPULAR: "popular",
    LATEST_UPDATES: "latest_updates",
    TOP_RATED: "top_rated",
    NEWEST: "newest",
} as const;

/** Which sort order backs each browsing section. */
export const BROWSE_SORT: Record<string, string> = {
    [SECTIONS.LATEST_UPDATES]: "updated_at",
    [SECTIONS.TOP_RATED]: "scored",
    [SECTIONS.NEWEST]: "created_at",
};

export const CARD_LINK_SELECTOR = "a";
export const CARD_TITLE_SELECTOR = ".comic-title";
export const CARD_IMAGE_SELECTOR = ".comic-image img, img.image, img.lozad";
export const CARD_LATEST_SELECTOR = ".comic-image > span, .comic-image span";
export const NEXT_PAGE_SELECTOR = "[rel=next]";

export const TITLE_SELECTOR = "h1";
export const THUMB_SELECTOR = ".img-manga img, .content-thumb img";
export const DESC_SELECTOR = ".summary > .content, div.summary p.content";
export const AUTHOR_SELECTOR = ".pre-title:contains(Author) ~ a";
export const ARTIST_SELECTOR = ".pre-title:contains(Artist) ~ a";
export const GENRE_SELECTOR = ".pre-title:contains(Genres) ~ a, div.col-md-7 p a[href*=genre]";
export const STATUS_SELECTOR =
    ".pre-title:contains(Status) ~ span:not(.space), div.col-md-7 p:contains(Status) span";

export const CHAPTER_SELECTOR = "a.list-chapter";
export const CHAPTER_FALLBACK_SELECTOR = 'a[id^="chapter-"]';
export const CHAPTER_DATE_SELECTOR = "p.small";
export const PAGE_SELECTOR = "div.carousel-item[data-page] img, img.lozad, img.d-block";

export const GENRE_OPTION_SELECTOR = ".checkbox-genre[data-value]";

/**
 * Ids of the filter sections shown on the search screen.
 *
 * 0.8 hands every chosen filter back as a flat list of tags, so each tag id is
 * prefixed with the section it came from and split apart again when the search
 * request is assembled.
 */
export const FILTERS = {
    SORT: "sort",
    ORDER: "order",
    GENRE: "genre",
    STATUS: "status",
    MATCH: "match",
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

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "0", title: "Ongoing" },
    { id: "1", title: "Completed" },
];

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "viewed", title: "Most Viewed" },
    { id: "scored", title: "Top Rated" },
    { id: "created_at", title: "Newest" },
    { id: "updated_at", title: "Latest Update" },
];

export const ORDER_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "asc", title: "Ascending" },
];

export const MATCH_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "1", title: "Title begins with" },
    { id: "2", title: "Title ends with" },
    { id: "desc", title: "Also search descriptions" },
];

/** Genres named here mark a title adult regardless of the site's own rating. */
export const ADULT_GENRE_NAMES: ReadonlySet<string> = new Set([
    "adult",
    "mature",
    "smut",
    "ecchi",
    "hentai",
    "erotica",
    "pornographic",
    "18+",
    "nsfw",
]);

/** Carried between pages of a paginated listing. */
export interface PageMetadata {
    page: number;
}

export interface OptionItem {
    id: string;
    value: string;
}

/** One series as it appears in a listing. */
export interface MangaCard {
    mangaId: string;
    title: string;
    imageUrl: string;
    subtitle?: string;
}

/** Everything the site's search page accepts, gathered from the chosen filters. */
export interface SearchRequest {
    page: number;
    title?: string;
    sortBy?: string;
    order?: string;
    status?: string;
    searchType?: string;
    searchDescriptions?: boolean;
    includedGenres?: string[];
    excludedGenres?: string[];
}
