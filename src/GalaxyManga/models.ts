/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://galaxymanga.io";
export const MANGA_DIR = "manga";

export const NEXT_PAGE_SELECTOR = "div.pagination .next, div.hpage .r, a.next.page-numbers, a.r";

/** Setting keys, declared so the store can read them up front. */
export const VISIBLE_SECTIONS_KEY = "galaxymanga.visibleSections";

export const SETTINGS_KEYS = [VISIBLE_SECTIONS_KEY] as const;

/** Ids for the home page sections. */
export const SECTIONS = {
    POPULAR: "popular",
    TRENDING: "trending",
    POPULAR_TODAY: "popular-today",
    LATEST: "latest",
    FRESH: "fresh",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

/**
 * Every section the source can show, in the order they appear.
 *
 * A reader can hide any of them from the settings screen; the whole list is
 * shown until they do.
 */
export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
    [SECTIONS.POPULAR]: { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
    // 0.9 let the reader switch this chart between weekly, monthly and all
    // time. 0.8 sections carry no controls, so it shows the weekly chart and
    // the other windows stay reachable through the search filters.
    [SECTIONS.TRENDING]: {
        id: SECTIONS.TRENDING,
        title: "Trending This Week",
        type: DiscoverSectionType.simpleCarousel,
    },
    [SECTIONS.POPULAR_TODAY]: {
        id: SECTIONS.POPULAR_TODAY,
        title: "Popular Today",
        type: DiscoverSectionType.simpleCarousel,
    },
    [SECTIONS.LATEST]: {
        id: SECTIONS.LATEST,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
    },
    [SECTIONS.FRESH]: {
        id: SECTIONS.FRESH,
        title: "Fresh Arrivals",
        type: DiscoverSectionType.simpleCarousel,
    },
};

export const SECTION_ORDER: SectionId[] = Object.keys(SECTION_DEFINITIONS) as SectionId[];

export const SECTION_OPTIONS: Array<{ id: string; title: string }> = SECTION_ORDER.map((id) => ({
    id,
    title: SECTION_DEFINITIONS[id].title,
}));

/** Headings the home page widgets sit under. */
export const HOME_HEADINGS = {
    POPULAR_TODAY: "Popular Today",
    LATEST: "Latest Update",
    FRESH: "Fresh Arrivals",
} as const;

/** Which window the trending chart covers. */
export const TRENDING_RANGE = "wpop-weekly";

export const TRENDING_RANGES: Array<{ id: string; title: string }> = [
    { id: "wpop-weekly", title: "Trending this week" },
    { id: "wpop-monthly", title: "Trending this month" },
    { id: "wpop-alltime", title: "Trending all time" },
];

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    GENRE: "genre",
    STATUS: "status",
    TYPE: "type",
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

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "ongoing", title: "Ongoing" },
    { id: "completed", title: "Completed" },
    { id: "hiatus", title: "Hiatus" },
];

export const TYPE_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "Manga", title: "Manga" },
    { id: "Manhwa", title: "Manhwa" },
    { id: "Manhua", title: "Manhua" },
    { id: "Comic", title: "Comic" },
];

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "title", title: "A-Z" },
    { id: "titlereverse", title: "Z-A" },
    { id: "update", title: "Latest Update" },
    { id: "latest", title: "Latest Added" },
    { id: "popular", title: "Popular" },
];

/** The site labels series by origin; the featured tile shows where it is from. */
export const TYPE_COUNTRIES: Record<string, string> = {
    manhwa: "Korea",
    manhua: "China",
    manga: "Japan",
};

/** Carried between pages of a paginated listing. */
export interface PageMetadata {
    page: number;
}

export interface MangaCard {
    mangaId: string;
    title: string;
    imageUrl: string;
    chapter?: string;
    rating?: string;
    typeName?: string;
    rank?: number;
    genres: string[];
}

export interface LatestCard extends MangaCard {
    chapterId?: string;
    chapterName?: string;
    publishDate?: Date;
}

/** Everything the directory listing accepts. */
export interface DirectoryRequest {
    title?: string;
    order?: string;
    status?: string;
    type?: string;
    includedGenres?: string[];
    excludedGenres?: string[];
}
