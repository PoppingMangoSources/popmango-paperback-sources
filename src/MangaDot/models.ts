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
    CHAPTER_LANGUAGES: "chapter_languages",
    CHAPTER_UPLOADS: "chapter_uploads",
    GENRES: "genres",
} as const;

export const SETTINGS_KEYS = Object.values(STATE_KEYS);

/** How long the site's genre list is kept before it is asked for again. */
export const GENRES_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

/** The languages the site's chapters come in, by the codes it gives them. */
export const LANGUAGE_OPTIONS = [
    { id: "ar", title: "Arabic" },
    { id: "bg", title: "Bulgarian" },
    { id: "my", title: "Burmese" },
    { id: "zh", title: "Chinese" },
    { id: "zh-hk", title: "Chinese (Hong Kong)" },
    { id: "cs", title: "Czech" },
    { id: "da", title: "Danish" },
    { id: "nl", title: "Dutch" },
    { id: "en", title: "English" },
    { id: "tl", title: "Filipino" },
    { id: "fi", title: "Finnish" },
    { id: "fr", title: "French" },
    { id: "ka", title: "Georgian" },
    { id: "de", title: "German" },
    { id: "el", title: "Greek" },
    { id: "he", title: "Hebrew" },
    { id: "hi", title: "Hindi" },
    { id: "hu", title: "Hungarian" },
    { id: "id", title: "Indonesian" },
    { id: "it", title: "Italian" },
    { id: "ja", title: "Japanese" },
    { id: "ko", title: "Korean" },
    { id: "la", title: "Latin" },
    { id: "lt", title: "Lithuanian" },
    { id: "ms", title: "Malay" },
    { id: "mn", title: "Mongolian" },
    { id: "no", title: "Norwegian" },
    { id: "pl", title: "Polish" },
    { id: "pt", title: "Portuguese" },
    { id: "pt-br", title: "Portuguese (Brazil)" },
    { id: "ro", title: "Romanian" },
    { id: "ru", title: "Russian" },
    { id: "es", title: "Spanish" },
    { id: "es-la", title: "Spanish (Latin America)" },
    { id: "sv", title: "Swedish" },
    { id: "th", title: "Thai" },
    { id: "tr", title: "Turkish" },
    { id: "uk", title: "Ukrainian" },
    { id: "vi", title: "Vietnamese" },
];

export const DEFAULT_LANGUAGES = ["en"];

/** Which of a chapter's uploads are listed, when it has several. */
export const UPLOAD_OPTIONS = [
    { id: "group", title: "One group per series" },
    { id: "best", title: "Best upload per chapter" },
    { id: "all", title: "Every upload" },
] as const;

export type UploadChoice = (typeof UPLOAD_OPTIONS)[number]["id"];

/**
 * Groups whose uploads are official releases, by name in lower case.
 *
 * The site marks none itself. These are the names the Aidoku source
 * recognises, with the site's own Official group and the platforms seen on
 * it besides.
 */
export const OFFICIAL_GROUPS: ReadonlySet<string> = new Set([
    "official",
    "official?",
    "animate international",
    "comikey",
    "crunchyroll",
    "dark horse manga",
    "fakku",
    "j-novel club",
    "k-manga",
    "k manga",
    "kodansha usa",
    "kodansha comics",
    "manga plus",
    "mangaplus",
    "manga up!",
    "one peace books",
    "seven seas entertainment",
    "square enix manga",
    "viz manga",
    "viz media",
    "viz shonen jump",
    "yen press",
    "manta",
    "tapas",
    "tappytoon",
    "webtoon",
    "line webtoon",
    "toomics",
]);

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
    TRENDING: "trending",
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
    [SECTIONS.TRENDING]: { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.simpleCarousel },
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

/** 0.9's default order, with the site's newer Trending row after the first. */
export const SECTION_IDS: SectionId[] = [
    SECTIONS.MOST_VIEWED,
    SECTIONS.TRENDING,
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
    /** 0 when the upload has no group. */
    group_id?: number | null;
    group_name?: string | null;
    /** Every group credited, for a joint release. */
    groups?: Array<{ id?: number | null; name?: string | null } | null> | null;
    uploader_id?: string | null;
    uploader_username?: string | null;
}

export interface ChapterImagesResponse {
    images?: Array<{ url?: string | null } | null> | null;
}

export interface PeopleResponse {
    suggestions?: string[] | null;
}
