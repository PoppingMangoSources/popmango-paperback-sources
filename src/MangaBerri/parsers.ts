/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { AnyNode } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";

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

import { HOME_TITLES, MATURE_GENRES, type MangaCard } from "./models";

/** Characters that are safe to keep in an id the app will store and replay. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

/**
 * Series links are `/<slug>`; chapter links are `/<slug>/<number>`.
 *
 * The leading slash is sometimes missing, so both shapes allow for that.
 */
const SLUG_ONLY = /^\/?[^/]+\/?$/;
const CHAPTER_HREF = /^\/?[^/]+\/\d+/;

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

function absoluteUrl(baseUrl: string, url: string): string {
    if (url.length === 0) {
        return "";
    }
    if (url.startsWith("http")) {
        return url;
    }
    return `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function slugFromHref(href: string | undefined): string {
    return (href ?? "").replace(/^\//, "").split(/[/?#]/)[0] ?? "";
}

function chapterIdFromHref(href: string | undefined): string | undefined {
    return /\/([0-9]+)\/?(?:[?#]|$)/.exec(href ?? "")?.[1];
}

function ratingFrom(text: string): string | undefined {
    const value = /[\d.]+/.exec(text)?.[0];
    return value !== undefined && Number.parseFloat(value) > 0 ? value : undefined;
}

function chapterNumberFrom(value: string): number | undefined {
    const match = /(\d+(?:\.\d+)?)/.exec(value);
    return match === null ? undefined : Number.parseFloat(match[1] ?? "");
}

/**
 * Reads an update label such as "13 mins ago" or "7 days ago".
 *
 * Several units can appear at once, so every one present is summed back from
 * now; a label with no units at all leaves the date unset.
 */
function parseRelativeDate(value: string): Date | undefined {
    const text = value.trim().toLowerCase();

    if (text.length === 0) {
        return undefined;
    }
    if (text.includes("just now") || text.includes("less than")) {
        return new Date();
    }

    const units: Array<[RegExp, number]> = [
        [/(\d+)\s*sec/, 1_000],
        [/(\d+)\s*min/, 60_000],
        [/(\d+)\s*hour/, 3_600_000],
        [/(\d+)\s*day/, 86_400_000],
        [/(\d+)\s*week/, 604_800_000],
        [/(\d+)\s*month/, 2_629_800_000],
        [/(\d+)\s*year/, 31_557_600_000],
    ];

    let offset = 0;
    for (const [pattern, factor] of units) {
        const amount = Number(pattern.exec(text)?.[1] ?? 0);
        if (amount) {
            offset += amount * factor;
        }
    }

    return offset > 0 ? new Date(Date.now() - offset) : undefined;
}

export function contentRatingForGenres(genres: string[]): ContentRating {
    const normalised = genres.map((genre) => genre.trim().toLowerCase());
    return normalised.some((genre) => MATURE_GENRES.includes(genre))
        ? ContentRating.MATURE
        : ContentRating.EVERYONE;
}

function coverFrom(baseUrl: string, element: Cheerio<AnyNode>): string {
    const image = element.find("img").first();
    return absoluteUrl(baseUrl, image.attr("data-src") ?? image.attr("src") ?? "");
}

/**
 * Reads one card.
 *
 * Cards here are bare anchors — a cover link, a title link, then a chapter
 * link — so they are told apart by the shape of their href rather than by any
 * class.
 */
function parseCard($: CheerioAPI, baseUrl: string, item: Cheerio<AnyNode>): MangaCard | undefined {
    const links = item
        .find("a[href]")
        .toArray()
        .map((element) => $(element));

    const slugOnly = links.filter((link) => SLUG_ONLY.test(link.attr("href") ?? ""));
    const chapterLink = links.find((link) => CHAPTER_HREF.test(link.attr("href") ?? ""));

    const slug = slugFromHref((slugOnly[0] ?? links[0])?.attr("href"));
    // The cover is also a slug-only link, so the title is the one without one.
    const title = cleanText(slugOnly.find((link) => link.find("img").length === 0)?.text() ?? "");

    if (slug.length === 0 || title.length === 0) {
        return undefined;
    }

    const chapterLabel = chapterLink === undefined ? "" : cleanText(chapterLink.text());

    return {
        slug,
        title,
        cover: coverFrom(baseUrl, item),
        rating: ratingFrom(item.find(".row.align-center span").last().text()),
        chapterId: chapterIdFromHref(chapterLink?.attr("href")),
        chapterLabel: chapterLabel.length > 0 ? chapterLabel : undefined,
        genres: [],
    };
}

/** Finds a home section by its heading, then reads every card beneath it. */
function sectionContainer($: CheerioAPI, title: string): Cheerio<AnyNode> {
    return $(".section-title")
        .filter((_, element) => cleanText($(element).text()) === title)
        .first()
        .closest(".section-container");
}

export function parseCarouselSection($: CheerioAPI, baseUrl: string, title: string): MangaCard[] {
    return sectionContainer($, title)
        .find(".manga-item")
        .toArray()
        .flatMap((element) => {
            const card = parseCard($, baseUrl, $(element));
            return card === undefined ? [] : [card];
        });
}

/**
 * Reads the latest-update block.
 *
 * These cards are a horizontal grid carrying a rating, the newest chapter and a
 * relative timestamp.
 */
export function parseLatestSection($: CheerioAPI, baseUrl: string): MangaCard[] {
    return sectionContainer($, HOME_TITLES.LATEST)
        .find(".manga-horizontal-item")
        .toArray()
        .flatMap((element) => {
            const item = $(element);
            const links = item
                .find("a[href]")
                .toArray()
                .map((anchor) => $(anchor));

            const slug = slugFromHref(links.find((link) => SLUG_ONLY.test(link.attr("href") ?? ""))?.attr("href"));
            const title = cleanText(
                links.find(
                    (link) => SLUG_ONLY.test(link.attr("href") ?? "") && link.find("img").length === 0,
                )?.text() ?? "",
            );

            if (slug.length === 0 || title.length === 0) {
                return [];
            }

            // Rows are newest first; the first one holding a chapter link is
            // the update, while the others carry the rating and older chapters.
            const chapterRow = item.find(".row.align-center:has(a.episode)").first();
            const chapterLink = chapterRow.find("a.episode").first();
            const chapterLabel = cleanText(chapterLink.text());
            const updatedAt = cleanText(chapterRow.find(".episode-date").first().text());

            return [
                {
                    slug,
                    title,
                    cover: coverFrom(baseUrl, item),
                    rating: ratingFrom(item.find(".row.align-center > span").first().text()),
                    chapterId: chapterIdFromHref(chapterLink.attr("href")),
                    chapterLabel: chapterLabel.length > 0 ? chapterLabel : undefined,
                    updatedAt: updatedAt.length > 0 ? updatedAt : undefined,
                    genres: item
                        .find('a[href*="genre.php"]')
                        .toArray()
                        .map((genre) => cleanText($(genre).text()))
                        .filter((genre) => genre.length > 0),
                },
            ];
        });
}

export function parseListingCards(html: string, baseUrl: string): MangaCard[] {
    const $ = Application.loadDocument(html);

    return $(".manga-item")
        .toArray()
        .flatMap((element) => {
            const card = parseCard($, baseUrl, $(element));
            return card === undefined ? [] : [card];
        });
}

function joinDetails(parts: Array<string | undefined>): string | undefined {
    const joined = parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ");
    return joined.length > 0 ? joined : undefined;
}

function chapterLabel(card: MangaCard): string | undefined {
    if (card.chapterLabel === undefined) {
        return undefined;
    }
    const number = chapterNumberFrom(card.chapterLabel);
    return number === undefined ? card.chapterLabel : `Ch. ${number}`;
}

/**
 * Builds a home page tile.
 *
 * 0.8 tiles carry a single subtitle line, so the chapter and rating are joined
 * into one where both are known.
 */
export function toDiscoverItem(card: MangaCard): DiscoverSectionItem {
    return {
        mangaId: card.slug,
        title: card.title,
        imageUrl: card.cover,
        subtitle: joinDetails([chapterLabel(card), card.rating === undefined ? undefined : `★ ${card.rating}`]),
    };
}

/** The weekly and genre charts lead with the site's own ranking. */
export function toRankedItem(card: MangaCard, index: number): DiscoverSectionItem {
    return {
        mangaId: card.slug,
        title: card.title,
        imageUrl: card.cover,
        subtitle: joinDetails([`#${index + 1}`, chapterLabel(card)]),
    };
}

