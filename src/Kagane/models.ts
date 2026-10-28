/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const MIRRORS = ["kagane.cx", "kagane.org", "kagane.si", "kagane.moe", "kagane.net"];
export const DEFAULT_MIRROR = "kagane.cx";
export const DOMAIN = `https://${DEFAULT_MIRROR}`;

const IMAGE_CDN = "kstatic.to";

// Page URLs carry the reader token, so a `cache_url` outside these hosts is not followed.
export function isTrustedHost(host: string): boolean {
    const name = host.toLowerCase();
    return (
        name === IMAGE_CDN ||
        name.endsWith(`.${IMAGE_CDN}`) ||
        MIRRORS.some((mirror) => name === mirror || name.endsWith(`.${mirror}`))
    );
}

export const PAGE_SIZE = 50;
export const HOME_ROW_SIZE = 20;
export const TRENDING_SIZE = 20;

export const MAX_IDS = 50; // Longer id lists fail with `too_many_values`

export const MAX_FILTER_PAGES = 10; // Pages scanned when "match all" tags are checked locally

export const STATE_KEYS = {
    MIRROR: "kagane_mirror",
    CONTENT_RATINGS: "kagane_content_ratings",
    LANGUAGES: "kagane_languages",
    UPLOAD_SOURCE: "kagane_upload_source",
    HIDE_DISTURBING: "kagane_hide_disturbing",
    EXCLUDED_GENRES: "kagane_excluded_genres",
    HIDDEN_TAGS: "kagane_hidden_tags",
    HIDDEN_THEMES: "kagane_hidden_themes",
    SHOW_SOURCE_IN_TITLE: "kagane_show_source_in_title",
    SHOW_SPOILER_TAGS: "kagane_show_spoiler_tags",
    VISIBLE_SECTIONS: "kagane_visible_sections",
} as const;

export const SETTINGS_KEYS = Object.values(STATE_KEYS);

export type ContentRatingId = "Safe" | "Suggestive" | "Erotica" | "Pornographic";

export const CONTENT_RATING_OPTIONS: Array<{ id: ContentRatingId; title: string }> = [
    { id: "Safe", title: "Safe" },
    { id: "Suggestive", title: "Suggestive" },
    { id: "Erotica", title: "Erotica" },
    { id: "Pornographic", title: "Pornographic" },
];

// A narrower default silently hides editions rated one step higher than the first.
export const DEFAULT_CONTENT_RATINGS: ContentRatingId[] = CONTENT_RATING_OPTIONS.map(({ id }) => id);

export const DEFAULT_LANGUAGES = ["en"];

export const LANGUAGE_OPTIONS: Tag[] = [
    { id: "en", title: "English" },
    { id: "ja", title: "Japanese" },
    { id: "ko", title: "Korean" },
    { id: "zh", title: "Chinese" },
    { id: "es", title: "Spanish" },
    { id: "es-419", title: "Spanish (Latin America)" },
    { id: "fr", title: "French" },
    { id: "de", title: "German" },
    { id: "it", title: "Italian" },
    { id: "pt", title: "Portuguese" },
    { id: "pt-br", title: "Portuguese (Brazil)" },
    { id: "ru", title: "Russian" },
    { id: "pl", title: "Polish" },
    { id: "tr", title: "Turkish" },
    { id: "ar", title: "Arabic" },
    { id: "id", title: "Indonesian" },
    { id: "th", title: "Thai" },
    { id: "vi", title: "Vietnamese" },
    { id: "hi", title: "Hindi" },
];

export type UploadSourceMode = "all" | "official" | "scanlations";

export const UPLOAD_SOURCE_OPTIONS: Array<{ id: UploadSourceMode; title: string }> = [
    { id: "all", title: "All uploads" },
    { id: "official", title: "Official only" },
    { id: "scanlations", title: "Scanlations only" },
];

export const SOURCE_TYPES: Record<UploadSourceMode, string[] | undefined> = {
    all: undefined,
    official: ["Official"],
    scanlations: ["Unofficial", "Mixed"],
};

