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
    CONTENT_RATING_GENRES,
    CONTENT_RATING_OPTIONS,
    DOMAIN,
    FORMAT_OPTIONS,
    TAG_TITLE_OVERRIDES,
    TRANSLATED_LANGUAGE_KEY,
    type ChapterData,
    type ChapterPagesResponse,
    type ComicData,
    type ComicNode,
    type ContentPreferenceRating,
    type FilterOptions,
    type LatestUploadsResult,
    type XComicPreferences,
} from "./models";

const PORNOGRAPHIC_GENRES = new Set<string>(CONTENT_RATING_GENRES.pornographic);
const EROTICA_GENRES = new Set<string>(CONTENT_RATING_GENRES.erotica);
const SUGGESTIVE_GENRES = new Set<string>(CONTENT_RATING_GENRES.suggestive);

/** Characters the app refuses to accept inside an id. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

function sanitizeId(value: string): string {
    return value.replace(UNSAFE_ID, "-");
}

function toAbsoluteUrl(url: string | null | undefined): string {
    if (typeof url !== "string" || url.trim().length === 0) {
        return "";
    }

    const normalised = url.trim();
    if (/^https?:\/\//i.test(normalised)) {
        return normalised;
    }
    if (normalised.startsWith("//")) {
        return `https:${normalised}`;
    }
    return `${DOMAIN}${normalised.startsWith("/") ? "" : "/"}${normalised}`;
}

function hasCoverUrl(url: string | null | undefined): url is string {
    return typeof url === "string" && url.trim().length > 0;
}

function titleCase(value: string): string {
    return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Reads the filter lists off the search page's own pickers. */
export function parseFilterOptions(html: string): FilterOptions {
    const $ = Application.loadDocument(html);

    const filterGroup = (name: string): Tag[] => {
        const seen = new Set<string>();

        return $("details.group")
            .filter((_, element) =>
                $(element).find("summary").first().text().trim().toLowerCase().includes(name),
            )
            .first()
            .find("div")
            .map((_, element): Tag | undefined => {
                const raw = $(element).attr(":")?.trim();
                const title = $(element).find("span").first().text().trim();
                if (raw === undefined || raw.length === 0 || title.length === 0) {
                    return undefined;
                }

                // Sanitised here and on a series alike, so a tag tapped on the
                // details page matches the filter of the same name.
                const id = sanitizeId(raw);
                if (seen.has(id)) {
                    return undefined;
                }
                seen.add(id);
                return { id, title: Application.decodeHTMLEntities(title) };
            })
            .get()
            .filter((option): option is Tag => option !== undefined);
    };

    const formatIds = new Set(FORMAT_OPTIONS.map(({ id }) => id));
    const options: FilterOptions = {
        contentRatings: filterGroup("content rating"),
        demographics: filterGroup("demographics"),
        genres: filterGroup("genres").filter(({ id }) => !formatIds.has(id)),
        types: filterGroup("types"),
    };

    // One empty group only weakens that picker; losing both of these means the
    // page has changed shape and nothing can be trusted.
    if (options.genres.length === 0 && options.types.length === 0) {
        throw new Error("The site's search filters could not be read.");
    }
    return options;
}

/**
 * How explicit a title actually is.
 *
 * The API filters on the rating a title declares for itself, which is often
 * lower than its own genres imply, so those are taken into account too.
 */
function contentPreferenceRating(comic: ComicData): ContentPreferenceRating {
    const taxonomy = [...(comic.genres ?? []), ...(comic.tags ?? [])].map((value) =>
        value.trim().toLowerCase(),
    );
    const rating = comic.contentRating?.trim().toLowerCase();

    // A rating the site adds later stays gated at the top rather than passing
    // through as safe.
    if (rating !== undefined && rating.length > 0 && !CONTENT_RATING_OPTIONS.some((option) => option.id === rating)) {
        return "pornographic";
    }
    if (rating === "pornographic" || taxonomy.some((value) => PORNOGRAPHIC_GENRES.has(value))) {
        return "pornographic";
    }
    if (rating === "erotica" || taxonomy.some((value) => EROTICA_GENRES.has(value))) {
        return "erotica";
    }
    if (
        rating === "suggestive" ||
        comic.sfw_result === false ||
        taxonomy.some((value) => SUGGESTIVE_GENRES.has(value))
    ) {
        return "suggestive";
    }
    return "safe";
}

