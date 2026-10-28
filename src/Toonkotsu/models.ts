/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://toonkotsu.com";

export const PAGE_SIZE = 42;

// The reader's signing secret and the build it shipped with. The key endpoint
// reports the live build, so a mismatch names the cause when the site has
// rotated the secret. 0.9 can recover a rotated secret by running the site's
// reader in a web view; 0.8 has no such call, so these are updated by hand.
export const READER_SECRET = "NO57DoQRq7oxY3MCO5_SNw4_3vFRsUq7";
export const READER_BUILD = "1738e5282ffc19e6";

export const STATE_KEYS = {
    CONTENT_RATINGS: "toonkotsu_content_ratings",
    TYPES: "toonkotsu_types",
    HIDDEN_TAGS: "toonkotsu_hidden_tags",
    VISIBLE_SECTIONS: "toonkotsu_visible_sections",
    DEDUPLICATE_CHAPTERS: "toonkotsu_deduplicate_chapters",
    UPLOAD_CHOICE: "toonkotsu_upload_choice",
    SHOW_UPLOAD_SIZE: "toonkotsu_show_upload_size",
} as const;

export type UploadChoice = "best" | "smallest";

/**
 * Which of a chapter's uploads to keep.
 *
 * The site often carries the same chapter several times over, at very
 * different sizes, and every byte of a page is decrypted on the phone before
 * it can be shown, so the lighter upload is worth offering.
 */
export const UPLOAD_CHOICE_OPTIONS: Array<{ id: UploadChoice; title: string }> = [
    { id: "best", title: "Best quality" },
    { id: "smallest", title: "Smallest download" },
];

export const SETTINGS_KEYS = Object.values(STATE_KEYS);

