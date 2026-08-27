/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://www.mangatown.com";

/** Page images are fetched one request per page; cap how many run at once. */
export const READER_CONCURRENCY = 4;

/** Setting keys, declared so the store can read them up front. */
export const VISIBLE_SECTIONS_KEY = "mangatown.visibleSections";

export const SETTINGS_KEYS = [VISIBLE_SECTIONS_KEY] as const;

/** Ids for the home page sections, referenced when the app asks for more. */
export const SECTIONS = {
    FEATURED: "featured",
    HOT: "hot",
    LATEST: "latest",
    NEW: "new",
    ROMANCE: "romance",
    SHOUNEN: "shounen",
    TOP_SHOUNEN: "top-shounen",
    SEINEN: "seinen",
    TOP_SEINEN: "top-seinen",
    SHOUJO: "shoujo",
    TOP_SHOUJO: "top-shoujo",
    YAOI: "yaoi",
    SHOUNEN_AI: "shounen-ai",
    JOSEI: "josei",
    TOP_YAOI: "top-yaoi",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

/**
 * Every section the source can show, in the order they appear.
 *
 * A reader can hide any of them from the settings screen; the whole list is
 * shown until they do.
 */
export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
    [SECTIONS.FEATURED]: { id: SECTIONS.FEATURED, title: "Featured Manga", type: DiscoverSectionType.featured },
    [SECTIONS.HOT]: { id: SECTIONS.HOT, title: "Hot Manga", type: DiscoverSectionType.prominentCarousel },
    [SECTIONS.LATEST]: { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
    [SECTIONS.NEW]: { id: SECTIONS.NEW, title: "New Manga Releases", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.ROMANCE]: { id: SECTIONS.ROMANCE, title: "Romance Releases", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.SHOUNEN]: { id: SECTIONS.SHOUNEN, title: "Shounen Releases", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.TOP_SHOUNEN]: { id: SECTIONS.TOP_SHOUNEN, title: "Top Shounen", type: DiscoverSectionType.featured },
    [SECTIONS.SEINEN]: { id: SECTIONS.SEINEN, title: "Seinen Releases", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.TOP_SEINEN]: { id: SECTIONS.TOP_SEINEN, title: "Top Seinen", type: DiscoverSectionType.featured },
    [SECTIONS.SHOUJO]: { id: SECTIONS.SHOUJO, title: "Shoujo Releases", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.TOP_SHOUJO]: { id: SECTIONS.TOP_SHOUJO, title: "Top Shoujo", type: DiscoverSectionType.featured },
    [SECTIONS.YAOI]: { id: SECTIONS.YAOI, title: "Yaoi Releases", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.SHOUNEN_AI]: { id: SECTIONS.SHOUNEN_AI, title: "Shounen Ai Releases", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.JOSEI]: { id: SECTIONS.JOSEI, title: "Josei Releases", type: DiscoverSectionType.simpleCarousel },
    [SECTIONS.TOP_YAOI]: { id: SECTIONS.TOP_YAOI, title: "Top Yaoi", type: DiscoverSectionType.featured },
};

export const SECTION_ORDER: SectionId[] = Object.keys(SECTION_DEFINITIONS) as SectionId[];

export const SECTION_OPTIONS: Array<{ id: string; title: string }> = SECTION_ORDER.map((id) => ({
    id,
    title: SECTION_DEFINITIONS[id].title,
}));

/**
 * Ids of the filter sections shown on the search screen.
 *
 * 0.8 hands every chosen filter back as a flat list of tags, so each tag id is
 * prefixed with the section it came from and split apart again when the search
 * request is assembled.
 */
export const FILTERS = {
    SORT: "sort",
    GENRE: "genre",
    DEMOGRAPHIC: "demo",
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

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "views", title: "Views" },
    { id: "az", title: "A-Z" },
    { id: "rating", title: "Rating" },
    { id: "latest", title: "Latest Updated" },
];

/** Bare query keys the site's listing tabs append for each ordering. */
export const SORT_TOKENS: Record<string, string> = {
    views: "",
    az: "name.az",
    rating: "rating.za",
    latest: "last_chapter_time.za",
};

export const GENRES: Array<{ id: string; title: string }> = [
    { id: "4_koma", title: "4 Koma" },
    { id: "action", title: "Action" },
    { id: "adventure", title: "Adventure" },
    { id: "comedy", title: "Comedy" },
    { id: "cooking", title: "Cooking" },
    { id: "doujinshi", title: "Doujinshi" },
    { id: "drama", title: "Drama" },
    { id: "ecchi", title: "Ecchi" },
    { id: "fantasy", title: "Fantasy" },
    { id: "gender_bender", title: "Gender Bender" },
    { id: "harem", title: "Harem" },
    { id: "historical", title: "Historical" },
    { id: "horror", title: "Horror" },
    { id: "martial_arts", title: "Martial Arts" },
    { id: "mature", title: "Mature" },
    { id: "mecha", title: "Mecha" },
    { id: "music", title: "Music" },
    { id: "mystery", title: "Mystery" },
    { id: "one_shot", title: "One Shot" },
    { id: "psychological", title: "Psychological" },
    { id: "reverse_harem", title: "Reverse Harem" },
    { id: "romance", title: "Romance" },
    { id: "school_life", title: "School Life" },
    { id: "sci_fi", title: "Sci Fi" },
    { id: "shotacon", title: "Shotacon" },
    { id: "slice_of_life", title: "Slice Of Life" },
    { id: "smut", title: "Smut" },
    { id: "sports", title: "Sports" },
    { id: "supernatural", title: "Supernatural" },
    { id: "suspense", title: "Suspense" },
    { id: "tragedy", title: "Tragedy" },
    { id: "vampire", title: "Vampire" },
    { id: "webtoons", title: "Webtoons" },
    { id: "youkai", title: "Youkai" },
];

export const DEMOGRAPHICS: Array<{ id: string; title: string }> = [
    { id: "shounen", title: "Shounen" },
    { id: "seinen", title: "Seinen" },
    { id: "shoujo", title: "Shoujo" },
    { id: "shoujo_ai", title: "Shoujo Ai" },
    { id: "josei", title: "Josei" },
    { id: "shounen_ai", title: "Shounen Ai" },
    { id: "yaoi", title: "Yaoi" },
    { id: "yuri", title: "Yuri" },
];

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "completed", title: "Completed" },
    { id: "ongoing", title: "Ongoing" },
];

/** Maps a genre slug back to the name the search endpoint expects. */
export const GENRE_TITLES = new Map<string, string>(
    [...GENRES, ...DEMOGRAPHICS].map((tag) => [tag.id, tag.title]),
);

/** Which slice of the directory a browsing section covers. */
export interface DirectoryFilters {
    demographic?: string;
    genre?: string;
    status?: string;
    sortToken?: string;
}

/** Everything the site's search endpoint accepts. */
export interface SearchRequest {
    name?: string;
    author?: string;
    artist?: string;
    includedGenres?: string[];
    excludedGenres?: string[];
    demographic?: string;
    isCompleted?: string;
}

/** Carried between pages of a paginated listing. */
export interface PageMetadata {
    page: number;
}

/** The newest chapter, as shown on a listing tile. */
export interface ListingChapter {
    chapterId: string;
    label: string;
    chapNum?: number;
}

/** One series as it appears in a listing, before the details page is fetched. */
export interface MangaListItem {
    mangaId: string;
    title: string;
    imageUrl: string;
    genres: string[];
    rating?: number;
    author?: string;
    status?: string;
    views?: number;
    rank?: number;
    chapter?: ListingChapter;
    updatedAt?: Date;
}
