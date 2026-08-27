/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://templetoons.com";
export const API_URL = "https://api.templetoons.com/api";

/** Marks a chapter id as one the reader has to buy before it will open. */
export const PAID_CHAPTER_SUFFIX = "#paid";

export const PAGE_SIZE = 20;

/** Setting keys, declared so the store can read them up front. */
export const SHOW_PAID_CHAPTERS_KEY = "templescan.showPaidChapters";

export const SETTINGS_KEYS = [SHOW_PAID_CHAPTERS_KEY] as const;

export interface BrowseSeries {
    series_slug: string;
    title: string;
    alternative_names?: string | null;
    thumbnail?: string | null;
    status?: string | null;
    update_chapter?: string | null;
    created_at?: string | null;
    total_views?: number;
}

export interface SeasonChapter {
    chapter_slug: string;
    chapter_name?: string | null;
    chapter_title?: string | null;
    created_at?: string | null;
    price?: number | null;
    index?: string | number;
}

export interface SeriesData {
    series_slug: string;
    title: string;
    description?: string | null;
    author?: string | null;
    studio?: string | null;
    badge?: string | null;
    status?: string | null;
    release_year?: string | number | null;
    alternative_names?: string | null;
    thumbnail?: string | null;
    total_views?: number;
    tag_series?: Array<{ tag?: { name?: string } }>;
    Season?: Array<{ Chapter?: SeasonChapter[] }>;
}

// Homepage cards: "Comics Update" entries carry their newest chapters,
// "New Series" entries do not.
export interface HomeSeries {
    series_slug: string;
    title: string;
    thumbnail?: string | null;
    badge?: string | null;
    Chapter?: SeasonChapter[];
}

export interface HomeSections {
    newSeries: HomeSeries[];
    updates: HomeSeries[];
}

export interface FeaturedEntry {
    series_slug: string;
    title: string;
    thumbnail?: string | null;
    banner?: string | null;
    protagonist?: string | null;
    description?: string | null;
    author?: string | null;
    total_views?: number;
}

export interface TrendingEntry {
    series_slug: string;
    title: string;
    thumbnail?: string | null;
    badge?: string | null;
    day_views?: number;
    week_views?: number;
    month_views?: number;
}

export interface TrendingResponse {
    dayRes?: TrendingEntry[];
    weekRes?: TrendingEntry[];
    mensualRes?: TrendingEntry[];
}

export type TrendingRange = "day" | "week" | "month";

/** Carried between pages of a paginated listing. */
export interface PageMetadata {
    page: number;
}

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    STATUS: "status",
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

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "views", title: "Most Viewed" },
    { id: "updated", title: "Recently Updated" },
    { id: "created", title: "Newest" },
];

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "Ongoing", title: "Ongoing" },
    { id: "Hiatus", title: "Hiatus" },
    { id: "Completed", title: "Completed" },
    { id: "Canceled", title: "Cancelled" },
    { id: "Dropped", title: "Dropped" },
];

export const TRENDING_RANGES: Array<{ id: TrendingRange; title: string }> = [
    { id: "day", title: "Trending today" },
    { id: "week", title: "Trending this week" },
    { id: "month", title: "Trending this month" },
];

/** Ids for the home page sections. */
export const SECTIONS = {
    FEATURED: "featured",
    NEW_SERIES: "new-series",
    LATEST: "latest",
} as const;

/**
 * The home page sections.
 *
 * 0.9 also showed a strip of links into the trending charts. 0.8 has no tile
 * that can hold a link, so the charts moved to the search filters instead.
 */
export const DISCOVER_SECTIONS: DiscoverSection[] = [
    { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
    { id: SECTIONS.NEW_SERIES, title: "New Series", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
];
