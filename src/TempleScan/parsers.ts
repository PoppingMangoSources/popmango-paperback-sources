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
    PAID_CHAPTER_SUFFIX,
    type BrowseSeries,
    type FeaturedEntry,
    type HomeSections,
    type HomeSeries,
    type SeasonChapter,
    type SeriesData,
    type TrendingEntry,
    type TrendingRange,
    type TrendingResponse,
} from "./models";

// Page data lives in a Next.js flight stream: JSON values sit directly in
// stream rows when fetched with the `rsc` header, or inside escaped script
// chunks when a full HTML document is returned. Slice balanced JSON out of
// the text, string-aware so braces inside values don't desync the scan.
function sliceJson(payload: string, start: number): string | undefined {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < payload.length; index += 1) {
        const char = payload[index];

        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }

        if (char === "{" || char === "[") {
            depth += 1;
        } else if (char === "}" || char === "]") {
            depth -= 1;
            if (depth === 0) {
                return payload.slice(start, index + 1);
            }
        }
    }

    return undefined;
}

function decodeEscaped(payload: string): string {
    return payload.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function scanByKey<T>(payload: string, key: string, matches: (value: T) => boolean): T | undefined {
    const marker = `"${key}":`;
    let index = payload.indexOf(marker);

    while (index !== -1) {
        const start = index + marker.length;

        if (payload[start] === "{" || payload[start] === "[") {
            const raw = sliceJson(payload, start);
            if (raw !== undefined) {
                try {
                    const value = JSON.parse(raw) as T;
                    if (matches(value)) {
                        return value;
                    }
                } catch {
                    // A key hit inside non-JSON markup; keep scanning.
                }
            }
        }

        index = payload.indexOf(marker, index + marker.length);
    }

    return undefined;
}

/** Tries the raw flight stream first, then the escaped-script form. */
function extractByKey<T>(payload: string, key: string, matches: (value: T) => boolean): T | undefined {
    return scanByKey(payload, key, matches) ?? scanByKey(decodeEscaped(payload), key, matches);
}

/**
 * Reads the whole directory out of the browse stream.
 *
 * It is not labelled, so it is found by being the largest array of entries
 * that look like series.
 */
export function parseDirectory(payload: string): BrowseSeries[] {
    let directory: BrowseSeries[] = [];

    for (const text of [payload, decodeEscaped(payload)]) {
        let index = text.indexOf("[{");

        while (index !== -1) {
            const raw = sliceJson(text, index);
            if (raw !== undefined && raw.length > 40) {
                try {
                    const value = JSON.parse(raw) as BrowseSeries[];
                    if (
                        Array.isArray(value) &&
                        value.length > directory.length &&
                        value.every((entry) => entry !== null && typeof entry === "object") &&
                        value[0]?.series_slug !== undefined &&
                        value[0]?.title !== undefined
                    ) {
                        directory = value;
                    }
                } catch {
                    // Not a data array; keep scanning.
                }
            }
            index = text.indexOf("[{", index + 2);
        }

        if (directory.length > 0) {
            break;
        }
    }

    if (directory.length === 0) {
        throw new Error("No series directory was found; the site layout may have changed.");
    }
    return directory;
}

// A long value — the description, usually — is deduped into its own flight row
// and referenced as "$<row>"; resolve that back to the row's byte-counted text.
function resolveFlightRef(payload: string, ref: string): string | undefined {
    for (const text of [payload, decodeEscaped(payload)]) {
        const header = new RegExp(`(?:^|\\n)${ref.slice(1)}:T([0-9a-f]+),`).exec(text);
        if (header === null) {
            continue;
        }

        const byteLength = parseInt(header[1] ?? "0", 16);
        const start = header.index + header[0].length;
        let bytes = 0;
        let end = start;

        while (end < text.length && bytes < byteLength) {
            const code = text.codePointAt(end) ?? 0;
            bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
            end += code > 0xffff ? 2 : 1;
        }

        return text.slice(start, end);
    }

    return undefined;
}

export function parseSeriesData(payload: string, mangaId: string): SeriesData {
    const data = extractByKey<SeriesData>(
        payload,
        "seriesData",
        (value) => value !== null && typeof value === "object" && Boolean(value.title),
    );

    if (data === undefined) {
        throw new Error(`No details were found for ${mangaId}.`);
    }

    // A bare "$<row>" description is an unresolved flight reference; resolve it
    // to the real text, or blank it so the pointer never shows as the synopsis.
    if (typeof data.description === "string" && /^\$[0-9a-f]+$/i.test(data.description)) {
        data.description = resolveFlightRef(payload, data.description) ?? "";
    }

    return data;
}

/** Characters the app refuses to accept inside an id. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

function sanitizeId(value: string): string {
    return value.toLowerCase().replace(UNSAFE_ID, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function stripHtml(html: string): string {
    return Application.decodeHTMLEntities(
        html
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/gi, " "),
    ).trim();
}

// Descriptions sometimes end with "#tag" hashtags behind a label word
// ("Tags:", "Keywords:", ...); strip both from the prose.
function cleanDescription(raw: string): string {
    const text = raw.includes("#")
        ? raw
              .slice(0, raw.indexOf("#"))
              .replace(/[\w\s]+:?\s*$/, "")
              .trim()
        : raw;
    return stripHtml(text);
}

function formatCount(count: number): string {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(1)}K`;
    }
    return count.toString();
}

function statusLabel(status?: string | null): string {
    if (!status) {
        return "Unknown";
    }
    return status === "Canceled" || status === "Dropped" ? "Cancelled" : status;
}

export function toSourceManga(data: SeriesData, mangaId: string): SourceManga {
    const description = data.description ?? "";
    const tagTitles = [
        data.badge ?? "",
        data.release_year !== null && data.release_year !== undefined ? String(data.release_year) : "",
        ...(data.tag_series ?? []).map((wrapper) => wrapper.tag?.name ?? ""),
        ...[...description.matchAll(/#(\w+)/g)].map((match) => match[1] ?? ""),
    ].filter((title) => title.length > 0);

    const seen = new Set<string>();
    const tags: Tag[] = tagTitles.flatMap((title) => {
        const id = sanitizeId(title);
        if (id.length === 0 || seen.has(id)) {
            return [];
        }
        seen.add(id);
        return [{ id, title }];
    });

    return {
        mangaId,
        mangaInfo: {
            primaryTitle: data.title,
            secondaryTitles: data.alternative_names ? [data.alternative_names] : [],
            thumbnailUrl: data.thumbnail ?? "",
            synopsis: cleanDescription(description),
            author: data.author ?? undefined,
            artist: data.studio ?? undefined,
            status: statusLabel(data.status),
            contentRating: ContentRating.ADULT,
            tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
        },
    };
}

function chapterNumber(chapter: SeasonChapter): number {
    const fromName = /(\d+(?:\.\d+)?)/.exec(chapter.chapter_name ?? "");
    if (fromName !== null) {
        return parseFloat(fromName[1] ?? "0");
    }

    const fromIndex = parseFloat(String(chapter.index ?? ""));
    return isNaN(fromIndex) ? 0 : fromIndex;
}

export function chapterIsPaid(chapter: SeasonChapter): boolean {
    return (chapter.price ?? 0) > 0;
}

function chapterTitle(chapter: SeasonChapter): string {
    const title = ((chapter.chapter_title ?? "").trim() || (chapter.chapter_name ?? "").trim())
        .replace(/^chapter\s+\d+(?:\.\d+)?(?:\s*[-:]\s*)?/i, "")
        .trim();

    if (!chapterIsPaid(chapter)) {
        return title;
    }
    return title.length > 0 ? `${title} 🔒` : "🔒";
}

function updateCardSubtitle(chapter: SeasonChapter): string {
    const number = chapterNumber(chapter);
    return [number > 0 ? `Chapter ${number}` : "", chapterTitle(chapter)]
        .filter((part) => part.length > 0)
        .join(" • ");
}

export function parseChapters(
    data: SeriesData,
    sourceManga: SourceManga,
    showPaidChapters: boolean,
): Chapter[] {
    return (data.Season ?? [])
        .flatMap((season) => season.Chapter ?? [])
        .filter((chapter) => chapter.chapter_slug && (showPaidChapters || !chapterIsPaid(chapter)))
        .map((chapter) => ({
            chapterId: `${chapter.chapter_slug}${chapterIsPaid(chapter) ? PAID_CHAPTER_SUFFIX : ""}`,
            sourceManga,
            langCode: "🇬🇧",
            chapNum: chapterNumber(chapter),
            title: chapterTitle(chapter),
            volume: 0,
            publishDate: chapter.created_at ? new Date(chapter.created_at) : undefined,
        }));
}

export function parseChapterPages(payload: string, chapter: Chapter): ChapterDetails {
    const pages = extractByKey<string[]>(
        payload,
        "pages",
        (value) => Array.isArray(value) && (value.length === 0 || typeof value[0] === "string"),
    );

    if (pages === undefined || pages.length === 0) {
        throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
}

export function parseHomeSections(payload: string): HomeSections {
    return {
        newSeries:
            extractByKey<HomeSeries[]>(
                payload,
                "data",
                (value) =>
                    Array.isArray(value) &&
                    value.length > 0 &&
                    Boolean(value[0]?.series_slug) &&
                    value[0]?.Chapter === undefined,
            ) ?? [],
        updates:
            extractByKey<HomeSeries[]>(
                payload,
                "series",
                (value) => Array.isArray(value) && value.length > 0 && Array.isArray(value[0]?.Chapter),
            ) ?? [],
    };
}

export function toNewSeriesItems(series: HomeSeries[]): DiscoverSectionItem[] {
    return series.map((entry) => ({
        type: "simpleCarouselItem" as const,
        mangaId: entry.series_slug,
        title: entry.title,
        imageUrl: entry.thumbnail ?? "",
        subtitle: entry.badge ?? undefined,
    }));
}

export function toUpdateItems(updates: HomeSeries[]): DiscoverSectionItem[] {
    return updates.flatMap((series) => {
        // Prefer the newest free chapter so update cards open something readable.
        const chapter = (series.Chapter ?? []).find((entry) => !chapterIsPaid(entry));
        if (chapter === undefined) {
            return [];
        }

        return [
            {
                type: "chapterUpdatesCarouselItem" as const,
                mangaId: series.series_slug,
                chapterId: chapter.chapter_slug,
                title: series.title,
                imageUrl: series.thumbnail ?? "",
                subtitle: updateCardSubtitle(chapter),
                publishDate: chapter.created_at ? new Date(chapter.created_at) : undefined,
            },
        ];
    });
}

export function parseFeatured(response: string): FeaturedEntry[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(response);
    } catch {
        throw new Error("The featured list could not be read.");
    }

    if (!Array.isArray(parsed)) {
        throw new Error("The featured response is not a list.");
    }
    return (parsed as FeaturedEntry[]).filter((entry) => entry.series_slug && entry.title);
}

/** The banner list has no cover art of its own; borrow it from the directory. */
export function withFeaturedCovers(entries: FeaturedEntry[], directory: BrowseSeries[]): FeaturedEntry[] {
    const covers = new Map(directory.map((series) => [series.series_slug, series.thumbnail]));
    return entries.map((entry) => ({ ...entry, thumbnail: covers.get(entry.series_slug) }));
}

export function toFeaturedItems(entries: FeaturedEntry[]): DiscoverSectionItem[] {
    return entries.map((entry) => ({
        type: "featuredCarouselItem" as const,
        mangaId: entry.series_slug,
        title: entry.title,
        // The featured carousel renders one image as both the portrait tile and
        // the card background, so a wide hero banner crops badly. Prefer the
        // character art, falling back to the portrait cover then the banner.
        imageUrl: entry.protagonist ?? entry.thumbnail ?? entry.banner ?? "",
        // 0.9 gave this tile a supertitle, a summary and a view count on
        // separate lines. 0.8 has one line, so it carries the author and the
        // view count and the summary is left to the details page.
        subtitle:
            [entry.author ?? "", entry.total_views ? `${formatCount(entry.total_views)} views` : ""]
                .filter((part) => part.length > 0)
                .join(" • ") || undefined,
    }));
}

export function toSearchResultItem(series: BrowseSeries): SearchResultItem {
    return {
        mangaId: series.series_slug,
        title: series.title,
        imageUrl: series.thumbnail ?? "",
        subtitle: series.total_views ? `${formatCount(series.total_views)} views` : undefined,
        contentRating: ContentRating.ADULT,
    };
}

export function parseTrending(response: string, range: TrendingRange): TrendingEntry[] {
    let parsed: TrendingResponse;
    try {
        parsed = JSON.parse(response) as TrendingResponse;
    } catch {
        throw new Error("The trending list could not be read.");
    }

    const lists: Record<TrendingRange, TrendingEntry[] | undefined> = {
        day: parsed.dayRes,
        week: parsed.weekRes,
        month: parsed.mensualRes,
    };
    return lists[range] ?? [];
}

export function toTrendingItems(entries: TrendingEntry[]): SearchResultItem[] {
    return entries.map((entry, index) => {
        const views = entry.day_views ?? entry.week_views ?? entry.month_views;
        return {
            mangaId: entry.series_slug,
            title: entry.title,
            imageUrl: entry.thumbnail ?? "",
            subtitle: [`#${index + 1}`, views ? `${formatCount(views)} views` : ""]
                .filter((part) => part.length > 0)
                .join(" · "),
            contentRating: ContentRating.ADULT,
        };
    });
}
