/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://valirscans.org";

/** Marks a chapter id as one the reader has to unlock before it will open. */
export const LOCKED_CHAPTER_PREFIX = "locked:";

/**
 * The site also publishes novels, which this extension does not carry.
 *
 * A 0.8 chapter is a list of page images, so prose has nowhere to go. Novels
 * are filtered out of every listing and excluded from browse queries.
 */
export const NOVEL_TYPE = "Novel";

/** Setting keys, declared so the store can read them up front. */
export const BASE_URL_KEY = "valirscans.baseUrl";
export const SHOW_PAID_CHAPTERS_KEY = "valirscans.showPaidChapters";

export const SETTINGS_KEYS = [BASE_URL_KEY, SHOW_PAID_CHAPTERS_KEY] as const;

// Genre entries are wrapped as `{ genre: {...} }` in home page payloads but
// flattened to `{ name, slug }` on series detail pages.
export interface ValirGenre {
    genre?: {
        slug?: string;
        name?: string;
    };
    slug?: string;
    name?: string;
}

export interface ValirChapterItem {
    id: string;
    number: number;
    title?: string | null;
    isLocked?: boolean;
    publishedAt?: string | null;
}

export interface ValirSeries {
    slug: string;
    urlSlug?: string;
    title: string;
    type?: string;
    coverImage?: string | null;
    bannerImage?: string | null;
    description?: string | null;
    status?: string | null;
    rating?: number;
    viewCount?: number;
    isMature?: boolean;
    author?: string | null;
    artist?: string | null;
    altTitle?: string | null;
    originalTitle?: string | null;
    aliases?: string[];
    genres?: ValirGenre[];
    tags?: Array<{ name?: string; slug?: string }>;
    chapters?: ValirChapterItem[];
    lastChapterAt?: string | null;
}

// Props of the series detail page component: the series record plus a
// paginated chapter list.
export interface ValirSeriesPage {
    series: ValirSeries;
    chapters?: ValirChapterItem[];
    totalPages?: number;
}

export interface ValirReaderPage {
    pageNumber: number;
    imageUrl: string;
}

export interface ValirChapterData {
    content?: string | null;
    pages?: ValirReaderPage[];
}

export interface HomeSections {
    featured: ValirSeries[];
    editorsPicks: ValirSeries[];
    latestUpdates: ValirSeries[];
    popularToday: ValirSeries[];
    mostPopular: ValirSeries[];
}

export interface FilterOption {
    id: string;
    title: string;
}

export interface BrowsePage {
    series: ValirSeries[];
    hasMore: boolean;
}

export interface FilterTaxonomy {
    genres: FilterOption[];
    tags: FilterOption[];
}

export interface PageMetadata {
    page: number;
}

/** Everything the browse listing accepts. */
export interface BrowseRequest {
    page: number;
    query?: string;
    sort?: string;
    includedGenres?: string[];
    excludedGenres?: string[];
    includedTags?: string[];
    excludedTags?: string[];
    types?: string[];
    statuses?: string[];
    origins?: string[];
    minChapters?: string;
    maxChapters?: string;
}

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    GENRE: "genre",
    TAG: "tag",
    TYPE: "type",
    STATUS: "status",
    ORIGIN: "origin",
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
export const MAX_CHAPTERS_FIELD = "maxChapters";

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "updated", title: "Recently Updated" },
    { id: "popular", title: "Most Bookmarked" },
    { id: "views", title: "Most Viewed" },
    { id: "longest", title: "Longest" },
    { id: "trending", title: "Trending" },
    { id: "rating", title: "Top Rated" },
    { id: "newest", title: "Newest" },
];

// Option ids are the exact values the site's browse URL accepts
// (e.g. ?type=Manhwa, ?status=Ongoing, ?origin=KOREAN).
export const TYPE_OPTIONS: FilterOption[] = [
    { id: "Manhwa", title: "Manhwa" },
    { id: "Manhua", title: "Manhua" },
    { id: "Manga", title: "Manga" },
    { id: "Comic", title: "Comic" },
    { id: "Webtoon", title: "Webtoon" },
];

