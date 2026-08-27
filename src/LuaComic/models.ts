/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

export const DOMAIN = "https://luacomic.org";
export const API_URL = "https://api.luacomic.org";
export const PAGE_SIZE = 20;

/** Marks a chapter id as one the reader has to buy before it will open. */
export const PAID_CHAPTER_SUFFIX = "#paid";

/** Setting keys, declared so the store can read them up front. */
export const SHOW_PAID_KEY = "luacomic.showPaidChapters";
export const SHOW_ADULT_KEY = "luacomic.showAdultContent";

export const SETTINGS_KEYS = [SHOW_PAID_KEY, SHOW_ADULT_KEY] as const;

/** Ids for the home page sections. */
export const SECTIONS = {
    POPULAR: "popular",
    FEATURED: "featured",
    RECOMMENDED: "recommended",
    LATEST: "latest",
    EDITORS: "editors",
} as const;

export interface OptionItem {
    id: string;
    value: string;
}

export interface PageMetadata {
    page: number;
}

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    STATUS: "status",
    GENRE: "genre",
    TRENDING: "trending",
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

// Mirrors the site's "Order by" control.
export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "created_at", title: "Created at" },
    { id: "updated_at", title: "Updated at" },
    { id: "total_views", title: "Views" },
    { id: "title", title: "Title" },
];

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "Ongoing", title: "Ongoing" },
    { id: "Hiatus", title: "Hiatus" },
    { id: "Dropped", title: "Dropped" },
    { id: "Completed", title: "Completed" },
];

/** The windows the site's own chart covers. */
export const TRENDING_RANGES: Array<{ id: string; title: string }> = [
    { id: "daily", title: "Trending today" },
    { id: "weekly", title: "Trending this week" },
    { id: "all", title: "Trending all time" },
];

/** Used only when the tags endpoint returns nothing, which it often does. */
export const FALLBACK_GENRES: OptionItem[] = [
    { id: "action", value: "Action" },
    { id: "adventure", value: "Adventure" },
    { id: "comedy", value: "Comedy" },
    { id: "drama", value: "Drama" },
    { id: "fantasy", value: "Fantasy" },
    { id: "harem", value: "Harem" },
    { id: "historical", value: "Historical" },
    { id: "horror", value: "Horror" },
    { id: "isekai", value: "Isekai" },
    { id: "josei", value: "Josei" },
    { id: "magic", value: "Magic" },
    { id: "martial-arts", value: "Martial Arts" },
    { id: "mature", value: "Mature" },
    { id: "mystery", value: "Mystery" },
    { id: "psychological", value: "Psychological" },
    { id: "romance", value: "Romance" },
    { id: "school-life", value: "School Life" },
    { id: "sci-fi", value: "Sci-fi" },
    { id: "seinen", value: "Seinen" },
    { id: "shoujo", value: "Shoujo" },
    { id: "shounen", value: "Shounen" },
    { id: "slice-of-life", value: "Slice of Life" },
    { id: "smut", value: "Smut" },
    { id: "supernatural", value: "Supernatural" },
    { id: "thriller", value: "Thriller" },
    { id: "tragedy", value: "Tragedy" },
    { id: "villainess", value: "Villainess" },
];

/** Genres that make a title explicit rather than merely mature. */
export const ADULT_GENRES = ["adult", "smut", "mature", "ecchi", "hentai", "yaoi", "yuri"];

export interface LuaChapter {
    id: number;
    chapter_name?: string | null;
    chapter_title?: string | null;
    chapter_slug: string;
    created_at?: string | null;
    index?: string | null;
    price?: number | null;
}

export interface LuaTag {
    id?: number | string | null;
    name?: string | null;
}

export interface LuaSeries {
    id: number;
    title: string;
    description?: string | null;
    alternative_names?: string | null;
    series_type?: string | null;
    series_slug: string;
    thumbnail?: string | null;
    total_views?: number | null;
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    badge?: string | null;
    author?: string | null;
    rating?: number | null;
    free_chapters?: LuaChapter[] | null;
    tags?: Array<string | LuaTag> | null;
    meta?: { chapters_count?: string | number | null } | null;
}

export interface LuaQueryResponse {
    meta?: {
        current_page?: number;
        last_page?: number;
        total?: number;
    } | null;
    data?: LuaSeries[] | null;
}

export interface LuaTrendingItem {
    id: number;
    title: string;
    thumbnail?: string | null;
    series_slug: string;
    badge?: string | null;
    status?: string | null;
    description?: string | null;
    meta?: {
        chapters_count?: string | number | null;
        who_bookmarked_count?: string | number | null;
    } | null;
}

export interface LuaBanner {
    id: number;
    banner?: string | null;
    background?: string | null;
    series?: LuaSeries | null;
}

export interface LuaHomePage {
    banners: LuaBanner[];
    recommended: LuaSeries[];
    editors: LuaSeries[];
}

/** Everything the catalogue query accepts. */
export interface QueryRequest {
    page: number;
    search?: string;
    orderBy?: string;
    status?: string;
    genres?: string[];
    adult: boolean;
}
