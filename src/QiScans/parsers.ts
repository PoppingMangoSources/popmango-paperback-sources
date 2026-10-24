/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import {
    Application,
    ContentRating,
    MangaStatus,
    type Chapter,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type Tag,
} from "../../common";

import {
    FALLBACK_COVER,
    FILTERS,
    GENRE_NAME_FIXES,
    MATURE_GENRES,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    filterTag,
    type ChapterContent,
    type ChapterItem,
    type ChapterPreview,
    type Genre,
    type SeriesDetails,
    type SeriesItem,
} from "./models";

const text = (value: string | null | undefined): string =>
    Application.decodeHTMLEntities((value ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const titleCase = (value: string): string =>
    value.toLowerCase().replace(/_/g, " ").replace(/(^|[\s-])\S/g, (char) => char.toUpperCase());

const cover = (value: string | null | undefined): string => (value?.trim() ? value.trim() : FALLBACK_COVER);

const optionTitle = (options: Tag[], id: string | null | undefined): string | undefined =>
    options.find((option) => option.id === id)?.title;

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
    const seen = new Set<string>();
    return items.filter((item) => !seen.has(key(item)) && Boolean(seen.add(key(item))));
}

// Novels, link-out entries and malformed rows have nothing the 0.8 reader can open.
export function isReadable(series: SeriesItem): boolean {
    const title = series.title?.trim() ?? "";
    return (
        series.slug.length > 0 &&
        title.length > 0 &&
        !/^https?:\/\//i.test(title) &&
        series.type !== "NOVEL" &&
        !series.redirectUrl?.trim()
    );
}

export function genreName(genre: { name: string; slug: string }): string {
    const fixed = GENRE_NAME_FIXES[genre.slug];
    if (fixed !== undefined) {
        return fixed;
    }
    const name = genre.name.trim();
    return name === name.toLowerCase() ? titleCase(name) : name;
}

export function toGenreOptions(genres: Genre[]): Tag[] {
    return uniqueBy(
        genres.map((genre) => ({ id: genre.slug, title: genreName(genre) })).filter((genre) => genre.title.length > 0),
        (genre) => genre.id,
    ).sort((a, b) => a.title.localeCompare(b.title));
}

// The newest chapter anyone can read, falling back to the newest of all.
export function newestReadable(chapters: ChapterPreview[] | null | undefined): ChapterPreview | undefined {
    const sorted = [...(chapters ?? [])].sort((a, b) => b.number - a.number);
    return sorted.find((chapter) => !chapter.price) ?? sorted[0];
}

function subtitle(series: SeriesItem): string | undefined {
    const latest = newestReadable(series.chapters);
    if (latest !== undefined) {
        return `Ch. ${latest.number}`;
    }
    if (typeof series.avgRating === "number" && series.avgRating > 0) {
        return `★ ${series.avgRating.toFixed(1)}`;
    }
    return [optionTitle(TYPE_OPTIONS, series.type), optionTitle(STATUS_OPTIONS, series.status)].filter(Boolean).join(" • ") || undefined;
}

export function toSearchResult(series: SeriesItem): SearchResultItem {
    return { mangaId: series.slug, title: text(series.title), imageUrl: cover(series.cover), subtitle: subtitle(series) };
}

export function toDiscoverItem(series: SeriesItem, type: DiscoverSectionItem["type"]): DiscoverSectionItem | undefined {
    const base = { type, mangaId: series.slug, title: text(series.title), imageUrl: cover(series.cover), subtitle: subtitle(series) };
    if (type !== "chapterUpdatesCarouselItem") {
        return base;
    }
    const latest = newestReadable(series.chapters);
    if (latest === undefined) {
        return undefined;
    }
    const date = new Date(latest.becameFreeAt ?? latest.createdAt ?? "");
    return { ...base, chapterId: latest.slug, publishDate: Number.isNaN(date.getTime()) ? undefined : date };
}

function statusOf(value: string | null | undefined): string {
    switch (value) {
        case "ONGOING":
        case "MASS_RELEASED":
        case "COMING_SOON":
            return MangaStatus.ONGOING;
        case "COMPLETED":
            return MangaStatus.COMPLETED;
        case "HIATUS":
            return MangaStatus.HIATUS;
        case "DROPPED":
        case "CANCELLED":
            return MangaStatus.CANCELLED;
        default:
            return MangaStatus.UNKNOWN;
    }
}

// Placeholder credits the site uses for unknown people
const person = (value: string | null | undefined): string | undefined => {
    const name = text(value);
    return name && !/^(?:unknown|n\/?a|updating|-)$/i.test(name) ? name : undefined;
};

export function toSourceManga(details: SeriesDetails): SourceManga {
    const primaryTitle = text(details.title);
    const secondaryTitles = uniqueBy(
        (details.alternativeTitles ?? "").split(/\s*[•;|,\r\n]\s*/).map(text),
        (title) => title.toLowerCase(),
    ).filter((title) => title.length > 0 && title.toLowerCase() !== primaryTitle.toLowerCase());

    const genres = details.genres ?? [];
    const rating = details.stats?.averageRating;
    const synopsis = Application.decodeHTMLEntities(
        (details.description ?? "")
            .replace(/<br\s*\/?>|<\/p>/gi, "\n")
            .replace(/<[^>]+>/g, ""),
    )
        .replace(/\s*\b(?:See more|See less)\s*$/i, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const additionalInfo: Record<string, string> = {};
    const type = optionTitle(TYPE_OPTIONS, details.type);
    if (type !== undefined) additionalInfo["Type"] = type;
    if (typeof details.stats?.chapterCount === "number") additionalInfo["Chapters"] = String(details.stats.chapterCount);
    if (details.releaseDays?.length) additionalInfo["Release days"] = details.releaseDays.map(titleCase).join(", ");

    // Namespaced like the filters, so tapping one searches by it
    const metadata = [
        ...(details.type && type !== undefined ? [filterTag(FILTERS.TYPE, details.type, type)] : []),
        ...(details.status && optionTitle(STATUS_OPTIONS, details.status) !== undefined
            ? [filterTag(FILTERS.STATUS, details.status, optionTitle(STATUS_OPTIONS, details.status)!)]
            : []),
    ];

    return {
        mangaId: details.slug,
        mangaInfo: {
            primaryTitle,
            secondaryTitles,
            thumbnailUrl: cover(details.cover),
            synopsis,
            author: person(details.author),
            artist: person(details.artist),
            status: statusOf(details.status),
            contentRating: genres.some((genre) => MATURE_GENRES.has(genre.slug)) ? ContentRating.MATURE : ContentRating.EVERYONE,
            rating: typeof rating === "number" && Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
            tagGroups: [
                { id: "genres", title: "Genres", tags: genres.map((genre) => filterTag(FILTERS.GENRE, genre.slug, genreName(genre))) },
                { id: "details", title: "Details", tags: metadata },
            ].filter((group) => group.tags.length > 0),
            additionalInfo: Object.keys(additionalInfo).length > 0 ? additionalInfo : undefined,
        },
    };
}

// requiresPurchase is per account, so a chapter the signed-in reader owns comes back false
export const isLocked = (chapter: { requiresPurchase?: boolean | null; requiresAuth?: boolean | null }): boolean =>
    chapter.requiresPurchase !== false || chapter.requiresAuth === true;

// Drops titles that only repeat the number ("Chapter 12", "Ch. 12")
function chapterTitle(chapter: ChapterItem): string | undefined {
    const name = text(chapter.title);
    return name && !/^(?:chapter|ch\.?|episode|ep\.?)?\s*#?\s*[\d.]+$/i.test(name) ? name : undefined;
}

// Oldest first, so the newest chapter gets the highest sorting index.
export function toChapters(chapters: ChapterItem[], sourceManga: SourceManga, showLocked: boolean): Chapter[] {
    const unique = uniqueBy(
        chapters.filter((chapter) => (chapter.publishStatus ?? "PUBLIC") === "PUBLIC"),
        (chapter) => chapter.slug,
    );
    const listed = unique.filter((chapter) => showLocked || !isLocked(chapter));

    if (listed.length === 0 && unique.length > 0) {
        throw new Error("Every chapter of this title is paid on Qi Scans. Turn on Show paid chapters to list them.");
    }

    return listed
        .sort((a, b) => a.number - b.number || Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""))
        .map((chapter, index) => {
            const name = chapterTitle(chapter);
            const price = chapter.discountedPrice ?? chapter.price;
            const lock = typeof price === "number" && price > 0 ? `🔒 ${price} coins` : "🔒 Locked";
            // The site dates a paid chapter by when it became free
            const date = new Date(chapter.becameFreeAt ?? chapter.createdAt ?? "");
            return {
                chapterId: chapter.slug,
                sourceManga,
                title: isLocked(chapter) ? (name ? `${lock} • ${name}` : lock) : name,
                chapNum: chapter.number,
                publishDate: Number.isNaN(date.getTime()) ? undefined : date,
                langCode: "en",
                sortingIndex: index + 1,
            };
        });
}

export function toPages(content: ChapterContent): string[] {
    if (content.requiresAuth === true) {
        throw new Error("Qi Scans needs you signed in for this chapter. Sign in on the website through the cloud button.");
    }
    if (content.requiresPurchase === true) {
        throw new Error("This chapter is paid on Qi Scans. Unlock it on the website, signed in through the cloud button.");
    }
    const pages = [...(content.images ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((image) => image.url)
        .filter((url) => url.length > 0);
    if (pages.length === 0) {
        throw new Error("Qi Scans returned no pages for this chapter.");
    }
    return pages;
}