function toContentRating(comic: ComicData): ContentRating {
    const rating = contentPreferenceRating(comic);
    if (rating === "erotica" || rating === "pornographic") {
        return ContentRating.ADULT;
    }
    if (rating === "suggestive") {
        return ContentRating.MATURE;
    }
    return ContentRating.EVERYONE;
}

export function isComicAllowed(
    comic: ComicData,
    preferences: XComicPreferences,
    // Feeds that carry every language at once cannot be narrowed by the site,
    // so they are narrowed here instead.
    restrictToPreferredLanguages = false,
): boolean {
    if (
        preferences.contentRatings.length === 0 ||
        preferences.types.length === 0 ||
        !hasCoverUrl(comic.urlCover)
    ) {
        return false;
    }

    if (
        restrictToPreferredLanguages &&
        comic.translatedLanguage !== null &&
        comic.translatedLanguage !== undefined &&
        !preferences.languages.includes(comic.translatedLanguage)
    ) {
        return false;
    }

    if (comic.type !== null && comic.type !== undefined && !preferences.types.includes(comic.type)) {
        return false;
    }
    if (!preferences.contentRatings.includes(contentPreferenceRating(comic))) {
        return false;
    }

    const excluded = new Set([...preferences.excludedGenres, ...preferences.excludedFormats]);
    return ![...(comic.genres ?? []), ...(comic.tags ?? [])].some((id) => excluded.has(id));
}

// Home page cards and the chapter list have to agree, or a card cannot be
// matched to the chapter it names.
function toChapterId(chapter: { id: string; urlPath?: string | null }): string {
    return sanitizeId(chapter.urlPath ?? `/comic/chapter/${chapter.id}`);
}

function chapterNumber(chapter?: ChapterData | null): number | undefined {
    const value = chapter?.chaNum ?? chapter?.serial;
    return typeof value === "number" && isFinite(value) ? value : undefined;
}

function formatChapter(chapter?: ChapterData | null): string | undefined {
    const number =
        chapterNumber(chapter) ?? /(?:chapter|ch\.?)[\s_]*(\d+(?:\.\d+)?)/i.exec(chapter?.dname ?? "")?.[1];

    if (number === undefined) {
        return undefined;
    }
    return `Ch. ${String(number).replace(/\.0$/, "")}`;
}

/** Reads a timestamp, which the API sends in seconds on some fields. */
function dateFromTimestamp(value?: number | null): Date | undefined {
    if (typeof value !== "number" || !isFinite(value) || value <= 0) {
        return undefined;
    }

    const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
    return isNaN(date.getTime()) ? undefined : date;
}

function formatType(type?: string | null): string | undefined {
    return type !== null && type !== undefined && type.length > 0 ? titleCase(type) : undefined;
}

function baseCard(node: ComicNode): { mangaId: string; title: string; imageUrl: string } {
    return {
        mangaId: sanitizeId(node.data.id),
        title: Application.decodeHTMLEntities(node.data.name),
        imageUrl: toAbsoluteUrl(node.data.urlCover),
    };
}

function cardSubtitle(comic: ComicData): string | undefined {
    return (
        [formatChapter(comic.chapterNodes_last?.[0]?.data), formatType(comic.type)]
            .filter((value): value is string => value !== undefined)
            .join(" • ") || undefined
    );
}

export function toSearchResultItem(node: ComicNode): SearchResultItem {
    return {
        ...baseCard(node),
        subtitle: cardSubtitle(node.data),
        contentRating: toContentRating(node.data),
    };
}

type CarouselItemType = "featuredCarouselItem" | "simpleCarouselItem" | "chapterUpdatesCarouselItem";

export function toDiscoverItems(nodes: ComicNode[], type: CarouselItemType): DiscoverSectionItem[] {
    return nodes
        .map((node) => toDiscoverItem(node, type))
        .filter((item): item is DiscoverSectionItem => item !== undefined);
}

