/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import {
    ContentRating,
    DiscoverSectionType,
    MangaStatus,
    type Chapter,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import {
    FILTERS,
    filterTag,
    type Book,
    type BookIndexResponse,
    type ContentRatingId,
    type LatestChapter,
    type ManifestPage,
    type SeriesDetails,
    type SeriesSummary,
} from "./models";

/** What changes how a title is shown, rather than which titles are. */
export interface ViewOptions {
    /** Builds a cover address from its image id; tiles and details differ. */
    cover: (imageId: string | undefined, full?: boolean) => string;
    /** Upload source names by id, when titles should carry them. */
    sourceNames?: Map<string, string>;
    showSpoilerTags: boolean;
}

// ---------------------------------------------------------------------------
// Ratings, status and titles
// ---------------------------------------------------------------------------

/**
 * The site rates by age band, with a flag on the explicit ones.
 *
 * An unknown band counts as Erotica rather than Safe: a rating the site adds
 * later stays gated rather than passing through as harmless.
 */
export function contentRatingOf(series: {
    age_rating?: string | null;
    is_pornographic?: boolean | null;
}): ContentRatingId {
    if (series.is_pornographic === true) {
        return "Pornographic";
    }
    switch (series.age_rating) {
        case "Safe":
            return "Safe";
        case "FifteenPlus":
            return "Suggestive";
        default:
            return "Erotica";
    }
}

function toContentRating(rating: ContentRatingId): ContentRating {
    switch (rating) {
        case "Safe":
            return ContentRating.EVERYONE;
        case "Suggestive":
            return ContentRating.MATURE;
        default:
            return ContentRating.ADULT;
    }
}

function statusOf(value: string | null | undefined): string {
    switch ((value ?? "").toLowerCase()) {
        case "ongoing":
            return MangaStatus.ONGOING;
        case "completed":
            return MangaStatus.COMPLETED;
        case "hiatus":
            return MangaStatus.HIATUS;
        case "abandoned":
            return MangaStatus.CANCELLED;
        default:
            return MangaStatus.UNKNOWN;
    }
}

function displayTitle(title: string, sourceId: string | null | undefined, view: ViewOptions): string {
    const name = title.trim();
    const source = sourceId ? view.sourceNames?.get(sourceId) : undefined;
    return source !== undefined ? `${name} [${source}]` : name;
}

/** The newest chapter as a short label, or the chapter count when there is none. */
function latestLabel(series: SeriesSummary): string | undefined {
    const latest = series.latest_chapters?.[0];
    if (latest?.chapter_no) {
        return `Ch. ${latest.chapter_no}`;
    }
    const count = series.current_books;
    return typeof count === "number" && count > 0 ? `${count} chapters` : undefined;
}

function latestDate(chapter: LatestChapter): Date | undefined {
    const value = chapter.available_at ?? chapter.created_at;
    if (!value) {
        return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function tileCover(series: SeriesSummary, view: ViewOptions): string {
    return view.cover(series.cover_image_id ?? undefined);
}

export function toSearchResult(series: SeriesSummary, view: ViewOptions): SearchResultItem {
    return {
        mangaId: series.series_id,
        title: displayTitle(series.title, series.source_id, view),
        imageUrl: tileCover(series, view),
        subtitle: latestLabel(series),
        contentRating: toContentRating(contentRatingOf(series)),
    };
}

/**
 * A home tile in the style its row asks for.
 *
 * A chapter-updates row needs a chapter to point at, so a series with no
 * chapter yet is left out of that row rather than shown as a bare cover.
 */
export function toDiscoverItem(
    series: SeriesSummary,
    type: DiscoverSectionType,
    view: ViewOptions,
): DiscoverSectionItem | undefined {
    const base = {
        mangaId: series.series_id,
        title: displayTitle(series.title, series.source_id, view),
        imageUrl: tileCover(series, view),
    };

    switch (type) {
        case DiscoverSectionType.chapterUpdates: {
            const latest = series.latest_chapters?.[0];
            if (latest === undefined) {
                return undefined;
            }
            return {
                ...base,
                type: "chapterUpdatesCarouselItem",
                chapterId: latest.book_id,
                subtitle: latest.chapter_no ? `Ch. ${latest.chapter_no}` : undefined,
                publishDate: latestDate(latest),
            };
        }

        case DiscoverSectionType.featured: {
            const facts = [series.format, latestLabel(series)].filter((value): value is string => Boolean(value));
            return { ...base, type: "featuredCarouselItem", subtitle: facts.join(" • ") || undefined };
        }

        case DiscoverSectionType.prominentCarousel:
            return { ...base, type: "prominentCarouselItem", subtitle: latestLabel(series) };

        default:
            return { ...base, type: "simpleCarouselItem", subtitle: latestLabel(series) };
    }
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

const AUTHOR_ROLE = /author|story|writer|creator/i;
const ARTIST_ROLE = /artist|\bart\b|illustrat/i;

export function toSourceManga(seriesId: string, details: SeriesDetails, view: ViewOptions): SourceManga {
    const staff = details.series_staff ?? [];
    const names = (pattern: RegExp): string[] =>
        unique(staff.filter((member) => pattern.test(member.role)).map((member) => member.name.trim())).filter(Boolean);
    const authors = names(AUTHOR_ROLE);
    // Someone credited for both is named once, as the author.
    const artists = names(ARTIST_ROLE).filter((name) => !authors.includes(name));

    const primaryTitle = displayTitle(details.title, details.source_id, view);
    const secondaryTitles = unique(
        (details.series_alternate_titles ?? [])
            .map((entry) => entry.title.trim())
            .filter((title) => title.length > 0 && title !== details.title.trim()),
    );

    // The main cover is named outright; a title can carry several.
    const coverId = details.main_cover_id ?? details.series_covers?.[0]?.image_id;

    // Genre tags carry their filter's namespace, so tapping one searches by it.
    const genres: Tag[] = (details.genres ?? [])
        .filter((genre) => view.showSpoilerTags || genre.is_spoiler !== true)
        .map((genre) => filterTag(FILTERS.GENRE, genre.genre_id, genre.genre_name));
    const tags: Tag[] = (details.tags ?? [])
        .filter((tag) => view.showSpoilerTags || tag.is_spoiler !== true)
        .map((tag) => filterTag(TAG_SECTION, tag.tag_id, tag.tag_name.trim()));

    const tagGroups: TagSection[] = [
        { id: "genres", title: "Genres", tags: genres },
        { id: "tags", title: "Tags", tags },
    ].filter((group) => group.tags.length > 0);

    const additionalInfo: Record<string, string> = {};
    if (details.format) {
        additionalInfo["Format"] = details.format;
    }
    if (details.publication_status) {
        additionalInfo["Publication"] = details.publication_status;
    }
    if (details.original_language) {
        additionalInfo["Original language"] = details.original_language;
    }
    if (details.translated_language) {
        additionalInfo["Translated language"] = details.translated_language;
    }
    if (typeof details.current_books === "number") {
        additionalInfo["Chapters"] = String(details.current_books);
    }
    if (typeof details.total_views === "number") {
        additionalInfo["Views"] = String(details.total_views);
    }
    if (typeof details.start_year === "number") {
        additionalInfo["Started"] = String(details.start_year);
    }

    return {
        mangaId: seriesId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles,
            thumbnailUrl: view.cover(coverId ?? undefined, true),
            synopsis: (details.description ?? "").replace(/\r/g, "").trim(),
            author: authors.join(", ") || undefined,
            artist: artists.join(", ") || undefined,
            status: statusOf(details.upload_status),
            contentRating: toContentRating(contentRatingOf(details)),
            // The site scores out of a hundred.
            rating:
                typeof details.average_rating === "number" && Number.isFinite(details.average_rating)
                    ? Math.min(1, Math.max(0, details.average_rating / 100))
                    : undefined,
            tagGroups,
            additionalInfo,
        },
    };
}

/**
 * The namespace a details page's tags carry.
 *
 * Search offers tags as a typed field rather than a section — there are
 * nearly ten thousand — but a tag tapped on a details page arrives as a
 * chosen tag, and this is how the search recognises it.
 */
export const TAG_SECTION = "tag";

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

/**
 * Reads the chapter index, which is a table: one row per book, its values in
 * the order `fields` names.
 *
 * The columns are read by name because their order is the site's to change.
 * A table that does not add up — a row of the wrong width, a repeated id, a
 * group position that points nowhere — is an error rather than a shorter
 * chapter list, which would be indistinguishable from a series that lost
 * chapters.
 */
export function parseBookIndex(index: BookIndexResponse): Book[] {
    if (
        !Array.isArray(index.fields) ||
        !Array.isArray(index.books) ||
        !Array.isArray(index.groups) ||
        index.books.length !== index.count
    ) {
        throw new Error("Kagane returned an incomplete chapter list.");
    }

    const column = (name: string): number => index.fields.indexOf(name);
    const at = {
        id: column("book_id"),
        title: column("title"),
        sort: column("sort_no"),
        chapter: column("chapter_no"),
        volume: column("volume_no"),
        released: column("released_at"),
        groups: column("group_ix"),
        pages: column("page_count"),
    };
    if (at.id < 0 || at.sort < 0) {
        throw new Error("Kagane's chapter list no longer names its chapters.");
    }

    const seen = new Set<string>();
    return index.books.map((row): Book => {
        if (!Array.isArray(row) || row.length !== index.fields.length) {
            throw new Error("Kagane returned a malformed chapter list.");
        }
        const cell = (position: number): unknown => (position >= 0 ? row[position] : undefined);

        const bookId = cell(at.id);
        const sortNo = cell(at.sort);
        if (typeof bookId !== "string" || bookId.length === 0 || seen.has(bookId)) {
            throw new Error("Kagane returned a chapter list with a missing or repeated chapter.");
        }
        if (typeof sortNo !== "number" || !Number.isFinite(sortNo)) {
            throw new Error("Kagane returned a chapter with no reading position.");
        }
        seen.add(bookId);

        const groups = cell(at.groups);
        const groupNames = (Array.isArray(groups) ? groups : []).map((position: unknown) => {
            const group = typeof position === "number" ? index.groups[position] : undefined;
            if (group === undefined) {
                throw new Error("Kagane returned a chapter credited to a group it does not list.");
            }
            return group.title.trim();
        });

        const released = cell(at.released);
        const pages = cell(at.pages);
        const text = (position: number): string | undefined => {
            const value = cell(position);
            return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
        };

        return {
            bookId,
            title: text(at.title) ?? "",
            sortNo,
            chapterNo: text(at.chapter),
            volumeNo: text(at.volume),
            groups: groupNames.filter(Boolean),
            // Seconds since the epoch.
            releasedAt: typeof released === "number" && Number.isFinite(released) ? new Date(released * 1000) : undefined,
            pageCount: typeof pages === "number" && Number.isInteger(pages) && pages > 0 ? pages : undefined,
        };
    });
}

/** "Chapter 12", "Ch. 12", "Episode 12" and the like, at the start of a title. */
const NUMBER_PREFIX = /^(?:chapters?|chap|ch|episodes?|eps?|ep)\s*\.?\s*#?\s*(\d+(?:\.\d+)?)\s*(?:[:\-–—]\s*)?/i;
/** A trailing " - Volume 3". */
const VOLUME_SUFFIX = /\s*[-–—]?\s*vol(?:ume)?s?\s*\.?\s*\d+(?:\.\d+)?\s*$/i;
/** A trailing credit in brackets, "(Team)" or "[Team]". */
const TRAILING_CREDIT = /\s*(?:\([^()]*\)|\[[^[\]]*\])\s*$/;

/**
 * The part of a chapter's title that says something its number does not.
 *
 * Most titles only repeat the number — "Ch. 4", "Episode 4", "Chapter 4 -
 * Volume 1 (Team)" — and showing that beside the number the app already
 * displays is noise. A real name is kept whole.
 */
export function chapterTitle(title: string): string | undefined {
    let rest = title.trim();
    const numbered = NUMBER_PREFIX.test(rest);
    if (!numbered) {
        return rest.length > 0 ? rest : undefined;
    }

    rest = rest.replace(NUMBER_PREFIX, "");
    // The credit and volume only count as noise on a title that was just a
    // number; on a real name they may be part of it.
    rest = rest.replace(TRAILING_CREDIT, "").replace(VOLUME_SUFFIX, "").trim();
    return rest.length > 0 ? rest : undefined;
}

function numberOf(value: string | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : undefined;
}

/**
 * Builds the chapter list in the site's reading order.
 *
 * `sort_no` is that order, independent of chapter numbers, which can repeat
 * or restart by volume; the position in it becomes the sorting index, newest
 * highest. A chapter with no number of its own keeps zero rather than
 * borrowing its position, which would be a number it does not have.
 */
export function toChapters(books: Book[], sourceManga: SourceManga, langCode: string): Chapter[] {
    return [...books]
        .sort((left, right) => left.sortNo - right.sortNo)
        .map((book, position) => ({
            chapterId: book.bookId,
            sourceManga,
            title: chapterTitle(book.title),
            chapNum: numberOf(book.chapterNo) ?? numberOf(NUMBER_PREFIX.exec(book.title)?.[1]) ?? 0,
            volume: numberOf(book.volumeNo),
            publishDate: book.releasedAt,
            langCode,
            group: book.groups.join(", ") || undefined,
            sortingIndex: position + 1,
        }));
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * Checks a chapter's page list before any of it is used.
 *
 * Page ids and extensions go into the page address, so anything but plain
 * characters is refused; a run of page numbers with a gap or a repeat is a
 * chapter half delivered. `expected` is the count the chapter list gave.
 */
export function orderedPages(pages: ManifestPage[], expected?: number): ManifestPage[] {
    const ids = new Set<string>();
    for (const page of pages) {
        if (
            !Number.isInteger(page.page_no) ||
            typeof page.page_id !== "string" ||
            !/^[A-Za-z0-9_-]+$/.test(page.page_id) ||
            (page.ext !== null && page.ext !== undefined && !/^[A-Za-z0-9]+$/.test(page.ext)) ||
            ids.has(page.page_id)
        ) {
            throw new Error("Kagane returned an invalid page list. Reopen the chapter.");
        }
        ids.add(page.page_id);
    }

    const ordered = [...pages].sort((left, right) => left.page_no - right.page_no);
    const first = ordered[0]?.page_no ?? 0;
    if (ordered.some((page, position) => page.page_no !== first + position)) {
        throw new Error("Kagane returned an incomplete chapter. Try again in a moment.");
    }
    if (expected !== undefined && ordered.length < expected) {
        throw new Error(`Kagane returned ${ordered.length} of this chapter's ${expected} pages. Try again in a moment.`);
    }

    return ordered;
}

function unique<T>(values: T[]): T[] {
    return values.filter((value, index) => values.indexOf(value) === index);
}
