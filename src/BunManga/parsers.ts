/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { AnyNode } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";

import {
    Application,
    ContentRating,
    URL,
    parseDate,
    type Chapter,
    type ChapterDetails,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import { DOMAIN, type ListingChapter, type MangaListItem } from "./models";

/** Characters that are safe to keep in an id the app will store and replay. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

/** Kana, Han and Hangul ranges, used to spot a title in its original script. */
const ORIGINAL_SCRIPT = /[぀-ヿ㐀-鿿가-힯]/;

const ADULT_GENRES = new Set(["adult", "hentai", "smut"]);
const MATURE_GENRES = new Set(["mature", "soft yaoi", "soft yuri", "yaoi", "yuri"]);

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

function sanitizeId(value: string): string {
    return value.replace(UNSAFE_ID, "-");
}

export function parseMangaId(value?: string | null): string {
    const slug = (value ?? "").match(/\/manga\/([^/?#]+)/i)?.[1] ?? "";
    return sanitizeId(slug);
}

function chapterIdFromUrl(value?: string | null): string {
    const path = (value ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    return sanitizeId(path.split("/").pop() ?? "");
}

function toAbsoluteUrl(value?: string | null): string {
    const url = Application.decodeHTMLEntities(value ?? "")
        .replace(/\s+/g, "")
        .trim();

    if (url.length === 0) {
        return "";
    }
    if (url.startsWith("//")) {
        return `https:${url}`;
    }
    if (/^https?:\/\//i.test(url)) {
        return url.replace(/^http:\/\//i, "https://");
    }
    return URL(DOMAIN).setPath(url).build();
}

/**
 * Finds the best image URL on a tile.
 *
 * The theme lazy-loads covers, so the real URL sits in one of several data
 * attributes and `src` holds a placeholder. Where a srcset is offered the
 * widest candidate is taken, since covers are displayed large.
 */
function imageUrlFrom(image: Cheerio<AnyNode>): string {
    const srcset = image
        .attr("srcset")
        ?.split(",")
        .map((entry) => {
            const [url, width] = entry.trim().split(/\s+/);
            return { url, width: Number.parseInt(width ?? "", 10) || 0 };
        })
        .filter((entry) => entry.url !== undefined)
        .sort((left, right) => right.width - left.width)[0]?.url;

    return toAbsoluteUrl(
        image.attr("data-cfsrc") ??
            image.attr("data-src") ??
            image.attr("data-lazy-src") ??
            srcset ??
            image.attr("src"),
    );
}

export function contentRatingForGenres(genres: string[]): ContentRating {
    const normalised = genres.map((genre) => genre.toLowerCase());

    if (normalised.some((genre) => ADULT_GENRES.has(genre))) {
        return ContentRating.ADULT;
    }
    if (normalised.some((genre) => MATURE_GENRES.has(genre))) {
        return ContentRating.MATURE;
    }
    return ContentRating.EVERYONE;
}

/** Picks the most useful alternate title, preferring one in the original script. */
function pickOriginalTitle(value: string, primaryTitle: string): string | undefined {
    const titles = splitTitles(value, primaryTitle);
    return titles.find((title) => ORIGINAL_SCRIPT.test(title)) ?? titles[0];
}

function splitTitles(value: string, primaryTitle: string): string[] {
    return value
        .split(/\s*[;/]\s*/)
        .map(cleanText)
        .filter(
            (title, index, values) =>
                title.length > 0 &&
                title.toLowerCase() !== primaryTitle.toLowerCase() &&
                values.indexOf(title) === index,
        );
}

function chapterNumber(value: string): number | undefined {
    const match = value.match(/\b(?:chapter|chap|ch\.?)[\s_-]*(\d+(?:\.\d+)?)/i);
    if (match === null) {
        return undefined;
    }
    const number = Number.parseFloat(match[1] ?? "");
    return Number.isFinite(number) ? number : undefined;
}

/** Strips the chapter number, leaving whatever title remains. */
function chapterTitle(value: string): string | undefined {
    const remainder = cleanText(
        cleanText(value)
            .replace(/\b(?:chapter|chap|ch\.?)[\s_-]*\d+(?:\.\d+)?/i, "")
            .replace(/^[-:\s]+/, ""),
    );
    return remainder.length > 0 ? remainder : undefined;
}

function parseListingChapter(container: Cheerio<AnyNode>): ListingChapter | undefined {
    const link = container.find(".latest-chap .chapter a, .chapter-item .chapter a").first();
    const chapterId = chapterIdFromUrl(link.attr("href"));
    const title = cleanText(link.text());

    if (chapterId.length === 0 || title.length === 0) {
        return undefined;
    }

    const dateContainer = container.find(".meta-item.post-on, .chapter-item").first();
    return {
        chapterId,
        title,
        // The exact date hides in a tooltip; the visible text is relative.
        publishDate: parseDate(dateContainer.find(".c-new-tag").first().attr("title") ?? dateContainer.text()),
    };
}

/** Reads a title, cover and id off a tile, given where each one lives. */
function tileItem(
    $: CheerioAPI,
    element: AnyNode,
    titleSelector: string,
    imageSelector: string,
): MangaListItem | undefined {
    const item = $(element);
    const titleLink = item.find(titleSelector).first();

    const mangaId = parseMangaId(titleLink.attr("href"));
    const title = cleanText(titleLink.text().length > 0 ? titleLink.text() : titleLink.attr("title"));
    const imageUrl = imageUrlFrom(item.find(imageSelector).first());

    if (mangaId.length === 0 || title.length === 0 || imageUrl.length === 0) {
        return undefined;
    }

    return {
        mangaId,
        title,
        imageUrl,
        // These compact tiles carry no genres, and the site is adult-leaning.
        contentRating: ContentRating.ADULT,
        genres: [],
        chapter: parseListingChapter(item),
    };
}

export function parseMangaList($: CheerioAPI): MangaListItem[] {
    const items: MangaListItem[] = [];
    const seen = new Set<string>();

    for (const element of $(".c-tabs-item__content").toArray()) {
        const item = $(element);
        const titleLink = item.find(".post-title a").first();

        const mangaId = parseMangaId(titleLink.attr("href"));
        const title = cleanText(titleLink.text().length > 0 ? titleLink.text() : titleLink.attr("title"));
        const imageUrl = imageUrlFrom(item.find(".tab-thumb img").first());

        if (mangaId.length === 0 || title.length === 0 || imageUrl.length === 0 || seen.has(mangaId)) {
            continue;
        }
        seen.add(mangaId);

        const genres = item
            .find(".mg_genres .summary-content a")
            .map((_, link) => cleanText($(link).text()))
            .toArray()
            .filter((genre) => genre.length > 0);

        const rawRating = Number.parseFloat(item.find(".meta-item.rating .score").first().text());
        const alternative = cleanText(item.find(".mg_alternative .summary-content").first().text());
        const status = cleanText(item.find(".mg_status .summary-content").first().text());

        items.push({
            mangaId,
            title,
            imageUrl,
            contentRating: contentRatingForGenres(genres),
            genres,
            alternativeTitle: pickOriginalTitle(alternative, title),
            status: status.length > 0 ? status : undefined,
            chapter: parseListingChapter(item),
            rating: Number.isFinite(rawRating) ? rawRating : undefined,
        });
    }

    return items;
}

/** Finds a home page widget by the heading it sits under. */
function widgetByHeading($: CheerioAPI, selector: string, heading: RegExp): Cheerio<AnyNode> {
    return $(selector)
        .filter((_, element) => heading.test(cleanText($(element).find(".heading").first().text())))
        .first();
}

export function parsePopular($: CheerioAPI): MangaListItem[] {
    return widgetByHeading($, ".widget-manga-popular-slider", /^popular$/i)
        .find(".slider__item")
        .toArray()
        .flatMap((element) => {
            const item = tileItem($, element, ".post-title a", ".slider__thumb img");
            return item === undefined ? [] : [item];
        });
}

export function parseTopDaily($: CheerioAPI): MangaListItem[] {
    return widgetByHeading($, ".widget-manga-recent", /^top daily$/i)
        .find(".popular-item-wrap")
        .toArray()
        .flatMap((element) => {
            const item = tileItem($, element, ".widget-title a", ".popular-img img");
            return item === undefined ? [] : [item];
        });
}

export function parseLatestUpdates($: CheerioAPI): MangaListItem[] {
    return $(".c-blog-listing .page-item-detail")
        .toArray()
        .flatMap((element) => {
            const item = tileItem($, element, ".post-title a", ".item-thumb img");
            return item === undefined ? [] : [item];
        });
}

/** Reads the genre checkboxes off the search form. */
export function parseGenreTags($: CheerioAPI): Tag[] {
    const tags: Tag[] = [];
    const seen = new Set<string>();

    for (const element of $('input[name="genre[]"]').toArray()) {
        const input = $(element);
        const id = sanitizeId(input.attr("value") ?? "");
        const title = cleanText($(`label[for="${input.attr("id") ?? ""}"]`).first().text());

        if (id.length === 0 || title.length === 0 || seen.has(id)) {
            continue;
        }
        seen.add(id);
        tags.push({ id, title });
    }

    return tags;
}

/**
 * Pulls out the query blob the load-more endpoint needs.
 *
 * The theme leaves it in an inline script on the first page of a listing; it
 * has to be carried forward verbatim, since it encodes the filters that
 * produced these results.
 */
export function parseLoadMoreQueryVars($: CheerioAPI): string | undefined {
    for (const element of $("script").toArray()) {
        const match = $(element)
            .text()
            .match(/var\s+__madara_query_vars\s*=\s*(\{[^\n;]+\})\s*;/);
        if (match !== null) {
            return match[1];
        }
    }
    return undefined;
}

export function parseTotalResults($: CheerioAPI): number | undefined {
    const match = cleanText($(".search-wrap .c-blog__heading h1").first().text()).match(/([\d,]+)\s+results?/i);
    if (match === null) {
        return undefined;
    }

    const total = Number.parseInt((match[1] ?? "").replace(/,/g, ""), 10);
    return Number.isFinite(total) ? total : undefined;
}

export function hasLoadMore($: CheerioAPI): boolean {
    return $("#navigation-ajax").length > 0;
}

/**
 * Builds a home page tile.
 *
 * 0.8 tiles carry a single subtitle line, so the newest chapter and the rating
 * are joined into one where both are known.
 */
export function toDiscoverItem(item: MangaListItem): DiscoverSectionItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([item.chapter?.title, item.rating === undefined ? undefined : `★ ${item.rating}`]),
    };
}

/** Like `toDiscoverItem`, but only for entries that actually have a new chapter. */
export function toChapterUpdateItem(item: MangaListItem): DiscoverSectionItem | undefined {
    if (item.chapter === undefined) {
        return undefined;
    }

    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: item.chapter.title,
        chapterId: item.chapter.chapterId,
        publishDate: item.chapter.publishDate,
    };
}

export function toSearchResultItem(item: MangaListItem): SearchResultItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([item.chapter?.title, item.status]),
        contentRating: item.contentRating,
    };
}

function joinDetails(parts: Array<string | undefined>): string | undefined {
    const joined = parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ");
    return joined.length > 0 ? joined : undefined;
}

/** Finds the value of a labelled row on the details page. */
function labelledContent($: CheerioAPI, label: string): Cheerio<AnyNode> | undefined {
    for (const element of $(".post-content_item").toArray()) {
        const item = $(element);
        const heading = cleanText(item.find(".summary-heading").first().text())
            .replace(/\(s\)$/i, "")
            .toLowerCase();

        if (heading === label.toLowerCase()) {
            return item.find(".summary-content").first();
        }
    }
    return undefined;
}

function tagsFrom($: CheerioAPI, selector: string): Tag[] {
    const tags: Tag[] = [];
    const seen = new Set<string>();

    for (const element of $(selector).toArray()) {
        const link = $(element);
        const href = (link.attr("href") ?? "").replace(/\/+$/, "");
        const id = sanitizeId(href.split("/").pop() ?? "");
        const title = cleanText(link.text());

        if (id.length === 0 || title.length === 0 || seen.has(id)) {
            continue;
        }
        seen.add(id);
        tags.push({ id, title });
    }

    return tags;
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const primaryTitle = cleanText($(".profile-manga .post-title h1").first().text());
    const thumbnailUrl = imageUrlFrom($(".summary_image img").first());

    // Without these two the details screen has nothing to show, and an empty
    // entry is worse than a visible failure.
    if (primaryTitle.length === 0 || thumbnailUrl.length === 0) {
        throw new Error(`Unable to read the details page for ${mangaId}.`);
    }

    const genres = tagsFrom($, ".genres-content a");
    const tags = tagsFrom($, ".tags-content a");
    const rawRating = Number.parseFloat($("#averagerate, [itemprop=ratingValue]").first().text());

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
        tagGroups.push({ id: "genres", title: "Genres", tags: genres });
    }
    if (tags.length > 0) {
        tagGroups.push({ id: "tags", title: "Tags", tags });
    }

    const status = cleanText(labelledContent($, "Status")?.text());

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles: splitTitles(cleanText(labelledContent($, "Alternative")?.text()), primaryTitle),
            thumbnailUrl,
            synopsis: cleanDescription($(".description-summary .summary__content").first().text()),
            author: namedPerson($, ".author-content", "Author"),
            artist: namedPerson($, ".artist-content", "Artist"),
            status: status.length > 0 ? status : "Unknown",
            // The site rates out of five; the app expects a fraction of one.
            rating: Number.isFinite(rawRating) ? Math.min(1, Math.max(0, rawRating / 5)) : undefined,
            contentRating: contentRatingForGenres(genres.map((genre) => genre.title)),
            tagGroups,
        },
    };
}