function toDiscoverItem(node: ComicNode, type: CarouselItemType): DiscoverSectionItem | undefined {
    const chapter = node.data.chapterNodes_last?.[0]?.data;

    if (type === "featuredCarouselItem") {
        // 0.9 gave this tile a type line, a summary and a row of counters. 0.8
        // has one line, so it carries the chapter count and the score.
        const chapters = node.data.chaps_normal ?? chapterNumber(chapter);
        const subtitle = [
            chapters !== undefined ? `${chapters} chapters` : "",
            node.data.score_val !== null && node.data.score_val !== undefined
                ? `★ ${node.data.score_val.toFixed(2)}`
                : "",
        ]
            .filter((part) => part.length > 0)
            .join(" • ");

        return { type, ...baseCard(node), subtitle: subtitle || undefined };
    }

    if (type === "chapterUpdatesCarouselItem") {
        if (chapter?.id === undefined) {
            return undefined;
        }
        return {
            type,
            ...baseCard(node),
            chapterId: toChapterId(chapter),
            subtitle: cardSubtitle(node.data),
            publishDate: dateFromTimestamp(chapter.datePublic ?? chapter.dateModify ?? chapter.dateCreate),
        };
    }

    return { type, ...baseCard(node), subtitle: cardSubtitle(node.data) };
}

export function toLatestUploadNodes(result?: LatestUploadsResult | null): ComicNode[] {
    if (result === null || result === undefined || !Array.isArray(result.items)) {
        throw new Error("The latest uploads could not be read.");
    }

    return result.items.flatMap(({ comic, chapters }) => {
        const data = comic?.data;
        const chapterNodes = chapters ?? [];

        if (data === undefined || !hasCoverUrl(data.urlCover) || chapterNodes[0]?.data.id === undefined) {
            return [];
        }
        return [{ data: { ...data, chapterNodes_last: chapterNodes } }];
    });
}

function nodeNames(nodes?: Array<{ data?: { name?: string } | null } | null> | null): string[] {
    return (
        nodes
            ?.map((node) => node?.data?.name?.trim())
            .filter((name): name is string => name !== undefined && name.length > 0)
            .map((name) => Application.decodeHTMLEntities(name)) ?? []
    );
}

/** Turns a summary's markup into the plain text the details page shows. */
function stripHtml(html?: string | null): string {
    if (html === null || html === undefined || html.length === 0) {
        return "";
    }

    const $ = Application.loadDocument(html);
    $("br").replaceWith("\n");
    $("p, div, li, blockquote").each((_, element) => {
        $(element).append("\n");
    });

    return Application.decodeHTMLEntities(
        $.root()
            .text()
            .replace(/\n{3,}/g, "\n\n")
            .trim(),
    );
}

function formatDateYmd(value: ComicData["originalPubFrom"]): string | undefined {
    if (value?.y === null || value?.y === undefined) {
        return undefined;
    }

    return [value.y, value.m?.toString().padStart(2, "0"), value.d?.toString().padStart(2, "0")]
        .filter((part) => part !== undefined && part !== null)
        .join("-");
}

