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
    ADULT_GENRES,
    PAID_CHAPTER_SUFFIX,
    type LuaBanner,
    type LuaChapter,
    type LuaHomePage,
    type LuaSeries,
    type LuaTrendingItem,
} from "./models";

/** Characters the app refuses to accept inside an id. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

function sanitizeId(value: string): string {
    return value.toLowerCase().replace(UNSAFE_ID, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function encodeSlugId(slug: string): string {
    return slug.replace(UNSAFE_ID, (char) => encodeURIComponent(char));
}

export function decodeSlugId(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function isAdultGenre(name: string): boolean {
    return ADULT_GENRES.includes(name.trim().toLowerCase());
}

function cleanText(value?: string | null): string {
    if (value === null || value === undefined || value.length === 0) {
        return "";
    }
    return Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();
}

/** Keeps the paragraph breaks a synopsis needs, unlike `cleanText`. */
function cleanDescription(value?: string | null): string {
    if (value === null || value === undefined || value.length === 0) {
        return "";
    }
    return Application.decodeHTMLEntities(value)
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
}

function mapStatus(status?: string | null): string | undefined {
    const value = (status ?? "").trim();
    return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : undefined;
}

function formatCount(value: number): string {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toString();
}

function ratingToUnit(value?: number | null): number | undefined {
    if (value === null || value === undefined || !isFinite(value)) {
        return undefined;
    }
    return Math.min(1, Math.max(0, value / 5));
}

export function tagNames(series: LuaSeries): string[] {
    return (series.tags ?? [])
        .map((tag) => (typeof tag === "string" ? tag : (tag.name ?? "")))
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
}

function contentRatingForSeries(series: LuaSeries): ContentRating {
    return tagNames(series).some(isAdultGenre) ? ContentRating.ADULT : ContentRating.MATURE;
}

function yearOf(value?: string | null): string | undefined {
    return /^(\d{4})/.exec(value ?? "")?.[1];
}

