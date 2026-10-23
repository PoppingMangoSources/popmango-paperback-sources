/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://mangadot.net";

export const STATE_KEYS = {
    SEARCH_ORIGINS: "search_origins",
    HIDDEN_TAGS: "hidden_tags",
    SECTION_ORIGINS: "section_origins",
    TIME_RANGE: "time_range",
    VISIBLE_SECTIONS: "visible_sections",
    ADULT: "adult",
    GENRES: "genres",
    GENRES_FETCHED_AT: "genres_fetched_at",
} as const;

export const SETTINGS_KEYS = Object.values(STATE_KEYS);

/** How long the site's genre list is kept before it is asked for again, as in 0.9. */
export const GENRES_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * The site's content types, by country of origin.
 *
 * Manhua covers both of the site's Chinese origins, which its own filter sends
 * together.
 */
export const ORIGIN_OPTIONS = [
    { id: "JP", title: "Manga", value: "JP" },
    { id: "KR", title: "Manhwa", value: "KR" },
    { id: "CN", title: "Manhua", value: "CN,TW" },
    { id: "ONESHOT", title: "Oneshot", value: "ONESHOT" },
] as const;

export const STATUS_OPTIONS: Tag[] = [
    { id: "Ongoing", title: "Ongoing" },
    { id: "Completed", title: "Completed" },
    { id: "Hiatus", title: "Interrupted" },
];

/** The site's own adult filter, with the labels the 0.9 source gives it. */
export const ADULT_OPTIONS = [
    { id: "0", title: "No" },
    { id: "1", title: "Yes" },
    { id: "both", title: "Both" },
] as const;

export type AdultChoice = (typeof ADULT_OPTIONS)[number]["id"];

/** Search orders. Relevance only means something with a search term. */
export const SORT_OPTIONS: Tag[] = [
    { id: "relevance", title: "Relevance" },
    { id: "latest", title: "Latest" },
    { id: "alphabetical", title: "Title" },
    { id: "chapters", title: "Chapters" },
    { id: "views", title: "Most viewed" },
    { id: "tracked", title: "Most tracked" },
    { id: "rating", title: "Top rated" },
];

export const ORDER_OPTIONS: Tag[] = [
    { id: "desc", title: "Descending" },
    { id: "asc", title: "Ascending" },
];

/**
 * The span a ranked home row covers.
 *
 * 0.9 offers the day, week and month as genre links; 0.8 cannot show those,
 * so the span is a setting the rows follow instead.
 */
export const TIME_RANGE_OPTIONS = [
    { id: "all", title: "All time" },
    { id: "daily", title: "Day" },
    { id: "weekly", title: "Week" },
    { id: "monthly", title: "Month" },
] as const;

export type TimeRange = (typeof TIME_RANGE_OPTIONS)[number]["id"];

export const SECTIONS = {
    MOST_VIEWED: "most_viewed",
    TOP_RATED: "top_rated",
    MOST_TRACKED: "most_tracked",
    LATEST_UPDATES: "latest_updates",
    RECENTLY_ADDED: "recently_added",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

// 0.9's genre, theme and demographic rows are links rather than titles, which
// 0.8 cannot show; those tags stay reachable as search filters.
export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
    [SECTIONS.MOST_VIEWED]: { id: SECTIONS.MOST_VIEWED, title: "Most Viewed", type: DiscoverSectionType.featured },
    [SECTIONS.TOP_RATED]: { id: SECTIONS.TOP_RATED, title: "Top Rated", type: DiscoverSectionType.prominentCarousel },
    [SECTIONS.MOST_TRACKED]: {
        id: SECTIONS.MOST_TRACKED,
        title: "Most Tracked Comics",
        type: DiscoverSectionType.simpleCarousel,
    },
    [SECTIONS.LATEST_UPDATES]: {
        id: SECTIONS.LATEST_UPDATES,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
    },
    [SECTIONS.RECENTLY_ADDED]: {
        id: SECTIONS.RECENTLY_ADDED,
        title: "Recently Added",
        type: DiscoverSectionType.simpleCarousel,
    },
};

/** 0.9's default order. */
export const SECTION_IDS: SectionId[] = [
    SECTIONS.MOST_VIEWED,
    SECTIONS.TOP_RATED,
    SECTIONS.MOST_TRACKED,
    SECTIONS.LATEST_UPDATES,
    SECTIONS.RECENTLY_ADDED,
];

export const SECTION_OPTIONS = SECTION_IDS.map((id) => ({ id, title: SECTION_DEFINITIONS[id].title }));

