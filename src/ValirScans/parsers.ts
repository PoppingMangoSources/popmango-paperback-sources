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
    type TagSection,
} from "../../common";

import {
    LOCKED_CHAPTER_PREFIX,
    NOVEL_TYPE,
    type BrowsePage,
    type FilterOption,
    type FilterTaxonomy,
    type HomeSections,
    type ValirChapterData,
    type ValirChapterItem,
    type ValirSeries,
    type ValirSeriesPage,
} from "./models";
import { toAbsoluteUrl } from "./site";

// The app rejects ids containing characters outside its allowed set — an
// apostrophe in a tag slug is enough to crash it — so anything else is scrubbed.
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

function sanitizeId(value: string): string {
    return value.toLowerCase().replace(UNSAFE_ID, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// Page data ships in a Next.js flight stream as escaped string literals; undo
// that escaping so JSON values can be sliced out by their keys.
function decodeFlightPayload(html: string): string {
    return html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function sliceBalanced(payload: string, start: number): string | undefined {
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

function extractByMarker<T>(payload: string, marker: string, keepMarker = false): T[] {
    const values: T[] = [];
    let index = payload.indexOf(marker);

    while (index !== -1) {
        const start = keepMarker ? index : index + marker.length;

        if (payload[start] === "{" || payload[start] === "[") {
            const raw = sliceBalanced(payload, start);
            if (raw !== undefined) {
                try {
                    values.push(JSON.parse(raw) as T);
                } catch {
                    // The marker also occurs in ordinary markup; skip those hits.
                }
            }
        }

        index = payload.indexOf(marker, index + marker.length);
    }

    return values;
}

/** Whether a series is prose rather than a comic. */
export function isNovel(series: ValirSeries): boolean {
    return (series.type ?? "").toUpperCase().includes(NOVEL_TYPE.toUpperCase());
}

/** Drops the novels from a list; this extension carries comics only. */
function comicsOnly(list: ValirSeries[]): ValirSeries[] {
    return list.filter((series) => !isNovel(series));
}

// Series URLs are /series/{comic|novel}/{urlSlug}; keeping both parts in the
// id lets every request rebuild the URL without another lookup.
function toMangaId(series: ValirSeries): string {
    return `comic/${series.urlSlug ?? series.slug}`;
}

function toContentRating(series: ValirSeries): ContentRating {
    return series.isMature === true ? ContentRating.MATURE : ContentRating.EVERYONE;
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

// Series text arrives with HTML entities still in place, so it is decoded at
// the parser boundary before it reaches the app.
function cleanText(value?: string | null): string {
    return Application.decodeHTMLEntities(value ?? "").trim();
}

function toTitleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/**
 * The line under a carousel tile.
 *
 * A ranked strip leads with the rank, an unranked one with the rating, and
 * both trail with the view count. Two figures is as much as the tile holds.
 */
function statSubtitle(series: ValirSeries, rank?: number): string | undefined {
    const lead =
        rank !== undefined ? `#${rank}` : series.rating !== undefined ? `★ ${series.rating.toFixed(1)}` : "";

    const parts = [lead, series.viewCount !== undefined ? `${formatCount(series.viewCount)} views` : ""].filter(
        (part) => part.length > 0,
    );

    return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function parseHomeSections(html: string): HomeSections {
    const payload = decodeFlightPayload(html);
    const seriesLists = extractByMarker<ValirSeries[]>(payload, '"series":').filter(
        (list) => Array.isArray(list) && list.length > 0,
    );

    return {
        featured: comicsOnly(extractByMarker<ValirSeries[]>(payload, '"initialSlides":')[0] ?? []),
        // The card-stack, updates and new-series components all pass a `series`
        // prop; they are told apart by the fields unique to each item shape.
        editorsPicks: comicsOnly(
            seriesLists.find((list) => list[0] !== undefined && "viewCount" in list[0] && !("createdAt" in list[0])) ??
                [],
        ),
        latestUpdates: comicsOnly(
            seriesLists.find((list) => list[0] !== undefined && "lastChapterAt" in list[0]) ?? [],
        ),
        // Named for the component rather than its contents; the shelf carries
        // comics too, and the novels among them are dropped here.
        popularToday: comicsOnly(extractByMarker<ValirSeries[]>(payload, '"novels":')[0] ?? []),
        // Ranked cards are emitted in rank order, one prop per card.
        mostPopular: comicsOnly(
            extractByMarker<ValirSeries>(payload, '"novel":').filter(
                (series) => Boolean(series.slug) && Boolean(series.title),
            ),
        ),
    };
}

// The filter component holds the full genre and tag lists as flat
// `{ name, slug }` records; matching on both fields isolates them from the
// nested copies inside card data.
export function parseFilterTaxonomy(html: string): FilterTaxonomy {
    const payload = decodeFlightPayload(html);

    const pick = (key: string): FilterOption[] =>
        (
            extractByMarker<Array<{ name?: string; slug?: string }>>(payload, `"${key}":`)
                .filter((list) => Array.isArray(list) && Boolean(list[0]?.name) && Boolean(list[0]?.slug))
                .sort((left, right) => right.length - left.length)[0] ?? []
        ).flatMap((entry) =>
            entry.name !== undefined && entry.slug !== undefined
                ? [{ id: sanitizeId(entry.slug), title: cleanText(entry.name) }]
                : [],
        );

    return { genres: pick("genres"), tags: pick("tags") };
}

export function parseBrowsePage(html: string): BrowsePage {
    const payload = decodeFlightPayload(html);
    const series = extractByMarker<ValirSeries[]>(payload, '"initialSeries":')[0];

    if (series === undefined) {
        throw new Error("No series list was found on the browse page.");
    }

    return { series: comicsOnly(series), hasMore: payload.includes('"initialHasMore":true') };
}

export function parseSeriesPage(html: string): ValirSeriesPage {
    const payload = decodeFlightPayload(html);
    const page = extractByMarker<ValirSeriesPage>(payload, '{"series":', true).find(
        (candidate) => Boolean(candidate.series?.title) && Array.isArray(candidate.chapters),
    );

    if (page === undefined) {
        throw new Error("No series data was found; the site layout may have changed.");
    }
    return page;
}

export function parseMangaDetails(page: ValirSeriesPage, mangaId: string): SourceManga {
    const series = page.series;

    const secondaryTitles = [
        ...new Set(
            [series.altTitle, series.originalTitle, ...(series.aliases ?? [])]
                .map((title) => cleanText(title))
                .filter((title) => title.length > 0 && title !== cleanText(series.title)),
        ),
    ];

    const genres: Tag[] = (series.genres ?? []).flatMap((entry) => {
        const genre = entry.genre ?? entry;
        const title =
            genre.name !== undefined
                ? cleanText(genre.name)
                : genre.slug !== undefined
                  ? toTitleCase(genre.slug)
                  : "";
        if (title.length === 0) {
            return [];
        }
        return [{ id: sanitizeId(genre.slug ?? title), title }];
    });

    const tags: Tag[] = (series.tags ?? [])
        .filter((tag): tag is { name: string; slug?: string } => tag.name !== undefined)
        .map((tag) => ({ id: sanitizeId(tag.slug ?? tag.name), title: cleanText(tag.name) }));

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
        tagGroups.push({ id: "genres", title: "Genres", tags: genres });
    }
    if (tags.length > 0) {
        tagGroups.push({ id: "tags", title: "Tags", tags });
    }

    return {
        mangaId,
        mangaInfo: {
            primaryTitle: cleanText(series.title),
            secondaryTitles,
            thumbnailUrl: toAbsoluteUrl(series.coverImage),
            bannerUrl: series.bannerImage !== null && series.bannerImage !== undefined
                ? toAbsoluteUrl(series.bannerImage)
                : undefined,
            synopsis: cleanText(series.description),
            contentRating: toContentRating(series),
            status: series.status ? toTitleCase(series.status) : "Unknown",
            author: cleanText(series.author) || undefined,
            artist: cleanText(series.artist) || undefined,
            rating: series.rating !== undefined ? Math.min(1, Math.max(0, series.rating / 10)) : undefined,
            tagGroups: tagGroups.length > 0 ? tagGroups : undefined,
        },
    };
}

function chapterIsLocked(chapter: ValirChapterItem): boolean {
    return chapter.isLocked === true;
}

function chapterTitle(chapter: ValirChapterItem): string {
    const title = cleanText(chapter.title)
        .replace(/^chapter\s+\d+(?:\.\d+)?(?:\s*[-:]\s*)?/i, "")
        .trim();

    if (!chapterIsLocked(chapter)) {
        return title;
    }
    return title.length > 0 ? `${title} 🔒` : "🔒";
}

export function parseChapters(
    seriesPages: ValirSeriesPage[],
    sourceManga: SourceManga,
    showPaidChapters: boolean,
): Chapter[] {
    const seen = new Set<number>();

    return seriesPages
        .flatMap((page) => page.chapters ?? [])
        .filter((chapter) => showPaidChapters || !chapterIsLocked(chapter))
        .filter((chapter) => {
            if (seen.has(chapter.number)) {
                return false;
            }
            seen.add(chapter.number);
            return true;
        })
        .sort((left, right) => left.number - right.number)
        .map((chapter, index) => ({
            chapterId: chapterIsLocked(chapter)
                ? `${LOCKED_CHAPTER_PREFIX}${chapter.number}`
                : String(chapter.number),
            sourceManga,
            langCode: "🇬🇧",
            chapNum: chapter.number,
            title: chapterTitle(chapter),
            volume: 0,
            publishDate: chapter.publishedAt ? new Date(chapter.publishedAt) : undefined,
            sortingIndex: index,
        }));
}

export function parseChapterDetails(html: string, chapter: Chapter): ChapterDetails {
    const payload = decodeFlightPayload(html);
    const data = extractByMarker<ValirChapterData>(payload, '"chapter":').find(
        (candidate) => Array.isArray(candidate.pages) || typeof candidate.content === "string",
    );

    if (data === undefined) {
        throw new Error(`No chapter data was found for chapter ${chapter.chapterId}.`);
    }

    const pages = (data.pages ?? [])
        .slice()
        .sort((left, right) => left.pageNumber - right.pageNumber)
        .map((page) => toAbsoluteUrl(page.imageUrl))
        .filter((url) => url.length > 0);

    if (pages.length > 0) {
        return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
    }

    // A chapter carrying prose instead of pages belongs to a novel, which this
    // extension does not read.
    throw new Error(`Chapter ${chapter.chapterId} has no page images.`);
}

export function toFeaturedItems(list: ValirSeries[]): DiscoverSectionItem[] {
    return list.map((series) => ({
        type: "featuredCarouselItem" as const,
        mangaId: toMangaId(series),
        imageUrl: toAbsoluteUrl(series.coverImage),
        title: cleanText(series.title),
        // 0.9 gave this tile a type line, a summary and a row of counters. 0.8
        // has one line, so it carries the figures and leaves the summary to
        // the details page.
        subtitle: statSubtitle(series),
    }));
}

export function toCarouselItems(
    list: ValirSeries[],
    type: "simpleCarouselItem" | "prominentCarouselItem",
    ranked = false,
): DiscoverSectionItem[] {
    return list.map((series, index) => ({
        type,
        mangaId: toMangaId(series),
        imageUrl: toAbsoluteUrl(series.coverImage),
        title: cleanText(series.title),
        subtitle: statSubtitle(series, ranked ? index + 1 : undefined),
    }));
}

export function toChapterUpdateItems(list: ValirSeries[]): DiscoverSectionItem[] {
    return list.flatMap((series) => {
        // Prefer the newest unlocked chapter so an update card does not lead
        // straight into a locked page.
        const chapter = series.chapters?.find((entry) => !chapterIsLocked(entry));
        if (chapter === undefined) {
            return [];
        }

        const date = chapter.publishedAt ?? series.lastChapterAt;

        return [
            {
                type: "chapterUpdatesCarouselItem" as const,
                mangaId: toMangaId(series),
                chapterId: String(chapter.number),
                imageUrl: toAbsoluteUrl(series.coverImage),
                title: cleanText(series.title),
                // The number rather than the title: some chapters carry a name
                // after the number that reads oddly on its own here.
                subtitle: `Chapter ${chapter.number}`,
                publishDate: date ? new Date(date) : undefined,
            },
        ];
    });
}

export function toSearchResultItem(series: ValirSeries): SearchResultItem {
    const subtitle = [
        series.rating !== undefined ? `★ ${series.rating.toFixed(1)}` : "",
        series.type !== undefined ? toTitleCase(series.type.replace(/_/g, " ")) : "",
    ]
        .filter((part) => part.length > 0)
        .join(" · ");

    return {
        mangaId: toMangaId(series),
        title: cleanText(series.title),
        imageUrl: toAbsoluteUrl(series.coverImage),
        subtitle: subtitle.length > 0 ? subtitle : undefined,
        contentRating: toContentRating(series),
    };
}
