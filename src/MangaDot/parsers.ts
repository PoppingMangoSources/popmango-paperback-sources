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
    type TagSection,
} from "../../common";

import {
    DOMAIN,
    FILTERS,
    TAG_GROUPS,
    filterTag,
    tagGroupOf,
    type ChapterEntry,
    type ChapterImagesResponse,
    type MangaData,
    type MangaDataResponse,
    type MangaSectionItem,
} from "./models";

// A tag id is the name percent-encoded so it passes the app's id rules and
// decodes back to the name the search filters expect. encodeURIComponent
// leaves !'*~ alone, and the app rejects them.
export const toTagId = (name: string): string =>
    encodeURIComponent(name).replace(/[!'*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export const fromTagId = (id: string): string => {
    try {
        return decodeURIComponent(id);
    } catch {
        return id;
    }
};

const UPDATE_NEEDED = "The source may need an update.";

/** A list the site should have sent, or a readable error when it did not. */
export const listOf = <T>(value: T[] | null | undefined, what: string): T[] => {
    if (!Array.isArray(value)) {
        throw new Error(`MangaDot's ${what} came back in an unexpected shape. ${UPDATE_NEEDED}`);
    }
    return value;
};

const cleanText = (value: string | null | undefined): string =>
    Application.decodeHTMLEntities(value ?? "")
        .replace(/\s+/g, " ")
        .trim();

const absoluteUrl = (path: string | null | undefined): string =>
    !path ? "" : /^https?:\/\//i.test(path) ? path : `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`;

// The API sends some lists as JSON text rather than as arrays.
const parseStringArray = (value: string[] | string | null | undefined): string[] => {
    if (value == null) {
        return [];
    }
    if (Array.isArray(value)) {
        return value;
    }
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return value.trim() ? [value] : [];
    }
};

const names = (value: string[] | string | null | undefined): string | undefined =>
    parseStringArray(value).map(cleanText).filter(Boolean).join(", ") || undefined;

/**
 * Reads the API's timestamps, written as Postgres writes them:
 * "2026-06-01 12:34:56.123456+00".
 *
 * The fraction is dropped because JavaScriptCore will not parse more than
 * three digits of it, and a bare hour offset is widened to the form it takes.
 */
export const parseSiteDate = (value: string | null | undefined): Date | undefined => {
    if (!value) {
        return undefined;
    }
    const iso = value
        .trim()
        .replace(" ", "T")
        .replace(/\.\d+/, "")
        .replace(/([+-]\d{2})$/, "$1:00");
    const date = new Date(/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(iso) ? iso : `${iso}Z`);
    return Number.isNaN(date.getTime()) ? undefined : date;
};

// The site's ratings, as the 0.9 source reads them.
const parseRating = (manga: MangaData): ContentRating => {
    if (manga.is_adult) {
        return ContentRating.ADULT;
    }
    if (manga.is_blurworthy) {
        return ContentRating.MATURE;
    }
    switch (manga.content_rating) {
        case "erotica":
            return ContentRating.MATURE;
        case "pornographic":
            return ContentRating.ADULT;
        default:
            return ContentRating.EVERYONE;
    }
};

const joinDetails = (parts: Array<string | undefined>): string | undefined =>
    parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ") || undefined;

const ratingText = (item: MangaSectionItem): string | undefined =>
    typeof item.avg_rating === "number" ? `★ ${Number(item.avg_rating.toFixed(1))}` : undefined;

const baseItem = (item: MangaSectionItem) => ({
    mangaId: String(item.id),
    title: cleanText(item.title),
    imageUrl: absoluteUrl(item.photo),
});

/** Search results; the site's own cards show the authors under the title. */
export const toSearchResults = (items: MangaData[]): SearchResultItem[] =>
    items.map((item) => ({
        ...baseItem(item),
        subtitle: names(item.authors),
        contentRating: parseRating(item),
    }));

/**
 * Cards for the large row.
 *
 * 0.9 shows the authors above the title and the rating and status below it;
 * a 0.8 card has one subtitle line, so the rating and status go there.
 */
export const toFeaturedItems = (items: MangaSectionItem[]): DiscoverSectionItem[] =>
    items.map((item) => ({
        type: "featuredCarouselItem",
        ...baseItem(item),
        subtitle: joinDetails([ratingText(item), cleanText(item.status) || undefined]),
    }));

