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
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import { DOMAIN, LOCK_SUFFIX, type ComicCard, type Genre } from "./models";

const MONTHS: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * Escapes a path so it survives being stored and replayed as an id.
 *
 * Ids here are whole paths rather than slugs, so anything outside the app's
 * accepted set is percent-encoded.
 */
function toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (character) => {
        const encoded = encodeURIComponent(character);
        return encoded !== character
            ? encoded
            : `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
    });
}

export function safeDecode(id: string): string {
    try {
        return decodeURIComponent(id);
    } catch {
        return id;
    }
}

export function parsePath(href: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const slug = cleaned.startsWith("http")
        ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
        : cleaned.replace(/^\/+/, "");
    return toSafeId(slug);
}

function absoluteUrl(source: string): string {
    const value = (source ?? "").trim();

    if (value.length === 0) {
        return "";
    }
    if (value.startsWith("http")) {
        return value;
    }
    if (value.startsWith("//")) {
        return `https:${value}`;
    }
    return value.startsWith("/") ? `${DOMAIN}${value}` : `${DOMAIN}/${value}`;
}

function imageUrlFrom(image: Cheerio<AnyNode>): string {
    return absoluteUrl(image.attr("data-src") ?? image.attr("data-lazy-src") ?? image.attr("src") ?? "");
}

function text(value: string | undefined): string {
    return Application.decodeHTMLEntities((value ?? "").trim());
}

/** The chapter endpoint refuses requests without the page's own token. */
export function extractNonce($: CheerioAPI): string | undefined {
    return $.html().match(/comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/)?.[1];
}

/** Home page timestamps are relative, e.g. "2 weeks" or "5 hours". */
function parseRelativeDate(value: string): Date | undefined {
    const match = value.trim().match(/(\d+)\s*(min|hour|day|week|month|year)/i);
    if (match === null) {
        return undefined;
    }

    const unitMs: Record<string, number> = {
        min: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        week: 604_800_000,
        month: 2_629_800_000,
        year: 31_557_600_000,
    };

    const amount = Number.parseInt(match[1] ?? "", 10);
    const factor = unitMs[(match[2] ?? "").toLowerCase()];
    return factor === undefined ? undefined : new Date(Date.now() - amount * factor);
}

function joinDetails(parts: Array<string | undefined>): string | undefined {
    const joined = parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ");
    return joined.length > 0 ? joined : undefined;
}

/**
 * Reads the weekly chart.
 *
 * 0.8 tiles carry one subtitle line, so the rank, views and chapter count are
 * joined into it.
 */
export function toHotItems($: CheerioAPI): DiscoverSectionItem[] {
    const items: DiscoverSectionItem[] = [];

    for (const element of $(".popular-comics .comic-card-popular").toArray()) {
        const card = $(element);
        const mangaId = parsePath((card.find("a.read-btn").first().attr("href") ?? "").trim());
        const title = text(card.find(".comic-title-popular").first().text());

        if (mangaId.length === 0 || title.length === 0) {
            continue;
        }

        const rank = card.find(".comic-rank").first().text().trim();
        const [views, chapters] = card
            .find(".comic-stats .stat")
            .toArray()
            .map((stat) => $(stat).text().trim());

        items.push({
            mangaId,
            title,
            imageUrl: imageUrlFrom(card.find(".comic-cover img").first()),
            subtitle: joinDetails([
                rank.length > 0 ? `#${rank}` : undefined,
                views,
                chapters === undefined || chapters.length === 0 ? undefined : `${chapters} ch`,
            ]),
        });
    }

    return items;
}

/** The site's pinned picks, with their chapter-count badge. */
export function toPinnedItems($: CheerioAPI): DiscoverSectionItem[] {
    const items: DiscoverSectionItem[] = [];
    const seen = new Set<string>();

    for (const element of $("a.pinned-comic-card").toArray()) {
        const card = $(element);
        const mangaId = parsePath((card.attr("href") ?? "").trim());
        const title = text(card.find(".pinned-comic-title").first().text());

        if (mangaId.length === 0 || title.length === 0 || seen.has(mangaId)) {
            continue;
        }
        seen.add(mangaId);

        const badge = card.find(".chapter-badge").first().text().trim();
        items.push({
            mangaId,
            title,
            imageUrl: imageUrlFrom(card.find(".comic-thumbnail img").first()),
            subtitle: badge.length > 0 ? badge : undefined,
        });
    }

    return items;
}

