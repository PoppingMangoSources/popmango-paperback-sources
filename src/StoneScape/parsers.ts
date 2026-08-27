/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import {
    Application,
    ContentRating,
    type Chapter,
    type ChapterDetails,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type Tag,
} from "../../common";

import {
    DOMAIN,
    FALLBACK_IMAGE_URL,
    type ChapterPagesResponse,
    type MangaListItem,
    type MediaType,
    type Series,
    type SeriesChapterDetails,
} from "./models";

/** Characters the app refuses to accept inside an id. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

/** Marks a chapter id as one the reader has to buy before it will open. */
const LOCKED_PREFIX = "locked:";

export function encodeMangaId(slug: string): string {
    return slug.replace(UNSAFE_ID, "-");
}

export function decodeMangaId(mangaId: string): string {
    try {
        return decodeURIComponent(mangaId);
    } catch {
        return mangaId;
    }
}

export function toAbsoluteUrl(value?: string | null): string {
    const path = (value ?? "").trim();
    if (path.length === 0) {
        return "";
    }

    const absolute = (
        path.startsWith("http://") || path.startsWith("https://")
            ? path
            : path.startsWith("//")
              ? `https:${path}`
              : `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`
        // A stray slash after the extension makes the CDN answer 404.
    ).replace(/(\.(?:avif|gif|jpe?g|jxl|png|svg|webp))\/+(?=([?#]|$))/i, "$1");

    return /^https?:\/\/[^/\s?#]+(?:[/?#]|$)/i.test(absolute) ? absolute : "";
}

/** The first usable still image; animated covers make poor tiles. */
function staticImageUrl(...values: Array<string | null | undefined>): string {
    for (const value of values) {
        const url = toAbsoluteUrl(value);
        if (url.length > 0 && !/\.gif(?:[?#]|$)/i.test(url)) {
            return url;
        }
    }
    return "";
}

function decodeText(value?: string | null): string {
    return Application.decodeHTMLEntities((value ?? "").trim());
}

function mapStatus(value?: string | null): string {
    switch ((value ?? "").toLowerCase()) {
        case "ongoing":
            return "Ongoing";
        case "completed":
            return "Completed";
        case "hiatus":
            return "Hiatus";
        case "dropped":
        case "cancelled":
            return "Cancelled";
        default:
            return "Unknown";
    }
}

function parseDate(value?: string | null): Date | undefined {
    if (value === undefined || value === null || value.length === 0) {
        return undefined;
    }
    const date = new Date(value);
    return isNaN(date.getTime()) ? undefined : date;
}

function formatChapterNumber(value: string): string {
    const number = parseFloat(value);
    return isFinite(number) ? number.toString() : value;
}

function formatMediaType(series: Series): MediaType {
    switch ((series.countryOfOrigin ?? "").toUpperCase()) {
        case "JP":
            return "Manga";
        case "CN":
            return "Manhua";
        default:
            return "Manhwa";
    }
}

export function contentRatingForGenres(genreNames: string[]): ContentRating {
    const genres = genreNames.map((name) => name.trim().toLowerCase());

    if (
        genres.some(
            (name) =>
                name === "adult" || name === "hentai" || name === "shotacon" || name === "smut" || name === "yaoi",
        )
    ) {
        return ContentRating.ADULT;
    }
    if (genres.some((name) => name === "ecchi" || name === "gore" || name === "mature")) {
        return ContentRating.MATURE;
    }
    return ContentRating.EVERYONE;
}

function formatViews(views?: number): string | undefined {
    if (views === undefined || !isFinite(views)) {
        return undefined;
    }
    if (views >= 1_000_000) {
        return `${(views / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
    }
    if (views >= 1_000) {
        return `${(views / 1_000).toFixed(1).replace(/\.0$/, "")}K views`;
    }
    return `${views} views`;
}

export function parseMangaList(series: Series[]): MangaListItem[] {
    return series.map((item) => {
        const parsedViews =
            item.totalViews === undefined || item.totalViews === null
                ? NaN
                : parseInt(String(item.totalViews), 10);

        return {
            mangaId: encodeMangaId(item.slug),
            title: decodeText(item.title),
            imageUrl: staticImageUrl(item.coverUrl, item.bannerUrl) || FALLBACK_IMAGE_URL,
            bannerImageUrl: staticImageUrl(item.bannerUrl, item.coverUrl) || FALLBACK_IMAGE_URL,
            summary: decodeText(item.description) || undefined,
            author: decodeText(item.author) || undefined,
            status: mapStatus(item.publicationStatus),
            rating:
                item.averageRating === undefined || item.averageRating === null || !isFinite(item.averageRating)
                    ? undefined
                    : item.averageRating,
            views: isFinite(parsedViews) ? parsedViews : undefined,
            contentRating: contentRatingForGenres(item.genres ?? []),
            mediaType: formatMediaType(item),
        };
    });
}

export function toFeaturedItem(item: MangaListItem): DiscoverSectionItem {
    // 0.9 gave this tile a media-type line, a summary and a row of counters.
    // 0.8 has one line, so it carries what identifies the title fastest.
    const subtitle = [
        item.mediaType,
        item.rating === undefined ? "" : `★ ${item.rating.toFixed(1)}`,
        formatViews(item.views) ?? "",
    ]
        .filter((part) => part.length > 0)
        .join(" • ");

    return {
        type: "featuredCarouselItem",
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.bannerImageUrl,
        subtitle: subtitle || undefined,
    };
}

export function toSearchResultItem(item: MangaListItem): SearchResultItem {
    const subtitle = [
        item.mediaType,
        item.status === "Unknown" ? "" : (item.status ?? ""),
        item.rating === undefined ? "" : `Rating ${item.rating.toFixed(1)}`,
        formatViews(item.views) ?? "",
    ]
        .filter((part) => part.length > 0)
        .join(" • ");

    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: subtitle || undefined,
        contentRating: item.contentRating,
    };
}

export function toChapterUpdateItem(series: Series): DiscoverSectionItem | undefined {
    const chapter = series.latestChapter;
    if (chapter === undefined || chapter === null || !chapter.chapterId || !chapter.chapterNumber) {
        return undefined;
    }

    return {
        type: "chapterUpdatesCarouselItem",
        mangaId: encodeMangaId(series.slug),
        chapterId: chapter.chapterId.replace(UNSAFE_ID, "-"),
        title: decodeText(series.title),
        imageUrl: staticImageUrl(series.coverUrl, series.bannerUrl) || FALLBACK_IMAGE_URL,
        subtitle: `${formatMediaType(series)} • Ch. ${formatChapterNumber(chapter.chapterNumber)}`,
        publishDate: parseDate(chapter.createdAt ?? series.lastChapterUploadedAt),
    };
}

/** Drops the placeholders the site uses when a credit is unknown. */
function cleanCreator(value?: string | null): string | undefined {
    const cleaned = decodeText(value);
    if (cleaned.length === 0 || cleaned === "-" || /^(?:n\/a|unknown|tba)$/i.test(cleaned)) {
        return undefined;
    }
    return cleaned;
}

export function parseMangaDetails(series: Series): SourceManga {
    const primaryTitle = decodeText(series.title);
    const originalTitle = decodeText(series.originalTitle);
    const genres = series.genres ?? [];

    const tags: Tag[] = genres.map((genre) => ({
        id: genre.replace(UNSAFE_ID, "-"),
        title: genre
            .replace(/[-_]/g, " ")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/\b\w/g, (character) => character.toUpperCase()),
    }));

    return {
        mangaId: encodeMangaId(series.slug),
        mangaInfo: {
            primaryTitle,
            secondaryTitles:
                originalTitle.length > 0 && originalTitle.toLowerCase() !== primaryTitle.toLowerCase()
                    ? [originalTitle]
                    : [],
            thumbnailUrl: staticImageUrl(series.coverUrl, series.bannerUrl) || FALLBACK_IMAGE_URL,
            synopsis: decodeText(series.description),
            author: cleanCreator(series.author),
            artist: cleanCreator(series.artist),
            status: mapStatus(series.publicationStatus),
            rating:
                series.averageRating === undefined ||
                series.averageRating === null ||
                !isFinite(series.averageRating)
                    ? undefined
                    : Math.min(1, Math.max(0, series.averageRating / 5)),
            contentRating: contentRatingForGenres(genres),
            tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
        },
    };
}

function chapterIsLocked(chapter: SeriesChapterDetails): boolean {
    return (chapter.price ?? 0) > 0 && chapter.isFreeNow !== true && chapter.isPurchased !== true;
}

export function parseChapterList(
    chapters: SeriesChapterDetails[],
    sourceManga: SourceManga,
    showLocked: boolean,
): Chapter[] {
    return chapters
        .filter((chapter) => showLocked || !chapterIsLocked(chapter))
        .map((chapter) => ({ chapter, number: parseFloat(chapter.chapterNumber) }))
        .sort((left, right) => {
            // A chapter with no readable number sorts last rather than first.
            const leftNumber = isFinite(left.number) ? left.number : Number.MAX_SAFE_INTEGER;
            const rightNumber = isFinite(right.number) ? right.number : Number.MAX_SAFE_INTEGER;
            if (leftNumber !== rightNumber) {
                return leftNumber - rightNumber;
            }
            return (
                (parseDate(left.chapter.createdAt)?.getTime() ?? 0) -
                (parseDate(right.chapter.createdAt)?.getTime() ?? 0)
            );
        })
        .map(({ chapter, number }, index) => {
            const locked = chapterIsLocked(chapter);
            const rawTitle = decodeText(chapter.title);
            const chapterId = chapter.chapterId.replace(UNSAFE_ID, "-");

            return {
                chapterId: locked ? `${LOCKED_PREFIX}${chapterId}` : chapterId,
                sourceManga,
                langCode: "🇬🇧",
                chapNum: isFinite(number) ? number : index + 1,
                title: locked ? (rawTitle.length > 0 ? `${rawTitle} 🔒` : "🔒") : rawTitle || undefined,
                volume: 0,
                sortingIndex: index,
                publishDate: parseDate(chapter.releaseDate ?? chapter.createdAt),
            };
        });
}

export function decodeChapterId(chapterId: string): { locked: boolean; chapterId: string } {
    const locked = chapterId.startsWith(LOCKED_PREFIX);
    return { locked, chapterId: locked ? chapterId.slice(LOCKED_PREFIX.length) : chapterId };
}

export function parseChapterPages(response: ChapterPagesResponse, chapter: Chapter): ChapterDetails {
    const source = response.pages !== undefined && response.pages.length > 0 ? response.pages : (response.images ?? []);

    const pages = [...source]
        .sort(
            (left, right) =>
                (left.pageNumber ?? Number.MAX_SAFE_INTEGER) - (right.pageNumber ?? Number.MAX_SAFE_INTEGER),
        )
        .map((page) => toAbsoluteUrl(page.url))
        .filter((url) => /^https?:\/\/\S+$/i.test(url));

    if (pages.length === 0) {
        throw new Error(`No pages were returned for chapter ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
}
