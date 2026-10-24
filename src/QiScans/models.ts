/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import { DiscoverSectionType, type DiscoverSection, type Tag } from "../../common";

export const DOMAIN = "https://qimanga.com";
export const API = "https://api.qimanga.com/api/v1";
export const FALLBACK_COVER = `${DOMAIN}/qiscans.ico`;

export const PAGE_SIZE = 100; // The API's maximum, for every paged list
export const LATEST_PAGE_SIZE = 40;
export const MIN_QUERY_LENGTH = 2; // Shorter queries are rejected with HTTP 400
export const MAX_CATALOGUE_PAGES = 5; // Title search with filters scans at most this many filtered pages

export const SHOW_LOCKED_KEY = "qiscans_show_locked";
export const GENRES_KEY = "qiscans_genres";
export const SETTINGS_KEYS = [SHOW_LOCKED_KEY, GENRES_KEY];
export const GENRES_MAX_AGE = 24 * 60 * 60 * 1000;

export const SORT_OPTIONS: Tag[] = [
    { id: "latest", title: "Latest updated" },
    { id: "popular", title: "Popular" },
    { id: "newest", title: "Newest" },
    { id: "alphabetical", title: "A-Z" },
];

// NOVEL is left out: the 0.8 reader shows image pages only.
export const TYPE_OPTIONS: Tag[] = [
    { id: "MANHWA", title: "Manhwa" },
    { id: "MANHUA", title: "Manhua" },
    { id: "MANGA", title: "Manga" },
    { id: "RUSSIAN", title: "Russian" },
    { id: "SPANISH", title: "Spanish" },
];

export const STATUS_OPTIONS: Tag[] = [
    { id: "ONGOING", title: "Ongoing" },
    { id: "COMPLETED", title: "Completed" },
    { id: "HIATUS", title: "Hiatus" },
    { id: "DROPPED", title: "Dropped" },
    { id: "CANCELLED", title: "Cancelled" },
    { id: "MASS_RELEASED", title: "Mass Released" },
    { id: "COMING_SOON", title: "Coming Soon" },
];

// The genre list has lowercase and misspelled names; the slug stays as the API expects it.
export const GENRE_NAME_FIXES: Record<string, string> = { vampiers: "Vampires" };
export const MATURE_GENRES = new Set(["mature", "ecchi"]);

export const FILTERS = {
    SORT: "sort",
    TYPE: "type",
    STATUS: "status",
    GENRE: "genre",
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

export const SECTIONS = {
    FEATURED: "featured",
    POPULAR: "popular",
    LATEST: "latest",
    NEW: "new",
    PINNED: "pinned",
    EDITORS_PICK: "editors_pick",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const DISCOVER_SECTIONS: Array<DiscoverSection & { id: SectionId }> = [
    { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
    { id: SECTIONS.POPULAR, title: "Popular Today", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
    { id: SECTIONS.NEW, title: "New Series", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.PINNED, title: "Pinned", type: DiscoverSectionType.simpleCarousel },
    { id: SECTIONS.EDITORS_PICK, title: "Editor's Pick", type: DiscoverSectionType.prominentCarousel },
];

export interface PageMetadata {
    page: number;
}

export interface Genre {
    id: number;
    name: string;
    slug: string;
}

export interface ChapterPreview {
    slug: string;
    number: number;
    price?: number | null;
    becameFreeAt?: string | null;
    createdAt?: string | null;
}

export interface SeriesItem {
    slug: string;
    title: string;
    alternativeTitles?: string | null;
    cover?: string | null;
    type?: string | null;
    status?: string | null;
    avgRating?: number | null;
    redirectUrl?: string | null;
    chapters?: ChapterPreview[] | null;
}

export interface HomeResponse {
    banners?: SeriesItem[];
    popular?: SeriesItem[];
    newSeries?: SeriesItem[];
    pinned?: SeriesItem[];
    editorsPick?: SeriesItem[];
}

export interface SeriesPage {
    data: SeriesItem[];
    totalPages: number;
    next: number | null;
}

export interface SeriesDetails extends SeriesItem {
    description?: string | null;
    author?: string | null;
    artist?: string | null;
    releaseDays?: string[] | null;
    genres?: Array<{ name: string; slug: string }> | null;
    stats?: { averageRating?: number | null; chapterCount?: number | null } | null;
}

export interface ChapterItem {
    slug: string;
    number: number;
    title?: string | null;
    price?: number | null;
    discountedPrice?: number | null;
    publishStatus?: string | null;
    // Account-specific: false for a paid chapter the signed-in reader owns
    requiresPurchase?: boolean | null;
    requiresAuth?: boolean | null;
    becameFreeAt?: string | null;
    createdAt?: string | null;
}

export interface ChapterPage {
    data: ChapterItem[];
    totalPages: number;
    next: number | null;
}

export interface ChapterContent {
    requiresPurchase?: boolean | null;
    requiresAuth?: boolean | null;
    totalImages?: number | null;
    images?: Array<{ url: string; order: number }> | null;
}