export const FORMAT_OPTIONS: Tag[] = ["Manga", "Manhwa", "Manhua", "Comic", "Other"].map((format) => ({
    id: format,
    title: format,
}));

export const STATUS_OPTIONS: Tag[] = [
    { id: "Ongoing", title: "Ongoing" },
    { id: "Completed", title: "Completed" },
    { id: "Hiatus", title: "Hiatus" },
    { id: "Abandoned", title: "Cancelled" },
];

// "" is relevance (no sort parameter); every other field is sent descending.
export const SORT_OPTIONS: Tag[] = [
    { id: "", title: "Relevance" },
    { id: "avg_views_today", title: "Most read today" },
    { id: "avg_views_week", title: "Most read this week" },
    { id: "popular_now", title: "Popular now" },
    { id: "avg_views_month", title: "Most read this month" },
    { id: "avg_views", title: "Most read of all time" },
    { id: "updated_at", title: "Last updated" },
    { id: "rating", title: "Rating" },
    { id: "created_at", title: "Date added" },
    { id: "current_books", title: "Chapter count" },
];

export const BROWSE_SORT = "avg_views"; // Relevance is meaningless without a query

export type DisturbingMode = "show" | "only" | "hide";

export const DISTURBING_OPTIONS: Array<{ id: DisturbingMode; title: string }> = [
    { id: "show", title: "Include" },
    { id: "only", title: "Only" },
    { id: "hide", title: "Leave out" },
];

export const MATCH_OPTIONS: Tag[] = [
    { id: "all", title: "Match all" },
    { id: "any", title: "Match any" },
];

export const GENRE_TYPES: Array<{ id: string; title: string }> = [
    { id: "genre", title: "Genres" },
    { id: "theme", title: "Themes" },
    { id: "demographic", title: "Demographics" },
    { id: "format", title: "Formats" },
];

export const FILTERS = {
    SORT: "sort",
    RATING: "rating",
    GENRE: "genre",
    GENRE_MATCH: "genrematch",
    TAG_MATCH: "tagmatch",
    FORMAT: "format",
    STATUS: "status",
    PUBLICATION: "publication",
    SOURCE: "source",
    DISTURBING: "disturbing",
    EXACT: "exact",
} as const;

export const FILTER_SEPARATOR = "::";

// 0.8 returns selected tags as one flat list, so the section is encoded in the id.
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

export const FIELDS = {
    TAGS: "tags",
    STAFF: "staff",
    GROUP: "group",
    CHAPTERS: "chapters",
    START_YEAR: "start_year",
} as const;

