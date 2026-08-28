/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://chikari.moe";
export const API_URL = `${DOMAIN}/api`;

export const PAGE_SIZE = 24;

/** How many tags the search screen offers, most used first. */
export const TAG_LIMIT = 100;

/** Characters the app refuses to accept inside an id. */
export const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

/**
 * The site also publishes novels, which this extension does not carry.
 *
 * A 0.8 chapter is a list of page images, so prose has nowhere to go. The
 * novel endpoints are simply not called, and "novel" is not a type a reader
 * can choose.
 */

/** Setting keys, declared so the store can read them up front. */
export const STATE_KEYS = {
    CONTENT_RATINGS: "chikari_content_ratings",
    CONTENT_TYPES: "chikari_content_types",
    EXCLUDED_GENRES: "chikari_excluded_genres",
    EXCLUDED_TAGS: "chikari_excluded_tags",
    VISIBLE_SECTIONS: "chikari_visible_sections",
} as const;

export const SETTINGS_KEYS = Object.values(STATE_KEYS);

export type ContentPreferenceRating = "safe" | "suggestive" | "erotica" | "pornographic";
export type Period = "day" | "week" | "month" | "all";
export type SeriesStatus = "releasing" | "completed" | "hiatus" | "cancelled" | "upcoming";
export type SeriesType = "manga" | "manhwa" | "manhua" | "oel";
export type SortId = "popular" | "top_rated" | "trending" | "updated" | "added" | "most_bookmarked";

export const DEFAULT_CONTENT_RATINGS: ContentPreferenceRating[] = ["safe", "suggestive"];
export const DEFAULT_CONTENT_TYPES: SeriesType[] = ["manga", "manhwa", "manhua"];

export const CONTENT_RATING_OPTIONS: Array<{ id: ContentPreferenceRating; title: string }> = [
    { id: "safe", title: "Safe" },
    { id: "suggestive", title: "Suggestive" },
    { id: "erotica", title: "Erotica" },
    { id: "pornographic", title: "Pornographic" },
];

export const CONTENT_TYPE_OPTIONS: Array<{ id: SeriesType; title: string }> = [
    { id: "manga", title: "Manga" },
    { id: "manhwa", title: "Manhwa" },
    { id: "manhua", title: "Manhua" },
    { id: "oel", title: "OEL" },
];

export interface ChikariPreferences {
    adult: boolean;
    contentRatings: ContentPreferenceRating[];
    excludedGenres: string[];
    excludedTags: string[];
    types: SeriesType[];
}

export interface SeriesItem {
    slug: string;
    title: string;
    type: string;
    status: SeriesStatus;
    is_nsfw: boolean;
    chapter_count: number;
    cover_url: string;
    latest_chapter: number | null;
    last_chapter_at: string | null;
    rating: number | null;
    views: number;
}

export interface HomeRow {
    slug: "trending" | "popular" | "top-rated" | "recently-updated" | "recently-added";
    items: SeriesItem[];
}

export interface HomeResponse {
    rows: HomeRow[];
}

export interface SeriesListResponse {
    items: SeriesItem[];
    total: number;
}

export interface SeriesCredit {
    name: string;
    role: "author" | "artist";
}

export interface SeriesGenre {
    slug: string;
    name: string;
}

export interface SeriesTag {
    id: number;
    name: string;
    is_spoiler: boolean;
}

export interface ChapterItem {
    number: number | null;
    volume: string;
    title: string;
    lang: string;
    created_at: string;
}

export interface SeriesDetails {
    slug: string;
    title: string;
    type: string;
    status: SeriesStatus;
    is_nsfw: boolean;
    chapter_count: number;
    cover_url: string;
    description: string;
    alt_titles: string[];
    authors: SeriesCredit[];
    genres: SeriesGenre[];
    tags: SeriesTag[];
    rating: number | null;
    views: number;
    year: number | null;
}

export interface ChapterListResponse {
    items: ChapterItem[];
    total: number;
}

export interface ChapterDetailsResponse {
    pages: string[];
}

export interface GenreOption {
    slug: string;
    name: string;
}

export interface TagOption {
    id: number;
    name: string;
    count: number;
}

export interface PageMetadata {
    offset: number;
}

/** Ids for the home page sections. */
export const SECTIONS = {
    FEATURED: "featured",
    RECENTLY_UPDATED: "recently-updated",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

/**
 * The home page sections.
 *
 * 0.9 also carried strips of links into the trending, bookmark and by-type
 * charts. 0.8 has no tile that can hold a link, so those moved to the search
 * filters; the novel shelves are gone with the novels.
 */
export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
    [SECTIONS.FEATURED]: { id: SECTIONS.FEATURED, title: "Popular", type: DiscoverSectionType.featured },
    [SECTIONS.RECENTLY_UPDATED]: {
        id: SECTIONS.RECENTLY_UPDATED,
        title: "Recently Updated",
        type: DiscoverSectionType.chapterUpdates,
    },
};

export const SECTION_IDS: SectionId[] = Object.values(SECTIONS);

export const SECTION_OPTIONS: Array<{ id: string; title: string }> = SECTION_IDS.map((id) => ({
    id,
    title: SECTION_DEFINITIONS[id].title,
}));

export const SORT_OPTIONS: Array<{ id: SortId; title: string }> = [
    { id: "popular", title: "Popularity" },
    { id: "top_rated", title: "Top Rated" },
    { id: "trending", title: "Trending" },
    { id: "updated", title: "Recently Updated" },
    { id: "added", title: "Recently Added" },
    { id: "most_bookmarked", title: "Most Bookmarked" },
];

export const PERIOD_OPTIONS: Array<{ id: Period; title: string }> = [
    { id: "day", title: "Today" },
    { id: "week", title: "This week" },
    { id: "month", title: "This month" },
];

export const STATUS_OPTIONS: Array<{ id: SeriesStatus; title: string }> = [
    { id: "releasing", title: "Releasing" },
    { id: "completed", title: "Completed" },
    { id: "hiatus", title: "Hiatus" },
    { id: "cancelled", title: "Cancelled" },
    { id: "upcoming", title: "Upcoming" },
];

export const TYPE_OPTIONS: Array<{ id: SeriesType; title: string }> = CONTENT_TYPE_OPTIONS;

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    PERIOD: "period",
    GENRE: "genre",
    TAG: "tag",
    TYPE: "type",
    STATUS: "status",
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
export const MIN_CHAPTERS_FIELD = "minChapters";
export const YEAR_FIELD = "year";

/** Everything the catalogue query accepts. */
export interface SeriesQueryOptions {
    contentRatings: ContentPreferenceRating[];
    adult: boolean;
    excludedGenres: string[];
    excludedTags: string[];
    genres: string[];
    limit?: number;
    minChapters?: number;
    offset: number;
    period?: Period;
    query?: string;
    sort: SortId;
    statuses: SeriesStatus[];
    tags: string[];
    types: SeriesType[];
    years: string[];
}
