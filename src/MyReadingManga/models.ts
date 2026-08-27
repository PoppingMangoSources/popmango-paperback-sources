/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://myreadingmanga.info";

/** Ids for the home page sections. */
export const SECTIONS = {
    POPULAR: "popular",
    LATEST: "latest",
    MANGA: "manga",
    BARA: "bara",
    RANDOM: "random",
} as const;

/** Setting keys, declared so the store can read them up front. */
export const LANGUAGES_KEY = "myreadingmanga.languages";
export const HIDDEN_GENRES_KEY = "myreadingmanga.hiddenGenres";
export const HIDDEN_TAGS_KEY = "myreadingmanga.hiddenTags";
export const VISIBLE_SECTIONS_KEY = "myreadingmanga.sections";

export const SETTINGS_KEYS = [
    LANGUAGES_KEY,
    HIDDEN_GENRES_KEY,
    HIDDEN_TAGS_KEY,
    VISIBLE_SECTIONS_KEY,
] as const;

export interface MangaCard {
    mangaId: string;
    title: string;
    imageUrl: string;
}

export interface FilterOption {
    id: string;
    title: string;
}

/** One entry per filter widget in the site's search sidebar. */
export type FilterTaxonomies = Record<string, FilterOption[]>;

export interface PageMetadata {
    page: number;
}

// A search facet, as the site names it: the metadata key, the sidebar widget
// id, the search parameter it accepts, its title, and the class prefix
// WordPress stamps on listing cards — which is how exclusions are applied.
export const TAXONOMIES = [
    { key: "genres", id: "genre", title: "Genre", param: "ep_filter_genre", classPrefix: "genre" },
    {
        key: "categories",
        id: "category",
        title: "Category",
        param: "ep_filter_category",
        classPrefix: "category",
    },
    { key: "tags", id: "tag", title: "Tag", param: "ep_filter_post_tag", classPrefix: "tag" },
    {
        key: "artists",
        id: "artist",
        title: "Circle / Artist",
        param: "ep_filter_artist",
        classPrefix: "artist",
    },
    { key: "pairings", id: "pairing", title: "Pairing", param: "ep_filter_pairing", classPrefix: "pairing" },
    { key: "statuses", id: "status", title: "Status", param: "ep_filter_status", classPrefix: "status" },
] as const;

// Site languages: the display name is what the search parameter accepts, the
// class is how listing cards are tagged, and the code is what a chapter carries.
export const LANGUAGES: Array<{ code: string; name: string; class: string }> = [
    { code: "en", name: "English", class: "english" },
    { code: "ja", name: "Japanese", class: "jp" },
    { code: "zh", name: "Chinese", class: "chinese" },
    { code: "ko", name: "Korean", class: "korean" },
    { code: "es", name: "Spanish", class: "spanish" },
    { code: "fr", name: "French", class: "french" },
    { code: "de", name: "German", class: "german" },
    { code: "it", name: "Italian", class: "italian" },
    { code: "pt", name: "Portuguese", class: "portuguese" },
];

export const SORT_OPTIONS: Array<{ id: string; title: string }> = [
    { id: "date", title: "Newest" },
    { id: "date_asc", title: "Oldest" },
    { id: "relevance", title: "Relevance" },
    { id: "rand", title: "Random" },
];

/** Ids of the filter sections shown on the search screen. */
export const FILTERS = {
    SORT: "sort",
    LANGUAGE: "lang",
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

/** Listing paths mirror the site's own browse entries; all page via /page/N/. */
export const LISTING_PATHS: Record<string, string> = {
    [SECTIONS.LATEST]: "/",
    [SECTIONS.POPULAR]: "/popular/",
    [SECTIONS.MANGA]: "/yaoi-manga/",
    [SECTIONS.BARA]: "/genre/bara/",
    [SECTIONS.RANDOM]: "/?ep_sort=rand&s=",
};

export const DISCOVER_SECTIONS: DiscoverSection[] = [
    { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
    { id: SECTIONS.LATEST, title: "Latest", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.MANGA, title: "Manga", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.BARA, title: "Bara", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.RANDOM, title: "Random", type: DiscoverSectionType.simpleCarousel },
];

export const SECTION_IDS: string[] = DISCOVER_SECTIONS.map((section) => section.id);

export const SECTION_OPTIONS: Array<{ id: string; title: string }> = DISCOVER_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
}));

/** Everything the search listing accepts. */
export interface SearchRequest {
    page: number;
    query: string;
    sort?: string;
    /** Chosen facet values, keyed by the taxonomy's metadata key. */
    facets: Map<string, string[]>;
    language?: string;
}