/** Like `toDiscoverItem`, but only for entries that actually have a chapter. */
export function toLatestItem(card: MangaCard): DiscoverSectionItem | undefined {
    if (card.chapterId === undefined) {
        return undefined;
    }

    return {
        mangaId: card.slug,
        title: card.title,
        imageUrl: card.cover,
        subtitle: joinDetails([chapterLabel(card), card.rating === undefined ? undefined : `★ ${card.rating}`]),
        chapterId: card.chapterId,
        publishDate: card.updatedAt === undefined ? undefined : parseRelativeDate(card.updatedAt),
    };
}

export function toSearchResultItem(card: MangaCard): SearchResultItem {
    return {
        mangaId: card.slug,
        title: card.title,
        imageUrl: card.cover,
        subtitle: card.rating === undefined ? undefined : `★ ${card.rating}`,
        contentRating: contentRatingForGenres(card.genres),
    };
}

/** Reads a labelled attribute from the details sidebar. */
function detailField($: CheerioAPI, label: string): string {
    return cleanText(
        $(".section-status.row, .comic-attrs .column")
            .toArray()
            .map((element) => $(element))
            .find((row) => cleanText(row.children().first().text()) === label)
            ?.children()
            .last()
            .text() ?? "",
    );
}

export function parseMangaDetails(html: string, baseUrl: string, mangaId: string): SourceManga {
    const $ = Application.loadDocument(html);

    const title = cleanText($("h1.story-name").first().text());
    if (title.length === 0) {
        throw new Error(`Unable to read the details page for ${mangaId}.`);
    }

    // The inline cover is the real image; the page's social card is generic.
    const thumbnailUrl = absoluteUrl(baseUrl, $("img.comic-img").first().attr("src") ?? "");
    const author = cleanText($('.comic-attrs a[href*="/author/"]').first().text());
    const status = detailField($, "Status");

    // Alternates sit in the subtitle separated by semicolons; commas inside a
    // romanised title are part of it, so they are left alone.
    const secondaryTitles = cleanText($(".comic-info-container h2").first().text())
        .split(";")
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 0 && alias.toLowerCase() !== title.toLowerCase());

    const seen = new Set<string>();
    const tags: Tag[] = $('.comic-attrs a[href*="genre.php?genre="]')
        .toArray()
        .flatMap((element) => {
            const name = cleanText($(element).text());
            const id = sanitizeId(name);

            if (name.length === 0 || id.length === 0 || seen.has(id)) {
                return [];
            }
            seen.add(id);
            return [{ id, title: name }];
        });

    const ratingText = ratingFrom($(".section-status .row.align-center .text.grey.normal").text());

    return {
        mangaId,
        mangaInfo: {
            primaryTitle: title,
            secondaryTitles,
            thumbnailUrl,
            synopsis: cleanText($(".story-desc").first().text()),
            author: author.length > 0 ? author : undefined,
            status: status.length > 0 ? status : "Unknown",
            // The site rates out of five; the app expects a fraction of one.
            rating:
                ratingText === undefined
                    ? undefined
                    : Math.min(1, Math.max(0, Number.parseFloat(ratingText) / 5)),
            contentRating: contentRatingForGenres(tags.map((tag) => tag.title)),
            tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
        },
    };
}

