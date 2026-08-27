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

import { ADULT_GENRES, type ApiManga, type FlightChapterList, type FlightImages } from "./models";

/** Characters that are safe to keep in an id the app will store and replay. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

function sanitizeId(value: string): string {
    return value
        .toLowerCase()
        .replace(UNSAFE_ID, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function cleanText(value: string): string {
    return Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();
}

/**
 * The catalogue addresses a series as "slug-id".
 *
 * The API wants the id on its own, so it is recovered from the tail rather
 * than tracked separately.
 */
export function mangaIdFor(manga: ApiManga): string {
    return manga.name_url !== undefined ? `${manga.name_url}-${manga.id}` : String(manga.id);
}

export function numericIdFrom(mangaId: string): string | undefined {
    return /(\d+)$/.exec(mangaId)?.[1];
}

function tagNames(values: Array<string | { name?: string }> | undefined): string[] {
    return (values ?? [])
        .map((value) => (typeof value === "string" ? value : (value.name ?? "")))
        .map(cleanText)
        .filter((name) => name.length > 0);
}

/**
 * Reads a series' genres.
 *
 * Listing rows carry them as one comma-separated string of slugs while the
 * detail payload sends objects, so both spellings feed the same list.
 */
function genreNames(manga: ApiManga): string[] {
    const named = tagNames(manga.genres);
    if (named.length > 0) {
        return named;
    }

    return (manga.genre_slugs ?? "")
        .split(",")
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0)
        .map((slug) => slug.replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()));
}

export function contentRatingFor(manga: ApiManga): ContentRating {
    if (manga.is_adult) {
        return ContentRating.ADULT;
    }

    const names = [...genreNames(manga), ...tagNames(manga.tags)].map((name) => name.toLowerCase());
    return names.some((name) => ADULT_GENRES.includes(name)) ? ContentRating.ADULT : ContentRating.MATURE;
}

/** Covers are served as webp; only the thumbnail path is ever handed out as png. */
export function coverUrlFor(baseUrl: string, manga: ApiManga): string {
    const url = manga.cover_url?.trim();

    if (url !== undefined && url.length > 0) {
        return url.replace(/(\/covers\/\d+\/thumbnail)\.png$/, "$1.webp");
    }
    return `${baseUrl}/covers/${manga.id}/thumbnail.webp`;
}

function numberFrom(value: string | number | null | undefined): number | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    const parsed = typeof value === "number" ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** A timestamp ahead of the clock is clamped, since it sorts wrongly. */
function dateFrom(value: string | null | undefined): Date | undefined {
    if (value === null || value === undefined || value.length === 0) {
        return undefined;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }
    return date.getTime() > Date.now() ? new Date() : date;
}

function compactCount(value: number | undefined): string | undefined {
    if (value === undefined || value <= 0) {
        return undefined;
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
    }
    return String(value);
}

function ratingFor(manga: ApiManga): number | undefined {
    const value = numberFrom(manga.rating ?? null);
    return value !== undefined && value > 0 ? value : undefined;
}

function chapterLabel(manga: ApiManga): string | undefined {
    const number = numberFrom(manga.chapter_number ?? null);
    return number === undefined ? undefined : `Ch. ${number}`;
}

function title(manga: ApiManga): string {
    return cleanText(manga.title ?? manga.name ?? "");
}

function joinDetails(parts: Array<string | undefined>): string | undefined {
    const joined = parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ");
    return joined.length > 0 ? joined : undefined;
}

/** How long ago something happened, in the shortest form that still reads. */
function relativeTime(date: Date | undefined): string | undefined {
    if (date === undefined) {
        return undefined;
    }

    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    const scale: Array<[number, string]> = [
        [31_536_000, "y"],
        [2_592_000, "mo"],
        [604_800, "w"],
        [86_400, "d"],
        [3_600, "h"],
        [60, "m"],
    ];

    for (const [size, suffix] of scale) {
        if (seconds >= size) {
            return `${Math.floor(seconds / size)}${suffix} ago`;
        }
    }
    return "just now";
}

/**
 * Builds a home page tile.
 *
 * 0.8 tiles carry a single subtitle line, so whichever details suit the
 * section are joined into it. `rank` leads where the row is ranked.
 */
export function toDiscoverItem(
    baseUrl: string,
    manga: ApiManga,
    detail: "chapter" | "reads" | "rating" | "updated",
    rank?: number,
): DiscoverSectionItem {
    const rating = ratingFor(manga);

    const lead =
        detail === "reads"
            ? joinDetails([chapterLabel(manga), compactCount(manga.recent_reads ?? manga.view_count)])
            : detail === "rating"
              ? joinDetails([rating === undefined ? undefined : `${rating.toFixed(1)} ★`, chapterLabel(manga)])
              : detail === "updated"
                ? joinDetails([
                      chapterLabel(manga),
                      relativeTime(dateFrom(manga.release_date ?? manga.chapter_updated_at ?? manga.updated_at)),
                  ])
                : chapterLabel(manga);

    return {
        mangaId: mangaIdFor(manga),
        title: title(manga),
        imageUrl: coverUrlFor(baseUrl, manga),
        subtitle: joinDetails([rank === undefined ? undefined : `#${rank}`, lead]),
    };
}

