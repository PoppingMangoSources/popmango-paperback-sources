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

import { ADULT_GENRES, type KaliCard } from "./models";
import { absoluteUrl, baseUrl } from "./site";

/** Characters the app refuses to accept inside an id. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

function sanitizeId(value: string): string {
    return value.toLowerCase().replace(UNSAFE_ID, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// Slugs double as ids; unusual characters are percent-encoded so the original
// slug can always be recovered for request URLs. Characters the encoder leaves
// unchanged still fall back to a dash so the id always lands in the safe set.
export function encodeSlugId(slug: string): string {
    return slug.replace(UNSAFE_ID, (char) => {
        const encoded = encodeURIComponent(char);
        return encoded !== char ? encoded : "-";
    });
}

export function decodeSlugId(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function cleanText(value: string): string {
    return Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();
}

/** Card links arrive as /manga/{id-slug} or manga/{id-slug}; keep the slug. */
function mangaSlugFromUrl(url: string): string | undefined {
    return /(?:^|\/)manga\/([^/?#]+)/.exec(url)?.[1];
}

export function contentRatingForGenres(genres: string[], isAdult = false): ContentRating {
    if (isAdult) {
        return ContentRating.ADULT;
    }

    const normalised = genres.map((genre) => genre.trim().toLowerCase());
    return normalised.some((genre) => ADULT_GENRES.includes(genre))
        ? ContentRating.ADULT
        : ContentRating.MATURE;
}

function chapterNumberFrom(value: string): number | undefined {
    const match = /chapter[.\s-]*(\d+(?:\.\d+)?)/i.exec(value);
    return match !== null ? parseFloat(match[1] ?? "0") : undefined;
}

// Site timestamps are zoneless and mostly relative ("2 hours ago"); parse both
// forms as UTC and clamp anything ahead of the clock so ages never go negative.
const RELATIVE_UNITS: Array<[string, number]> = [
    ["second", 1_000],
    ["minute", 60_000],
    ["hour", 3_600_000],
    ["day", 86_400_000],
    ["week", 604_800_000],
    ["month", 2_629_800_000],
    ["year", 31_557_600_000],
];

function parseSiteDate(value: string): Date | undefined {
    const text = value.trim().toLowerCase();
    if (text.length === 0) {
        return undefined;
    }
    if (text === "just now" || text.includes("less than")) {
        return new Date();
    }

    if (text.includes("ago")) {
        const count = Number(/\d+/.exec(text)?.[0] ?? 0);
        const unit = RELATIVE_UNITS.find(([name]) => text.includes(name))?.[1];
        return unit !== undefined ? new Date(Date.now() - count * unit) : undefined;
    }

    const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    const date =
        ymd !== null
            ? new Date(
                  Date.UTC(
                      Number(ymd[1]),
                      Number(ymd[2]) - 1,
                      Number(ymd[3]),
                      Number(ymd[4] ?? 0),
                      Number(ymd[5] ?? 0),
                      Number(ymd[6] ?? 0),
                  ),
              )
            : new Date(value);

    if (isNaN(date.getTime())) {
        return undefined;
    }
    return date.getTime() > Date.now() ? new Date() : date;
}

function coverFrom(element: Cheerio<AnyNode>): string {
    const img = element.find("img").first();
    const source =
        img.attr("data-src") ??
        img.attr("data-lazy-src") ??
        img.attr("data-cfsrc") ??
        img.attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0] ??
        img.attr("src") ??
        "";

    // A "/static/" path is the site's own placeholder, not a cover.
    return source.length > 0 && !source.includes("/static/") ? absoluteUrl(source) : "";
}

/** The listing embeds each card's real values as JSON beside the markup. */
interface EmbeddedData {
    name?: string;
    url?: string;
    cover?: string;
    rating?: string;
    views?: string;
    summary?: string;
    updated_at?: string;
    is_adult?: number | boolean;
    genres?: Array<{ name?: string }>;
}

function isEmbeddedData(value: unknown): value is EmbeddedData {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const record = value as Record<string, unknown>;
    const strings = ["name", "url", "cover", "rating", "views", "summary", "updated_at"];
    if (strings.some((key) => record[key] !== undefined && record[key] !== null && typeof record[key] !== "string")) {
        return false;
    }

    if (
        record.is_adult !== undefined &&
        record.is_adult !== null &&
        typeof record.is_adult !== "number" &&
        typeof record.is_adult !== "boolean"
    ) {
        return false;
    }

    if (record.genres === undefined || record.genres === null) {
        return true;
    }

    return (
        Array.isArray(record.genres) &&
        record.genres.every((genre) => {
            if (genre === null || typeof genre !== "object" || Array.isArray(genre)) {
                return false;
            }
            const name = (genre as Record<string, unknown>).name;
            return name === undefined || name === null || typeof name === "string";
        })
    );
}

function embeddedData(item: Cheerio<AnyNode>): EmbeddedData | undefined {
    const raw = item.find("script#json-data").first().text().trim();
    if (raw.length === 0) {
        return undefined;
    }

    try {
        const value: unknown = JSON.parse(raw);
        return isEmbeddedData(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function cardFrom($: CheerioAPI, element: AnyNode): KaliCard | undefined {
    const item = $(element);
    const data = embeddedData(item);
    const link = item.find(".title a, h3 a, h4 a, a").first();
    const url = data?.url ?? link.attr("href") ?? "";

    if (mangaSlugFromUrl(url) === undefined) {
        return undefined;
    }

    const title = cleanText(data?.name ?? item.find(".title, .name, h3, h4").first().text());
    if (title.length === 0) {
        return undefined;
    }

    const chapterLink = item.find('a[href*="chapter"]').first();
    const markupGenres = item
        .find(".genres span, .genres a")
        .toArray()
        .map((genre) => cleanText($(genre).text()))
        .filter((genre) => genre.length > 0);
    const embeddedGenres = (data?.genres ?? [])
        .map((genre) => genre.name ?? "")
        .filter((genre) => genre.length > 0);

    return {
        url,
        title,
        cover: data?.cover !== undefined ? absoluteUrl(data.cover) : coverFrom(item),
        latestChapter:
            cleanText(item.find(".latest-chapter").first().text()) ||
            cleanText(chapterLink.text()) ||
            undefined,
        latestChapterUrl: chapterLink.attr("href"),
        views: cleanText(data?.views ?? item.find(".views span, .views").first().text()) || undefined,
        rating:
            (data?.rating ?? cleanText(item.find(".rating .score, .rating").first().text())).replace(
                /[^\d.]/g,
                "",
            ) || undefined,
        genres: embeddedGenres.length > 0 ? embeddedGenres : markupGenres,
        summary: cleanText(data?.summary ?? item.find(".summary p, .summary").first().text()),
        updatedAt: data?.updated_at,
        isAdult: data?.is_adult === 1 || data?.is_adult === true,
    };
}

function collectCards(html: string, selector: string, requireCover: boolean): KaliCard[] {
    const $ = Application.loadDocument(html);
    const cards: KaliCard[] = [];
    const seen = new Set<string>();

    for (const element of $(selector).toArray()) {
        const card = cardFrom($, element);
        if (card === undefined) {
            continue;
        }
        if (requireCover && card.cover.length === 0) {
            continue;
        }

        const slug = mangaSlugFromUrl(card.url);
        if (slug === undefined || seen.has(slug)) {
            continue;
        }

        seen.add(slug);
        cards.push(card);
    }

    return cards;
}

export function parseCards(html: string): KaliCard[] {
    return collectCards(html, ".book-detailed-item, .book-item", false);
}

export function parseHotCells(html: string): KaliCard[] {
    return collectCards(html, ".trending-item", true);
}

function ratingText(card: KaliCard): string | undefined {
    const value = card.rating !== undefined ? parseFloat(card.rating) : NaN;
    return isFinite(value) && value > 0 ? value.toFixed(1) : undefined;
}

export function toFeaturedItems(cards: KaliCard[]): DiscoverSectionItem[] {
    return cards.flatMap((card) => {
        const slug = mangaSlugFromUrl(card.url);
        if (slug === undefined) {
            return [];
        }

        const rating = ratingText(card);

        return [
            {
                type: "featuredCarouselItem" as const,
                mangaId: encodeSlugId(slug),
                imageUrl: card.cover,
                title: card.title,
                // 0.9 gave this tile a genre line, a summary and a row of
                // counters. 0.8 has one line, so it carries the score and the
                // views and the rest is left to the details page.
                subtitle:
                    [rating !== undefined ? `${rating} ★` : "", card.views ?? ""]
                        .filter((part) => part.length > 0)
                        .join(" • ") || undefined,
            },
        ];
    });
}

export function toRankedItems(
    cards: KaliCard[],
    detail: "chapter" | "views" | "rating",
    ranked = true,
): DiscoverSectionItem[] {
    return cards.flatMap((card, index) => {
        const slug = mangaSlugFromUrl(card.url);
        if (slug === undefined) {
            return [];
        }

        const rating = ratingText(card);
        const lead =
            detail === "chapter"
                ? card.latestChapter
                : detail === "views"
                  ? card.views && `${card.views} views`
                  : rating && `${rating} ★`;

        return [
            {
                type: "simpleCarouselItem" as const,
                mangaId: encodeSlugId(slug),
                imageUrl: card.cover,
                title: card.title,
                subtitle:
                    [ranked ? `#${index + 1}` : "", lead ?? ""]
                        .filter((part) => part.length > 0)
                        .join(" • ") || undefined,
            },
        ];
    });
}

export function toLatestItems(cards: KaliCard[]): DiscoverSectionItem[] {
    return cards.flatMap((card) => {
        const slug = mangaSlugFromUrl(card.url);
        if (slug === undefined) {
            return [];
        }

        const chapNum = card.latestChapter !== undefined ? chapterNumberFrom(card.latestChapter) : undefined;
        const chapterSlug =
            card.latestChapterUrl !== undefined
                ? (card.latestChapterUrl.split("/").pop() ?? "").replace(/[?#].*$/, "")
                : chapNum !== undefined
                  ? `chapter-${chapNum}`
                  : undefined;

        if (chapterSlug === undefined || chapterSlug.length === 0) {
            return [];
        }

        const rating = ratingText(card);

        return [
            {
                type: "chapterUpdatesCarouselItem" as const,
                mangaId: encodeSlugId(slug),
                chapterId: encodeSlugId(chapterSlug),
                imageUrl: card.cover,
                title: card.title,
                subtitle:
                    [
                        chapNum !== undefined ? `Ch. ${chapNum}` : (card.latestChapter ?? ""),
                        rating !== undefined ? `${rating} ★` : "",
                    ]
                        .filter((part) => part.length > 0)
                        .join(" • ") || undefined,
                publishDate: card.updatedAt !== undefined ? parseSiteDate(card.updatedAt) : undefined,
            },
        ];
    });
}

export function toSearchResultItems(cards: KaliCard[]): SearchResultItem[] {
    return cards.flatMap((card) => {
        const slug = mangaSlugFromUrl(card.url);
        if (slug === undefined) {
            return [];
        }

        const rating = ratingText(card);

        return [
            {
                mangaId: encodeSlugId(slug),
                title: card.title,
                imageUrl: card.cover,
                subtitle:
                    [rating !== undefined ? `${rating} ★` : "", card.genres[0] ?? ""]
                        .filter((part) => part.length > 0)
                        .join(" • ") || undefined,
                contentRating: contentRatingForGenres(card.genres, card.isAdult),
            },
        ];
    });
}

export function hasNextPage(html: string): boolean {
    const $ = Application.loadDocument(html);
    return $(".paginator > a.active + a:not([rel=next]), .pagination a[rel=next]").length > 0;
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
    const $ = Application.loadDocument(html);

    const title = cleanText($(".detail h1, .name h1").first().text());
    if (title.length === 0) {
        throw new Error(`No details were found for ${mangaId}.`);
    }

    const authors = $('.detail .meta > p > strong:contains("Authors") ~ a')
        .toArray()
        .map((element) => cleanText($(element).text()))
        .filter((author) => author.length > 0);

    const genres = $('.detail .meta > p > strong:contains("Genres") ~ a')
        .toArray()
        .map((element) =>
            cleanText(
                $(element)
                    .text()
                    .replace(/[,\s]+$/, ""),
            ),
        )
        .filter((genre) => genre.length > 0);

    const statusText = cleanText($('.detail .meta > p > strong:contains("Status") ~ a').first().text());

    // The inline cover is a lazy-loading placeholder; the share image carries
    // the real full-size cover.
    const cover = $("#cover img").first();
    const thumbnailUrl =
        $('meta[property="og:image"]').attr("content") ?? cover.attr("data-src") ?? cover.attr("src") ?? "";

    // The first summary paragraph is boilerplate about the site; the story
    // description follows it.
    const summary = $(".summary p, .summary .content")
        .toArray()
        .map((element) => cleanText($(element).text()))
        .filter((text) => text.length > 0 && !/^you are reading\b/i.test(text))
        .join("\n\n");

    const secondaryTitles = cleanText($(".detail h2, .name h2").first().text())
        .split(/[,;]/)
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 0 && alias.toLowerCase() !== title.toLowerCase());

    const seen = new Set<string>();
    const tags: Tag[] = genres.flatMap((genre) => {
        const id = sanitizeId(genre);
        if (id.length === 0 || seen.has(id)) {
            return [];
        }
        seen.add(id);
        return [{ id, title: genre }];
    });

    const score = cleanText($(".rating .score, #score-board").first().text()).replace(/[^\d.]/g, "");
    const scored = parseFloat(score);
    const rating = score.length > 0 && scored > 0 ? Math.min(1, Math.max(0, scored / 5)) : undefined;

    return {
        mangaId,
        mangaInfo: {
            primaryTitle: title,
            secondaryTitles,
            thumbnailUrl: thumbnailUrl.length > 0 ? absoluteUrl(thumbnailUrl) : "",
            synopsis: summary,
            author: authors.join(", ") || undefined,
            status: statusText.length > 0 ? statusText.charAt(0).toUpperCase() + statusText.slice(1) : "Unknown",
            rating: rating !== undefined && isFinite(rating) ? rating : undefined,
            contentRating: contentRatingForGenres(genres),
            tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
        },
    };
}

export function parseChapterList(html: string, sourceManga: SourceManga): Chapter[] {
    const $ = Application.loadDocument(html);
    const rows = $("#chapter-list > li, .chapter-list > li").toArray();

    const chapters = rows.flatMap((element, index) => {
        const row = $(element);
        const url = row.find("a").first().attr("href") ?? "";
        const chapterId = url
            .split("/")
            .filter((part) => part.length > 0)
            .pop()
            ?.replace(/[?#].*$/, "");

        if (chapterId === undefined || chapterId.length === 0) {
            return [];
        }

        const name = cleanText(row.find(".chapter-title").first().text());
        const chapNum = chapterNumberFrom(name) ?? chapterNumberFrom(chapterId) ?? rows.length - index;
        const dateText = cleanText(row.find(".chapter-update").first().text());

        return [
            {
                chapterId: encodeSlugId(chapterId),
                sourceManga,
                langCode: "🇬🇧",
                chapNum,
                // A name that only repeats the number is noise beside it.
                title: name.length > 0 && !/^chapter[.\s-]*[\d.]+$/i.test(name) ? name : undefined,
                volume: 0,
                sortingIndex: rows.length - index,
                publishDate: dateText.length > 0 ? parseSiteDate(dateText) : undefined,
            },
        ];
    });

    if (chapters.length === 0) {
        throw new Error(`No chapters were found for ${sourceManga.mangaId}.`);
    }
    return chapters;
}

export function parseChapterPages(html: string, chapter: Chapter): ChapterDetails {
    const $ = Application.loadDocument(html);

    let pages = $("#chapter-images img, .chapter-image, .chapter-image img, .chapter-lazy-image")
        .toArray()
        .map((element) => {
            const image = $(element);
            return (
                image.attr("data-src") ??
                image.attr("data-lazy-src") ??
                image.attr("data-cfsrc") ??
                image.attr("src") ??
                ""
            );
        })
        .filter((url) => url.length > 0 && !url.includes("/static/"));

    if (pages.length === 0) {
        // Older chapters ship their page list in a script variable instead.
        const list = /var\s+chapImages\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1];
        if (list !== undefined) {
            const server = /var\s+mainServer\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1] ?? "";
            pages = list
                .split(",")
                .map((path) => path.trim())
                .filter((path) => path.length > 0)
                .map((path) => {
                    if (path.startsWith("http")) {
                        return path;
                    }
                    const prefix = server.startsWith("//") ? `https:${server}` : server;
                    return `${prefix}${path}`;
                });
        }
    }

    // Signed CDN queries must keep their ampersands intact; re-encoded entities
    // break the signature and the CDN answers 403.
    pages = pages.map((url) => Application.decodeHTMLEntities(url).replace(/ /g, "%20"));

    if (pages.length === 0) {
        throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
    }

    return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        pages: [...new Set(pages)],
    };
}

export function mangaUrl(mangaId: string): string {
    return `${baseUrl()}/manga/${decodeSlugId(mangaId)}`;
}
