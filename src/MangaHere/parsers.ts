/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { AnyNode } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";

import {
    Application,
    ContentRating,
    MangaStatus,
    type Chapter,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type TagSection,
} from "../../common";

import { DOMAIN, type ListingChapter, type MangaListItem, type ReaderMetadata } from "./models";
import { secureUrl } from "./network";
import { isPacked, parseEmbeddedPages, parseReaderKey, unpack } from "./unpack";

/** Characters that are safe to keep in an id the app will store and replay. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const ADULT_GENRES = new Set(["adult", "hentai", "lolicon", "shotacon"]);
const MATURE_GENRES = new Set(["ecchi", "mature", "smut", "yaoi", "yuri"]);

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const RELATIVE_UNITS: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
};

/** The placeholder the site shows instead of the pages of a removed chapter. */
const REMOVED_PAGE = /\/images\/war\.jpg(?:\?|$)/i;

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
    return sanitizeId((value ?? "").match(/\/manga\/([^/?#]+)/i)?.[1] ?? "");
}

/** Chapter paths may carry a volume segment, which stays part of the id. */
function parseChapterRef(value?: string | null): { mangaId: string; chapterId: string } | undefined {
    const match = (value ?? "").match(/\/manga\/([^/?#]+)\/((?:v[^/]+\/)?c[^/?#]+)/i);
    if (match === null) {
        return undefined;
    }
    return { mangaId: sanitizeId(match[1] ?? ""), chapterId: sanitizeId(match[2] ?? "") };
}

function toAbsoluteUrl(value?: string | null): string {
    const url = Application.decodeHTMLEntities(value ?? "").trim();

    if (url.length === 0) {
        return "";
    }
    if (url.startsWith("//") || /^https?:\/\//i.test(url)) {
        return secureUrl(url);
    }
    return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Lazy-loaded images keep the real address aside and show a loading picture. */
function imageUrlFrom(image: Cheerio<AnyNode>): string {
    return toAbsoluteUrl(
        image.attr("data-original") ??
            image.attr("data-src") ??
            image.attr("data-lazy-src") ??
            image.attr("data-cfsrc") ??
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

function parseChapterNumber(value: string): number | undefined {
    const match = value.match(/Ch(?:apter)?\.?\s*(\d+(?:\.\d+)?)/i);
    return match === null ? undefined : Number.parseFloat(match[1] ?? "");
}

function parseVolumeNumber(value: string): number | undefined {
    const match = value.match(/Vol(?:ume)?\.?\s*(\d+(?:\.\d+)?)/i);
    return match === null ? undefined : Number.parseFloat(match[1] ?? "");
}

/** Anchored to midnight so re-reading the same listing stays stable. */
function startOfDay(daysAgo: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(0, 0, 0, 0);
    return date;
}

/** Reads "5 hours ago", "Today", "Yesterday" or "Nov 07,2026". */
export function parseSiteDate(value?: string | null): Date | undefined {
    const text = cleanText(value);
    if (text.length === 0) {
        return undefined;
    }

    const relative = text.match(/(\d+)\s*(minute|hour|day|week)s?\s*ago/i);
    if (relative !== null) {
        const amount = Number.parseInt(relative[1] ?? "", 10);
        return new Date(Date.now() - amount * (RELATIVE_UNITS[(relative[2] ?? "").toLowerCase()] ?? 0));
    }
    if (/today/i.test(text)) {
        return startOfDay(0);
    }
    if (/yesterday/i.test(text)) {
        return startOfDay(1);
    }

    const match = text.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
    const month = match === null ? undefined : MONTHS[(match[1] ?? "").toLowerCase()];
    if (match === null || month === undefined) {
        return undefined;
    }
    return new Date(Number.parseInt(match[3] ?? "", 10), month, Number.parseInt(match[2] ?? "", 10));
}

/** Reads a labelled line from a listing card's hover panel. */
function labelledValue($: CheerioAPI, item: Cheerio<AnyNode>, label: string): string {
    let result = "";

    item.find(".manga-list-hover-info-line").each((_, element) => {
        if (result.length > 0) {
            return;
        }
        const row = $(element);
        if (!cleanText(row.find(".manga-list-hover-info-t").first().text()).startsWith(label)) {
            return;
        }
        result = cleanText(row.clone().children().first().remove().end().text());
    });

    return result;
}

function parseListItem($: CheerioAPI, item: Cheerio<AnyNode>): MangaListItem | undefined {
    const titleLink = item
        .find(
            ".manga-list-1-item-title a, .manga-list-2-item-title a, .manga-list-2-title a, .manga-list-3-show-title a, .manga-list-4-item-title a",
        )
        .first();
    const coverLink = item.find('a[href*="/manga/"][title]').first();
    const mangaId = parseMangaId(titleLink.attr("href") ?? coverLink.attr("href"));
    const title = cleanText(titleLink.attr("title") ?? coverLink.attr("title") ?? (titleLink.text() || coverLink.text()));

    if (mangaId.length === 0 || title.length === 0) {
        return undefined;
    }

    const genres = [
        ...new Set(
            item
                .find(
                    ".manga-list-hover-info-block .item-tag, .manga-list-3-show-tag-list span, .manga-list-4-show-tag-list a",
                )
                .toArray()
                .map((element) => cleanText($(element).text()))
                .filter((genre) => genre.length > 0),
        ),
    ];

    const rating = Number.parseFloat(cleanText(item.find(".item-score").first().text()));

    const chapterLink = item
        .find(
            '.manga-list-1-item-subtitle a, .manga-list-2-item-subtitle a, .manga-list-4-item-part a, .manga-list-4-item-tip a[href*="/c"]',
        )
        .first();
    const chapterRef = parseChapterRef(chapterLink.attr("href"));
    const chapterText = cleanText(chapterLink.text() || chapterLink.attr("title"));
    const chapter: ListingChapter | undefined =
        chapterRef === undefined
            ? undefined
            : {
                  chapterId: chapterRef.chapterId,
                  label: chapterText,
                  chapNum: parseChapterNumber(chapterText) ?? parseChapterNumber(chapterRef.chapterId),
                  volume: parseVolumeNumber(chapterText) ?? parseVolumeNumber(chapterRef.chapterId),
              };

    const rankText =
        cleanText(item.find('[class^="rank-"], [class*=" rank-"]').first().text()) || labelledValue($, item, "Rank:");
    const rank = Number.parseInt(rankText.replace(/\D/g, ""), 10);
    const views = Number.parseInt(labelledValue($, item, "Views:").replace(/\D/g, ""), 10);

    const searchAuthor = item
        .find(".manga-list-4-item-tip")
        .toArray()
        .map((element) => $(element))
        .find((row) => cleanText(row.text()).startsWith("Author:"));
    const author =
        labelledValue($, item, "Author:") ||
        cleanText(item.find(".manga-list-3-show-say a").text()) ||
        cleanText(searchAuthor?.find("a").text());
    const status = cleanText(item.find(".manga-list-4-show-tag-list-2 a").first().text());
    const dateText = cleanText(
        item.find(".manga-list-4-item-subtitle span, .manga-list-2-cover-bottom, p.title2").first().text(),
    );

    return {
        mangaId,
        title,
        imageUrl: imageUrlFrom(
            item
                .find("img.manga-list-1-cover, img.manga-list-2-cover-img, img.manga-list-3-show-img, img.manga-list-4-cover")
                .first(),
        ),
        genres,
        rating: Number.isFinite(rating) ? rating : undefined,
        author: author.length > 0 ? author : undefined,
        status: status.length > 0 ? status : undefined,
        views: Number.isFinite(views) ? views : undefined,
        rank: Number.isFinite(rank) && rank > 0 ? rank : undefined,
        chapter,
        updatedAt: parseSiteDate(dateText),
    };
}

function parseElements($: CheerioAPI, elements: AnyNode[]): MangaListItem[] {
    const items: MangaListItem[] = [];
    const seen = new Set<string>();

    for (const element of elements) {
        const item = parseListItem($, $(element));
        if (item === undefined || seen.has(item.mangaId)) {
            continue;
        }
        seen.add(item.mangaId);
        items.push(item);
    }
    return items;
}

export function parseMangaList($: CheerioAPI, selector: string): MangaListItem[] {
    return parseElements($, $(selector).toArray());
}

/** Finds a front page section by its heading, which is all that tells them apart. */
export function parseHomeSection($: CheerioAPI, heading: string): MangaListItem[] {
    const section = $(".manga-list-1, .manga-list-2, .manga-list-3, .manga-list-4")
        .toArray()
        .map((element) => $(element))
        .find((item) => {
            const title = cleanText(
                item
                    .children(".manga-list-1-title, .manga-list-2-title, .manga-list-3-title, .manga-list-4-title")
                    .first()
                    .clone()
                    .children()
                    .remove()
                    .end()
                    .text(),
            );
            return title === heading || (heading === "New Manga Release" && title === "New Manga Releases");
        });

    if (section === undefined) {
        return [];
    }
    return parseElements(
        $,
        section.find("> ul > li, > .main-large > ul > li, > .main-small .manga-list-3-show").toArray(),
    );
}

export function parseMobileHomeSection($: CheerioAPI, heading: string): MangaListItem[] {
    const section = $(".manga-list")
        .toArray()
        .map((element) => $(element))
        .find((item) => cleanText(item.children(".manga-list-title").first().text()) === heading);

    return section === undefined ? [] : parseElements($, section.find("> ul.manga-list-2 > li").toArray());
}

export function parseRankingList($: CheerioAPI, className: string): MangaListItem[] {
    return parseMangaList($, `.${className} ul.manga-list-1-list > li`).map((item, index) => ({
        ...item,
        rank: item.rank ?? index + 1,
    }));
}

export function parseHasNextPage($: CheerioAPI): boolean {
    // The final page still renders a "next" link, but it goes nowhere.
    return $(".pager-list-left a")
        .toArray()
        .some(
            (element) =>
                cleanText($(element).text()) === ">" && !($(element).attr("href") ?? "").startsWith("javascript"),
        );
}

function genreSlug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const info = $(".detail-info");
    const right = info.find(".detail-info-right");
    const title = cleanText(right.find(".detail-info-right-title-font").first().text()) || mangaId;

    const genres = right
        .find(".detail-info-right-tag-list a")
        .toArray()
        .map((element) => cleanText($(element).text()))
        .filter((genre) => genre.length > 0);

    const author = [
        ...new Set(
            right
                .find(".detail-info-right-say a")
                .toArray()
                .map((element) => cleanText($(element).text()))
                .filter((name) => name.length > 0),
        ),
    ].join(", ");

    const statusText = cleanText(right.find(".detail-info-right-title-tip").first().text());
    const rating = Number.parseFloat(cleanText(right.find(".item-score").first().text()));

    const tagGroups: TagSection[] =
        genres.length === 0
            ? []
            : [{ id: "genres", title: "Genres", tags: genres.map((genre) => ({ id: genreSlug(genre), title: genre })) }];

    return {
        mangaId,
        mangaInfo: {
            primaryTitle: title,
            secondaryTitles: [],
            thumbnailUrl: imageUrlFrom(info.find("img.detail-info-cover-img").first()),
            author: author.length > 0 ? author : undefined,
            synopsis: cleanDescription(right.find(".fullcontent").first().text()),
            contentRating: contentRatingForGenres(genres),
            status: /completed/i.test(statusText)
                ? MangaStatus.COMPLETED
                : /ongoing/i.test(statusText)
                  ? MangaStatus.ONGOING
                  : MangaStatus.UNKNOWN,
            // The site rates out of five; the app expects a fraction of one.
            rating: Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
            tagGroups,
        },
    };
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const rows = $("ul.detail-main-list > li").toArray();

    rows.forEach((element, index) => {
        const row = $(element);
        const link = row.find("a").first();
        const ref = parseChapterRef(link.attr("href"));
        if (ref === undefined || seen.has(ref.chapterId)) {
            return;
        }
        seen.add(ref.chapterId);

        const label = cleanText(row.find("p.title3").first().text() || link.attr("title"));
        const chapNum = parseChapterNumber(label) ?? parseChapterNumber(ref.chapterId);
        const volume = ref.chapterId.match(/^v(\d+(?:\.\d+)?)\//i)?.[1];

        chapters.push({
            chapterId: ref.chapterId,
            sourceManga,
            langCode: "🇬🇧",
            chapNum: chapNum ?? 0,
            title: chapNum === undefined && label.length > 0 ? label : undefined,
            // "vTBD" and the like are volumes not yet collected.
            volume: volume === undefined ? 0 : Number.parseFloat(volume),
            publishDate: parseSiteDate(row.find("p.title2").first().text()),
            // The site lists newest chapters first.
            sortingIndex: rows.length - index,
        });
    });

    return chapters;
}

/** Every page of a chapter, from the mobile roll reader. */
export function parseMobileChapterPages($: CheerioAPI): string[] {
    return [
        ...new Set(
            $("#viewer img")
                .toArray()
                .map((image) => imageUrlFrom($(image)))
                .filter((url) => url.includes("/store/manga/")),
        ),
    ];
}

/**
 * Reads the desktop reader's chapter id, page count and either its page list
 * or the key its page requests need.
 */
export function parseReaderMetadata($: CheerioAPI): ReaderMetadata | undefined {
    const scripts = $("script:not([src])")
        .toArray()
        .map((element) => $(element).html() ?? "")
        .filter((script) => script.length > 0);
    const scriptText = scripts.join("\n");

    const chapterId = /(?:var\s+)?chapterid\s*=\s*(\d+)/i.exec(scriptText)?.[1];
    const imageCount = Number.parseInt(/(?:var\s+)?imagecount\s*=\s*(\d+)/i.exec(scriptText)?.[1] ?? "", 10);
    if (chapterId === undefined || !Number.isFinite(imageCount) || imageCount <= 0) {
        return undefined;
    }

    if ($('script[src*="chapter_bar"]').length > 0) {
        const packed = scripts.find((script) => isPacked(script) && script.includes("newImgs"));
        if (packed === undefined) {
            throw new Error("No embedded reader script was found.");
        }
        return { chapterId, imageCount, embeddedPages: parseEmbeddedPages(unpack(packed)).map(secureUrl) };
    }

    const packed = scripts.find((script) => isPacked(script) && script.includes("dm5_key"));
    if (packed === undefined) {
        throw new Error("No reader key script was found.");
    }
    return { chapterId, imageCount, secretKey: parseReaderKey(unpack(packed)) };
}

/**
 * Checks a desktop reader's pages before handing them over.
 *
 * Some chapters report one page more than they serve, so one short is
 * accepted; anything else means the reader changed and the pages are wrong.
 */
export function validateChapterPages(pages: string[], expectedCount: number): string[] {
    if (pages.some((page) => REMOVED_PAGE.test(page))) {
        throw new Error("This chapter's images have been removed from the site.");
    }
    if (
        (pages.length === expectedCount || pages.length === expectedCount - 1) &&
        pages.every((page) => /^https:\/\//i.test(page))
    ) {
        return pages;
    }
    throw new Error(`The reader returned ${pages.length} of ${expectedCount} expected pages.`);
}

function formatCount(count: number): string {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(1)}K`;
    }
    return `${count}`;
}

function chapterLabel(chapter?: ListingChapter): string | undefined {
    if (chapter === undefined) {
        return undefined;
    }
    const number = chapter.chapNum !== undefined ? `Ch. ${chapter.chapNum}` : chapter.label;
    return joinDetails([chapter.volume !== undefined ? `Vol. ${chapter.volume}` : undefined, number], " ");
}

function joinDetails(parts: Array<string | undefined>, separator = " • "): string | undefined {
    const joined = parts.filter((part): part is string => part !== undefined && part.length > 0).join(separator);
    return joined.length > 0 ? joined : undefined;
}

const stars = (rating?: number): string | undefined => (rating === undefined ? undefined : `★ ${rating.toFixed(2)}`);

/**
 * A tile on a home row.
 *
 * 0.8 tiles carry a single subtitle line, so the newest chapter and the
 * rating are joined into one where both are known.
 */
export function toDiscoverItem(item: MangaListItem): DiscoverSectionItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([chapterLabel(item.chapter), stars(item.rating)]),
    };
}

/** The large tiles of the popularity chart lead with its position and views. */
export function toFeaturedItem(item: MangaListItem): DiscoverSectionItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([
            item.rank === undefined ? undefined : `Rank ${item.rank}`,
            item.views === undefined ? undefined : `${formatCount(item.views)} views`,
            chapterLabel(item.chapter),
        ]),
    };
}

/** Like `toDiscoverItem`, but only for entries that actually have a chapter. */
export function toChapterUpdateItem(item: MangaListItem): DiscoverSectionItem | undefined {
    if (item.chapter === undefined) {
        return undefined;
    }
    return { ...toDiscoverItem(item), chapterId: item.chapter.chapterId, publishDate: item.updatedAt };
}

/**
 * A search result.
 *
 * A card that lists no genres says nothing about its rating, so it takes the
 * rating of the genres searched for, if any.
 */
export function toSearchResultItem(item: MangaListItem, fallbackRating = ContentRating.EVERYONE): SearchResultItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([chapterLabel(item.chapter), item.status]),
        contentRating: item.genres.length > 0 ? contentRatingForGenres(item.genres) : fallbackRating,
    };
}

export function toRankingItem(item: MangaListItem): SearchResultItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([
            item.rank === undefined ? undefined : `#${item.rank}`,
            chapterLabel(item.chapter),
            stars(item.rating),
        ]),
        contentRating: contentRatingForGenres(item.genres),
    };
}