export const STATUS_OPTIONS: FilterOption[] = [
    { id: "Ongoing", title: "Ongoing" },
    { id: "Completed", title: "Completed" },
    { id: "Hiatus", title: "Hiatus" },
    { id: "Cancelled", title: "Cancelled" },
];

export const ORIGIN_OPTIONS: FilterOption[] = [
    { id: "KOREAN", title: "Korean" },
    { id: "JAPANESE", title: "Japanese" },
    { id: "CHINESE", title: "Chinese" },
    { id: "ENGLISH", title: "English" },
];

// Bundled fallback for the genre filter; the live taxonomy (genres plus the
// larger tag set) is read off the browse page and held for the session.
export const GENRES: FilterOption[] = [
    { id: "action", title: "Action" },
    { id: "adult", title: "Adult" },
    { id: "adventure", title: "Adventure" },
    { id: "comedy", title: "Comedy" },
    { id: "drama", title: "Drama" },
    { id: "ecchi", title: "Ecchi" },
    { id: "fantasy", title: "Fantasy" },
    { id: "gamelit", title: "GameLit" },
    { id: "gender-bender", title: "Gender Bender" },
    { id: "harem", title: "Harem" },
    { id: "historical", title: "Historical" },
    { id: "horror", title: "Horror" },
    { id: "isekai", title: "Isekai" },
    { id: "josei", title: "Josei" },
    { id: "litrpg", title: "LitRPG" },
    { id: "martial-arts", title: "Martial Arts" },
    { id: "mature", title: "Mature" },
    { id: "mecha", title: "Mecha" },
    { id: "military", title: "Military" },
    { id: "mystery", title: "Mystery" },
    { id: "psychological", title: "Psychological" },
    { id: "romance", title: "Romance" },
    { id: "school-life", title: "School Life" },
    { id: "sci-fi", title: "Sci-Fi" },
    { id: "seinen", title: "Seinen" },
    { id: "shoujo", title: "Shoujo" },
    { id: "shoujo-ai", title: "Shoujo Ai" },
    { id: "shounen", title: "Shounen" },
    { id: "shounen-ai", title: "Shounen Ai" },
    { id: "slice-of-life", title: "Slice of Life" },
    { id: "smut", title: "Smut" },
    { id: "sports", title: "Sports" },
    { id: "supernatural", title: "Supernatural" },
    { id: "thriller", title: "Thriller" },
    { id: "tragedy", title: "Tragedy" },
    { id: "virtual-reality", title: "Virtual Reality" },
    { id: "wuxia", title: "Wuxia" },
    { id: "xianxia", title: "Xianxia" },
    { id: "xuanhuan", title: "Xuanhuan" },
    { id: "yaoi", title: "Yaoi" },
    { id: "yuri", title: "Yuri" },
];

/** Ids for the home page sections. */
export const SECTIONS = {
    FEATURED: "featured",
    EDITORS_PICKS: "editors-picks",
    LATEST_COMICS: "latest-comics",
    POPULAR_TODAY: "popular-today",
    MOST_POPULAR: "most-popular",
    NEW_SERIES: "new-series",
} as const;

export const DISCOVER_SECTIONS: DiscoverSection[] = [
    { id: SECTIONS.FEATURED, title: "Top Featured", type: DiscoverSectionType.featured },
    { id: SECTIONS.MOST_POPULAR, title: "Most Popular", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.LATEST_COMICS, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
    { id: SECTIONS.POPULAR_TODAY, title: "Popular Today", type: DiscoverSectionType.prominentCarousel },
    { id: SECTIONS.EDITORS_PICKS, title: "Editors' Picks", type: DiscoverSectionType.prominentCarousel },
    { id: SECTIONS.NEW_SERIES, title: "New Series", type: DiscoverSectionType.simpleCarousel },
];
