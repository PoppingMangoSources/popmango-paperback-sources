/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { AnyNode } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";

import {
    Application,
    ContentRating,
    parseDate,
    type Chapter,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import {
    ADULT_GENRE_NAMES,
    ARTIST_SELECTOR,
    AUTHOR_SELECTOR,
    CARD_IMAGE_SELECTOR,
    CARD_LATEST_SELECTOR,
    CARD_LINK_SELECTOR,
    CARD_TITLE_SELECTOR,
    CHAPTER_DATE_SELECTOR,
    CHAPTER_FALLBACK_SELECTOR,
    CHAPTER_SELECTOR,
    DESC_SELECTOR,
    GENRE_OPTION_SELECTOR,
    GENRE_SELECTOR,
    PAGE_SELECTOR,
    STATUS_SELECTOR,
    THUMB_SELECTOR,
    TITLE_SELECTOR,
    type MangaCard,
    type OptionItem,
} from "./models";

/** Characters that are safe to keep in an id the app will store and replay. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function extractMangaId(href: string): string | undefined {
    return (
        href.match(/\/manga\/([a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])(?:[/?#]|$)/)?.[1] ??
        href.match(/\/manga\/([a-zA-Z0-9-]+)/)?.[1]
    );
}

function absoluteUrl(base: string, source: string): string {
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
    return value.startsWith("/") ? `${base}${value}` : `${base}/${value}`;
}

/** The theme lazy-loads covers, so the real URL sits in a data attribute. */
function imageUrlFrom(base: string, image: Cheerio<AnyNode>): string {
    if (image.length === 0) {
        return "";
    }

    const source =
        image.attr("data-src") ??
        image.attr("data-lazy-src") ??
        image.attr("data-cfsrc") ??
        image.attr("src") ??
        "";

    return absoluteUrl(base, source);
}

function parseCard($: CheerioAPI, base: string, element: AnyNode): MangaCard | undefined {
    const unit = $(element);
    const link = unit.find(CARD_LINK_SELECTOR).first();
    const href = (link.attr("href") ?? "").trim();

    if (href.length === 0) {
        return undefined;
    }

    const mangaId = extractMangaId(href);
    if (mangaId === undefined) {
        return undefined;
    }

    const title = Application.decodeHTMLEntities(
        (unit.find(CARD_TITLE_SELECTOR).first().text() || link.attr("title") || "").trim(),
    );
    if (title.length === 0) {
        return undefined;
    }

    let imageUrl = imageUrlFrom(base, unit.find(CARD_IMAGE_SELECTOR).first());
    if (imageUrl.length === 0) {
        // Some cards paint the cover as a background rather than an image.
        imageUrl = absoluteUrl(base, unit.find(".comic-image").first().attr("data-background-image") ?? "");
    }

    const latest = unit.find(CARD_LATEST_SELECTOR).first().text().trim();

    return {
        mangaId,
        title,
        imageUrl,
        subtitle: latest.length > 0 ? latest : undefined,
    };
}

export function parseCards($: CheerioAPI, base: string): MangaCard[] {
    const cards: MangaCard[] = [];
    const seen = new Set<string>();

    for (const element of $(".comic-item").toArray()) {
        const card = parseCard($, base, element);
        if (card !== undefined && !seen.has(card.mangaId)) {
            seen.add(card.mangaId);
            cards.push(card);
        }
    }

    return cards;
}

/** Reads the genre checkboxes off the search form. */
export function parseGenres($: CheerioAPI): OptionItem[] {
    const genres: OptionItem[] = [];
    const seen = new Set<string>();

    for (const element of $(GENRE_OPTION_SELECTOR).toArray()) {
        const checkbox = $(element);
        const id = checkbox.attr("data-value")?.trim();
        const name = Application.decodeHTMLEntities(
            checkbox.parent().find("label").first().text().replace(/\s+/g, " ").trim(),
        );

        if (id === undefined || id.length === 0 || name.length === 0 || seen.has(id)) {
            continue;
        }
        seen.add(id);
        genres.push({ id, value: name });
    }

    return genres.sort((left, right) => left.value.localeCompare(right.value));
}

/** Collects the text of every match, dropping the theme's placeholders. */
function collectText($: CheerioAPI, selector: string): string[] {
    const values: string[] = [];

    $(selector).each((_, element) => {
        const text = $(element).text().trim();
        const lowered = text.toLowerCase();
        if (text.length > 0 && text !== "-" && lowered !== "n/a" && lowered !== "updating") {
            values.push(text);
        }
    });

    return values;
}

export function parseMangaDetails(
    $: CheerioAPI,
    base: string,
    mangaId: string,
    defaultRating: ContentRating,
): SourceManga {
    const primaryTitle = Application.decodeHTMLEntities(
        $(TITLE_SELECTOR).first().text().trim() || safeDecode(mangaId),
    );

    let synopsis = "";
    $(DESC_SELECTOR).each((_, element) => {
        const text = $(element).text().trim();
        if (text.length > 0) {
            synopsis += (synopsis.length > 0 ? "\n" : "") + text;
        }
    });

    const genreTags: Tag[] = [];
    const seenGenre = new Set<string>();

    $(GENRE_SELECTOR).each((_, element) => {
        const anchor = $(element);
        const title = Application.decodeHTMLEntities(anchor.text().trim());
        if (title.length === 0) {
            return;
        }

        const id = genreIdFromAnchor(anchor.attr("href") ?? "", title);
        if (seenGenre.has(id)) {
            return;
        }
        seenGenre.add(id);
        genreTags.push({ id, title });
    });

    const tagGroups: TagSection[] =
        genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : [];

    const isAdult = genreTags.some((tag) => ADULT_GENRE_NAMES.has(tag.title.trim().toLowerCase()));
    const author = collectText($, AUTHOR_SELECTOR).join(", ");
    const artist = collectText($, ARTIST_SELECTOR).join(", ");

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles: [],
            thumbnailUrl: imageUrlFrom(base, $(THUMB_SELECTOR).first()),
            synopsis: Application.decodeHTMLEntities(synopsis),
            author: author.length > 0 ? author : undefined,
            artist: artist.length > 0 ? artist : undefined,
            status: parseStatus($(STATUS_SELECTOR).last().text().trim()),
            contentRating: isAdult ? ContentRating.ADULT : defaultRating,
            tagGroups,
        },
    };
}