/** The rows the site ranks over a day, week or month. */
export const RANGED_SECTIONS: ReadonlySet<string> = new Set([
    SECTIONS.TOP_RATED,
    SECTIONS.MOST_TRACKED,
    SECTIONS.RECENTLY_ADDED,
]);

export const FILTERS = {
    SORT: "sort",
    ORDER: "order",
    GENRE: "genre",
    STATUS: "status",
    ORIGIN: "origin",
    ADULT: "adult",
} as const;

export const FIELDS = {
    AUTHOR: "author",
    ARTIST: "artist",
} as const;

export const FILTER_SEPARATOR = "::";

/** Builds a tag that remembers which filter it came from. */
export function filterTag(section: string, id: string, title: string): Tag {
    return { id: `${section}${FILTER_SEPARATOR}${id}`, title };
}

export function splitFilterTag(tagId: string): { section: string; value: string } | undefined {
    const index = tagId.indexOf(FILTER_SEPARATOR);
    if (index <= 0) {
        return undefined;
    }
    return { section: tagId.slice(0, index), value: tagId.slice(index + FILTER_SEPARATOR.length) };
}

/**
 * The groups the site's genres are shown in, as the 0.9 search form shows
 * them. Every group filters the same genres parameter.
 */
export const TAG_GROUPS = [
    { id: "genres", title: "Genres" },
    { id: "demographic", title: "Demographic" },
    { id: "themes", title: "Themes & content" },
    { id: "more", title: "More" },
] as const;

export type TagGroupId = (typeof TAG_GROUPS)[number]["id"];

const TAG_GROUP_OF: Record<string, TagGroupId> = {
    Shounen: "demographic",
    Seinen: "demographic",
    Shoujo: "demographic",
    Josei: "demographic",
    Kids: "demographic",

    Action: "genres",
    Adventure: "genres",
    Comedy: "genres",
    Drama: "genres",
    Fantasy: "genres",
    Horror: "genres",
    Mystery: "genres",
    Romance: "genres",
    "Sci-Fi": "genres",
    "Slice of Life": "genres",
    Sports: "genres",
    Thriller: "genres",
    Tragedy: "genres",
    Psychological: "genres",
    Supernatural: "genres",
    Mecha: "genres",
    Historical: "genres",

    Isekai: "themes",
    Ecchi: "themes",
    Harem: "themes",
    "Martial Arts": "themes",
    "School Life": "themes",
    Magic: "themes",
    Military: "themes",
    Music: "themes",
    Demons: "themes",
    Vampire: "themes",
    Game: "themes",
    Cooking: "themes",
    Medical: "themes",
    Webtoon: "themes",
};

export const tagGroupOf = (name: string): TagGroupId => TAG_GROUP_OF[name] ?? "more";

export interface PageMetadata {
    page: number;
}

// ---------------------------------------------------------------------------
// The site's API
// ---------------------------------------------------------------------------

/** A title as the home rows list it. */
export interface MangaSectionItem {
    id: number;
    title: string;
    photo: string;
    status?: string | null;
    hiatus?: string | null;
    country_of_origin?: string | null;
    chapter_count?: number | null;
    view_count?: number | null;
    tracked_count?: number | null;
    avg_rating?: number | null;
    rating_count?: number | null;
    last_chapter_date?: string | null;
    is_blurworthy?: number | boolean | null;
}

/** A title as search and the details page describe it. */
export interface MangaData extends MangaSectionItem {
    genres?: string[] | null;
    date_added?: string | null;
    description?: string | null;
    banner_image?: string | null;
    content_rating?: string | null;
    alt_titles?: string[] | string | null;
    authors?: string[] | string | null;
    artists?: string[] | string | null;
    is_adult?: boolean | null;
}

export interface SearchResponse {
    manga_list?: MangaData[] | null;
    pagination?: { total_pages?: number | null } | null;
}

export interface MangaSection {
    items?: MangaSectionItem[] | null;
}

export interface MangaDataResponse {
    manga?: MangaData | null;
}

export interface ChapterEntry {
    id: number;
    chapter_number?: number | null;
    volume_number?: number | null;
    chapter_title?: string | null;
    language?: string | null;
    /** "trusted" chapters are served from the site's uploads rather than its chapter store. */
    uploader_upload_status?: string | null;
    date_added?: string | null;
    scanlator_name?: string | null;
    group_name?: string | null;
}

export interface ChapterImagesResponse {
    images?: Array<{ url?: string | null } | null> | null;
}

export interface PeopleResponse {
    suggestions?: string[] | null;
}
