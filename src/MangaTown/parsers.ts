/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { AnyNode } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";

import {
    Application,
    ContentRating,
    type Chapter,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type TagSection,
} from "../../common";

import { DOMAIN, type ListingChapter, type MangaListItem } from "./models";

/** Characters that are safe to keep in an id the app will store and replay. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const ADULT_GENRES = new Set(["adult", "hentai", "lolicon", "shotacon"]);
const MATURE_GENRES = new Set(["ecchi", "mature", "smut", "yaoi", "yuri"]);

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

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
    const match = (value ?? "").match(/\/manga\/([^/?#]+)\/((?:v[^/]+\/)?c[^/?#]+)\/?/i);
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
    if (url.startsWith("//")) {
        return `https:${url}`;
    }
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

function imageUrlFrom(image: Cheerio<AnyNode>): string {
    return toAbsoluteUrl(
        image.attr("data-src") ?? image.attr("data-lazy-src") ?? image.attr("data-cfsrc") ?? image.attr("src"),
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

/** Anchored to midnight so re-reading the same listing stays stable. */
function startOfDay(daysAgo: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(0, 0, 0, 0);
    return date;
}

export function parseSiteDate(value?: string | null): Date | undefined {
    const text = cleanText(value);
    if (text.length === 0) {
        return undefined;
    }
    if (/today/i.test(text)) {
        return startOfDay(0);
    }
    if (/yesterday/i.test(text)) {
        return startOfDay(1);
    }

    const match = text.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
    if (match === null) {
        return undefined;
    }

    const month = MONTHS[(match[1] ?? "").toLowerCase()];
    if (month === undefined) {
        return undefined;
    }
    return new Date(Number.parseInt(match[3] ?? "", 10), month, Number.parseInt(match[2] ?? "", 10));
}

/** The site puts the chapter number at the end of the link text. */
function parseChapterNumber(value: string): number | undefined {
    const match = value.match(/(\d+(?:\.\d+)?)\s*$/);
    return match === null ? undefined : Number.parseFloat(match[1] ?? "");
}

function parseListingChapter(item: Cheerio<AnyNode>): ListingChapter | undefined {
    const link = item.find("p.new_chapter a").first();
    const ref = parseChapterRef(link.attr("href"));

    if (ref === undefined) {
        return undefined;
    }

    const label = cleanText(link.text());
    return { chapterId: ref.chapterId, label, chapNum: parseChapterNumber(label) };
}

export function parseMangaList($: CheerioAPI): MangaListItem[] {
    const items: MangaListItem[] = [];
    const seen = new Set<string>();

    $("li").each((_, element) => {
        const item = $(element);
        const cover = item.find("a.manga_cover").first();
        if (cover.length === 0) {
            return;
        }

        const titleLink = item.find("p.title a").first();
        const fallbackLink = item.find("p a").first();
        const href = titleLink.attr("href") ?? fallbackLink.attr("href") ?? cover.attr("href");

        const mangaId = parseMangaId(href);
        const title = cleanText(
            titleLink.text() || cover.attr("title") || fallbackLink.text() || cover.attr("rel"),
        );

        if (mangaId.length === 0 || title.length === 0 || seen.has(mangaId)) {
            return;
        }
        seen.add(mangaId);

        const genres = item
            .find("p.keyWord a")
            .toArray()
            .map((genre) => cleanText($(genre).text()))
            .filter((genre) => genre.length > 0);

        // The card's detail lines are all `p.view`, distinguished only by the
        // label they start with; an unlabelled one carries the update date.
        let author: string | undefined;
        let status: string | undefined;
        let views: number | undefined;
        let rank: number | undefined;
        let updatedAt: Date | undefined;

        item.find("p.view").each((_index, viewElement) => {
            const text = cleanText($(viewElement).text());
            const labelled = text.match(/^(Author|Status|Views|Rank):\s*(.*)$/i);

            if (labelled === null) {
                updatedAt ??= parseSiteDate(text);
                return;
            }

            const value = (labelled[2] ?? "").trim();
            if (value.length === 0) {
                return;
            }

            switch ((labelled[1] ?? "").toLowerCase()) {
                case "author":
                    author = value;
                    break;
                case "status":
                    status = value;
                    break;
                case "views":
                    views = Number.parseInt(value.replace(/\D/g, ""), 10);
                    break;
                default:
                    rank = Number.parseInt(value.replace(/\D/g, ""), 10);
            }
        });

        const rating = Number.parseFloat(cleanText(item.find("p.score b").first().text()));

        items.push({
            mangaId,
            title,
            imageUrl: imageUrlFrom(item.find("a.manga_cover img").first()),
            genres,
            rating: Number.isFinite(rating) ? rating : undefined,
            author,
            status,
            views: views !== undefined && Number.isFinite(views) ? views : undefined,
            rank: rank !== undefined && Number.isFinite(rank) ? rank : undefined,
            chapter: parseListingChapter(item),
            updatedAt,
        });
    });

    return items;
}