export const SECTIONS = {
    MOST_READ: "most-read",
    TRENDING: "trending",
    RECENTLY_ADDED: "recently-added",
    HIDDEN_GEMS: "hidden-gems",
    LATEST: "latest",
    THIS_SEASON: "this-season",
    COMPLETED: "completed",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

/**
 * The home page rows.
 *
 * The site's genre rail is left out: 0.8 has no tile that can hold a link to a
 * search, and the genres are all reachable as search filters instead.
 */
export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
    [SECTIONS.MOST_READ]: { id: SECTIONS.MOST_READ, title: "Most Read", type: DiscoverSectionType.featured },
    [SECTIONS.TRENDING]: { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.prominentCarousel },
    [SECTIONS.RECENTLY_ADDED]: {
        id: SECTIONS.RECENTLY_ADDED,
        title: "Recently Added",
        type: DiscoverSectionType.simpleCarousel,
    },
    [SECTIONS.HIDDEN_GEMS]: { id: SECTIONS.HIDDEN_GEMS, title: "Hidden Gems", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.LATEST]: { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
    [SECTIONS.THIS_SEASON]: { id: SECTIONS.THIS_SEASON, title: "This Season", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.COMPLETED]: { id: SECTIONS.COMPLETED, title: "Completed", type: DiscoverSectionType.simpleCarousel },
};

export const SECTION_IDS: SectionId[] = Object.values(SECTIONS);
export const SECTION_OPTIONS: Tag[] = SECTION_IDS.map((id) => ({ id, title: SECTION_DEFINITIONS[id].title }));

// The site's sort menu, in its order and under its names, each with the
// catalogue token the site's own table sends. It gives ten names to eight
// orders: Updated and Uploaded Date are one, and View and Follow Count another,
// and the same pairs pick the same list on the site.
export const SORT_OPTIONS = [
    { id: "createdAt", title: "Created Date", value: "new" },
    { id: "updatedAt", title: "Updated Date", value: "latest" },
    { id: "lastUploadedChapterAt", title: "Uploaded Date", value: "latest" },
    { id: "relevance", title: "Best Match", value: "relevance" },
    { id: "title", title: "Title", value: "title" },
    { id: "year", title: "Year", value: "year" },
    { id: "rating", title: "Rating", value: "score" },
    { id: "views", title: "View Count", value: "popular" },
    { id: "follows", title: "Follow Count", value: "popular" },
    { id: "chapters", title: "Chapter Count", value: "chapters" },
] as const;

// Default follows the site: a title list starts at A, every other sort newest
// or highest first.
export const ORDER_OPTIONS: Tag[] = [
    { id: "desc", title: "Descending" },
    { id: "asc", title: "Ascending" },
];

export const CONTENT_RATING_OPTIONS: Tag[] = [
    { id: "safe", title: "Safe" },
    { id: "suggestive", title: "Suggestive" },
    { id: "erotica", title: "Erotica" },
    { id: "pornographic", title: "Pornographic" },
];

export const DEFAULT_CONTENT_RATINGS = ["safe", "suggestive", "erotica"];

// The catalogue files a series by its original language; these are the types
// that language makes.
export const TYPE_OPTIONS = [
    { id: "manga", title: "Manga", languages: ["ja", "ja-ro"] },
    { id: "manhwa", title: "Manhwa", languages: ["ko", "ko-ro"] },
    { id: "manhua", title: "Manhua", languages: ["zh", "zh-hk", "zh-ro"] },
    { id: "oel", title: "OEL", languages: ["en"] },
    { id: "other", title: "Other", languages: ["xx"] },
];

export const COUNTRY_OPTIONS: Tag[] = [
    { id: "ja", title: "Japan" },
    { id: "ko", title: "Korea" },
    { id: "zh", title: "China" },
    { id: "en", title: "Western" },
];

export const DEMOGRAPHIC_OPTIONS: Tag[] = [
    { id: "shounen", title: "Shounen" },
    { id: "shoujo", title: "Shoujo" },
    { id: "seinen", title: "Seinen" },
    { id: "josei", title: "Josei" },
    { id: "none", title: "None" },
];

export const STATUS_OPTIONS = [
    { id: "ongoing", title: "Ongoing", value: "Ongoing" },
    { id: "completed", title: "Completed", value: "Complete" },
    { id: "hiatus", title: "Hiatus", value: "Hiatus" },
    { id: "cancelled", title: "Cancelled", value: "Canceled" },
];

export const MATCH_MODE_OPTIONS: Tag[] = [
    { id: "all", title: "AND" },
    { id: "any", title: "OR" },
];

// Tags the site keeps out of its genre list: demographics have their own
// filter, and these are never offered for browsing.
export const UNLISTED_TAGS = new Set(["Shounen", "Shoujo", "Seinen", "Josei", "Lolicon", "Shotacon", "Other"]);
export const PORNOGRAPHIC_TAGS = new Set(["Hentai", "Adult", "Smut"]);

// The site's tag picker: anything the catalogue files under a category reads as
// a theme there, as do a few uncategorised names, and only the adult tags and
// Doujinshi stand apart from the genres.
export const TAG_GROUPS = [
    { id: "content", title: "Content" },
    { id: "format", title: "Format" },
    { id: "genres", title: "Genre" },
    { id: "themes", title: "Theme" },
] as const;
export const CONTENT_TAGS = new Set(["Ecchi", "Mature", "Smut", "Adult", "Hentai"]);
export const FORMAT_TAGS = new Set(["Doujinshi"]);
export const THEME_TAGS = new Set([
    "School Life",
    "Martial Arts",
    "Harem",
    "Isekai",
    "Gender Bender",
    "Mecha",
    "Supernatural",
    "Historical",
]);

export const STATUS_NAMES: Record<string, string> = {
    Complete: "Completed",
    Canceled: "Cancelled",
};

/**
 * Search filter sections, whose ids namespace the tags inside them.
 *
 * 0.8 has no search form, so the site's filters that are a choice from a list
 * become tag sections; every tag group filters the same genres parameter, so
 * they share one namespace.
 */
export const FILTERS = {
    SORT: "sort",
    ORDER: "order",
    RATING: "rating",
    STATUS: "status",
    DEMOGRAPHIC: "demo",
    COUNTRY: "country",
    OPTIONS: "options",
    INC_MODE: "incmode",
    EXC_MODE: "excmode",
    GENRE: "genre",
} as const;

/** The one choice in the "Options" section. */
export const HAS_CHAPTERS = "has_chapters";

/** The free-text boxes offered beside the filters. */
export const FIELDS = {
    YEAR_FROM: "year_from",
    YEAR_TO: "year_to",
    CHAPTERS_MIN: "chapters_min",
    CHAPTERS_MAX: "chapters_max",
    AUTHOR: "author",
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

export type ContentRatingId = "safe" | "suggestive" | "erotica" | "pornographic";

export interface PageMetadata {
    page: number;
    /** Titles already shown in Latest Updates, so a later page does not repeat them. */
    seen?: number[];
}

export interface LatestChapterRef {
    id?: number;
    label?: string | null;
    n?: number | null;
    at?: number | null;
}

export interface Series {
    id: number;
    hid?: string | null;
    slug?: string | null;
    title: string;
    titles?: { english?: string | null; romaji?: string | null; native?: string | null } | null;
    alt?: string[] | null;
    description?: string | null;
    year?: number | null;
    type?: string | null;
    tags?: string[] | null;
    spoilerTags?: string[] | null;
    status?: string | null;
    cover?: string | null;
    banner?: string | null;
    hero?: string | null;
    score?: number | null;
    latest?: LatestChapterRef | null;
    chapters?: number | null;
    authors?: string[] | null;
    adult?: boolean | null;
    /** Chapter opens, on reading rankings. */
    count?: number | null;
}

export interface ChapterGroup {
    slug?: string | null;
    name?: string | null;
}

export interface ChapterRelease {
    id: number;
    label?: string | null;
    at?: number | null;
    src?: string | null;
    group?: ChapterGroup | null;
    partial?: boolean | null;
    /** Page width in pixels and download size in megabytes, which rank a group's uploads. */
    w?: number | null;
    mb?: number | null;
}

export interface ChapterEntry extends ChapterRelease {
    n?: number | null;
    vol?: string | number | null;
    alts?: ChapterRelease[] | null;
}

export interface SeriesListResponse {
    items: Series[];
    page?: number;
    limit?: number;
    total?: number;
    hasNextPage?: boolean;
}

export interface LatestResponse {
    items: { chapter: ChapterEntry; series: Series }[];
    page?: number;
    hasNextPage?: boolean;
}

export interface SeriesResponse {
    series: Series;
    chapters: ChapterEntry[];
}

export interface Facet {
    name: string;
    category?: string | null;
    isAdult?: boolean | null;
}

export interface FacetsResponse {
    genres?: Facet[];
}

export interface ReaderKeyResponse {
    key: string;
    build: string;
    now: number;
}

export interface ReaderLimit {
    code?: string;
    error?: string;
    reason?: string;
    resign?: boolean;
    transient?: boolean;
    retryAfterSec?: number;
}
