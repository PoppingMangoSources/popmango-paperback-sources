/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

export const DOMAIN = "https://mangaberri.com";

/** Setting keys, declared so the store can read them up front. */
export const BASE_URL_KEY = "mangaberri.baseUrl";

export const SETTINGS_KEYS = [BASE_URL_KEY] as const;

/** Ids for the home page sections, referenced when the app asks for more. */
export const SECTIONS = {
    MOST_VIEWED: "most-viewed",
    WEEKLY: "weekly",
    SHOUNEN: "shounen",
    LATEST: "latest",
    SEINEN: "seinen",
    POPULAR_TODAY: "popular-today",
    MANHWA_MANHUA: "manhwa-manhua",
} as const;

/**
 * Home page headings the sections are sliced out of.
 *
 * Kept verbatim, since the blocks carry no ids and are located by the text of
 * their own heading.
 */
export const HOME_TITLES = {
    MOST_VIEWED: "Most Viewed",
    POPULAR_TODAY: "Popular Today",
    LATEST: "Latest Update",
} as const;

/** Genre names behind the three ranked carousels. */
export const RANKED_GENRES = {
    SHOUNEN: "Shounen",
    SEINEN: "Seinen",
    MANHWA_MANHUA: "Manhwa/Manhua",
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
    { id: "action", value: "Action" },
    { id: "adventure", value: "Adventure" },
    { id: "comedy", value: "Comedy" },
    { id: "crime", value: "Crime" },
    { id: "demons", value: "Demons" },
    { id: "drama", value: "Drama" },
    { id: "ecchi", value: "Ecchi" },
    { id: "fantasy", value: "Fantasy" },
    { id: "girls-love", value: "Girls Love" },
    { id: "gourmet", value: "Gourmet" },
    { id: "harem", value: "Harem" },
    { id: "horror", value: "Horror" },
    { id: "isekai", value: "Isekai" },
    { id: "iyashikei", value: "Iyashikei" },
    { id: "kids", value: "Kids" },
    { id: "magic", value: "Magic" },
    { id: "manhwa-manhua", value: "Manhwa/Manhua" },
    { id: "martial-arts", value: "Martial Arts" },
    { id: "mecha", value: "Mecha" },
    { id: "military", value: "Military" },
    { id: "mystery", value: "Mystery" },
    { id: "parody", value: "Parody" },
    { id: "psychological", value: "Psychological" },
    { id: "romance", value: "Romance" },
    { id: "school", value: "School" },
    { id: "sci-fi", value: "Sci-Fi" },
    { id: "seinen", value: "Seinen" },
    { id: "shoujo", value: "Shoujo" },
    { id: "shounen", value: "Shounen" },
    { id: "slice-of-life", value: "Slice of Life" },
    { id: "space", value: "Space" },
    { id: "sports", value: "Sports" },
    { id: "super-power", value: "Super Power" },
    { id: "supernatural", value: "Supernatural" },
    { id: "thriller", value: "Thriller" },
    { id: "vampire", value: "Vampire" },
];

/** Genres that mark a title as mature; anything else is treated as safe. */
export const MATURE_GENRES = ["seinen", "ecchi", "harem", "mature", "adult", "smut"];
