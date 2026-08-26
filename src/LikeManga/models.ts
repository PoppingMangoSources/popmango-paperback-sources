/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

export const DOMAIN = "https://likemanga.ink";

/** How many results the site returns per page of a listing. */
export const PAGE_SIZE = 36;

/** Ids for the home page sections, referenced when the app asks for more. */
export const SECTIONS = {
    MOST_FOLLOWED: "most_followed",
    NEW_MANGA: "new_manga",
    LATEST_RELEASES: "latest_releases",
    TOP_SERIES: "top_series",
    HOT: "hot",
} as const;

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
    STATUS: "status",
    MIN_CHAPTERS: "min_chapters",
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
    { id: "lastest-chap", title: "Latest Chapter" },
    { id: "lastest-manga", title: "Newest Manga" },
    { id: "top-manga", title: "Most Viewed" },
    { id: "top-month", title: "Top This Month" },
    { id: "top-week", title: "Top This Week" },
    { id: "top-day", title: "Top Today" },
    { id: "follow", title: "Most Followed" },
    { id: "comment", title: "Most Commented" },
    { id: "num-chap", title: "Most Chapters" },
];

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "Complete", title: "Complete" },
    { id: "In process", title: "In process" },
    { id: "Pause", title: "Pause" },
];

export const MIN_CHAPTER_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "50", title: "50 chapters or more" },
    { id: "100", title: "100 chapters or more" },
    { id: "200", title: "200 chapters or more" },
    { id: "300", title: "300 chapters or more" },
    { id: "400", title: "400 chapters or more" },
    { id: "500", title: "500 chapters or more" },
];

/**
 * Which window the "Top Series" rail covers.
 *
 * 0.9 let the reader switch between them inside the section. 0.8 sections
 * carry no controls of their own, so the monthly chart is shown and the other
 * windows remain reachable through the sort filter in search.
 */
export const TOP_SERIES_SORT = "top-month";

/** Everything the site's search page accepts, gathered from the chosen filters. */
export interface SearchRequest {
    page: number;
    keyword?: string;
    sortBy?: string;
    status?: string;
    genres?: string[];
    minChapters?: string;
}

/** Carried between pages of a paginated listing. */
export interface PageMetadata {
    page: number;
}

/** One chapter, as listed on a tile or in the chapter list. */
export interface ListingChapter {
    chapterId: string;
    title: string;
    dateText: string;
    isNew: boolean;
}

/** One series as it appears in a listing, before the details page is fetched. */
export interface MangaListItem {
    mangaId: string;
    title: string;
    imageUrl: string;
    alternativeTitle?: string;
    description?: string;
    genres: string[];
    status?: string;
    views?: string;
    comments?: string;
    follows?: string;
    rating?: number;
    updatedDate?: Date;
    chapters: ListingChapter[];
}

/** A tile from the "new manga" slider, which carries less than a full card. */
export interface NewMangaItem {
    mangaId: string;
    title: string;
    imageUrl: string;
    chapter?: ListingChapter;
}

/** The chapter list endpoint's reply. */
export interface ChapterAjaxResponse {
    list_chap: string;
    nav?: string;
}

/** What the details page reveals about its own chapter list. */
export interface ChapterPageInfo {
    mangaNumericId?: string;
    lastPage: number;
}
