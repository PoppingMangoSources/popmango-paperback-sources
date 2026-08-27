/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { ContentRating, Tag } from "../../common";

export const DOMAIN = "https://stonescape.xyz";
export const API_URL = `${DOMAIN}/api`;

/** Shown when a series has neither a cover nor a banner. */
export const FALLBACK_IMAGE_URL = `${DOMAIN}/logo.png`;

export const PAGE_SIZE = 20;

/**
 * The site also publishes novels, which this extension does not carry.
 *
 * 0.8 chapters are a list of page images and nothing else, so prose has
 * nowhere to go. Every request therefore asks for comics only.
 */
export const CONTENT_TYPE = "manhwa";

/** Setting keys, declared so the store can read them up front. */
export const SHOW_LOCKED_CHAPTERS_KEY = "stonescape_show_locked_chapters";

export const SETTINGS_KEYS = [SHOW_LOCKED_CHAPTERS_KEY] as const;

/** Ids for the home page sections. */
export const SECTIONS = {
    FEATURED: "featured",
    LATEST: "latest",
} as const;

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    STATUS: "status",
    GENRE: "genre",
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

export const PERIOD_OPTIONS: Array<{ id: PopularPeriod; title: string }> = [
    { id: "week", title: "Popular this week" },
    { id: "month", title: "Popular this month" },
    { id: "year", title: "Popular this year" },
];

export type PopularPeriod = "week" | "month" | "year";

export type MediaType = "Manga" | "Manhwa" | "Manhua";

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "in-process", title: "In Process" },
    { id: "completed", title: "Completed" },
    { id: "hiatus", title: "Hiatus" },
];

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "latest", title: "Latest" },
    { id: "popular_month", title: "Popular This Month" },
    { id: "popular_year", title: "Popular This Year" },
    { id: "title", title: "A–Z" },
    { id: "title_desc", title: "Z–A" },
];

export interface PageMetadata {
    page: number;
}

export interface SeriesChapter {
    chapterId: string;
    chapterNumber: string;
    title?: string | null;
    status?: string | null;
    createdAt?: string | null;
}

export interface Series {
    seriesId: string;
    title: string;
    slug: string;
    originalTitle?: string | null;
    artist?: string | null;
    author?: string | null;
    coverUrl?: string | null;
    bannerUrl?: string | null;
    description?: string | null;
    publicationStatus?: string | null;
    countryOfOrigin?: string | null;
    contentType?: string;
    lastChapterUploadedAt?: string | null;
    genres?: string[];
    latestChapter?: SeriesChapter | null;
    averageRating?: number | null;
    totalViews?: string | number | null;
}

export interface SeriesResponse {
    data: Series[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface BannerResponse {
    featuredSeries: Series[];
}

export interface PopularSeriesResponse {
    data: Series[];
}

export interface Genre {
    slug: string;
    label: string;
}

export interface GenreResponse {
    genres: Genre[];
}

export interface SeriesChapterDetails extends SeriesChapter {
    releaseDate?: string | null;
    price?: number | null;
    isFreeNow?: boolean;
    isPurchased?: boolean;
}

export interface ChapterListResponse {
    chapters: SeriesChapterDetails[];
}

export interface ChapterPage {
    pageNumber?: number;
    url: string;
}

export interface ChapterPagesResponse {
    pages?: ChapterPage[];
    images?: ChapterPage[];
}

export interface MangaListItem {
    mangaId: string;
    title: string;
    imageUrl: string;
    bannerImageUrl: string;
    summary?: string;
    author?: string;
    status?: string;
    rating?: number;
    views?: number;
    contentRating: ContentRating;
    mediaType: MediaType;
}

export interface SeriesQuery {
    page: number;
    limit?: number;
    genres?: string[];
    status?: string;
    search?: string;
    sort?: string;
}