export function parseHasNextPage($: CheerioAPI): boolean {
    // The final page still renders a "next" link, but it goes nowhere.
    return $("a.next")
        .toArray()
        .some((element) => !($(element).attr("href") ?? "").startsWith("javascript"));
}

/** Reads a `<b>Label:</b> value` list row off the details page. */
function labelledListText($: CheerioAPI, info: Cheerio<AnyNode>, label: string): string {
    let result = "";

    info.find("li").each((_, element) => {
        if (result.length > 0) {
            return;
        }
        const item = $(element);
        if (item.find("b").first().text().toLowerCase().includes(label)) {
            result = cleanText(item.text());
        }
    });

    return result;
}

/** Reads the link that follows a bold label. */
function labelledLinkText($: CheerioAPI, info: Cheerio<AnyNode>, label: string): string {
    let result = "";

    info.find("b").each((_, element) => {
        if (result.length > 0) {
            return;
        }
        const bold = $(element);
        if (bold.text().toLowerCase().includes(label)) {
            result = cleanText(bold.next("a").first().text());
        }
    });

    return result;
}

function parseStatus($: CheerioAPI, info: Cheerio<AnyNode>): string {
    // A licensed title has no readable chapters, which is worth saying plainly.
    let licensed = false;
    info.find("div.chapter_content").each((_, element) => {
        if ($(element).text().toLowerCase().includes("has been licensed")) {
            licensed = true;
        }
    });

    if (licensed) {
        return "Licensed";
    }

    const status = labelledListText($, info, "status").toLowerCase();
    if (status.includes("ongoing")) {
        return "Ongoing";
    }
    if (status.includes("completed")) {
        return "Completed";
    }
    return "Unknown";
}

function genreSlug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const info = $("div.article_content");
    const title = cleanText(info.find("h1").first().text()) || mangaId;

    const genres: string[] = [];
    info.find("li").each((_, element) => {
        const item = $(element);
        if (!item.find("b").first().text().toLowerCase().includes("genre")) {
            return;
        }
        item.find("a").each((_index, link) => {
            const genre = cleanText($(link).text());
            if (genre.length > 0) {
                genres.push(genre);
            }
        });
    });

    const ratingMatch = labelledListText($, info, "rating").match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
    const rating = ratingMatch === null ? Number.NaN : Number.parseFloat(ratingMatch[1] ?? "");

    const secondaryTitles = labelledListText($, info, "alternative")
        .replace(/^alternative\s*name\s*:?/i, "")
        .split(/\s*;\s*/)
        .map(cleanText)
        .filter((value) => value.length > 0 && value.toLowerCase() !== title.toLowerCase());

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
        tagGroups.push({
            id: "genres",
            title: "Genres",
            tags: genres.map((genre) => ({ id: genreSlug(genre), title: genre })),
        });
    }

    const author = labelledLinkText($, info, "author");
    const artist = labelledLinkText($, info, "artist");

    return {
        mangaId,
        mangaInfo: {
            primaryTitle: title,
            secondaryTitles,
            thumbnailUrl: imageUrlFrom($("div.detail_info img").first()),
            author: author.length > 0 ? author : undefined,
            artist: artist.length > 0 ? artist : undefined,
            // The synopsis ends with the control that collapses it again.
            synopsis: cleanDescription($("span#show").first().text().replace(/HIDE$/, "")),
            contentRating: contentRatingForGenres(genres),
            status: parseStatus($, info),
            // The site rates out of five; the app expects a fraction of one.
            rating: Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
            tagGroups,
        },
    };
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const mangaTitle = sourceManga.mangaInfo.primaryTitle;
    const entries = $("ul.chapter_list li").toArray();

    entries.forEach((element, index) => {
        const item = $(element);
        const link = item.find("a").first();
        const ref = parseChapterRef(link.attr("href"));

        if (ref === undefined || seen.has(ref.chapterId)) {
            return;
        }
        seen.add(ref.chapterId);

        const linkText = cleanText(link.text());

        // A chapter's own title, where it has one, sits in a span that is
        // neither the timestamp nor the "new" flag.
        const extra = item
            .find("span")
            .toArray()
            .map((span) => $(span))
            .filter((span) => {
                const className = span.attr("class") ?? "";
                return !className.includes("time") && !className.includes("new");
            })
            .map((span) => cleanText(span.text()))
            .filter((text) => text.length > 0)
            .join(" ");

        const chapNum = parseChapterNumber(linkText);
        const volumeMatch = ref.chapterId.match(/^v(\d+)\//i);

        chapters.push({
            chapterId: ref.chapterId,
            sourceManga,
            langCode: "🇬🇧",
            chapNum: chapNum ?? 0,
            title: extra.length > 0 ? extra : chapNum === undefined ? cleanText(linkText.replace(mangaTitle, "")) : undefined,
            volume: volumeMatch === null ? 0 : Number.parseInt(volumeMatch[1] ?? "", 10),
            publishDate: parseSiteDate(item.find("span.time").first().text()),
            // The site lists newest chapters first.
            sortingIndex: entries.length - index,
        });
    });

    return chapters;
}

