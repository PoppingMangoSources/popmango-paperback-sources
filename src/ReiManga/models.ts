/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

export const DOMAIN = "https://reimanga.net";

export const PAGE_SIZE = 24;

/** Setting keys, declared so the store can read them up front. */
export const BASE_URL_KEY = "reimanga.baseUrl";

export const SETTINGS_KEYS = [BASE_URL_KEY] as const;

/** Ids for the home page sections. */
export const SECTIONS = {
    FEATURED: "featured",
    MOST_READ: "most-read",
    NEW: "new-manga",
    LATEST: "latest",
    TOP_RATED: "top-rated",
} as const;

/**
 * Which window the "Most Read" chart covers.
 *
 * 0.9 let the reader switch between them inside the section. 0.8 sections carry
 * no controls, so the weekly chart is shown and the other windows stay
 * reachable through the search filter below.
 */
export const MOST_READ_PERIOD = "week";

export const PERIOD_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "day", title: "Most read today" },
    { id: "week", title: "Most read this week" },
    { id: "month", title: "Most read this month" },
];

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    GENRE: "genre",
    STATUS: "status",
    PERIOD: "period",
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

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "latest", title: "Latest Update" },
    { id: "newest", title: "Newest" },
    { id: "viewed", title: "Most Viewed" },
    { id: "scored", title: "Top Rated" },
    { id: "title", title: "Title A-Z" },
];

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "ongoing", title: "Ongoing" },
    { id: "completed", title: "Completed" },
];

/**
 * The site's own genre menu.
 *
 * The catalogue accepts any genre slug, so this is only the picker's
 * vocabulary rather than a limit on what a search can ask for.
 */
export const GENRES: Array<{ id: string; title: string }> = [
    { id: "action", title: "Action" },
    { id: "adventure", title: "Adventure" },
    { id: "comedy", title: "Comedy" },
    { id: "drama", title: "Drama" },
    { id: "ecchi", title: "Ecchi" },
    { id: "fantasy", title: "Fantasy" },
    { id: "horror", title: "Horror" },
    { id: "mahou-shoujo", title: "Mahou Shoujo" },
    { id: "mecha", title: "Mecha" },
    { id: "music", title: "Music" },
    { id: "mystery", title: "Mystery" },
    { id: "psychological", title: "Psychological" },
    { id: "romance", title: "Romance" },
    { id: "scifi", title: "Sci-fi" },
    { id: "slice-of-life", title: "Slice of Life" },
    { id: "sports", title: "Sports" },
    { id: "supernatural", title: "Supernatural" },
    { id: "thriller", title: "Thriller" },
];

export const ADULT_GENRES = ["ecchi", "smut", "adult", "mature", "yaoi", "yuri", "hentai"];

/** Carried between pages of a paginated listing. */
export interface PageMetadata {
    page: number;
}

export interface ApiTag {
    name?: string;
    slug?: string;
}

export interface ApiManga {
    id: number;
    title?: string;
    name?: string;
    alt_title?: string | null;
    name_url?: string;
    description?: string | null;
    cover_url?: string | null;
    completed?: number;
    view_count?: number;
    rating?: number | string;
    voted?: number;
    is_adult?: number;
    blur_cover?: number;
    chapter_number?: string | number | null;
    chapter_title?: string | null;
    chapter_updated_at?: string | null;
    release_date?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    recent_reads?: number;
    genres?: Array<string | ApiTag>;
    genre_slugs?: string | null;
    tags?: Array<string | ApiTag>;
    authors?: Array<string | ApiTag>;
}

export interface ApiPagination {
    currentPage?: number;
    totalPages?: number;
}

export interface ApiMangaList {
    data?: ApiManga[];
    pagination?: ApiPagination;
}

export interface ApiMangaDetails {
    manga?: ApiManga;
}

/**
 * Chapter lists and reader pages exist only inside the route's own server
 * payload, rather than behind a JSON endpoint of their own.
 */
export interface FlightChapter {
    id: number;
    name?: string;
    uploadDate?: string | null;
    updatedAt?: string | null;
    createdAt?: string | null;
}

export interface FlightChapterList {
    manga?: { id?: number; slug?: string; name_url?: string };
    chapters?: FlightChapter[];
}

export interface FlightImage {
    page_number?: number;
    image_url?: string;
    url?: string;
}

export interface FlightImages {
    images?: FlightImage[];
}

/** Everything the catalogue endpoint accepts. */
export interface SearchRequest {
    page: number;
    term?: string;
    sortBy?: string;
    status?: string;
    includedGenres?: string[];
    excludedGenres?: string[];
}