/** Update cards, pointed at the newest chapter that is actually readable. */
export function toLatestItems($: CheerioAPI): DiscoverSectionItem[] {
    const items: DiscoverSectionItem[] = [];

    for (const element of $(".latest-releases .comic-card").toArray()) {
        const card = $(element);
        const mangaId = parsePath((card.find("a.comic-card__cover").first().attr("href") ?? "").trim());
        const title = text(card.find(".comic-card__title").first().text());

        if (mangaId.length === 0 || title.length === 0) {
            continue;
        }

        // Skip locked entries so the card opens something the reader can read.
        const chapter = card
            .find("a.chapter-item")
            .toArray()
            .map((entry) => $(entry))
            .find((entry) => !isLocked(entry) && (entry.attr("href") ?? "").includes("/chapter/"));

        if (chapter === undefined) {
            continue;
        }

        const label = chapter.find("label").first().text().trim();
        items.push({
            mangaId,
            title,
            imageUrl: imageUrlFrom(card.find(".comic-card__cover img").first()),
            subtitle: label.length > 0 ? label : undefined,
            chapterId: parsePath(chapter.attr("href") ?? ""),
            publishDate: parseRelativeDate(chapter.find("span").first().text()),
        });
    }

    return items;
}

export function parseComicCards($: CheerioAPI): ComicCard[] {
    const cards: ComicCard[] = [];
    const seen = new Set<string>();

    for (const element of $("article.ac-card").toArray()) {
        const card = $(element);
        const link = card.find(".ac-title a").first();
        const href = (link.attr("href") ?? "").trim();

        if (href.length === 0) {
            continue;
        }

        const mangaId = parsePath(href);
        const title = text(link.text());

        if (mangaId.length === 0 || title.length === 0 || seen.has(mangaId)) {
            continue;
        }
        seen.add(mangaId);

        cards.push({ mangaId, title, imageUrl: imageUrlFrom(card.find(".ac-thumb img").first()) });
    }

    return cards;
}

export function hasNextPage($: CheerioAPI): boolean {
    return $(".ac-pagination a.next").length > 0;
}

export function parseGenres($: CheerioAPI): Genre[] {
    const genres: Genre[] = [];
    const seen = new Set<string>();

    for (const element of $(".ac-filter-group.ac-genre input[name='genres[]']").toArray()) {
        const input = $(element);
        const slug = (input.attr("value") ?? "").trim();
        const name = text(input.parent().find(".ac-option-text").first().text());

        if (slug.length === 0 || name.length === 0 || seen.has(slug)) {
            continue;
        }
        seen.add(slug);
        genres.push({ slug, name });
    }

    return genres;
}

function parseStatus(status: string): string {
    const value = (status ?? "").trim().toLowerCase();

    if (value.includes("ongoing")) {
        return "Ongoing";
    }
    if (value.includes("completed")) {
        return "Completed";
    }
    if (value.includes("hiatus")) {
        return "Hiatus";
    }
    if (value.includes("cancel")) {
        return "Cancelled";
    }
    return "Unknown";
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const primaryTitle = text(
        $(".comic-info-upper h1").first().text() || $("h1").first().text() || safeDecode(mangaId),
    );

    const authors: string[] = [];
    for (const element of $(".comic-graph > span").toArray()) {
        const value = $(element).text().trim();
        if (value.length > 0 && value !== "•" && !authors.includes(value)) {
            authors.push(value);
        }
    }

    const genreTags: Tag[] = [];
    const seenGenre = new Set<string>();

    for (const element of $(".comic-genres .genres .genre").toArray()) {
        const title = text($(element).text());
        if (title.length === 0) {
            continue;
        }

        const id = title.toLowerCase().replace(/\s+/g, "-");
        if (seenGenre.has(id)) {
            continue;
        }
        seenGenre.add(id);
        genreTags.push({ id, title });
    }

    const tagGroups: TagSection[] =
        genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : [];

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles: [],
            thumbnailUrl: absoluteUrl($("meta[property=og:image]").first().attr("content") ?? ""),
            synopsis: text(
                $(".comic-synopsis").first().text() ||
                    $("meta[property=og:description]").first().attr("content") ||
                    "",
            ),
            author: authors[0],
            artist: authors[1],
            status: parseStatus($(".comic-status span:last-child").first().text()),
            contentRating: ContentRating.EVERYONE,
            tagGroups,
        },
    };
}

