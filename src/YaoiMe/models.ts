/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://yaoi.me";

export const STATE_KEYS = {
    CHAPTER_LANGUAGES: "yaoime_chapter_languages",
    CONTENT_RATINGS: "yaoime_content_ratings",
    CONTENT_TYPES: "yaoime_content_types",
    DEDUPE: "yaoime_dedupe_chapters",
    GENRES: "yaoime_genres",
    UPLOAD_SIZE: "yaoime_upload_size",
    UPLOAD_SOURCES: "yaoime_upload_sources",
    UPLOAD_SOURCES_ONLY: "yaoime_upload_sources_only",
    HIDDEN_TAGS: "yaoime_hidden_tags",
    OFFICIAL_ONLY: "yaoime_official_only",
    SEAL_KEY: "yaoime_seal_key",
    VISIBLE_SECTIONS: "yaoime_visible_sections",
} as const;

export const SETTINGS_KEYS = Object.values(STATE_KEYS);
export const GENRES_MAX_AGE = 24 * 60 * 60 * 1000;

// The page-list key the reader has shipped with; a deploy that changes it is read from its scripts.
export const SEAL_KEY = "10dd8dff9911000f9286d3dfd8b9f72b3f763c2f783f89f5c384cff4a11988ac";

export const SECTIONS = {
    POPULAR: "popular",
    BINGE: "binge",
    TRENDING: "trending",
    TOP_RATED: "top-rated",
    LATEST: "latest",
    BOOKMARKED: "bookmarked",
    HIDDEN_GEMS: "hidden-gems",
    TALKED: "talked",
    RISING: "rising",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

// Each row is one heading on the home page; `heading` is how it is found there.
export interface YaoiSection extends DiscoverSection {
    id: SectionId;
    heading: string;
}

export const DISCOVER_SECTIONS: YaoiSection[] = [
    { id: SECTIONS.POPULAR, title: "Popular Updates", heading: "Popular updates", type: DiscoverSectionType.featured },
    { id: SECTIONS.BINGE, title: "Binge Worthy", heading: "Binge-worthy", type: DiscoverSectionType.prominentCarousel },
    { id: SECTIONS.TRENDING, title: "Trending Now", heading: "Trending now", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.TOP_RATED, title: "Top Rated", heading: "Top rated", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.LATEST, title: "Latest Releases", heading: "Latest releases", type: DiscoverSectionType.chapterUpdates },
    { id: SECTIONS.BOOKMARKED, title: "Most Bookmarked", heading: "Most bookmarked", type: DiscoverSectionType.featured },
    { id: SECTIONS.HIDDEN_GEMS, title: "Hidden Gems", heading: "Hidden gems", type: DiscoverSectionType.prominentCarousel },
    { id: SECTIONS.TALKED, title: "Most Talked About", heading: "Most talked about", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.RISING, title: "Rising", heading: "Rising", type: DiscoverSectionType.simpleCarousel },
];

export const SECTION_IDS = DISCOVER_SECTIONS.map((section) => section.id);
export const SECTION_OPTIONS: Tag[] = DISCOVER_SECTIONS.map((section) => ({ id: section.id, title: section.title }));

// "novel" is left out: the 0.8 reader shows image pages only.
export const TYPE_OPTIONS: Tag[] = [
    { id: "doujinshi", title: "Doujinshi" },
    { id: "manga", title: "Manga" },
    { id: "manhwa", title: "Manhwa" },
    { id: "manhua", title: "Manhua" },
    { id: "oel", title: "OEL" },
    { id: "other", title: "Other" },
];

export const CONTENT_RATING_OPTIONS: Tag[] = [
    { id: "safe", title: "Safe" },
    { id: "suggestive", title: "Suggestive" },
    { id: "erotica", title: "Erotica" },
    { id: "pornographic", title: "Pornographic" },
];

// The site labels "releasing" as Ongoing; the filter only accepts the value.
export const STATUS_OPTIONS: Tag[] = [
    { id: "releasing", title: "Ongoing" },
    { id: "completed", title: "Completed" },
    { id: "hiatus", title: "Hiatus" },
    { id: "cancelled", title: "Cancelled" },
    { id: "upcoming", title: "Upcoming" },
];

export const DEMOGRAPHIC_OPTIONS: Tag[] = [
    { id: "shounen", title: "Shounen" },
    { id: "shoujo", title: "Shoujo" },
    { id: "seinen", title: "Seinen" },
    { id: "josei", title: "Josei" },
];

export const OTHER_OPTIONS: Tag[] = [
    { id: "anime", title: "Has an anime" },
    { id: "licensed", title: "Licensed" },
];

export const LANGUAGE_OPTIONS: Tag[] = [
    ["en", "English"],
    ["es", "Spanish"],
    ["vi", "Vietnamese"],
    ["fr", "French"],
    ["pt", "Portuguese"],
    ["ru", "Russian"],
    ["id", "Indonesian"],
    ["th", "Thai"],
    ["ko", "Korean"],
    ["ja", "Japanese"],
    ["zh", "Chinese"],
    ["de", "German"],
    ["it", "Italian"],
    ["pl", "Polish"],
    ["tr", "Turkish"],
    ["ar", "Arabic"],
    ["nl", "Dutch"],
    ["hu", "Hungarian"],
    ["cs", "Czech"],
    ["ro", "Romanian"],
    ["fi", "Finnish"],
    ["ms", "Malay"],
    ["mn", "Mongolian"],
    ["uk", "Ukrainian"],
    ["fa", "Persian"],
    ["he", "Hebrew"],
    ["bg", "Bulgarian"],
    ["bn", "Bengali"],
    ["sr", "Serbian"],
    ["hi", "Hindi"],
    ["my", "Burmese"],
    ["sk", "Slovak"],
    ["kk", "Kazakh"],
    ["hr", "Croatian"],
    ["km", "Khmer"],
    ["ca", "Catalan"],
    ["el", "Greek"],
    ["sv", "Swedish"],
    ["no", "Norwegian"],
    ["da", "Danish"],
    ["lt", "Lithuanian"],
    ["lv", "Latvian"],
    ["et", "Estonian"],
    ["sl", "Slovenian"],
    ["bs", "Bosnian"],
    ["mk", "Macedonian"],
    ["sq", "Albanian"],
    ["ka", "Georgian"],
    ["hy", "Armenian"],
    ["az", "Azerbaijani"],
    ["uz", "Uzbek"],
    ["ne", "Nepali"],
    ["lo", "Lao"],
    ["tl", "Tagalog"],
    ["af", "Afrikaans"],
    ["sw", "Swahili"],
    ["is", "Icelandic"],
    ["pt-br", "Portuguese (BR)"],
    ["pt-pt", "Portuguese (PT)"],
    ["es-419", "Spanish (LATAM)"],
    ["zh-hk", "Chinese (HK)"],
    ["zh-tw", "Chinese (TW)"],
    ["zh-hans", "Chinese (Simplified)"],
    ["zh-hant", "Chinese (Traditional)"],
    ["en-us", "English (US)"],
    ["en-gb", "English (UK)"],
].map(([id, title]) => ({ id: id!, title: title! }));

export const DEFAULT_LANGUAGES = ["en"];

export const SORT_OPTIONS: Tag[] = [
    { id: "update-desc", title: "Recently updated" },
    { id: "create-desc", title: "Recently added" },
    { id: "popular-desc", title: "Most popular" },
    { id: "rating-desc", title: "Highest rated" },
    { id: "chapters-desc", title: "Most chapters" },
    { id: "az-asc", title: "Title A–Z" },
    { id: "az-desc", title: "Title Z–A" },
];

export const FILTERS = {
    SORT: "sort",
    GENRE: "genre",
    TYPE: "type",
    STATUS: "status",
    RATING: "rating",
    DEMOGRAPHIC: "demographic",
    LANGUAGE: "lang",
    OTHER: "other",
} as const;

export const FIELDS = {
    TAGS: "tags",
    AUTHOR: "author",
    ARTIST: "artist",
    PUBLISHER: "publisher",
    YEAR_FROM: "yearFrom",
    YEAR_TO: "yearTo",
    MIN_CHAPTERS: "minChapters",
    MAX_CHAPTERS: "maxChapters",
    MIN_PAGES: "minPages",
    MIN_RATING: "minRating",
    MAX_RATING: "maxRating",
    UPDATED_WITHIN: "updatedWithin",
} as const;

const FILTER_SEPARATOR = "::";

// 0.8 returns selected tags as one flat list, so the section is encoded in the id.
export function filterTag(section: string, id: string, title: string): Tag {
    return { id: `${section}${FILTER_SEPARATOR}${id}`, title };
}

export function splitFilterTag(tagId: string): { section: string; value: string } | undefined {
    const index = tagId.indexOf(FILTER_SEPARATOR);
    return index > 0
        ? { section: tagId.slice(0, index), value: tagId.slice(index + FILTER_SEPARATOR.length) }
        : undefined;
}

export interface Preferences {
    chapterLanguages: string[];
    contentRatings: string[];
    contentTypes: string[];
    hiddenTags: string[];
    officialOnly: boolean;
}

export interface BrowseOptions {
    page: number;
    query?: string;
    sort: string;
    genres?: string[];
    withoutGenres?: string[];
    tags?: string[];
    withoutTags?: string[];
    types?: string[];
    statuses?: string[];
    ratings?: string[];
    demographics?: string[];
    languages?: string[];
    author?: string;
    artist?: string;
    publisher?: string;
    yearFrom?: string;
    yearTo?: string;
    minChapters?: string;
    maxChapters?: string;
    minPages?: string;
    minRating?: string;
    maxRating?: string;
    updatedWithin?: string;
    anime?: boolean;
    licensed?: boolean;
}

export interface PageMetadata {
    page: number;
}

export type ContentRatingName = "safe" | "suggestive" | "erotica" | "pornographic";

export interface MangaCard {
    mangaId: string;
    title: string;
    imageUrl: string;
    status?: string;
    typeName?: string;
    rating?: string;
    chapter?: string;
    chapterId?: string;
    publishDate?: Date;
    contentRating: ContentRatingName;
}

// The title page lists each chapter with every upload of it; an upload is read at
// /chapter/<s>/<id>, where s is that upload source's id for this one series.
export interface ChapterVariant {
    id: number;
    s: number;
    lang?: string;
    // 1 marks an upload the site counts as a duplicate
    d?: number;
    // Size in bytes
    b?: number;
}

// Groups come newest first in the site's order; an unnumbered extra (numReal 0) follows the
// chapter it was posted after and carries a placeholder num.
export interface ChapterGroup {
    label: string;
    num: number | null;
    numReal?: number;
    vol?: number | null;
    extra?: boolean;
    createdAt?: number;
    variants: ChapterVariant[];
}

export interface ChapterOptions {
    languages: string[];
    dedupe: boolean;
    showSize: boolean;
    sources: string[];
    // Show only the listed upload sources instead of hiding them
    sourcesOnly: boolean;
}

export interface ReaderPage {
    hashes: string[];
    sealed?: string;
    build?: string;
    scripts: string[];
}

// The page-list key read from the site's script, kept until the site deploys a new build.
export interface SealKey {
    build: string;
    key: string;
}