export function toSourceManga(node: ComicNode): SourceManga {
    const comic = node.data;
    const authors = nodeNames(comic.authorNodes);
    const artists = nodeNames(comic.artistNodes).filter((artist) => !authors.includes(artist));

    const toTags = (values: string[]): Tag[] =>
        [...new Set(values.map(sanitizeId))].map((id) => ({
            id,
            title: TAG_TITLE_OVERRIDES[id] ?? titleCase(id),
        }));

    const tagGroups: TagSection[] = [
        { id: "genres", title: "Genres", tags: toTags(comic.genres ?? []) },
        { id: "demographics", title: "Demographics", tags: toTags(comic.demographics ?? []) },
        { id: "tags", title: "Tags", tags: toTags(comic.tags ?? nodeNames(comic.tagNodes)) },
    ].filter((group) => group.tags.length > 0);

    const publicationFrom = formatDateYmd(comic.originalPubFrom);
    const publicationTill = formatDateYmd(comic.originalPubTill);
    const publishers = nodeNames(comic.publisherNodes);

    return {
        mangaId: sanitizeId(comic.id),
        mangaInfo: {
            primaryTitle: Application.decodeHTMLEntities(comic.name),
            secondaryTitles: (comic.altNames ?? []).map((title) => Application.decodeHTMLEntities(title)),
            thumbnailUrl: toAbsoluteUrl(comic.urlCover),
            synopsis: stripHtml(comic.summary?.html),
            author: authors.join(", ") || undefined,
            artist: artists.join(", ") || undefined,
            contentRating: toContentRating(comic),
            rating:
                typeof comic.score_val === "number" && isFinite(comic.score_val)
                    ? Math.min(1, Math.max(0, comic.score_val / 10))
                    : undefined,
            status: titleCase(comic.originalStatus ?? comic.uploadStatus ?? "unknown"),
            tagGroups,
            additionalInfo: {
                ...(comic.type ? { Type: titleCase(comic.type) } : {}),
                ...(comic.originalLanguage ? { "Original Language": comic.originalLanguage } : {}),
                ...(comic.translatedLanguage ? { [TRANSLATED_LANGUAGE_KEY]: comic.translatedLanguage } : {}),
                ...(publicationFrom !== undefined
                    ? {
                          Publication:
                              publicationTill !== undefined
                                  ? `${publicationFrom} – ${publicationTill}`
                                  : publicationFrom,
                      }
                    : {}),
                ...(comic.originalPubZone ? { Region: comic.originalPubZone } : {}),
                ...(typeof comic.chaps_normal === "number" ? { Chapters: String(comic.chaps_normal) } : {}),
                ...(typeof comic.follows === "number" ? { Follows: String(comic.follows) } : {}),
                ...(typeof comic.reviews === "number" ? { Reviews: String(comic.reviews) } : {}),
                ...(typeof comic.comments_total === "number" ? { Comments: String(comic.comments_total) } : {}),
                ...(publishers.length > 0 ? { Publishers: publishers.join(", ") } : {}),
            },
        },
    };
}

export function toChapter(data: ChapterData, sourceManga: SourceManga): Chapter {
    const title = [data.dname?.trim(), data.title?.trim()]
        .filter((value): value is string => value !== undefined && value.length > 0)
        // A title that only repeats the display name is noise beside it.
        .filter((value, index, values) => index === 0 || value !== values[0])
        .map((value) => Application.decodeHTMLEntities(value))
        .join(": ");

    const sourceName = data.srcName?.trim();
    const profileNames = nodeNames(data.profileNodes);
    const scanlators =
        sourceName !== undefined && sourceName.length > 0
            ? [Application.decodeHTMLEntities(sourceName.charAt(0).toUpperCase() + sourceName.slice(1))]
            : profileNames.length > 0
              ? profileNames
              : nodeNames(data.groupNodes);

    const uploader = data.userNode?.data?.name?.trim();
    const language = sourceManga.mangaInfo.additionalInfo?.[TRANSLATED_LANGUAGE_KEY];
    const langCode =
        typeof language === "string" && language.length > 0
            ? language === "_t"
                ? "und"
                : language.replace(/_/g, "-")
            : "en";

    return {
        chapterId: toChapterId(data),
        sourceManga,
        chapNum: chapterNumber(data) ?? 0,
        volume: 0,
        title: title || undefined,
        langCode,
        publishDate: dateFromTimestamp(data.dateModify ?? data.dateCreate ?? data.datePublic),
        group:
            scanlators.join(", ") ||
            (uploader !== undefined ? Application.decodeHTMLEntities(uploader) : undefined),
    };
}

export function parseChapterDetails(response: ChapterPagesResponse, chapter: Chapter): ChapterDetails {
    const pages = (response.get_chapterNode?.data?.imageUrls ?? [])
        .map(toAbsoluteUrl)
        .filter((url) => url.length > 0);

    if (pages.length === 0) {
        throw new Error(`No pages were returned for chapter ${chapter.chapterId}.`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
}
