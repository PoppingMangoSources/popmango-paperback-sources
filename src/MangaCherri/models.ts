/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

export const DOMAIN = "https://mangacherri.com";

/** Setting keys, declared so the store can read them up front. */
export const BASE_URL_KEY = "mangacherri.baseUrl";

export const SETTINGS_KEYS = [BASE_URL_KEY] as const;

/** Ids for the home page sections, referenced when the app asks for more. */
export const SECTIONS = {
    POPULAR: "most-popular",
    WEEKLY: "weekly",
    LATEST: "latest",
    POPULAR_NOW: "popular-now",
    COMPLETED: "completed-romance",
} as const;

/**
 * Home page headings the sections are sliced out of.
 *
 * Kept verbatim, since the carousels carry no ids and are located by the text
 * of their own heading.
 */
export const HOME_TITLES = {
    POPULAR: "Most Popular",
    LATEST: "Latest Chapter",
    POPULAR_NOW: "Popular Now",
    COMPLETED: "Completed Romance Manga",
} as const;

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    GENRE: "genre",
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

/**
 * Carried between pages of a listing.
 *
 * The pagination markup is not consistent across these pages, so the ids
 * already shown are carried forward and a page that adds nothing new ends the
 * listing.
 */
export interface PageMetadata {
    page: number;
    seen: string[];
}

/** One series as it appears in any listing or carousel on the site. */
export interface MangaCard {
    slug: string;
    title: string;
    cover: string;
    rating?: string;
    views?: string;
    chapterId?: string;
    chapterLabel?: string;
    updatedAt?: string;
    genres: string[];
}

/**
 * A genre the site can browse.
 *
 * Browsing goes one genre at a time through a query parameter, so the id is an
 * app-safe slug and the value is the exact name that parameter wants.
 */
export interface Genre {
    id: string;
    value: string;
}

export const GENRES: Genre[] = [
    { id: "adventure", value: "Adventure" },
    { id: "animals", value: "Animals" },
    { id: "comedy", value: "Comedy" },
    { id: "drama", value: "Drama" },
    { id: "fantasy", value: "Fantasy" },
    { id: "gyaru", value: "Gyaru" },
    { id: "isekai", value: "Isekai" },
    { id: "josei", value: "Josei" },
    { id: "magic", value: "Magic" },
    { id: "manhua", value: "Manhua" },
    { id: "manhwa", value: "Manhwa" },
    { id: "music", value: "Music" },
    { id: "mystery", value: "Mystery" },
    { id: "office", value: "Office" },
    { id: "parody", value: "Parody" },
    { id: "psychological", value: "Psychological" },
    { id: "romance", value: "Romance" },
    { id: "school", value: "School" },
    { id: "sci-fi", value: "Sci-fi" },
    { id: "seinen", value: "Seinen" },
    { id: "shoujo", value: "Shoujo" },
    { id: "shounen", value: "Shounen" },
    { id: "slice-of-life", value: "Slice of Life" },
    { id: "sports", value: "Sports" },
    { id: "supernatural", value: "Supernatural" },
];

/**
 * Genres that mark a title as mature.
 *
 * Romance manhwa here can carry suggestive content, so a title is escalated
 * when its genres say so and treated as safe otherwise.
 */
export const MATURE_GENRES = ["josei", "seinen", "mature", "adult", "smut", "ecchi"];
