/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * The model shapes the sources are written against.
 *
 * These mirror the vocabulary used by the newer extension API so that a
 * source's parsers can stay readable and framework-independent. Nothing here
 * ever reaches the app directly — `Convert.ts` turns each of these into the
 * object the 0.8 runtime actually expects.
 */

/** How explicit a title is. 0.8 only distinguishes "adult" from "not adult". */
export enum ContentRating {
    EVERYONE = "EVERYONE",
    MATURE = "MATURE",
    ADULT = "ADULT",
}

/** Publication state of a series, as the app renders it. */
export enum MangaStatus {
    ONGOING = "Ongoing",
    COMPLETED = "Completed",
    HIATUS = "Hiatus",
    CANCELLED = "Cancelled",
    UNKNOWN = "Unknown",
}

/**
 * The section styles a source can ask for on the home page.
 *
 * 0.8 has a smaller set of layouts than later versions, so several of these
 * collapse onto the same one once rendered. See `Discover.ts`.
 */
export enum DiscoverSectionType {
    /** Large cover art, one title at a time. */
    featured = "featured",
    /** A horizontal strip of covers. */
    simpleCarousel = "simpleCarousel",
    /** A taller, more eye-catching strip. */
    prominentCarousel = "prominentCarousel",
    /** A strip whose subtitle carries the newest chapter. */
    chapterUpdates = "chapterUpdates",
    /** A strip of genre links rather than titles. */
    genres = "genres",
}

export interface Tag {
    readonly id: string;
    readonly title: string;
}

export interface TagSection {
    readonly id: string;
    readonly title: string;
    readonly tags: Tag[];
}

export interface SortingOption {
    readonly id: string;
    readonly label: string;
}

/** A series as the details page describes it. */
export interface MangaInfo {
    primaryTitle: string;
    secondaryTitles: string[];
    thumbnailUrl: string;
    synopsis: string;
    status: string;
    contentRating: ContentRating;
    author?: string;
    artist?: string;
    tagGroups?: TagSection[];
    rating?: number;
    bannerUrl?: string;
    additionalInfo?: Record<string, string>;
}

export interface SourceManga {
    mangaId: string;
    mangaInfo: MangaInfo;
}

export interface Chapter {
    chapterId: string;
    sourceManga: SourceManga;
    title?: string;
    chapNum: number;
    volume?: number;
    publishDate?: Date;
    langCode?: string;
    group?: string;
    sortingIndex?: number;
}

export interface ChapterDetails {
    id: string;
    mangaId: string;
    pages: string[];
}

/** One entry in a search result list. */
export interface SearchResultItem {
    mangaId: string;
    title: string;
    imageUrl: string;
    subtitle?: string;
    contentRating?: ContentRating;
}

/** One entry in a home page section. */
export interface DiscoverSectionItem {
    type?: "simpleCarouselItem" | "featuredCarouselItem" | "chapterUpdatesCarouselItem" | "genresCarouselItem";
    mangaId: string;
    title: string;
    imageUrl: string;
    subtitle?: string;
    /** Used by chapter-update items; rendered as the subtitle. */
    chapterId?: string;
    publishDate?: Date;
    metadata?: unknown;
}

export interface DiscoverSection {
    id: string;
    title: string;
    type: DiscoverSectionType;
    /** Shown in place of the section when it has nothing to display. */
    subtitle?: string;
}

/** A page of results plus whatever the source needs to fetch the next one. */
export interface PagedResults<T> {
    items: T[];
    metadata?: unknown;
}

/** The user's search input, as the source sees it. */
export interface SearchQuery {
    title?: string;
    includedTags: Tag[];
    excludedTags: Tag[];
    /** Free-form values from the source's own search fields. */
    parameters: Record<string, unknown>;
}