function chapterCount(meta?: { chapters_count?: string | number | null } | null): number | undefined {
    const raw = meta?.chapters_count;
    const parsed = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
    return isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Reassembles the page's data stream.
 *
 * The site is a Next.js app that pushes its data over in chunks; the joins
 * between chunks are stripped and the escaping undone so the result reads as
 * ordinary JSON text.
 */
function flightPayload(html: string): string {
    return html
        .replace(/"\]\)\s*;?\s*(?:<\/script>\s*<script>\s*)?self\.__next_f\.push\(\[1,\s*"/g, "")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
}

function sliceJsonArray(text: string, from: number): string | undefined {
    let depth = 0;
    let inString = false;

    for (let index = from; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            if (char === "\\") {
                index += 1;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === "[") {
            depth += 1;
        } else if (char === "]") {
            depth -= 1;
            if (depth === 0) {
                return text.slice(from, index + 1);
            }
        }
    }

    return undefined;
}

function extractArray<T>(payload: string, key: string): T[] {
    const marker = `"${key}":[`;
    const start = payload.indexOf(marker);
    if (start === -1) {
        return [];
    }

    const slice = sliceJsonArray(payload, start + marker.length - 1);
    if (slice === undefined) {
        return [];
    }

    try {
        return JSON.parse(slice) as T[];
    } catch {
        return [];
    }
}

/**
 * Resolves a value the stream deduped into a row of its own.
 *
 * A long description arrives as a pointer like "$1b"; the row it names carries
 * the real text, prefixed by its length in hex.
 */
function resolveFlightText(payload: string, value: string | null | undefined): string | undefined {
    if (value === null || value === undefined || value.length === 0) {
        return undefined;
    }
    if (!/^\$[0-9a-f]+$/i.test(value)) {
        return value;
    }

    const marker = `${value.slice(1)}:T`;
    let index = payload.indexOf(marker);

    // Make sure the row id is not the tail of a longer one.
    while (index > 0 && /[0-9a-z]/i.test(payload[index - 1] ?? "")) {
        index = payload.indexOf(marker, index + 1);
    }
    if (index === -1) {
        return undefined;
    }

    const comma = payload.indexOf(",", index + marker.length);
    if (comma === -1) {
        return undefined;
    }

    const length = parseInt(payload.slice(index + marker.length, comma), 16);
    if (!isFinite(length) || length <= 0) {
        return undefined;
    }

    const chunk = payload.slice(comma + 1, comma + 1 + length);
    const boundary = chunk.search(/\n[0-9a-f]{1,4}:/i);
    return (boundary === -1 ? chunk : chunk.slice(0, boundary)).trim() || undefined;
}

function resolveSeriesText(payload: string, series: LuaSeries): LuaSeries {
    return { ...series, description: resolveFlightText(payload, series.description) ?? null };
}

export function parseHomePage(html: string): LuaHomePage {
    const payload = flightPayload(html);

    return {
        banners: extractArray<LuaBanner>(payload, "banners").map((banner) => ({
            ...banner,
            series: banner.series ? resolveSeriesText(payload, banner.series) : banner.series,
        })),
        recommended: extractArray<LuaSeries>(payload, "series").map((series) =>
            resolveSeriesText(payload, series),
        ),
        editors: extractArray<LuaSeries>(payload, "pinned_series").map((series) =>
            resolveSeriesText(payload, series),
        ),
    };
}

function parseMetaContent(html: string, property: string): string | undefined {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(
        `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
        "i",
    ).exec(html);

    return match?.[1] !== undefined && match[1].length > 0
        ? Application.decodeHTMLEntities(match[1])
        : undefined;
}

function parseJsonNumber(payload: string, key: string): number | undefined {
    const match = new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(payload);
    if (match === null) {
        return undefined;
    }
    const value = parseInt(match[1] ?? "", 10);
    return isFinite(value) ? value : undefined;
}

function parseJsonString(payload: string, key: string): string | undefined {
    const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(payload);
    if (match === null) {
        return undefined;
    }
    try {
        return JSON.parse(`"${match[1]}"`) as string;
    } catch {
        return match[1];
    }
}

export function parseSeriesPage(html: string, slug: string): LuaSeries {
    const payload = flightPayload(html);

    // The page's own metadata is cleaner than what the stream carries.
    const titleFromMeta = parseMetaContent(html, "og:title")?.replace(/\s+-\s+Lua Comic$/i, "");
    const descriptionFromMeta = parseMetaContent(html, "og:description")?.replace(
        new RegExp(
            `^Read\\s+${(titleFromMeta ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+on\\s+Lua Comic\\s*-\\s*`,
            "i",
        ),
        "",
    );

    const id = parseJsonNumber(payload, "id");
    if (id === undefined) {
        throw new Error(`No series id was found for ${slug}.`);
    }

    return {
        id,
        title: titleFromMeta ?? parseJsonString(payload, "title") ?? slug,
        description: descriptionFromMeta ?? parseJsonString(payload, "description") ?? null,
        alternative_names: parseJsonString(payload, "alternative_names") ?? null,
        series_type: parseJsonString(payload, "series_type") ?? "Comic",
        series_slug: parseJsonString(payload, "series_slug") ?? slug,
        thumbnail: parseMetaContent(html, "og:image") ?? parseJsonString(payload, "thumbnail") ?? null,
        total_views: parseJsonNumber(payload, "total_views") ?? null,
        status: parseJsonString(payload, "status") ?? null,
        created_at: parseJsonString(payload, "created_at") ?? null,
        updated_at: parseJsonString(payload, "updated_at") ?? null,
        badge: parseJsonString(payload, "badge") ?? null,
        author: parseJsonString(payload, "author") ?? null,
        rating: parseJsonNumber(payload, "rating") ?? null,
        tags: extractArray<{ name?: string | null }>(payload, "tags"),
        meta: { chapters_count: parseJsonNumber(payload, "chapters_count") ?? null },
    };
}

export function toPopularItems(entries: LuaSeries[]): DiscoverSectionItem[] {
    return entries.map((series) => {
        // 0.9 gave this tile an alternate-title line, a summary and a row of
        // counters. 0.8 has one line, so it carries the score and the status.
        const subtitle = [
            series.rating !== null && series.rating !== undefined && isFinite(series.rating)
                ? `★ ${series.rating.toFixed(1)}`
                : "",
            mapStatus(series.status) ?? "",
        ]
            .filter((part) => part.length > 0)
            .join(" • ");

        return {
            type: "featuredCarouselItem" as const,
            mangaId: encodeSlugId(series.series_slug),
            imageUrl: series.thumbnail ?? "",
            title: cleanText(series.title),
            subtitle: subtitle || undefined,
        };
    });
}

export function toBannerItems(banners: LuaBanner[]): DiscoverSectionItem[] {
    return banners.flatMap((banner): DiscoverSectionItem[] => {
        const series = banner.series;
        if (series === null || series === undefined || !series.series_slug) {
            return [];
        }

        const views = series.total_views;

        return [
            {
                type: "featuredCarouselItem",
                mangaId: encodeSlugId(series.series_slug),
                imageUrl: banner.banner ?? series.thumbnail ?? "",
                title: cleanText(series.title),
                subtitle: views !== null && views !== undefined ? `${formatCount(views)} views` : undefined,
            },
        ];
    });
}

export function toRecommendedItems(entries: LuaSeries[]): DiscoverSectionItem[] {
    return entries.map((series) => {
        const subtitle = [mapStatus(series.status) ?? "", yearOf(series.created_at) ?? "", cleanText(series.author)]
            .filter((part) => part.length > 0)
            .join(" • ");

        return {
            type: "simpleCarouselItem" as const,
            mangaId: encodeSlugId(series.series_slug),
            imageUrl: series.thumbnail ?? "",
            title: cleanText(series.title),
            subtitle: subtitle || undefined,
        };
    });
}

function chapterIsPaid(chapter: LuaChapter): boolean {
    return (chapter.price ?? 0) > 0;
}

function newestChapter(series: LuaSeries): LuaChapter | undefined {
    return [...(series.free_chapters ?? [])]
        .filter((chapter) => !chapterIsPaid(chapter))
        .sort(
            (left, right) =>
                new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime(),
        )[0];
}

export function toLatestItems(entries: LuaSeries[]): DiscoverSectionItem[] {
    return entries.flatMap((series): DiscoverSectionItem[] => {
        // Prefer the newest free chapter so update cards open something readable.
        const chapter = newestChapter(series);
        if (chapter === undefined) {
            return [];
        }

        const publishDate = new Date(chapter.created_at ?? "");

        return [
            {
                type: "chapterUpdatesCarouselItem",
                mangaId: encodeSlugId(series.series_slug),
                chapterId: encodeSlugId(chapter.chapter_slug),
                imageUrl: series.thumbnail ?? "",
                title: cleanText(series.title),
                subtitle: cleanText(chapter.chapter_name) || undefined,
                publishDate: isNaN(publishDate.getTime()) ? undefined : publishDate,
            },
        ];
    });
}

export function toRankedItems(entries: LuaSeries[]): DiscoverSectionItem[] {
    return entries.map((entry, index) => {
        const chapters = chapterCount(entry.meta);

        return {
            type: "simpleCarouselItem" as const,
            mangaId: encodeSlugId(entry.series_slug),
            imageUrl: entry.thumbnail ?? "",
            title: cleanText(entry.title),
            subtitle: [`#${index + 1}`, chapters !== undefined ? `${chapters} ch` : ""]
                .filter((part) => part.length > 0)
                .join(" • "),
        };
    });
}

export function toSearchResultItems(entries: LuaSeries[]): SearchResultItem[] {
    return entries.map((series) => ({
        mangaId: encodeSlugId(series.series_slug),
        title: cleanText(series.title),
        imageUrl: series.thumbnail ?? "",
        subtitle: mapStatus(series.status),
        contentRating: contentRatingForSeries(series),
    }));
}

export function toTrendingSearchItems(entries: LuaTrendingItem[]): SearchResultItem[] {
    return entries.map((entry, index) => {
        const chapters = parseInt(String(entry.meta?.chapters_count ?? ""), 10);

        return {
            mangaId: encodeSlugId(entry.series_slug),
            title: entry.title,
            imageUrl: entry.thumbnail ?? "",
            subtitle: [`#${index + 1}`, isFinite(chapters) ? `${chapters} ch` : ""]
                .filter((part) => part.length > 0)
                .join(" • "),
            contentRating: ContentRating.MATURE,
        };
    });
}

export function parseMangaDetails(series: LuaSeries): SourceManga {
    const primaryTitle = cleanText(series.title) || "Untitled";
    const secondaryTitles: string[] = [];
    const seen = new Set([primaryTitle.toLowerCase()]);

    for (const raw of (series.alternative_names ?? "").split(/\s*[,|/]\s*|\n/)) {
        const title = cleanText(raw);
        const key = title.toLowerCase();
        if (title.length === 0 || seen.has(key)) {
            continue;
        }
        seen.add(key);
        secondaryTitles.push(title);
    }

    const genres = [...new Set(tagNames(series))];
    const tags: Tag[] = genres.map((name) => ({ id: sanitizeId(name), title: name }));

    const views = series.total_views;

    return {
        mangaId: encodeSlugId(series.series_slug),
        mangaInfo: {
            primaryTitle,
            secondaryTitles,
            thumbnailUrl: series.thumbnail ?? "",
            synopsis: cleanDescription(series.description),
            author: cleanText(series.author) || undefined,
            status: mapStatus(series.status) ?? "Unknown",
            rating: ratingToUnit(series.rating),
            contentRating: contentRatingForSeries(series),
            tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
            additionalInfo:
                views !== null && views !== undefined && isFinite(views)
                    ? { views: formatCount(views) }
                    : undefined,
        },
    };
}

function chapterNumberOf(chapter: LuaChapter): number {
    const indexed = parseFloat(chapter.index ?? "");
    if (isFinite(indexed)) {
        return indexed;
    }

    const named = /(\d+(?:\.\d+)?)/.exec(chapter.chapter_name ?? chapter.chapter_slug);
    return named !== null ? parseFloat(named[1] ?? "0") : 0;
}

export function parseChapterList(
    chapters: LuaChapter[],
    sourceManga: SourceManga,
    showPaid: boolean,
): Chapter[] {
    return chapters
        .filter((chapter) => showPaid || !chapterIsPaid(chapter))
        .sort((left, right) => chapterNumberOf(left) - chapterNumberOf(right))
        .map((chapter, index) => {
            const paid = chapterIsPaid(chapter);
            const title = cleanText(chapter.chapter_title);

            return {
                chapterId: `${encodeSlugId(chapter.chapter_slug)}${paid ? PAID_CHAPTER_SUFFIX : ""}`,
                sourceManga,
                title: paid ? (title.length > 0 ? `${title} 🔒` : "🔒") : title,
                chapNum: chapterNumberOf(chapter),
                volume: 0,
                langCode: "🇬🇧",
                sortingIndex: index,
                publishDate: chapter.created_at ? new Date(chapter.created_at) : undefined,
            };
        });
}

export function parseChapterPages(html: string, chapter: Chapter): ChapterDetails {
    const payload = flightPayload(html);
    let pages: string[] = [];

    // Scan from the chapter's own record, so an images list belonging to some
    // other part of the page is not picked up instead.
    const anchor = payload.indexOf('"chapter_data":');
    const marker = '"images":[';
    const start = payload.indexOf(marker, anchor === -1 ? 0 : anchor);

    if (start !== -1) {
        const slice = sliceJsonArray(payload, start + marker.length - 1);
        if (slice !== undefined) {
            try {
                pages = (JSON.parse(slice) as unknown[]).filter((url): url is string => typeof url === "string");
            } catch {
                pages = [];
            }
        }
    }

    if (pages.length === 0) {
        // Older chapters render their pages as ordinary markup.
        const images = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi;
        let match: RegExpExecArray | null;
        while ((match = images.exec(payload)) !== null) {
            pages.push(match[1] ?? "");
        }
    }

    pages = pages
        .map((url) => url.replace(/%3A/gi, ":").replace(/%2F/gi, "/").replace(/ /g, "%20"))
        // Keep only the site's own media, so page furniture is left out.
        .filter((url) => url.includes("media.luacomic.org") || url.includes("/uploads/series/"));

    if (pages.length === 0) {
        throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
}
