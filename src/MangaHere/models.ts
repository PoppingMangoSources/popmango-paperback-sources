/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://www.mangahere.cc";

/** The mobile site, whose roll reader lists a whole chapter on one page. */
export const MOBILE_DOMAIN = "https://m.mangahere.cc";

/** The newer mobile site, the only one with a trending list. */
export const NEW_MOBILE_DOMAIN = "https://newm.mangahere.cc";

/** The site sometimes drops a connection before answering; these are retried. */
export const SITE_RETRIES = 2;

/** Setting keys, declared so the store can read them up front. */
export const SHOW_ADULT_KEY = "mangahere.showAdult";

export const SETTINGS_KEYS = [SHOW_ADULT_KEY] as const;

/** Ids for the home page sections, referenced when the app asks for more. */
export const SECTIONS = {
    POPULAR: "popular",
    RECOMMENDED: "recommended",
    NEW: "new",
    LATEST: "latest",
    READING_NOW: "reading-now",
    TRENDING: "trending",
    HOT: "hot",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

/**
 * The home page, in the order the site shows it.
 *
 * The site's Ranking and Genres strips are links rather than titles, which a
 * 0.8 row cannot hold; both are search filters instead.
 */
export const SECTION_LIST: DiscoverSection[] = [
    { id: SECTIONS.POPULAR, title: "Most Popular", type: DiscoverSectionType.featured },
    { id: SECTIONS.RECOMMENDED, title: "Recommended", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.NEW, title: "New Manga Releases", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
    { id: SECTIONS.READING_NOW, title: "Being Read Right Now", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.TRENDING, title: "Trending Manga", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.HOT, title: "Hot Manga Releases", type: DiscoverSectionType.simpleCarousel },
];

/** The headings the front page gives the sections it carries. */
export const HOME_TITLES = {
    RECOMMENDED: "Recommended",
    NEW: "New Manga Release",
    READING_NOW: "Being Read Right Now",
    TRENDING: "Trending Manga",
    HOT: "Hot Manga Releases",
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
    RANKING: "ranking",
    GENRE: "genre",
    TYPE: "type",
    STATUS: "status",
    STARS: "stars",
    STARS_MATCH: "starsMatch",
    NAME_MATCH: "nameMatch",
    AUTHOR_MATCH: "authorMatch",
    ARTIST_MATCH: "artistMatch",
    RELEASED_MATCH: "releasedMatch",
} as const;

/** Ids of the free-text boxes beside the filters. */
export const FIELDS = {
    AUTHOR: "author",
    ARTIST: "artist",
    RELEASED: "released",
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

/** Orderings of the directory; the search endpoint has none. */
export const SORT_OPTIONS: Tag[] = [
    { id: "po", title: "Popular" },
    { id: "news", title: "New" },
    { id: "latest", title: "Chapter" },
    { id: "rating", title: "Ratings" },
    { id: "az", title: "Alphabetical" },
];

export const RANKING_PERIODS = [
    { id: "daily", title: "Daily", path: "dayranking", className: "dayrank" },
    { id: "weekly", title: "Weekly", path: "weekranking", className: "weekrank" },
    { id: "monthly", title: "Monthly", path: "monthranking", className: "monthrank" },
] as const;

/** The search endpoint takes the numeric id, the directory the slug. */
export const GENRES = [
    { id: "1", title: "Action", slug: "action" },
    { id: "2", title: "Adventure", slug: "adventure" },
    { id: "3", title: "Comedy", slug: "comedy" },
    { id: "4", title: "Fantasy", slug: "fantasy" },
    { id: "5", title: "Historical", slug: "historical" },
    { id: "6", title: "Horror", slug: "horror" },
    { id: "7", title: "Martial Arts", slug: "martial-arts" },
    { id: "8", title: "Mystery", slug: "mystery" },
    { id: "9", title: "Romance", slug: "romance" },
    { id: "10", title: "Shounen Ai", slug: "shounen-ai" },
    { id: "11", title: "Supernatural", slug: "supernatural" },
    { id: "12", title: "Drama", slug: "drama" },
    { id: "13", title: "Shounen", slug: "shounen" },
    { id: "14", title: "School Life", slug: "school-life" },
    { id: "15", title: "Shoujo", slug: "shoujo" },
    { id: "16", title: "Gender Bender", slug: "gender-bender" },
    { id: "17", title: "Josei", slug: "josei" },
    { id: "18", title: "Psychological", slug: "psychological" },
    { id: "19", title: "Seinen", slug: "seinen" },
    { id: "20", title: "Slice of Life", slug: "slice-of-life" },
    { id: "21", title: "Sci-fi", slug: "sci-fi" },
    { id: "22", title: "Ecchi", slug: "ecchi" },
    { id: "23", title: "Harem", slug: "harem" },
    { id: "24", title: "Shoujo Ai", slug: "shoujo-ai" },
    { id: "25", title: "Yuri", slug: "yuri" },
    { id: "26", title: "Mature", slug: "mature" },
    { id: "27", title: "Tragedy", slug: "tragedy" },
    { id: "28", title: "Yaoi", slug: "yaoi" },
    { id: "29", title: "Doujinshi", slug: "doujinshi" },
    { id: "30", title: "Sports", slug: "sports" },
    { id: "31", title: "Adult", slug: "adult" },
    { id: "32", title: "One Shot", slug: "one-shot" },
    { id: "33", title: "Smut", slug: "smut" },
    { id: "34", title: "Mecha", slug: "mecha" },
    { id: "35", title: "Shotacon", slug: "shotacon" },
    { id: "36", title: "Lolicon", slug: "lolicon" },
    { id: "37", title: "Webtoons", slug: "webtoons" },
] as const;

export const TYPE_OPTIONS: Tag[] = [
    { id: "1", title: "Japanese Manga" },
    { id: "2", title: "Korean Manhwa" },
    { id: "3", title: "Chinese Manhua" },
    { id: "4", title: "European Manga" },
    { id: "5", title: "American Manga" },
    { id: "6", title: "Hong Kong Manga" },
    { id: "7", title: "Other Manga" },
];

/** Completion as the search endpoint numbers it; the directory takes a path segment. */
export const STATUS_OPTIONS = [
    { id: "2", title: "Completed", path: "completed" },
    { id: "1", title: "Ongoing", path: "on_going" },
] as const;

export const STARS_OPTIONS: Tag[] = [
    { id: "0", title: "No star" },
    { id: "1", title: "1 star" },
    { id: "2", title: "2 stars" },
    { id: "3", title: "3 stars" },
    { id: "4", title: "4 stars" },
    { id: "5", title: "5 stars" },
];

/** How a name is matched; the first is the site's default. */
export const MATCH_OPTIONS: Tag[] = [
    { id: "cw", title: "Contains" },
    { id: "bw", title: "Begins with" },
    { id: "ew", title: "Ends with" },
];

/** How a number is compared; the first is the site's default. */
export const COMPARE_OPTIONS: Tag[] = [
    { id: "eq", title: "Exactly" },
    { id: "lt", title: "Less than" },
    { id: "gt", title: "More than" },
];

export const RELEASED_OPTIONS: Tag[] = [
    { id: "eq", title: "In that year" },
    { id: "lt", title: "Before it" },
    { id: "gt", title: "After it" },
];

/** Everything the site's search endpoint accepts. */
export interface SearchRequest {
    title?: string;
    name?: string;
    nameMethod?: string;
    author?: string;
    authorMethod?: string;
    artist?: string;
    artistMethod?: string;
    type?: string;
    includedGenres: string[];
    excludedGenres: string[];
    released?: string;
    releasedMethod?: string;
    rating?: string;
    ratingMethod?: string;
    completion?: string;
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
    volume?: number;
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

/** What the desktop reader page says about its chapter. */
export interface ReaderMetadata {
    /** The site's numeric chapter id, which page requests name. */
    chapterId: string;
    imageCount: number;
    /** Every page, when the reader lists them itself. */
    embeddedPages?: string[];
    /** The key page requests carry, when they have to be asked for one by one. */
    secretKey?: string;
}
