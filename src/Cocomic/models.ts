/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { ContentRating, Tag } from "../../common";

export const DOMAIN = "https://cocomic.co";

/** Ids for the home page sections, referenced when the app asks for more. */
export const SECTIONS = {
    TOP_RATED: "top_rated",
    ONLY_COCOMIC: "only_cocomic",
    NEW_RELEASES: "new_releases",
    LATEST_UPDATES: "latest_updates",
    TODAYS_OFFICIAL: "todays_official",
    YAOI: "yaoi",
    MANHWA: "manhwa",
    SMUT: "smut",
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
    ADULT: "adult",
    GENRE_MATCH: "genre_match",
} as const;

/** Separates a filter section id from the value within it. */
export const FILTER_SEPARATOR = ":";

export function filterTag(section: string, id: string, title: string): Tag {
    return { id: `${section}${FILTER_SEPARATOR}${id}`, title };
}

/** Splits a tag id back into the section it belongs to and its own value. */
export function splitFilterTag(tagId: string): { section: string; value: string } | undefined {
    const index = tagId.indexOf(FILTER_SEPARATOR);
    if (index <= 0) {
        return undefined;
    }
    return { section: tagId.slice(0, index), value: tagId.slice(index + 1) };
}

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "relevance", title: "Relevance" },
    { id: "latest", title: "Latest" },
    { id: "alphabet", title: "A-Z" },
    { id: "rating", title: "Rating" },
    { id: "trending", title: "Trending" },
    { id: "views", title: "Most Views" },
    { id: "new-manga", title: "New" },
];

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "on-going", title: "Ongoing" },
    { id: "end", title: "Completed" },
    { id: "canceled", title: "Canceled" },
    { id: "on-hold", title: "On Hold" },
    { id: "upcoming", title: "Upcoming" },
];

export const ADULT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "0", title: "Exclude adult" },
    { id: "1", title: "Adult only" },
];

export const GENRE_MATCH_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "and", title: "Match all chosen genres" },
];

/** Everything the site's search page accepts, gathered from the chosen filters. */
export interface SearchRequest {
    title?: string;
    sortBy?: string;
    genres?: string[];
    genreMatch?: "and" | "or";
    adult?: string;
    statuses?: string[];
}

/** The newest chapter, as shown on a listing tile. */
export interface ListingChapter {
    chapterId: string;
    title: string;
    publishDate?: Date;
}

/** One series as it appears in a listing, before the details page is fetched. */
export interface MangaListItem {
    mangaId: string;
    title: string;
    imageUrl: string;
    contentRating: ContentRating;
    genres: string[];
    chapter?: ListingChapter;
    alternativeTitle?: string;
    status?: string;
    rating?: number;
}

/** Carried between pages of a paginated listing. */
export interface PageMetadata {
    page: number;
}