function parseChapterNumber(name: string): number {
    const match = name.match(/(\d+(?:\.\d+)?)/);
    return match === null ? 0 : Number.parseFloat(match[1] ?? "");
}

function parseDate(value: string): Date | undefined {
    const trimmed = (value ?? "").trim();
    if (trimmed.length === 0) {
        return undefined;
    }

    const match = trimmed.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (match !== null) {
        const month = MONTHS[(match[1] ?? "").toLowerCase()];
        if (month !== undefined) {
            return new Date(
                Date.UTC(Number.parseInt(match[3] ?? "", 10), month, Number.parseInt(match[2] ?? "", 10)),
            );
        }
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function elementHref(element: Cheerio<AnyNode>): string {
    const own = (element.attr("href") ?? "").trim();
    return own.length > 0 ? own : (element.find("a").first().attr("href") ?? "").trim();
}

/** A chapter the site will not serve without a purchase. */
function isLocked(element: Cheerio<AnyNode>): boolean {
    const reason = (element.attr("data-reason") ?? "").toLowerCase();

    if (reason.length > 0 && reason !== "free") {
        return true;
    }
    if (element.hasClass("locked-chapter") || element.hasClass("is-locked")) {
        return true;
    }

    const href = elementHref(element);
    if (href.length === 0 || href === "#") {
        return true;
    }
    return element.find(".chapter_price").length > 0;
}

export function parseChapterElements(
    $: CheerioAPI,
    elements: Cheerio<AnyNode>,
    sourceManga: SourceManga,
): Chapter[] {
    const chapters: Chapter[] = [];

    elements.each((_, element) => {
        const row = $(element);
        const permalink = (row.attr("data-permalink") ?? "").trim();
        const href = elementHref(row);
        const rawUrl = (permalink !== "#" ? permalink : "") || (href !== "#" ? href : "");
        const postId = (row.attr("data-post-id") ?? "").trim();

        if (rawUrl.length === 0 && postId.length === 0) {
            return;
        }

        const locked = isLocked(row);
        const name = text(
            row.find(".chapter-number").first().text() ||
                row.find(".ch-name").first().text() ||
                row.find(".chapter-side-title").first().text() ||
                (row.attr("data-title") ?? "").trim() ||
                row.find("label").first().text(),
        );

        let title = name.replace(/^chapter\s+\d+(?:\.\d+)?(?:\s*[-:]\s*)?/i, "").trim();

        // A locked chapter may expose no URL at all; a synthetic id keeps it
        // listed while staying unreadable.
        let chapterId = rawUrl.length > 0 ? parsePath(rawUrl) : `locked-${postId}`;
        if (locked) {
            title = title.length > 0 ? `${title} 🔒` : "🔒";
            chapterId += LOCK_SUFFIX;
        }

        chapters.push({
            chapterId,
            sourceManga,
            title,
            volume: 0,
            chapNum: parseChapterNumber(name),
            publishDate: parseDate(row.find(".chapter-date").first().text()),
            langCode: "🇬🇧",
        });
    });

    return chapters;
}

/** Numbers any unnumbered chapter by its place and sets the sort order. */
export function finaliseChapters(chapters: Chapter[]): Chapter[] {
    const total = chapters.length;

    return chapters.map((chapter, index) => ({
        ...chapter,
        chapNum: chapter.chapNum || total - index,
        // The list runs newest first; the app wants oldest lowest.
        sortingIndex: total - index,
    }));
}

export function parseChapterDetails($: CheerioAPI, chapter: Chapter): ChapterDetails {
    const pages: string[] = [];

    for (const element of $("img.chapter-image").toArray()) {
        const source = ($(element).attr("data-src") ?? $(element).attr("src") ?? "").trim();
        if (source.length > 0) {
            pages.push(absoluteUrl(source));
        }
    }

    if (pages.length === 0) {
        throw new Error("This chapter is locked or has no pages.");
    }

    return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        pages,
    };
}
