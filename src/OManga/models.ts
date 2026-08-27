/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

export const DEFAULT_DOMAIN = "https://omanga.to";

/** Setting keys, declared so the store can read them up front. */
export const BASE_URL_KEY = "omanga_base_url";
export const ALL_VERSIONS_KEY = "omanga_all_versions";

export const SETTINGS_KEYS = [BASE_URL_KEY, ALL_VERSIONS_KEY] as const;

/** Ids for the home page sections. */
export const SECTIONS = {
    POPULAR: "popular",
    TREND: "trend",
    POPULAR_TODAY: "popular_today",
    UPDATES: "updates",
    NEW_SEASON: "new_season",
    MOST_LIKED: "most_liked",
    BEST_ONGOING: "best_ongoing",
} as const;

/** Headings the home page shelves sit under. */
export const HOME_HEADINGS = {
    POPULAR: "Popular This Week",
    MOST_LIKED: "Most liked",
    NEW_SEASON: "New Season",
    TREND: "In the Trend",
    POPULAR_TODAY: "Popular Today",
    BEST_ONGOING: "Best Ongoings",
} as const;

export type CatalogQuery = Record<string, string | string[] | undefined>;

export interface CatalogResponse {
    items: CatalogItem[];
    hasMore: boolean;
    nextPage?: number | null;
}

/** Teams that publish officially, marked so a reader can tell them apart. */
const OFFICIAL_TEAMS = new Set([
    "official",
    "tapas",
    "webtoon",
    "manta",
    "tappytoon",
    "mangaplus",
    "kodansha",
    "coolmic",
    "omoi",
    "kmanga",
    "toomics",
    "pocketcomics",
    "shonenjump",
    "vizmanga",
    "vizmedia",
    "yenpress",
    "webcomic",
    "webcomics",
    "webcomicsapp",
    "mangaup",
    "inkrcomics",
    "thehoursbetween",
    "jujucat",
    "akumakira",
    "comikey",
    "lezhin",
    "lehzin",
]);

function normaliseTeamKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isOfficialTeam(name?: string | null, slug?: string | null): boolean {
    return [name, slug].some(
        (value) => typeof value === "string" && OFFICIAL_TEAMS.has(normaliseTeamKey(value)),
    );
}

export interface CatalogItem {
    id: number;
    title: string;
    slug: string;
    poster: string;
    /** "Manga", "Manhwa", "Manhua", … */
    type?: string;
    genres?: string[];
    rating?: number;
    views?: number;
    votes?: number;
    /** Home page rows only. */
    year?: number;
    _count?: { chapters?: number };
}

export interface ChapterEntry {
    id: number;
    mangaId: number;
    number: number;
    volume?: number | null;
    title?: string | null;
    /** Written as "$D2026-07-14T02:23:00.772Z" in the page data. */
    createdAt?: string | null;
    translator?: string | null;
    isLocked?: boolean;
    team?: { id?: number; name?: string; slug?: string } | null;
}

export interface SeriesProps {
    mangaId: number;
    slug: string;
    title: string;
    description?: string;
    genres?: string[];
    tags?: string[];
    publisher?: string;
    author?: string;
    artist?: string;
    translator?: string;
    /** "Ongoing", "Completed", "Hiatus", "Cancelled", "Announced" */
    status?: string;
    /** "For all", "12+", "15+", "16+", "18+", "21+" */
    ageRating?: string;
    altNames?: string[];
    chapters?: ChapterEntry[];
}

export interface ReaderChapter {
    id: number;
    number: number;
    title?: string | null;
    volume?: number | null;
    pages?: string[];
    pagesAlt?: string[];
    translator?: string | null;
    team?: { name?: string; slug?: string } | null;
}

export interface PageMetadata {
    page: number;
}

export type TopSeriesCountry = "korea" | "japan" | "china";

export interface OptionItem {
    id: string;
    value: string;
}

function toOptionId(value: string): string {
    return value.replace(/\s+/g, "_");
}

function toOptions(values: string[]): OptionItem[] {
    return values.map((value) => ({ id: toOptionId(value), value }));
}