/**
 * The reader carries two page pickers; only the one after the chapter dropdown
 * lists pages, the other repeats the chapter list.
 */
const PAGE_OPTION_SELECTOR = "select#top_chapter_list ~ div.page_select option";
const FALLBACK_PAGE_OPTION_SELECTOR = "div.manga_read_footer div.page_select option";

export function parseChapterPageUrls($: CheerioAPI): string[] {
    const scoped = $(PAGE_OPTION_SELECTOR);
    const options = scoped.length > 0 ? scoped : $(FALLBACK_PAGE_OPTION_SELECTOR);

    const urls: string[] = [];
    const seen = new Set<string>();

    options.each((_, element) => {
        const option = $(element);
        const value = option.attr("value") ?? "";

        // The final option advertises a promo page rather than a chapter page.
        if (value.length === 0 || /featured/i.test(value) || /featured/i.test(option.text())) {
            return;
        }

        const url = toAbsoluteUrl(value);
        if (seen.has(url)) {
            return;
        }
        seen.add(url);
        urls.push(url);
    });

    return urls;
}

/** Matches a URL ending in a zero-padded page index. */
const SEQUENTIAL_IMAGE = /^(.*\/)([^/\d]*)(\d+)(\.[A-Za-z0-9]+)$/;

/**
 * Guesses every page's image URL from one of them.
 *
 * A chapter's images sit in one directory under consecutive indices, so the
 * whole set can be derived rather than fetching each reader page in turn. The
 * caller checks the guess before trusting it.
 */
export function buildSequentialImageUrls(
    imageUrl: string,
    imagePage: number,
    totalPages: number,
): string[] | undefined {
    const match = imageUrl.match(SEQUENTIAL_IMAGE);
    if (match === null) {
        return undefined;
    }

    const [, directory, prefix, digits, extension] = match;
    const first = Number.parseInt(digits ?? "", 10) - (imagePage - 1);

    if (!Number.isFinite(first) || first < 0) {
        return undefined;
    }

    return Array.from(
        { length: totalPages },
        (_, index) =>
            `${directory}${prefix}${String(first + index).padStart((digits ?? "").length, "0")}${extension}`,
    );
}

export function parseViewerImage($: CheerioAPI): string {
    return imageUrlFrom($("div#viewer img, img#image, source#image").first());
}

export function parseViewerImages($: CheerioAPI): string[] {
    return $("div#viewer img")
        .toArray()
        .map((element) => imageUrlFrom($(element)))
        .filter((url) => url.length > 0);
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
    return chapter.chapNum !== undefined ? `Ch. ${chapter.chapNum}` : chapter.label || undefined;
}

function joinDetails(parts: Array<string | undefined>): string | undefined {
    const joined = parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ");
    return joined.length > 0 ? joined : undefined;
}

/**
 * Builds a home page tile.
 *
 * 0.8 tiles carry a single subtitle line, so the rating and newest chapter are
 * joined into one where both are known.
 */
export function toDiscoverItem(item: MangaListItem): DiscoverSectionItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([
            item.rating === undefined ? undefined : `★ ${item.rating.toFixed(2)}`,
            chapterLabel(item.chapter),
        ]),
    };
}

/** Like `toDiscoverItem`, but leads with the chart position and view count. */
export function toTopItem(item: MangaListItem): DiscoverSectionItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([
            item.rank === undefined ? undefined : `Rank ${item.rank}`,
            item.views === undefined ? undefined : `${formatCount(item.views)} views`,
            item.status,
        ]),
    };
}

/** Like `toDiscoverItem`, but only for entries that actually have a chapter. */
export function toChapterUpdateItem(item: MangaListItem): DiscoverSectionItem | undefined {
    if (item.chapter === undefined) {
        return undefined;
    }

    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([
            chapterLabel(item.chapter),
            item.views === undefined ? undefined : `${formatCount(item.views)} views`,
        ]),
        chapterId: item.chapter.chapterId,
        publishDate: item.updatedAt,
    };
}

export function toSearchResultItem(item: MangaListItem): SearchResultItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([
            item.rating === undefined ? undefined : `★ ${item.rating.toFixed(2)}`,
            item.status,
        ]),
        contentRating: contentRatingForGenres(item.genres),
    };
}
