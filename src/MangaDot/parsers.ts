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
    OFFICIAL_GROUPS,
    TAG_GROUPS,
    filterTag,
    tagGroupOf,
    type ChapterEntry,
    type ChapterImagesResponse,
    type MangaData,
    type MangaDataResponse,
    type MangaSectionItem,
    type UploadChoice,
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

interface Upload {
    entry: ChapterEntry;
    /** Who it is by: its group, or for an upload without one, its scanlator or uploader. */
    by: string;
    official: boolean;
    addedAt: number;
    /**
     * The whole chapter it is an upload of, or part of: 15.5 is a part of 15.
     * An upload without a number is never merged.
     */
    chapter?: string;
}

const NO_GROUP = "no group";

const lowerText = (value: string | null | undefined): string => cleanText(value).toLowerCase();

const toUpload = (entry: ChapterEntry): Upload => {
    const group = lowerText(entry.group_name);
    const scanlator = lowerText(entry.scanlator_name);
    const by =
        entry.group_id && group !== NO_GROUP
            ? `group:${entry.group_id}`
            : scanlator && scanlator !== NO_GROUP
              ? `scanlator:${scanlator}`
              : `uploader:${entry.uploader_id ?? entry.uploader_username ?? ""}`;
    const credited = [group, scanlator, ...(entry.groups ?? []).map((credit) => lowerText(credit?.name))];
    return {
        entry,
        by,
        official: credited.some((name) => OFFICIAL_GROUPS.has(name)),
        addedAt: parseSiteDate(entry.date_added)?.getTime() ?? 0,
    };
};

/**
 * Marks which whole chapter each upload is of, and its volume too in a series
 * whose numbering starts again each volume, which shows as one uploader having
 * the same number in two volumes.
 *
 * Whole chapters, because groups split them differently: one releases 15
 * whole, another as 15 and 15.5, and matching exact numbers would list the
 * second half after the whole chapter.
 */
const markChapters = (uploads: Upload[]): void => {
    const numbered = uploads.filter(
        ({ entry }) => typeof entry.chapter_number === "number" && Number.isFinite(entry.chapter_number),
    );
    const volumeOf = new Map<string, string>();
    let restarts = false;
    for (const { entry, by } of numbered) {
        const seen = `${by}|${entry.chapter_number}`;
        const volume = String(entry.volume_number ?? "");
        restarts = restarts || (volumeOf.has(seen) && volumeOf.get(seen) !== volume);
        volumeOf.set(seen, volume);
    }
    for (const upload of numbered) {
        const whole = Math.floor(upload.entry.chapter_number as number);
        upload.chapter = restarts ? `${upload.entry.volume_number ?? ""}|${whole}` : String(whole);
    }
};

/**
 * Each chapter from the first uploader to have it, in the order given, with
 * every part that uploader has of it. One uploader's repeat of the same
 * number is left out.
 */
const firstOfEach = (uploads: Upload[]): ChapterEntry[] => {
    const takenBy = new Map<string, string>();
    const listed = new Set<string>();
    const kept: ChapterEntry[] = [];
    for (const { entry, by, chapter } of uploads) {
        if (chapter !== undefined) {
            const part = `${chapter}|${entry.chapter_number}`;
            if ((takenBy.get(chapter) ?? by) !== by || listed.has(part)) {
                continue;
            }
            takenBy.set(chapter, by);
            listed.add(part);
        }
        kept.push(entry);
    }
    return kept;
};

const newestFirst = (a: Upload, b: Upload): number => b.addedAt - a.addedAt || b.entry.id - a.entry.id;

/** Chapter by chapter, the official upload, or else the newest, with its parts. */
const bestOfEach = (uploads: Upload[]): ChapterEntry[] =>
    firstOfEach([...uploads].sort((a, b) => Number(b.official) - Number(a.official) || newestFirst(a, b)));

/**
 * One uploader for as much of the series as it has, its gaps filled from the
 * next: official releases first, then whoever has the most chapters, then
 * whoever uploaded last.
 */
const oneGroup = (uploads: Upload[]): ChapterEntry[] => {
    const standing = new Map<string, { official: boolean; chapters: Set<string>; latest: number }>();
    for (const upload of uploads) {
        const record = standing.get(upload.by) ?? { official: false, chapters: new Set<string>(), latest: 0 };
        record.official = record.official || upload.official;
        if (upload.chapter !== undefined) {
            record.chapters.add(upload.chapter);
        }
        record.latest = Math.max(record.latest, upload.addedAt);
        standing.set(upload.by, record);
    }
    const rank = new Map(
        [...standing]
            .sort(
                ([, a], [, b]) =>
                    Number(b.official) - Number(a.official) ||
                    b.chapters.size - a.chapters.size ||
                    b.latest - a.latest,
            )
            .map(([by], index) => [by, index]),
    );
    return firstOfEach(
        [...uploads].sort((a, b) => (rank.get(a.by) ?? 0) - (rank.get(b.by) ?? 0) || newestFirst(a, b)),
    );
};

/**
 * The uploads to list, out of every upload of every chapter.
 *
 * Only the chosen languages are kept, none chosen meaning all of them; a
 * series with nothing in them keeps every language rather than showing
 * nothing. Each language then has its uploads picked on its own, so each
 * keeps its own group.
 */
export const pickUploads = (
    entries: ChapterEntry[],
    languages: readonly string[],
    choice: UploadChoice,
): ChapterEntry[] => {
    const languageOf = (entry: ChapterEntry): string => lowerText(entry.language) || "en";
    const wanted = new Set(languages);
    const chosen = wanted.size === 0 ? entries : entries.filter((entry) => wanted.has(languageOf(entry)));
    const shown = chosen.length > 0 ? chosen : entries;
    if (choice === "all") {
        return shown;
    }

    const byLanguage = new Map<string, Upload[]>();
    for (const entry of shown) {
        const language = languageOf(entry);
        const uploads = byLanguage.get(language) ?? [];
        uploads.push(toUpload(entry));
        byLanguage.set(language, uploads);
    }
    return [...byLanguage.values()].flatMap((uploads) => {
        markChapters(uploads);
        return choice === "group" ? oneGroup(uploads) : bestOfEach(uploads);
    });
};

/**
 * The uploads to list, in the order the app shows them.
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