/** Titles from a paged ranking carry their authors; a day, week or month ranking only its rating. */
export const toCarouselItems = (
    items: Array<MangaSectionItem | MangaData>,
    type: "prominentCarouselItem" | "simpleCarouselItem",
): DiscoverSectionItem[] =>
    items.map((item) => ({
        type,
        ...baseItem(item),
        subtitle: ("authors" in item ? names(item.authors) : undefined) ?? ratingText(item),
    }));

/** The updates row has a title's chapter count and last upload, not its newest chapter. */
export const toLatestItems = (items: MangaSectionItem[]): DiscoverSectionItem[] =>
    items.map((item) => ({
        type: "chapterUpdatesCarouselItem",
        ...baseItem(item),
        subtitle: joinDetails([
            typeof item.chapter_count === "number" ? `${item.chapter_count} Chapters` : undefined,
            ratingText(item),
        ]),
        publishDate: parseSiteDate(item.last_chapter_date),
    }));

/**
 * Everything the details screen shows.
 *
 * Tags carry the same ids as the search filters, so tapping one searches for
 * it. 0.9 also shows each volume's cover; 0.8 has no place for them, so they
 * are not asked for.
 */
export const parseMangaDetails = ({ manga }: MangaDataResponse, mangaId: string): SourceManga => {
    if (!manga || manga.id === undefined) {
        throw new Error(`MangaDot returned no details for ${mangaId}. ${UPDATE_NEEDED}`);
    }
    const primaryTitle = cleanText(manga.title);
    const genres = (manga.genres ?? []).map(cleanText).filter(Boolean);
    const tagGroups: TagSection[] = TAG_GROUPS.flatMap(({ id, title }) => {
        const tags = genres
            .filter((genre) => tagGroupOf(genre) === id)
            .map((genre) => filterTag(FILTERS.GENRE, toTagId(genre), genre));
        return tags.length > 0 ? [{ id, title, tags }] : [];
    });

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles: [
                ...new Set(
                    parseStringArray(manga.alt_titles)
                        .map(cleanText)
                        .filter((title) => title && title !== primaryTitle),
                ),
            ],
            thumbnailUrl: absoluteUrl(manga.photo),
            bannerUrl: manga.banner_image ? absoluteUrl(manga.banner_image) : undefined,
            synopsis: cleanText(manga.description),
            contentRating: parseRating(manga),
            status: cleanText(manga.status) || "Unknown",
            author: names(manga.authors),
            artist: names(manga.artists),
            // Out of ten on the site.
            rating: typeof manga.avg_rating === "number" ? manga.avg_rating / 10 : undefined,
            tagGroups,
        },
    };
};

/**
 * Every upload of every chapter, as the site lists them.
 *
 * The site gives no order of its own, so the app is handed one: volumes in
 * turn, a volume not yet assigned counting as the newest, then chapter
 * numbers, then upload order. A volume that starts again at chapter 1 so
 * stays after the one before it.
 */
export const parseChapters = (entries: ChapterEntry[], sourceManga: SourceManga): Chapter[] => {
    const hasVolumes = entries.some((entry) => typeof entry.volume_number === "number");
    const rank = (value: number | null | undefined, missing: number): number =>
        typeof value === "number" && Number.isFinite(value) ? value : missing;
    const ordered = [...entries].sort(
        (a, b) =>
            rank(a.volume_number, Infinity) - rank(b.volume_number, Infinity) ||
            rank(a.chapter_number, 0) - rank(b.chapter_number, 0) ||
            a.id - b.id,
    );

    return ordered.map(
        (entry, index): Chapter => ({
            chapterId: String(entry.id),
            sourceManga,
            chapNum: rank(entry.chapter_number, 0),
            title: cleanText(entry.chapter_title) || undefined,
            group: cleanText(entry.group_name) || cleanText(entry.scanlator_name) || undefined,
            // Zero means no volume data; undefined means an unassigned volume in a numbered series.
            volume: typeof entry.volume_number === "number" ? entry.volume_number : hasVolumes ? undefined : 0,
            publishDate: parseSiteDate(entry.date_added),
            langCode: cleanText(entry.language) || undefined,
            sortingIndex: index + 1,
        }),
    );
};

export const parseChapterPages = (response: ChapterImagesResponse, chapter: Chapter): ChapterDetails => {
    const pages = listOf(response?.images, "chapter images")
        .map((image) => absoluteUrl(image?.url))
        .filter(Boolean);
    if (pages.length === 0) {
        throw new Error("This chapter has no pages.");
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
};