/** Reads an author or artist, treating the theme's placeholder as absent. */
function namedPerson($: CheerioAPI, selector: string, label: string): string | undefined {
    const direct = cleanText($(selector).first().text());
    const value = direct.length > 0 ? direct : cleanText(labelledContent($, label)?.text());
    return value.length === 0 || /^updating$/i.test(value) ? undefined : value;
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
    const nodes = $(".wp-manga-chapter").toArray();
    const seen = new Set<string>();

    const chapters = nodes.flatMap((element, index) => {
        const item = $(element);
        const link = item.find("a").first();
        const chapterId = chapterIdFromUrl(link.attr("href"));
        const rawTitle = cleanText(link.text());

        if (chapterId.length === 0 || seen.has(chapterId)) {
            return [];
        }
        seen.add(chapterId);

        return [
            {
                chapterId,
                sourceManga,
                langCode: "🇬🇧",
                // Prologues and extras carry no number; sortingIndex still
                // places them correctly.
                chapNum: chapterNumber(rawTitle.length > 0 ? rawTitle : chapterId) ?? 0,
                title: chapterTitle(rawTitle),
                volume: 0,
                // The page lists newest first; the app wants oldest lowest.
                sortingIndex: nodes.length - index,
                publishDate: parseDate(
                    item.find(".chapter-release-date .c-new-tag").first().attr("title") ??
                        item.find(".chapter-release-date").text(),
                ),
            },
        ];
    });

    if (chapters.length === 0) {
        throw new Error(`No chapters were found for ${sourceManga.mangaInfo.primaryTitle}.`);
    }
    return chapters;
}

export function parseChapterDetails($: CheerioAPI, chapter: Chapter): ChapterDetails {
    const pages = $(".reading-content .page-break img")
        .toArray()
        .map((element) => imageUrlFrom($(element)))
        .filter((url) => url.length > 0);

    if (pages.length === 0) {
        throw new Error(
            `No pages were found for ${chapter.sourceManga.mangaInfo.primaryTitle}, chapter ${chapter.chapNum}.`,
        );
    }

    return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        pages,
    };
}