/** Turns chosen filter ids back into the words the catalogue expects. */
export function resolveOptionValues(options: OptionItem[], ids?: string[]): string[] | undefined {
    if (ids === undefined || ids.length === 0) {
        return undefined;
    }
    return ids.map((id) => options.find((option) => option.id === id)?.value ?? id);
}

export const GENRE_OPTIONS: OptionItem[] = toOptions([
    "Action",
    "Adult",
    "Adventure",
    "Comedy",
    "Doujinshi",
    "Drama",
    "Ecchi",
    "Fantasy",
    "Gender Bender",
    "Harem",
    "Hentai",
    "Historical",
    "Horror",
    "Josei",
    "Lolicon",
    "Martial Arts",
    "Mature",
    "Mecha",
    "Mystery",
    "Psychological",
    "Romance",
    "School Life",
    "Sci-fi",
    "Seinen",
    "Shotacon",
    "Shoujo",
    "Shoujo Ai",
    "Shounen",
    "Shounen Ai",
    "Slice of Life",
    "Smut",
    "Sports",
    "Supernatural",
    "Tragedy",
    "Yaoi",
    "Yuri",
]);

export const GENRE_MATCH_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "and", title: "Match all genres" },
    { id: "or", title: "Match any genre" },
];

export const TYPE_OPTIONS: OptionItem[] = toOptions([
    "Manga",
    "Manhwa",
    "Manhua",
    "One-shot",
    "Doujinshi",
    "Novel",
    "Comics",
    "Other",
]);

export const STATUS_OPTIONS: OptionItem[] = [
    { id: "Ongoing", value: "Ongoing" },
    { id: "Completed", value: "Completed" },
    { id: "Hiatus", value: "On Hiatus" },
    { id: "Cancelled", value: "Axed" },
    { id: "Announced", value: "Preview" },
];

export const AGE_RATING_OPTIONS: OptionItem[] = toOptions(["For all", "12+", "15+", "16+", "18+", "21+"]);

export const MIN_RATING_OPTIONS: OptionItem[] = [
    { id: "5", value: "5+ (Average)" },
    { id: "6", value: "6+ (Good)" },
    { id: "7", value: "7+ (Very Good)" },
    { id: "8", value: "8+ (Excellent)" },
    { id: "9", value: "9+ (Masterpiece)" },
];

const CURRENT_YEAR = new Date().getFullYear();

export const YEAR_OPTIONS: OptionItem[] = Array.from({ length: CURRENT_YEAR - 1950 + 1 }, (_, index) => {
    const year = String(CURRENT_YEAR - index);
    return { id: year, value: year };
});

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "real_views", title: "Popularity" },
    { id: "updated_at", title: "Recently Updated" },
    { id: "created_at", title: "Newest" },
    { id: "rating", title: "Rating" },
    { id: "votes", title: "Votes" },
    { id: "likes", title: "Likes" },
    { id: "chapters", title: "Chapter Count" },
    { id: "by_views", title: "Views" },
];

/** The site's own country charts. */
export const TOP_SERIES_CHIPS: Array<{ id: TopSeriesCountry; title: string; type: string }> = [
    { id: "korea", title: "Top from Korea", type: "Manhwa" },
    { id: "japan", title: "Top from Japan", type: "Manga" },
    { id: "china", title: "Top from China", type: "Manhua" },
];

export interface HomeUpdate {
    id: number;
    number: number;
    volume?: number | null;
    createdAt?: string | null;
    manga?: {
        id: number;
        title: string;
        slug: string;
        type?: string;
        poster?: string;
    };
}

export interface HomeLinkCard {
    slug: string;
    title: string;
    cover: string;
    type?: string;
    year?: string;
}

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    TOP: "top",
    GENRE: "genre",
    GENRE_MODE: "genremode",
    TYPE: "type",
    STATUS: "status",
    AGE: "age",
    RATING: "rating",
    YEAR: "year",
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

/** The free-text boxes offered beside the filters. */
export const CHAPTERS_FROM_FIELD = "chaptersFrom";
export const CHAPTERS_TO_FIELD = "chaptersTo";
export const TAG_FIELD = "tag";