export function toSearchResultItem(baseUrl: string, manga: ApiManga): SearchResultItem {
    const rating = ratingFor(manga);

    return {
        mangaId: mangaIdFor(manga),
        title: title(manga),
        imageUrl: coverUrlFor(baseUrl, manga),
        subtitle: joinDetails([rating === undefined ? undefined : `${rating.toFixed(1)} ★`, chapterLabel(manga)]),
        contentRating: contentRatingFor(manga),
    };
}

export function toSourceManga(baseUrl: string, manga: ApiManga, mangaId: string): SourceManga {
    const seen = new Set<string>();
    const group = (names: string[]): Tag[] =>
        names.flatMap((name) => {
            const id = sanitizeId(name);
            if (id.length === 0 || seen.has(id)) {
                return [];
            }
            seen.add(id);
            return [{ id, title: name }];
        });

    const genreTags = group(genreNames(manga));
    const tagTags = group(tagNames(manga.tags));
    const rating = ratingFor(manga);
    const alternate = manga.alt_title === null || manga.alt_title === undefined ? "" : cleanText(manga.alt_title);
    const author = tagNames(manga.authors).join(", ");

    return {
        mangaId,
        mangaInfo: {
            primaryTitle: title(manga),
            secondaryTitles:
                alternate.length > 0
                    ? alternate
                          .split(/[,;|]/)
                          .map((value) => value.trim())
                          .filter((value) => value.length > 0)
                    : [],
            thumbnailUrl: coverUrlFor(baseUrl, manga),
            synopsis: manga.description === null || manga.description === undefined ? "" : cleanText(manga.description),
            author: author.length > 0 ? author : undefined,
            status: manga.completed === 1 ? "Completed" : "Ongoing",
            // The site scores out of ten; the app expects a fraction of one.
            rating: rating === undefined ? undefined : Math.min(1, Math.max(0, rating / 10)),
            contentRating: contentRatingFor(manga),
            tagGroups: [
                ...(genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : []),
                ...(tagTags.length > 0 ? [{ id: "tags", title: "Tags", tags: tagTags }] : []),
            ],
        },
    };
}

/**
 * Reassembles a route's server payload.
 *
 * The route ships its data as escaped string fragments that only form valid
 * JSON once joined in order. A payload served directly for a component request
 * arrives unwrapped, so it is used as-is.
 */
function decodeFlight(body: string): string {
    const pieces: string[] = [];
    const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

    for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) {
        try {
            pieces.push(JSON.parse(`"${match[1]}"`) as string);
        } catch {
            continue;
        }
    }

    return pieces.length > 0 ? pieces.join("") : body;
}

/** Returns the object starting at `start`, respecting nesting and strings. */
function balancedObject(text: string, start: number): string | undefined {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
        const character = text[index];

        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === "\\") {
            if (inString) {
                escaped = true;
            }
            continue;
        }
        if (character === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }

        if (character === "{") {
            depth += 1;
        } else if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return text.slice(start, index + 1);
            }
        }
    }

    return undefined;
}

/**
 * Pulls one keyed object out of a server payload.
 *
 * Walks back from the key to the nearest object start that both parses cleanly
 * and still contains it, which skips the surrounding component tree.
 */
function extractFlight<T>(body: string, key: string): T | undefined {
    const blob = decodeFlight(body);
    const marker = `"${key}":`;
    let from = blob.indexOf(marker);

    while (from >= 0) {
        for (let start = from; start >= 0; start -= 1) {
            if (blob[start] !== "{") {
                continue;
            }

            const slice = balancedObject(blob, start);
            if (slice === undefined || slice.length < marker.length || !slice.includes(marker)) {
                continue;
            }

            try {
                return JSON.parse(slice) as T;
            } catch {
                continue;
            }
        }
        from = blob.indexOf(marker, from + marker.length);
    }

    return undefined;
}

export function parseChapters(body: string, sourceManga: SourceManga): Chapter[] {
    const entries = extractFlight<FlightChapterList>(body, "chapters")?.chapters ?? [];

    const chapters = entries.flatMap((entry, index) => {
        if (entry.id === undefined || entry.id === null) {
            return [];
        }

        const name = cleanText(entry.name ?? "");
        const chapNum = numberFrom(/(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? null) ?? entries.length - index;

        return [
            {
                chapterId: String(entry.id),
                sourceManga,
                langCode: "🇬🇧",
                chapNum,
                // A name that is only the number adds nothing beside it.
                title: name.length > 0 && !/^(?:ch\.?|chapter)\s*[\d.]+$/i.test(name) ? name : undefined,
                volume: 0,
                // The list runs newest first; the app wants oldest lowest.
                sortingIndex: entries.length - index,
                publishDate: dateFrom(entry.uploadDate ?? entry.updatedAt ?? entry.createdAt),
            },
        ];
    });

    if (chapters.length === 0) {
        throw new Error(`No chapters were found for ${sourceManga.mangaInfo.primaryTitle}.`);
    }
    return chapters;
}

export function parseChapterPages(body: string, chapter: Chapter): ChapterDetails {
    const pages = (extractFlight<FlightImages>(body, "images")?.images ?? [])
        .slice()
        .sort((left, right) => (left.page_number ?? 0) - (right.page_number ?? 0))
        .map((image) => (image.image_url ?? image.url ?? "").trim())
        .filter((url) => url.length > 0);

    if (pages.length === 0) {
        throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
    }

    return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        pages: [...new Set(pages)],
    };
}
