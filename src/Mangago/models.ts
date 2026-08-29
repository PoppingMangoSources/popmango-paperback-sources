/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type SearchResultItem, type Tag } from "../../common";

export const DOMAIN = "https://www.mangago.me";

/**
 * The reader wants a desktop browser.
 *
 * Asked as a phone, the reader page hands back one image at a time and the
 * chapter has to be walked page by page; asked as a desktop browser it hands
 * back the whole list at once. Browsing still uses the app's own agent,
 * because the mobile listing is the one that links chapters as `/read-manga/`
 * URLs.
 */
export const READER_USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

/** Settings this source stores. */
export const STATE_KEYS = {
    HIDDEN_GENRES: "mangago_hidden_genres",
    CONTENT_TYPE: "mangago_content_type",
    VISIBLE_SECTIONS: "mangago_visible_sections",
} as const;

export const SETTINGS_KEYS = Object.values(STATE_KEYS);

/** Search filter sections, whose ids namespace the tags inside them. */
export const FILTERS = {
    GENRE: "genre",
    STATUS: "status",
    SORT: "sort",
} as const;

const FILTER_SEPARATOR = "::";

/**
 * Builds a tag that remembers which filter it came from.
 *
 * 0.8 hands back one flat list of chosen tags with no indication of the
 * section each belonged to, so the section is carried in the id.
 */
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

/** Relative update times on the latest list — "5 minutes", "2 hours", "3 days". */
export const RELATIVE_UNIT_MS: Record<string, number> = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
};

export const STATUS_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "f", title: "Completed" },
    { id: "o", title: "Ongoing" },
];

/**
 * Sort orders, as tags rather than a control of their own.
 *
 * 0.8 has no sort picker on the search screen, so these are offered as a
 * section of tags; the first one chosen is the one that takes effect.
 */
export const SORT_OPTIONS: Array<{ id: string; title: string; value: string }> = [
    { id: "alphabetical", title: "Alphabetical", value: "" },
    { id: "views", title: "Views", value: "view" },
    { id: "popularity", title: "Popularity", value: "comment_count" },
    { id: "create_date", title: "Create date", value: "create_date" },
    { id: "update_date", title: "Update date", value: "update_date" },
];

export const GENRES = [
    "Yaoi",
    "Comedy",
    "Shounen Ai",
    "Shoujo",
    "Yuri",
    "Josei",
    "Fantasy",
    "School Life",
    "Romance",
    "Doujinshi",
    "Smut",
    "Adult",
    "Mystery",
    "One Shot",
    "Ecchi",
    "Shounen",
    "Martial Arts",
    "Shoujo Ai",
    "Supernatural",
    "Drama",
    "Action",
    "Adventure",
    "Harem",
    "Historical",
    "Horror",
    "Mature",
    "Mecha",
    "Psychological",
    "Sci-fi",
    "Seinen",
    "Slice Of Life",
    "Sports",
    "Gender Bender",
    "Tragedy",
    "Bara",
    "Webtoons",
];

/** The id a genre is stored under, derived from its name so it round-trips. */
export function genreIdFromTitle(title: string): string {
    return title
        .trim()
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
}

export const GENRE_OPTIONS: Array<{ id: string; title: string }> = GENRES.map((genre) => ({
    id: genreIdFromTitle(genre),
    title: genre,
}));

export function getGenreTitle(idOrTitle: string): string {
    return (
        GENRE_OPTIONS.find((genre) => genre.id === idOrTitle || genre.title === idOrTitle)?.title ??
        idOrTitle
    );
}

/**
 * The site has no content-type field of its own.
 *
 * "Webtoons" is the only signal that a title is a manhwa or manhua, so the
 * type filter is really an include or an exclude of that one genre.
 */
export const CONTENT_TYPE_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "all", title: "Everything" },
    { id: "webtoons", title: "Manhwa and manhua" },
    { id: "manga", title: "Manga" },
];

/** What a scrambled image needs before it can be put back together. */
export interface ImageContext {
    desckey: string;
    cols: number;
}

/** A search or home page tile, plus the extras only the listings carry. */
export interface MangagoListing extends SearchResultItem {
    /** Reader path of the newest chapter, when the listing names one. */
    chapterId?: string;
    /** Only the latest-updates page carries these. */
    publishDate?: Date;
    genres?: string[];
}

export interface MangagoSectionOption {
    id: string;
    title: string;
    type: DiscoverSectionType;
    /** A "Top N" row caps its items; the rest paginate. */
    limit?: number;
}

export const SECTION_OPTIONS: MangagoSectionOption[] = [
    { id: "featured_manga", title: "Featured", type: DiscoverSectionType.featured, limit: 10 },
    { id: "popular_manga", title: "Popular", type: DiscoverSectionType.prominentCarousel },
    { id: "new_chapters", title: "New chapters", type: DiscoverSectionType.chapterUpdates },
    { id: "top_yaoi", title: "Yaoi top 5", type: DiscoverSectionType.featured, limit: 5 },
    { id: "top_shoujo", title: "Shoujo top 10", type: DiscoverSectionType.simpleCarousel, limit: 10 },
    { id: "top_comedy", title: "Comedy top 5", type: DiscoverSectionType.featured, limit: 5 },
    {
        id: "top_supernatural",
        title: "Supernatural top 10",
        type: DiscoverSectionType.simpleCarousel,
        limit: 10,
    },
    { id: "top_fantasy", title: "Fantasy top 5", type: DiscoverSectionType.featured, limit: 5 },
    { id: "top_mystery", title: "Mystery top 10", type: DiscoverSectionType.simpleCarousel, limit: 10 },
    { id: "top_josei", title: "Josei top 5", type: DiscoverSectionType.featured, limit: 5 },
    {
        id: "top_shounen_ai",
        title: "Shounen ai top 5",
        type: DiscoverSectionType.simpleCarousel,
        limit: 5,
    },
    { id: "top_yuri", title: "Yuri top 5", type: DiscoverSectionType.featured, limit: 5 },
    {
        id: "top_school_life",
        title: "School life top 5",
        type: DiscoverSectionType.simpleCarousel,
        limit: 5,
    },
];

export const SECTION_IDS = SECTION_OPTIONS.map((section) => section.id);

/** Sections the reader has to turn on before they appear. */
export const DEFAULT_OFF_SECTION_IDS = new Set(["top_shounen_ai", "top_yuri", "top_school_life"]);

export const DEFAULT_SECTION_IDS = SECTION_IDS.filter((id) => !DEFAULT_OFF_SECTION_IDS.has(id));

/** Genre tops that add "Webtoons" so they list only manhwa and manhua. */
export const MANHWA_TOP_SECTION_IDS = new Set(["top_supernatural", "top_mystery"]);

/** What the search screen carries forward between pages. */
export interface PageMetadata {
    page: number;
}
