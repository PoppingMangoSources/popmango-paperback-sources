/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Tag } from "../../common";

/** Every domain the site answers on. They all serve the same catalogue. */
export const MIRRORS: Array<{ id: string; title: string }> = [
    { id: "https://kaliscan.com", title: "kaliscan.com" },
    { id: "https://kaliscan.me", title: "kaliscan.me" },
    { id: "https://kaliscan.io", title: "kaliscan.io" },
    { id: "https://mgjinx.com", title: "mgjinx.com" },
];

export const DOMAIN = MIRRORS[0]?.id ?? "https://kaliscan.com";

export const MIRROR_IDS: string[] = MIRRORS.map((mirror) => mirror.id);

/** Setting keys, declared so the store can read them up front. */
export const BASE_URL_KEY = "kaliscan.baseUrl";
export const ACTIVE_BASE_URL_KEY = "kaliscan.activeBaseUrl";
export const FAILOVER_KEY = "kaliscan.automaticFailover";

export const SETTINGS_KEYS = [BASE_URL_KEY, ACTIVE_BASE_URL_KEY, FAILOVER_KEY] as const;

/** Ids for the home page sections. */
export const SECTIONS = {
    POPULAR: "popular",
    HOT: "hot-updates",
    LATEST: "latest",
    NEWEST: "newest",
    REVIEWS: "top-reviews",
} as const;

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    STATUS: "status",
    GENRE: "genre",
    GENRE_MODE: "genremode",
    TOP: "top",
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
export const AUTHOR_FIELD = "author";

/** The windows the site's own charts cover. */
export const TOP_RANGES: Array<{ id: string; title: string }> = [
    { id: "day", title: "Top today" },
    { id: "week", title: "Top this week" },
    { id: "month", title: "Top this month" },
];

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "views", title: "Views" },
    { id: "updated_at", title: "Updated" },
    { id: "created_at", title: "Created" },
    { id: "name", title: "Name A-Z" },
    { id: "rating", title: "Rating" },
];

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "ongoing", title: "Ongoing" },
    { id: "completed", title: "Completed" },
];

/** How several chosen genres combine. Picking neither leaves "all of them". */
export const GENRE_MODE_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "and", title: "Match all genres" },
    { id: "or", title: "Match any genre" },
];

export interface PageMetadata {
    page?: number;
    /** Ids already shown, so the second page does not repeat the first. */
    seen?: string[];
}

export interface KaliCard {
    url: string;
    title: string;
    cover: string;
    latestChapter?: string;
    latestChapterUrl?: string;
    views?: string;
    rating?: string;
    genres: string[];
    summary?: string;
    updatedAt?: string;
    isAdult?: boolean;
}

export const GENRES: Array<{ id: string; title: string }> = [
    { id: "action", title: "Action" },
    { id: "adaptation", title: "Adaptation" },
    { id: "adult", title: "Adult" },
    { id: "adventure", title: "Adventure" },
    { id: "animal", title: "Animal" },
    { id: "anthology", title: "Anthology" },
    { id: "cartoon", title: "Cartoon" },
    { id: "comedy", title: "Comedy" },
    { id: "comic", title: "Comic" },
    { id: "cooking", title: "Cooking" },
    { id: "demons", title: "Demons" },
    { id: "doujinshi", title: "Doujinshi" },
    { id: "drama", title: "Drama" },
    { id: "ecchi", title: "Ecchi" },
    { id: "fantasy", title: "Fantasy" },
    { id: "full-color", title: "Full Color" },
    { id: "game", title: "Game" },
    { id: "gender-bender", title: "Gender Bender" },
    { id: "ghosts", title: "Ghosts" },
    { id: "harem", title: "Harem" },
    { id: "historical", title: "Historical" },
    { id: "horror", title: "Horror" },
    { id: "isekai", title: "Isekai" },
    { id: "josei", title: "Josei" },
    { id: "long-strip", title: "Long Strip" },
    { id: "mafia", title: "Mafia" },
    { id: "magic", title: "Magic" },
    { id: "manga", title: "Manga" },
    { id: "manhua", title: "Manhua" },
    { id: "manhwa", title: "Manhwa" },
    { id: "martial-arts", title: "Martial Arts" },
    { id: "mature", title: "Mature" },
    { id: "mecha", title: "Mecha" },
    { id: "medical", title: "Medical" },
    { id: "military", title: "Military" },
    { id: "monster", title: "Monster" },
    { id: "monster-girls", title: "Monster Girls" },
    { id: "monsters", title: "Monsters" },
    { id: "music", title: "Music" },
    { id: "mystery", title: "Mystery" },
    { id: "office", title: "Office" },
    { id: "office-workers", title: "Office Workers" },
    { id: "one-shot", title: "One Shot" },
    { id: "police", title: "Police" },
    { id: "psychological", title: "Psychological" },
    { id: "reincarnation", title: "Reincarnation" },
    { id: "romance", title: "Romance" },
    { id: "school-life", title: "School Life" },
    { id: "sci-fi", title: "Sci-fi" },
    { id: "science-fiction", title: "Science Fiction" },
    { id: "seinen", title: "Seinen" },
    { id: "shoujo", title: "Shoujo" },
    { id: "shoujo-ai", title: "Shoujo Ai" },
    { id: "shounen", title: "Shounen" },
    { id: "shounen-ai", title: "Shounen Ai" },
    { id: "slice-of-life", title: "Slice of Life" },
    { id: "smut", title: "Smut" },
    { id: "soft-yaoi", title: "Soft Yaoi" },
    { id: "sports", title: "Sports" },
    { id: "super-power", title: "Super Power" },
    { id: "superhero", title: "Superhero" },
    { id: "supernatural", title: "Supernatural" },
    { id: "thriller", title: "Thriller" },
    { id: "time-travel", title: "Time Travel" },
    { id: "tragedy", title: "Tragedy" },
    { id: "vampire", title: "Vampire" },
    { id: "vampires", title: "Vampires" },
    { id: "video-games", title: "Video Games" },
    { id: "villainess", title: "Villainess" },
    { id: "web-comic", title: "Web Comic" },
    { id: "webtoons", title: "Webtoons" },
    { id: "yaoi", title: "Yaoi" },
    { id: "yuri", title: "Yuri" },
    { id: "zombies", title: "Zombies" },
];

/** Genres that make a title explicit rather than merely mature. */
export const ADULT_GENRES = [
    "adult",
    "smut",
    "ecchi",
    "mature",
    "yaoi",
    "soft yaoi",
    "yuri",
    "doujinshi",
];