export function parseChapterList(html: string, sourceManga: SourceManga): Chapter[] {
    const $ = Application.loadDocument(html);

    const entries = $(".chapters-container a[href]")
        .toArray()
        .flatMap((element) => {
            const chapterId = chapterIdFromHref($(element).attr("href"));
            return chapterId === undefined ? [] : [{ chapterId, label: cleanText($(element).text()) }];
        });

    const seen = new Set<string>();
    const total = entries.length;

    const chapters = entries.flatMap((entry, index) => {
        if (seen.has(entry.chapterId)) {
            return [];
        }
        seen.add(entry.chapterId);

        return [
            {
                chapterId: entry.chapterId,
                sourceManga,
                langCode: "🇬🇧",
                // An unnumbered chapter still sorts by its place in the list.
                chapNum: chapterNumberFrom(entry.label) ?? total - index,
                volume: 0,
                // The list runs newest first; the app wants oldest lowest.
                sortingIndex: total - index,
            },
        ];
    });

    if (chapters.length === 0) {
        throw new Error(`No chapters were found for ${sourceManga.mangaInfo.primaryTitle}.`);
    }
    return chapters;
}

export function parseReaderPages(html: string, baseUrl: string, chapter: Chapter): ChapterDetails {
    const $ = Application.loadDocument(html);

    const pages = $(".reading-container img")
        .toArray()
        .map((element) => absoluteUrl(baseUrl, $(element).attr("data-src") ?? $(element).attr("src") ?? ""))
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
