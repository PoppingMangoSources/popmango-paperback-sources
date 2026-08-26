/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { AnyNode } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";

import {
    Application,
    ContentRating,
    URL,
    type Chapter,
    type ChapterDetails,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type Tag,
} from "../../common";

import {
    DOMAIN,
    type ChapterPageInfo,
    type ListingChapter,
    type MangaListItem,
    type NewMangaItem,
} from "./models";

const ADULT_GENRES = new Set(["adult", "hentai", "smut"]);
const MATURE_GENRES = new Set(["ecchi", "mature", "yaoi", "yuri"]);

/** Hangul runs, used to pull an original title out of a mixed string. */
const KOREAN_TITLE = /[ᄀ-ᇿ㄰-㆏가-힯][ᄀ-ᇿ㄰-㆏가-힯0-9\s·-]*/g;

function cleanText(value?: string | null): string {
    return Application.decodeHTMLEntities(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

/** Like `cleanText`, but keeps the paragraph breaks a synopsis depends on. */
function cleanDescription(value?: string | null): string {
    return Application.decodeHTMLEntities(value ?? "")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function normalisedPath(href: string): string {
    const path = Application.decodeHTMLEntities(href)
        .replace(/^https?:\/\/(?:www\.)?likemanga\.ink\//i, "")
        .replace(/[?#].*$/, "")
        .replace(/^\/+|\/+$/g, "");
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
}

/**
 * Turns a link into an id the app can store.
 *
 * Ids here are whole paths rather than slugs, so they are percent-encoded —
 * including the characters `encodeURIComponent` leaves alone, since the app
 * treats several of them as separators.
 */
export function encodePathId(href: string): string {
    return encodeURIComponent(normalisedPath(href)).replace(
        /[!'*~]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function toAbsoluteUrl(value?: string | null): string {
    const url = (value ?? "").trim();

    if (url.length === 0) {
        return "";
    }
    if (url.startsWith("//")) {
        return `https:${url}`;
    }
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    return URL(DOMAIN).setPath(url).build();
}

function imageUrlFrom(image: Cheerio<AnyNode>): string {
    const srcset = image.attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];

    return toAbsoluteUrl(
        image.attr("data-cfsrc") ??
            image.attr("data-src") ??
            image.attr("data-lazy-src") ??
            srcset ??
            image.attr("src"),
    );
}

/** Picks the longest Hangul run, which is nearly always the original title. */
function koreanTitleFrom(value?: string | null): string | undefined {
    return (cleanText(value).match(KOREAN_TITLE) ?? [])
        .map(cleanText)
        .sort((left, right) => right.length - left.length)[0];
}

/** Reads a value out of the site's `label: value` paragraphs. */
function labelledValue($: CheerioAPI, container: Cheerio<AnyNode>, label: string): string {
    for (const paragraph of container.find("p").toArray()) {
        const selection = $(paragraph);
        const currentLabel = cleanText(selection.find("label").first().text()).replace(/:$/, "").toLowerCase();

        if (currentLabel !== label.toLowerCase()) {
            continue;
        }

        const clone = selection.clone();
        clone.find("label").remove();
        return cleanText(clone.text());
    }
    return "";
}

/** The site prints absolute dates, so anything unparseable is simply absent. */
function parseListingDate(value?: string | null): Date | undefined {
    const text = cleanText(value);
    if (text.length === 0 || /^new$/i.test(text)) {
        return undefined;
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

export function contentRatingForGenres(genres: string[]): ContentRating {
    const normalised = genres.map((genre) => genre.trim().toLowerCase());

    if (normalised.some((genre) => ADULT_GENRES.has(genre))) {
        return ContentRating.ADULT;
    }
    if (normalised.some((genre) => MATURE_GENRES.has(genre))) {
        return ContentRating.MATURE;
    }
    return ContentRating.EVERYONE;
}

function chapterNumber(title: string): number | undefined {
    const match = title.match(/\b(?:chapter|ch\.?)\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (match === null) {
        return undefined;
    }
    const value = Number.parseFloat(match[1] ?? "");
    return Number.isFinite(value) ? value : undefined;
}

/**
 * Strips the chapter number off a title, leaving the rest.
 *
 * Some rows repeat the number in the part that follows, so a second copy is
 * dropped as well.
 */
function formatChapterTitle(title: string): string {
    const text = cleanText(title);
    const match = text.match(/\b(?:chapter|ch\.?)\s*([0-9]+(?:\.[0-9]+)?)/i);

    if (match === null) {
        return text;
    }

    let rest = cleanText(text.slice((match.index ?? 0) + match[0].length).replace(/^[-:\s•]+/, ""));
    const number = (match[1] ?? "").replace(".", "\\.");
    const duplicate = rest.match(new RegExp(`^[-:\\s•]*(?:chapter|ch\\.?)\\s*${number}\\b`, "i"));

    if (duplicate !== null) {
        rest = cleanText(rest.slice((duplicate.index ?? 0) + duplicate[0].length).replace(/^[-:\s•]+/, ""));
    }
    return rest;
}

/** A short label for a chapter, falling back to its number when it has no title. */
function formatChapterLabel(title: string): string {
    const cleaned = formatChapterTitle(title);
    if (cleaned.length > 0) {
        return cleaned;
    }
    return cleanText(title).match(/\b(?:chapter|ch\.?)\s*[0-9]+(?:\.[0-9]+)?/i)?.[0] ?? cleanText(title);
}

function chapterTitleFromLink(link: Cheerio<AnyNode>): string {
    const nested = cleanText(
        link.find(".chapter-item-title, .chapter-item-headtitle, .chapter-title").first().text(),
    );
    if (nested.length > 0) {
        return nested;
    }

    // Otherwise the link's own text carries the date and badges too.
    const clone = link.clone();
    clone.find("cite, time, .chapter-release-date, .text-danger, script, style").remove();
    return cleanText(clone.text());
}

function parseListingChapter($: CheerioAPI, element: AnyNode): ListingChapter | undefined {
    const row = $(element);
    const link = row.find("a.list-2-chap, a").first();
    const href = link.attr("href") ?? "";
    const title = chapterTitleFromLink(link);

    if (href.length === 0 || title.length === 0) {
        return undefined;
    }

    const dateNode = row.find("cite").first();
    return {
        chapterId: encodePathId(href),
        title,
        dateText: cleanText(dateNode.text()),
        isNew: dateNode.find(".text-danger").length > 0 || /^new$/i.test(dateNode.text().trim()),
    };
}

export function parseMangaList($: CheerioAPI): MangaListItem[] {
    const items: MangaListItem[] = [];
    const seen = new Set<string>();

    for (const element of $(".video").toArray()) {
        const card = $(element);
        const titleLink = card.find("p.title-manga a").first();
        const href = titleLink.attr("href") ?? card.find("a").first().attr("href") ?? "";

        const mangaId = encodePathId(href);
        const title = cleanText(titleLink.text().length > 0 ? titleLink.text() : card.find("img").first().attr("alt"));

        if (mangaId.length === 0 || title.length === 0 || seen.has(mangaId)) {
            continue;
        }
        seen.add(mangaId);

        // Most of a card's detail lives in a tooltip elsewhere in the page,
        // referenced by selector from the cover image.
        const tooltipSelector = card.find("img[data-jtip]").first().attr("data-jtip");
        const tooltip = tooltipSelector !== undefined ? $(tooltipSelector) : card.find("[data-missing-tooltip]");

        const genres = labelledValue($, tooltip, "Genres")
            .split(",")
            .map(cleanText)
            .filter((genre) => genre.length > 0);

        const rawRating = Number.parseFloat(tooltip.find("[itemprop=ratingValue]").first().text());
        const description = cleanDescription(tooltip.find(".box_text").first().text());

        items.push({
            mangaId,
            title,
            imageUrl: imageUrlFrom(card.find("img").first()),
            alternativeTitle: koreanTitleFrom(labelledValue($, tooltip, "Alternative")),
            description: description.length > 0 ? description : undefined,
            genres,
            status: labelledValue($, tooltip, "Status") || undefined,
            views: labelledValue($, tooltip, "View") || undefined,
            comments: labelledValue($, tooltip, "Comment") || undefined,
            follows: labelledValue($, tooltip, "Follow") || undefined,
            rating: Number.isFinite(rawRating) ? rawRating : undefined,
            updatedDate: parseListingDate(labelledValue($, tooltip, "Updated")),
            chapters: card
                .find(".list-group-item")
                .toArray()
                .flatMap((chapter) => {
                    const parsed = parseListingChapter($, chapter);
                    return parsed === undefined ? [] : [parsed];
                }),
        });
    }

    return items;
}

export function parseNewManga($: CheerioAPI): NewMangaItem[] {
    const items: NewMangaItem[] = [];
    const seen = new Set<string>();

    for (const element of $(".items-slide .item").toArray()) {
        const item = $(element);
        const titleLink = item.find(".slide-caption h3 a").first();
        const mangaId = encodePathId(titleLink.attr("href") ?? "");
        const title = cleanText(titleLink.text());

        if (mangaId.length === 0 || title.length === 0 || seen.has(mangaId)) {
            continue;
        }
        seen.add(mangaId);

        const chapterLink = item.find(".slide-caption > a").first();
        const chapterHref = chapterLink.attr("href") ?? "";
        const chapterTitle = chapterTitleFromLink(chapterLink);

        items.push({
            mangaId,
            title,
            imageUrl: imageUrlFrom(item.find("img").first()),
            chapter:
                chapterHref.length > 0 && chapterTitle.length > 0
                    ? {
                          chapterId: encodePathId(chapterHref),
                          title: chapterTitle,
                          dateText: cleanText(item.find(".time").text()),
                          isNew: item.find(".time .text-danger").length > 0,
                      }
                    : undefined,
        });
    }

    return items;
}

/**
 * Reads the genre list.
 *
 * The advanced search form is preferred; where it has not rendered, the genre
 * links elsewhere on the page carry the same values.
 */
export function parseGenreTags($: CheerioAPI): Tag[] {
    const tags: Tag[] = [];
    const seen = new Set<string>();

    const inputs = $('input[name="f[genres][]"]');
    if (inputs.length > 0) {
        for (const element of inputs.toArray()) {
            const input = $(element);
            const id = encodePathId(input.attr("value") ?? "");
            const title = cleanText($(`label[for="${input.attr("id") ?? ""}"]`).first().text());

            if (id.length === 0 || title.length === 0 || /^genres$/i.test(title) || seen.has(id)) {
                continue;
            }
            seen.add(id);
            tags.push({ id, title });
        }
        return tags;
    }

    for (const element of $('a[href*="/genres/"]').toArray()) {
        const link = $(element);
        const href = link.attr("href")?.replace(/\/+$/, "") ?? "";
        const id = encodePathId(href.split("/").pop() ?? "");
        const title = cleanText(link.text());

        if (id.length === 0 || title.length === 0 || /^genres$/i.test(title) || seen.has(id)) {
            continue;
        }
        seen.add(id);
        tags.push({ id, title });
    }

    return tags;
}

/** Maps the site's wording onto the terms the app displays. */
function mapStatus(status: string): string {
    const normalised = cleanText(status).toLowerCase();

    if (normalised.length === 0) {
        return "Unknown";
    }
    if (normalised.includes("complete")) {
        return "Completed";
    }
    if (normalised.includes("in process") || normalised.includes("ongoing")) {
        return "Ongoing";
    }
    if (normalised.includes("pause") || normalised.includes("hiatus")) {
        return "Hiatus";
    }
    return cleanText(status);
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const primaryTitle = cleanText($("#title-detail-manga").first().text());
    if (primaryTitle.length === 0) {
        throw new Error(`Unable to read the details page for ${mangaId}.`);
    }

    const koreanTitle = koreanTitleFrom($(".list-info .othername p").eq(1).text());
    const genres = $(".list-info .kind a")
        .map((_, element) => cleanText($(element).text()))
        .toArray()
        .filter((genre) => genre.length > 0);

    const tags = $(".list-info .kind a")
        .map((_, element) => {
            const link = $(element);
            const href = link.attr("href")?.replace(/\/+$/, "") ?? "";
            return { id: href.split("/").pop() ?? "", title: cleanText(link.text()) };
        })
        .toArray()
        .filter((tag) => tag.id.length > 0 && tag.title.length > 0);

    const rawRating = Number.parseFloat($("[itemprop=ratingValue]").first().text());
    const author = cleanText($(".list-info .author p").eq(1).text());

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles:
                koreanTitle !== undefined && koreanTitle.toLowerCase() !== primaryTitle.toLowerCase()
                    ? [koreanTitle]
                    : [],
            thumbnailUrl: imageUrlFrom($(".detail-info img").first()),
            synopsis: cleanDescription($("#summary_shortened").first().text()),
            author: author.length > 0 && !/^updating$/i.test(author) ? author : undefined,
            status: mapStatus($(".list-info .status p").eq(1).text()),
            // The site rates out of five; the app expects a fraction of one.
            rating: Number.isFinite(rawRating) ? Math.min(1, Math.max(0, rawRating / 5)) : undefined,
            contentRating: contentRatingForGenres(genres),
            tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
        },
    };
}

/**
 * Works out how the chapter list is paginated.
 *
 * The page numbers live in the inline handlers on the pager, and the numeric
 * id the endpoint wants is an attribute on the title.
 */
export function parseChapterPageInfo($: CheerioAPI): ChapterPageInfo {
    let lastPage = 1;

    for (const element of $(".chapters_pagination a").toArray()) {
        const match = ($(element).attr("onclick") ?? "").match(/load_list_chapter\((\d+)\)/);
        if (match !== null) {
            lastPage = Math.max(lastPage, Number.parseInt(match[1] ?? "", 10));
        }
    }

    return {
        mangaNumericId: $("#title-detail-manga").attr("data-manga") || undefined,
        lastPage,
    };
}

export function parseChapters($: CheerioAPI, fragments: string[], sourceManga: SourceManga): Chapter[] {
    // The first page is already in the document; the rest arrived as markup.
    const roots = [$, ...fragments.map((fragment) => Application.loadDocument(fragment))];
    const entries: Array<{ chapterId: string; name: string; dateText: string }> = [];
    const seen = new Set<string>();

    for (const root of roots) {
        for (const element of root(".wp-manga-chapter").toArray()) {
            const row = root(element);
            const link = row.find("a").first();
            const chapterId = encodePathId(link.attr("href") ?? "");
            const name = chapterTitleFromLink(link);

            if (chapterId.length === 0 || name.length === 0 || seen.has(chapterId)) {
                continue;
            }
            seen.add(chapterId);

            entries.push({
                chapterId,
                name,
                dateText: cleanText(row.find(".chapter-release-date").text()),
            });
        }
    }

    if (entries.length === 0) {
        throw new Error(`No chapters were found for ${sourceManga.mangaInfo.primaryTitle}.`);
    }

    // Rows marked "new" carry no date of their own, so the page's own
    // last-updated stamp stands in for them.
    const fallbackDate = parseListingDate($("article > time, #item-detail > time").first().text());

    return entries.map((entry, index) => ({
        chapterId: entry.chapterId,
        sourceManga,
        langCode: "🇬🇧",
        chapNum: chapterNumber(entry.name) ?? 0,
        title: formatChapterTitle(entry.name) || undefined,
        volume: 0,
        // The list runs newest first; the app wants oldest lowest.
        sortingIndex: entries.length - index,
        publishDate: parseListingDate(entry.dateText) ?? (/^new$/i.test(entry.dateText) ? fallbackDate : undefined),
    }));
}

/**
 * Collects the page images of a chapter.
 *
 * The reader builds its images from a signed token holding a base64 manifest
 * and a CDN prefix. Where that cannot be read — the format changes from time
 * to time — the markup still carries the images directly, so that is tried
 * second rather than failing outright.
 */
export function parseChapterPages($: CheerioAPI, chapter: Chapter): ChapterDetails {
    const pages: string[] = [];

    const token = $("#next_img_token").attr("value") ?? "";
    const cdnUrl = $("#currentlink").attr("value")?.replace(/\/+$/, "") ?? "";
    const encodedPayload = token.split(".")[1];

    if (encodedPayload !== undefined && encodedPayload.length > 0 && cdnUrl.length > 0) {
        try {
            const payload = JSON.parse(Application.base64Decode(encodedPayload)) as { data?: unknown };
            if (typeof payload.data === "string") {
                const manifest = JSON.parse(Application.base64Decode(payload.data)) as unknown;
                if (Array.isArray(manifest)) {
                    for (const image of manifest) {
                        if (typeof image === "string" && image.length > 0) {
                            pages.push(`${cdnUrl}/${image}`);
                        }
                    }
                }
            }
        } catch {
            pages.length = 0;
        }
    }

    if (pages.length === 0) {
        const seen = new Set<string>();
        for (const element of $(".reading-detail.box_doc img").toArray()) {
            const imageUrl = imageUrlFrom($(element));
            if (imageUrl.length === 0 || seen.has(imageUrl)) {
                continue;
            }
            seen.add(imageUrl);
            pages.push(imageUrl);
        }
    }

    if (pages.length === 0) {
        throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
    }

    return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        pages,
    };
}

export function hasNextPage($: CheerioAPI): boolean {
    return $(".pagination a")
        .toArray()
        .some((element) => cleanText($(element).text()) === "»");
}

/**
 * Builds a home page tile.
 *
 * 0.8 tiles carry a single subtitle line, so the newest chapter and whichever
 * count suits the section are joined into one.
 */
export function toDiscoverItem(item: MangaListItem, detail?: string): DiscoverSectionItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([
            item.chapters[0] === undefined ? undefined : formatChapterLabel(item.chapters[0].title),
            detail,
        ]),
    };
}

export function toFollowedItem(item: MangaListItem): DiscoverSectionItem {
    return toDiscoverItem(item, item.follows === undefined ? undefined : `♡ ${item.follows}`);
}

export function toHotItem(item: MangaListItem): DiscoverSectionItem {
    return toDiscoverItem(item, item.views === undefined ? undefined : `${item.views} views`);
}

export function toNewMangaItem(item: NewMangaItem): DiscoverSectionItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([
            item.chapter === undefined ? undefined : formatChapterLabel(item.chapter.title),
            "NEW",
        ]),
    };
}

/** Like `toDiscoverItem`, but only for entries that actually have a chapter. */
export function toLatestReleaseItem(item: MangaListItem): DiscoverSectionItem | undefined {
    const chapter = item.chapters[0];
    if (chapter === undefined) {
        return undefined;
    }

    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: formatChapterLabel(chapter.title),
        chapterId: chapter.chapterId,
        publishDate: parseListingDate(chapter.dateText) ?? (chapter.isNew ? item.updatedDate : undefined),
    };
}

export function toSearchResultItem(item: MangaListItem): SearchResultItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([
            item.views === undefined ? undefined : `${item.views} views`,
            item.chapters[0] === undefined ? undefined : formatChapterLabel(item.chapters[0].title),
        ]),
        contentRating: contentRatingForGenres(item.genres),
    };
}

function joinDetails(parts: Array<string | undefined>): string | undefined {
    const joined = parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ");
    return joined.length > 0 ? joined : undefined;
}