/**
 * Works out a stable id for a genre link.
 *
 * The site numbers its genres, so the number is preferred wherever the link
 * carries one; a slug built from the name is only a last resort.
 */
function genreIdFromAnchor(href: string, title: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const last = cleaned.split("/").pop() ?? "";

    if (/^\d+$/.test(last)) {
        return last;
    }

    const query = href.match(/genre(?:\[\])?=(\d+)/);
    if (query !== null) {
        return query[1] ?? "";
    }

    return title.toLowerCase().replace(/\s+/g, "-").replace(UNSAFE_ID, "-");
}

function parseStatus(status: string): string {
    const value = (status ?? "").toLowerCase().trim();

    if (value.length === 0) {
        return "Unknown";
    }
    if (value.includes("complet") || value.includes("finish")) {
        return "Completed";
    }
    if (value.includes("ongoing") || value.includes("on going") || value.includes("updating")) {
        return "Ongoing";
    }
    if (value.includes("hiatus") || value.includes("pause")) {
        return "Hiatus";
    }
    if (value.includes("cancel") || value.includes("drop")) {
        return "Cancelled";
    }
    return "Unknown";
}

export function parseChapters($: CheerioAPI, base: string, sourceManga: SourceManga): Chapter[] {
    let elements = $(CHAPTER_SELECTOR).toArray();
    if (elements.length === 0) {
        elements = $(CHAPTER_FALLBACK_SELECTOR).toArray();
    }

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const element of elements) {
        const row = $(element);
        const href = (row.attr("href") ?? row.find("a").first().attr("href") ?? "").trim();
        if (href.length === 0) {
            continue;
        }

        // Chapter pages live at arbitrary paths here, so the whole URL is the id.
        const chapterId = absoluteUrl(base, href);
        if (chapterId.length === 0 || seen.has(chapterId)) {
            continue;
        }
        seen.add(chapterId);

        const title = Application.decodeHTMLEntities(
            row.find("span").first().text().trim() ||
                row.find("p:not(.small)").first().text().trim() ||
                row.text().trim(),
        );

        chapters.push({
            chapterId,
            sourceManga,
            title,
            volume: 0,
            chapNum: parseChapterNumber(title),
            publishDate: parseDate(row.find(CHAPTER_DATE_SELECTOR).first().text().trim()),
            langCode: "🇬🇧",
        });
    }

    // The list runs newest first; the app wants oldest lowest.
    return chapters.map((chapter, index) => ({ ...chapter, sortingIndex: chapters.length - index }));
}

function parseChapterNumber(name: string): number {
    const match = name.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i) ?? name.match(/(\d+(?:\.\d+)?)/);
    const value = match === null ? Number.NaN : Number.parseFloat(match[1] ?? "");
    return Number.isFinite(value) ? value : 0;
}

export function parseChapterPages($: CheerioAPI, base: string): string[] {
    const pages: string[] = [];
    const seen = new Set<string>();

    for (const element of $(PAGE_SELECTOR).toArray()) {
        const image = imageUrlFrom(base, $(element));

        // The reader's markup also carries the site's own furniture.
        if (image.length === 0 || seen.has(image) || /loading\.gif|\/(logo|icon|avatar|banner)/i.test(image)) {
            continue;
        }
        seen.add(image);
        pages.push(image);
    }

    return pages;
}
