/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import {
    ContentRating,
    type Chapter,
    type ChapterDetails,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type Tag,
} from "../../common";

import {
    TAG_LIMIT,
    UNSAFE_ID,
    type ChapterDetailsResponse,
    type ChapterItem,
    type GenreOption,
    type HomeResponse,
    type HomeRow,
    type SeriesDetails,
    type SeriesItem,
    type SeriesStatus,
    type TagOption,
} from "./models";

export function sanitizeId(value: string): string {
    return value.replace(UNSAFE_ID, "-");
}

/** The cover comes in three sizes, chosen by suffixing the file name. */
export function formatCoverUrl(url: string, width: 200 | 400 | 600 = 400): string {
    return url.replace(/\.webp(?:\?.*)?$/i, `_${width}.webp`);
}

export function formatSeriesType(type: string): string {
    return type === "oel" ? "OEL" : `${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;
}

export function formatSeriesStatus(status: SeriesStatus): string {
    return `${status[0]?.toUpperCase() ?? ""}${status.slice(1)}`;
}

export function formatRating(rating: number | null): string | undefined {
    return rating === null || !isFinite(rating) ? undefined : `★ ${rating.toFixed(1)}`;
}

export function formatViews(views: number): string {
    if (views >= 1_000_000) {
        return `${(views / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
    }
    if (views >= 1_000) {
        return `${(views / 1_000).toFixed(1).replace(/\.0$/, "")}K views`;
    }
    return `${views} views`;
}

export function formatChapterNumber(number: number | null): string {
    return number === null ? "Oneshot" : String(number);
}

/** A chapter is addressed by its number, or by the word for a one-shot. */
export function chapterToken(number: number | null): string {
    return sanitizeId(number === null ? "oneshot" : String(number));
}

function toContentRating(isNsfw: boolean): ContentRating {
    return isNsfw ? ContentRating.ADULT : ContentRating.EVERYONE;
}

export function toGenreOptions(genres: GenreOption[]): Tag[] {
    return [...new Map(genres.map((genre) => [genre.slug, genre])).values()].map((genre) => ({
        id: sanitizeId(genre.slug),
        title: genre.name,
    }));
}

/** The most-used tags, since the site has far more than a screen can hold. */
export function toTagOptions(tags: TagOption[]): Tag[] {
    return [...new Map(tags.map((tag) => [tag.id, tag])).values()]
        .filter((tag) => tag.count > 0)
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
        .slice(0, TAG_LIMIT)
        .map((tag) => ({ id: sanitizeId(String(tag.id)), title: tag.name }));
}

function chapterTitle(chapter: ChapterItem): string | undefined {
    const title = chapter.title.trim();
    if (chapter.number === null) {
        return title || "Oneshot";
    }
    return title || undefined;
}

export function findHomeRow(response: HomeResponse, slug: HomeRow["slug"]): SeriesItem[] {
    return response.rows.find((row) => row.slug === slug)?.items ?? [];
}

export function toFeaturedItem(series: SeriesItem): DiscoverSectionItem {
    // 0.9 gave this tile a type line, a summary and a row of counters. 0.8 has
    // one line, so it carries the figures that identify a title fastest.
    const subtitle = [
        formatSeriesType(series.type),
        formatRating(series.rating) ?? "",
        formatViews(series.views),
    ]
        .filter((part) => part.length > 0)
        .join(" • ");

    return {
        type: "featuredCarouselItem",
        mangaId: sanitizeId(series.slug),
        imageUrl: formatCoverUrl(series.cover_url, 600),
        title: series.title,
        subtitle: subtitle || undefined,
    };
}

export function toRecentlyUpdatedItem(series: SeriesItem): DiscoverSectionItem | undefined {
    if (series.latest_chapter === null) {
        return undefined;
    }

    const subtitle = [`Ch. ${formatChapterNumber(series.latest_chapter)}`, formatRating(series.rating) ?? ""]
        .filter((part) => part.length > 0)
        .join(" • ");

    const date = series.last_chapter_at !== null ? new Date(series.last_chapter_at) : undefined;

    return {
        type: "chapterUpdatesCarouselItem",
        mangaId: sanitizeId(series.slug),
        chapterId: chapterToken(series.latest_chapter),
        imageUrl: formatCoverUrl(series.cover_url, 200),
        title: series.title,
        subtitle: subtitle || undefined,
        publishDate: date !== undefined && !isNaN(date.getTime()) ? date : undefined,
    };
}

function subtitleFor(series: { type: string; rating: number | null; views: number }): string | undefined {
    return (
        [formatSeriesType(series.type), formatRating(series.rating) ?? "", formatViews(series.views)]
            .filter((part) => part.length > 0)
            .join(" • ") || undefined
    );
}

export function toSearchResultItem(series: SeriesItem): SearchResultItem {
    return {
        mangaId: sanitizeId(series.slug),
        title: series.title,
        imageUrl: formatCoverUrl(series.cover_url),
        subtitle: subtitleFor(series),
        contentRating: toContentRating(series.is_nsfw),
    };
}

export function detailsToSearchResultItem(series: SeriesDetails): SearchResultItem {
    return {
        mangaId: sanitizeId(series.slug),
        title: series.title,
        imageUrl: formatCoverUrl(series.cover_url),
        subtitle: subtitleFor(series),
        contentRating: toContentRating(series.is_nsfw),
    };
}

export function parseMangaDetails(series: SeriesDetails): SourceManga {
    const authors = series.authors
        .filter((credit) => credit.role === "author")
        .map((credit) => credit.name)
        .join(", ");

    const artists = series.authors
        .filter((credit) => credit.role === "artist")
        .map((credit) => credit.name)
        .join(", ");

    return {
        mangaId: sanitizeId(series.slug),
        mangaInfo: {
            primaryTitle: series.title,
            secondaryTitles: series.alt_titles,
            thumbnailUrl: formatCoverUrl(series.cover_url, 600),
            synopsis: series.description,
            contentRating: toContentRating(series.is_nsfw),
            status: formatSeriesStatus(series.status),
            author: authors || undefined,
            artist: artists || undefined,
            rating:
                series.rating === null || !isFinite(series.rating)
                    ? undefined
                    : Math.min(1, Math.max(0, series.rating / 10)),
            tagGroups: [
                {
                    id: "genres",
                    title: "Genres",
                    tags: series.genres.map((genre) => ({ id: sanitizeId(genre.slug), title: genre.name })),
                },
                {
                    id: "tags",
                    title: "Tags",
                    // A spoiler tag says what happens; it stays off the page.
                    tags: series.tags
                        .filter((tag) => !tag.is_spoiler)
                        .map((tag) => ({ id: sanitizeId(String(tag.id)), title: tag.name })),
                },
            ],
            additionalInfo: {
                Type: formatSeriesType(series.type),
                Chapters: String(series.chapter_count),
                Views: formatViews(series.views),
                ...(series.year !== null ? { Year: String(series.year) } : {}),
            },
        },
    };
}

export function parseChapters(chapters: ChapterItem[], sourceManga: SourceManga): Chapter[] {
    return chapters.map((chapter, index) => {
        const publishDate = new Date(chapter.created_at);
        const volume = Number(chapter.volume);

        return {
            chapterId: chapterToken(chapter.number),
            sourceManga,
            langCode: chapter.lang || "en",
            chapNum: chapter.number ?? index + 1,
            title: chapterTitle(chapter),
            volume: isFinite(volume) && volume > 0 ? volume : 0,
            publishDate: isNaN(publishDate.getTime()) ? undefined : publishDate,
            sortingIndex: index,
        };
    });
}

export function parseChapterDetails(response: ChapterDetailsResponse, chapter: Chapter): ChapterDetails {
    if (response.pages.length === 0) {
        throw new Error(`No pages were returned for chapter ${chapter.chapterId}.`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages: response.pages };
}