export const SECTIONS = {
    POPULAR: "popular",
    WEEKLY_CHART: "weekly_chart",
    MONTH: "trending_month",
    WEEK: "trending_week",
    LATEST: "latest_updates",
    TODAY: "trending_today",
    RECENTLY_ADDED: "recently_added",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export interface KaganeSection extends DiscoverSection {
    sort: string;
}

export const DISCOVER_SECTIONS: Record<SectionId, KaganeSection> = {
    [SECTIONS.POPULAR]: {
        id: SECTIONS.POPULAR,
        title: "Popular All Time",
        type: DiscoverSectionType.featured,
        sort: "avg_views",
    },
    [SECTIONS.WEEKLY_CHART]: {
        id: SECTIONS.WEEKLY_CHART,
        title: "Trending This Week",
        type: DiscoverSectionType.prominentCarousel,
        sort: "",
    },
    [SECTIONS.MONTH]: {
        id: SECTIONS.MONTH,
        title: "Popular This Month",
        type: DiscoverSectionType.simpleCarousel,
        sort: "avg_views_month",
    },
    [SECTIONS.WEEK]: {
        id: SECTIONS.WEEK,
        title: "Popular This Week",
        type: DiscoverSectionType.simpleCarousel,
        sort: "avg_views_week",
    },
    [SECTIONS.LATEST]: {
        id: SECTIONS.LATEST,
        title: "Recently Updated",
        type: DiscoverSectionType.chapterUpdates,
        sort: "updated_at",
    },
    [SECTIONS.TODAY]: {
        id: SECTIONS.TODAY,
        title: "Popular Today",
        type: DiscoverSectionType.simpleCarousel,
        sort: "avg_views_today",
    },
    [SECTIONS.RECENTLY_ADDED]: {
        id: SECTIONS.RECENTLY_ADDED,
        title: "Recently Added",
        type: DiscoverSectionType.simpleCarousel,
        sort: "created_at",
    },
};

export const SECTION_IDS: SectionId[] = Object.values(SECTIONS);
export const SECTION_OPTIONS = SECTION_IDS.map((id) => ({ id, title: DISCOVER_SECTIONS[id].title }));

export interface PageMetadata {
    page: number; // 1-based; the API itself is 0-based
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface SearchOptions {
    query?: string;
    sort: string;
    exactMatch: boolean;
    contentRatings: ContentRatingId[];
    languages: string[];
    uploadSource: UploadSourceMode;
    disturbing: DisturbingMode;
    formats: string[];
    statuses: string[];
    publicationStatuses: string[];
    sourceIds: string[];
    genres: { included: string[]; excluded: string[]; matchAll: boolean };
    tags: { included: string[][]; excluded: string[]; matchAll: boolean }; // One id group per name (case-variant duplicates)
    staffId?: string;
    groupId?: string;
    chapters?: { min?: number; max?: number };
    startYear?: { min?: number; max?: number };
}

export interface LatestChapter {
    book_id: string;
    title?: string | null;
    chapter_no?: string | null;
    volume_no?: string | null;
    created_at?: string | null;
    available_at?: string | null;
}

export interface SeriesSummary {
    series_id: string;
    title: string;
    source_id?: string | null;
    cover_image_id?: string | null;
    age_rating?: string | null;
    is_pornographic?: boolean | null;
    is_disturbing?: boolean | null;
    format?: string | null;
    current_books?: number | null;
    translated_language?: string | null;
    genres?: string[] | null; // Ids; the weekly chart is filtered locally against these
    tags?: string[] | null;
    latest_chapters?: LatestChapter[] | null;
    hidden_by_filter?: boolean | null;
}

export interface SearchResponse {
    content?: SeriesSummary[] | null;
    last?: boolean | null;
}

export interface TrendingResponse {
    items?: Array<{ series?: SeriesSummary | null; hidden_by_filter?: boolean | null }> | null;
}

export interface SeriesDetails {
    title: string;
    description?: string | null;
    upload_status?: string | null;
    publication_status?: string | null;
    format?: string | null;
    source_id?: string | null;
    age_rating?: string | null;
    is_pornographic?: boolean | null;
    original_language?: string | null;
    translated_language?: string | null;
    current_books?: number | null;
    total_views?: number | null;
    average_rating?: number | null;
    start_year?: number | null;
    series_staff?: Array<{ name: string; role: string }> | null;
    genres?: Array<{ genre_id: string; genre_name: string; is_spoiler?: boolean | null }> | null;
    tags?: Array<{ tag_id: string; tag_name: string; is_spoiler?: boolean | null }> | null;
    series_alternate_titles?: Array<{ title: string }> | null;
    series_covers?: Array<{ image_id: string }> | null;
    main_cover_id?: string | null;
}

// Columnar: each book is a row of values in `fields` order.
export interface BookIndexResponse {
    count: number;
    fields: string[];
    groups: Array<{ title: string }>;
    books: unknown[][];
}

export interface Book {
    bookId: string;
    title: string;
    sortNo: number;
    chapterNo?: string;
    volumeNo?: string;
    groups: string[];
    releasedAt?: Date;
    pageCount?: number;
}

export interface GenreEntry {
    id: string;
    genre_name: string;
    genre_type?: string | null;
}

export interface TagEntry {
    id: string;
    tag_name: string;
}

export interface UploadSource {
    source_id: string;
    source_type?: string | null;
    title: string;
}

export interface IntegrityResponse {
    token: string;
    exp: number; // Unix seconds
}

export interface ManifestPage {
    page_no: number;
    page_id: string;
    ext?: string | null;
}

export interface ReaderSession {
    access_token: string;
    cache_url?: string | null;
    manifest?: { pages?: ManifestPage[] | null } | null;
}
