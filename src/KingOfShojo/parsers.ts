/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import {
    Application,
    ContentRating,
    type Chapter,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import {
    ADULT_GENRE_NAMES,
    MANGA_DIR,
    type ImageMode,
    type LatestCard,
    type MangaCard,
    type OptionItem,
} from "./models";

const CARD_SELECTOR = ".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx, .bsx";

const DETAILS_SCOPE = "div.bigcontent, div.animefull, div.main-info, div.postbody";
const TITLE_SELECTOR = "h1.entry-title, .ts-breadcrumb li:last-child span";
const THUMB_SELECTOR = ".infomanga > div[itemprop=image] img, .thumb img";
const DESC_SELECTOR = ".desc, .entry-content[itemprop=description]";
const ALT_NAME_SELECTOR = ".alternative, .wd-full:contains(alt) span, .alter, .seriestualt";
const GENRE_SELECTOR = "div.gnr a, .mgen a, .seriestugenre a";
const AUTHOR_SELECTOR =
    ".infotable tr:contains(Author) td:last-child, .tsinfo .imptdt:contains(Author) i, .fmed b:contains(Author)+span";
const ARTIST_SELECTOR =
    ".infotable tr:contains(Artist) td:last-child, .tsinfo .imptdt:contains(Artist) i, .fmed b:contains(Artist)+span";
const STATUS_SELECTOR =
    ".infotable tr:contains(Status) td:last-child, .tsinfo .imptdt:contains(Status) i, .fmed b:contains(Status)+span";

const CHAPTER_SELECTOR = "div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)";
const CHAPTER_NAME_SELECTOR = ".lch a, .chapternum";
const CHAPTER_DATE_SELECTOR = ".chapterdate";
const PAGE_SELECTOR = "div#readerarea img";

// Written without the `s` flag, which the bundler's target does not accept.
const IMAGE_LIST = /"images"\s*:\s*(\[[\s\S]*?\])/;

const GENRE_FILTER_SELECTOR = "ul.genrez li";

const MONTHS: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
};

/** Escapes anything the app refuses to accept inside an id. */
function toSafeId(slug: string): string {
    return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/gu, (char) => {
        const encoded = encodeURIComponent(char);
        if (encoded !== char) {
            return encoded;
        }
        return "%" + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    });
}

function safeDecode(id: string): string {
    try {
        return decodeURIComponent(id);
    } catch {
        return id;
    }
}

export function parseMangaId(href: string): string {
    const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const marker = `/${MANGA_DIR}/`;
    const index = cleaned.indexOf(marker);
    const slug =
        index !== -1 ? (cleaned.slice(index + marker.length).split("/")[0] ?? "") : (cleaned.split("/").pop() ?? "");
    return toSafeId(slug);
}

/** A chapter's id is its whole path, since the site does not nest them. */
function parseChapterId(href: string): string {
    const cleaned = href
        .replace(/^(?:https?:)?\/\/[^/]+/i, "")
        .replace(/[?#].*$/, "")
        .replace(/^\/+|\/+$/g, "");
    return toSafeId(cleaned);
}

function absoluteUrl(base: string, src: string): string {
    const trimmed = (src || "").trim();
    if (trimmed.length === 0) {
        return "";
    }
    if (trimmed.startsWith("http")) {
        return trimmed;
    }
    if (trimmed.startsWith("//")) {
        return `https:${trimmed}`;
    }
    return trimmed.startsWith("/") ? `${base}${trimmed}` : `${base}/${trimmed}`;
}

/** Reads a cover out of an image element, preferring the largest offered. */
function imgAttr(base: string, img: Cheerio<AnyNode>): string {
    if (img.length === 0) {
        return "";
    }

    let src = img.attr("data-lazy-src") ?? img.attr("data-src") ?? img.attr("data-cfsrc") ?? "";

    if (src.length === 0) {
        const srcset = img.attr("srcset");
        if (srcset !== undefined) {
            const best = srcset
                .split(",")
                .map((part) => part.trim().split(/\s+/))
                .map(([url, width]) => ({
                    url: url ?? "",
                    width: parseInt((width ?? "0").replace(/\D/g, ""), 10) || 0,
                }))
                .sort((left, right) => right.width - left.width)[0];

            if (best !== undefined) {
                src = best.url;
            }
        }
    }

    if (src.length === 0) {
        src = img.attr("src") ?? "";
    }

    return absoluteUrl(base, src);
}

function cardTitle(unit: Cheerio<AnyNode>, link: Cheerio<AnyNode>): string {
    const img = unit.find("img").first();
    const raw =
        unit.find(".bigor .tt a, .tt").first().text().trim() ||
        img.attr("title") ||
        link.attr("title") ||
        link.text();
    return Application.decodeHTMLEntities((raw || "").trim());
}

function parseCard($: CheerioAPI, base: string, element: AnyNode): MangaCard | undefined {
    const unit = $(element);
    const link = unit.is("a") ? unit : unit.find("a").first();
    const href = (link.attr("href") ?? "").trim();
    if (href.length === 0) {
        return undefined;
    }

    const mangaId = parseMangaId(href);
    if (mangaId.length === 0) {
        return undefined;
    }

    const title = cardTitle(unit, link);
    if (title.length === 0) {
        return undefined;
    }

    const rating = unit.find(".numscore").first().text().trim();
    const chapter = unit.find(".epxs").first().text().trim();

    return {
        mangaId,
        title,
        imageUrl: imgAttr(base, unit.find("img").first()),
        subtitle: rating.length > 0 ? `★ ${rating}` : chapter || undefined,
        rating: rating || undefined,
    };
}

function dedupeCards(cards: Array<MangaCard | undefined>): MangaCard[] {
    const out: MangaCard[] = [];
    const seen = new Set<string>();

    for (const card of cards) {
        if (card !== undefined && !seen.has(card.mangaId)) {
            seen.add(card.mangaId);
            out.push(card);
        }
    }
    return out;
}

export function parseCards($: CheerioAPI, base: string): MangaCard[] {
    return dedupeCards($(CARD_SELECTOR).toArray().map((element) => parseCard($, base, element)));
}

/** The home page is a stack of widgets told apart only by their heading. */
function widgetByHeading($: CheerioAPI, heading: string): Cheerio<AnyNode> {
    return $(`.releases:contains("${heading}")`).first().closest(".bixbox, .section");
}

export function parseWidgetCards($: CheerioAPI, base: string, heading: string): MangaCard[] {
    return dedupeCards(
        widgetByHeading($, heading)
            .find(".bsx")
            .toArray()
            .map((element) => parseCard($, base, element)),
    );
}

export function parsePopularSeries($: CheerioAPI, base: string, rangeClass: string): MangaCard[] {
    const scope = widgetByHeading($, "Popular Series");
    const cards: MangaCard[] = [];
    const seen = new Set<string>();

    for (const element of scope
        .find(`.serieslist.${rangeClass} ul li, #wpop-items .${rangeClass} ul li`)
        .toArray()) {
        const row = $(element);
        const link = row.find("a.series").first();
        const href = (link.attr("href") ?? "").trim();
        if (href.length === 0) {
            continue;
        }

        const mangaId = parseMangaId(href);
        if (mangaId.length === 0 || seen.has(mangaId)) {
            continue;
        }

        const title = Application.decodeHTMLEntities(
            (row.find(".leftseries h2 a, .leftseries a.series").first().text() || link.attr("title") || "").trim(),
        );
        if (title.length === 0) {
            continue;
        }

        const isAdult = row
            .find('a[href*="/genres/"]')
            .toArray()
            .some((genre) => ADULT_GENRE_NAMES.has($(genre).text().trim().toLowerCase()));

        seen.add(mangaId);
        const rating = row.find(".numscore").first().text().trim();

        cards.push({
            mangaId,
            title,
            imageUrl: imgAttr(base, row.find("img").first()),
            subtitle: rating.length > 0 ? `★ ${rating}` : undefined,
            rating: rating || undefined,
            isAdult,
        });
    }

    return cards;
}

export function parseLatestUpdate($: CheerioAPI, base: string): LatestCard[] {
    const scope = widgetByHeading($, "Latest Update");
    const cards: LatestCard[] = [];
    const seen = new Set<string>();

    for (const element of scope.find(".bsx").toArray()) {
        const card = parseCard($, base, element);
        if (card === undefined || seen.has(card.mangaId)) {
            continue;
        }
        seen.add(card.mangaId);

        const firstChapter = $(element).find("ul.chfiv li a").first();
        const chapterHref = (firstChapter.attr("href") ?? "").trim();
        const chapterName = firstChapter.find(".fivchap").text().trim();
        const timeText = firstChapter.find(".fivtime").text().trim();

        cards.push({
            ...card,
            subtitle: chapterName || card.subtitle,
            chapterId: chapterHref.length > 0 ? parseChapterId(chapterHref) : undefined,
            chapterName: chapterName || undefined,
            publishDate: timeText.length > 0 ? parseSiteDate(timeText) : undefined,
        });
    }

    return cards;
}

/** The directory page publishes the genre list as its own filter checkboxes. */
export function parseGenreFilter($: CheerioAPI): OptionItem[] {
    const genres: OptionItem[] = [];
    const seen = new Set<string>();

    for (const element of $(GENRE_FILTER_SELECTOR).toArray()) {
        const row = $(element);
        const id = (row.find("input[type=checkbox]").attr("value") ?? "").trim();
        const name = Application.decodeHTMLEntities(row.find("label").text().trim());

        if (id.length === 0 || name.length === 0 || seen.has(id)) {
            continue;
        }
        seen.add(id);
        genres.push({ id, value: name });
    }

    return genres;
}

function collectText($: CheerioAPI, scope: Cheerio<AnyNode>, selector: string): string[] {
    const out: string[] = [];

    scope.find(selector).each((_, element) => {
        const text = $(element).text().trim();
        if (text.length > 0 && text !== "-" && text.toLowerCase() !== "n/a") {
            out.push(text);
        }
    });

    return out;
}

export function parseMangaDetails(
    $: CheerioAPI,
    base: string,
    mangaId: string,
    contentRating: ContentRating,
): SourceManga {
    const details = $(DETAILS_SCOPE).first();
    const scope = details.length > 0 ? details : $("html");

    const primaryTitle = Application.decodeHTMLEntities(
        scope.find(TITLE_SELECTOR).first().text().trim() || safeDecode(mangaId),
    );
    const thumbnailUrl = imgAttr(base, scope.find(THUMB_SELECTOR).first());

    let synopsis = "";
    scope.find(DESC_SELECTOR).each((_, element) => {
        const text = $(element).text().trim();
        if (text.length > 0) {
            synopsis += (synopsis.length > 0 ? "\n" : "") + text;
        }
    });
    synopsis = Application.decodeHTMLEntities(synopsis);

    const secondaryTitles: string[] = [];
    const altName = scope.find(ALT_NAME_SELECTOR).first().text().trim();
    for (const alias of altName.split(/[,;|]/)) {
        const trimmed = Application.decodeHTMLEntities(alias.trim());
        if (trimmed.length > 0) {
            secondaryTitles.push(trimmed);
        }
    }

    const genreTags: Tag[] = [];
    const seenGenre = new Set<string>();
    scope.find(GENRE_SELECTOR).each((_, element) => {
        const title = Application.decodeHTMLEntities($(element).text().trim());
        if (title.length === 0) {
            return;
        }
        const id = toSafeId(title.toLowerCase().replace(/\s+/g, "-"));
        if (seenGenre.has(id)) {
            return;
        }
        seenGenre.add(id);
        genreTags.push({ id, title });
    });

    const tagGroups: TagSection[] =
        genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : [];

    // A title carrying an explicit genre is rated explicit whatever the site
    // says about itself as a whole.
    const effectiveRating = genreTags.some((tag) => ADULT_GENRE_NAMES.has(tag.title.trim().toLowerCase()))
        ? ContentRating.ADULT
        : contentRating;

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles,
            thumbnailUrl,
            synopsis,
            author: collectText($, scope, AUTHOR_SELECTOR).join(", ") || undefined,
            artist: collectText($, scope, ARTIST_SELECTOR).join(", ") || undefined,
            status: parseStatus(scope.find(STATUS_SELECTOR).first().text().trim()),
            contentRating: effectiveRating,
            tagGroups,
        },
    };
}

function parseStatus(status: string): string {
    const text = (status || "").toLowerCase().trim();
    if (text.length === 0) {
        return "Unknown";
    }
    if (text.includes("complet") || text.includes("finished") || text.includes("tamat")) {
        return "Completed";
    }
    if (
        text.includes("ongoing") ||
        text.includes("on going") ||
        text.includes("publishing") ||
        text.includes("updating")
    ) {
        return "Ongoing";
    }
    if (text.includes("hiatus") || text.includes("hold") || text.includes("pause")) {
        return "Hiatus";
    }
    if (text.includes("cancel") || text.includes("drop") || text.includes("discontin")) {
        return "Cancelled";
    }
    return "Unknown";
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
    const chapters: Chapter[] = [];

    for (const element of $(CHAPTER_SELECTOR).toArray()) {
        const row = $(element);
        const link = row.is("a") ? row : row.find("a").first();
        const href = (link.attr("href") ?? "").trim();
        if (href.length === 0) {
            continue;
        }

        const chapterId = parseChapterId(href);
        if (chapterId.length === 0) {
            continue;
        }

        const title = Application.decodeHTMLEntities(
            row.find(CHAPTER_NAME_SELECTOR).first().text().trim() || link.text().trim(),
        );
        const dateText = row.find(CHAPTER_DATE_SELECTOR).first().text().trim();

        chapters.push({
            chapterId,
            sourceManga,
            title,
            chapNum: parseChapterNumber(title),
            volume: 0,
            publishDate: dateText.length > 0 ? parseSiteDate(dateText) : undefined,
            langCode: "🇬🇧",
        });
    }

    // The page lists newest first, which is the order the app wants reversed.
    return chapters.map((chapter, index) => ({ ...chapter, sortingIndex: chapters.length - index }));
}

function parseChapterNumber(name: string): number {
    const match = /chapter[.\s-]*(\d+(?:\.\d+)?)/i.exec(name) ?? /(\d+(?:\.\d+)?)/.exec(name);
    return match !== null ? parseFloat(match[1] ?? "0") : 0;
}

export function parseChapterPages($: CheerioAPI, base: string): string[] {
    const pages: string[] = [];

    for (const element of $(PAGE_SELECTOR).toArray()) {
        const image = imgAttr(base, $(element));
        if (image.length > 0) {
            pages.push(image);
        }
    }

    if (pages.length === 0) {
        // Newer chapters ship their page list in a script instead of markup.
        const match = IMAGE_LIST.exec($.root().html() ?? "");
        if (match !== null) {
            try {
                for (const entry of JSON.parse(match[1] ?? "[]") as unknown[]) {
                    if (typeof entry === "string") {
                        const url = entry.trim().replace(/\\\//g, "/");
                        if (url.length > 0) {
                            pages.push(absoluteUrl(base, url));
                        }
                    }
                }
            } catch {
                // A malformed list leaves the chapter with no pages, which the
                // caller reports rather than showing a broken reader.
            }
        }
    }

    return [...new Set(pages)];
}

/**
 * Routes an image through a resizing proxy.
 *
 * The site serves full-size scans of well over a megabyte each, which makes a
 * chapter slow to open and sometimes fails outright. Only clean, extensioned
 * URLs are rewritten — anything already carrying a query is likely signed, and
 * proxying it would break the signature.
 */
export function proxyImage(url: string, mode: ImageMode): string {
    if (mode === "original") {
        return url;
    }

    const match = /^https?:\/\/(.+)$/i.exec(url);
    if (
        match === null ||
        /\/\/wsrv\.nl\//i.test(url) ||
        /[?#]/.test(url) ||
        !/\.(avif|gif|jpe?g|jxl|png|webp)$/i.test(url)
    ) {
        return url;
    }

    const source = (match[1] ?? "").replace(/&/g, "%26");
    const higherQuality = mode === "quality";
    const width = higherQuality ? 1080 : 720;
    const quality = higherQuality ? 80 : 65;

    return `https://wsrv.nl/?w=${width}&q=${quality}&we&default=ssl:${source}&url=ssl:${source}`;
}

/** Reads the site's dates, which are absolute on some pages and relative on others. */
function parseSiteDate(text: string): Date {
    const trimmed = (text || "").trim();
    if (trimmed.length === 0) {
        return new Date();
    }

    const absolute = /([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(trimmed);
    if (absolute !== null) {
        const month = MONTHS[(absolute[1] ?? "").toLowerCase()];
        if (month !== undefined) {
            return new Date(
                Date.UTC(parseInt(absolute[3] ?? "0", 10), month, parseInt(absolute[2] ?? "1", 10)),
            );
        }
    }

    const relative = /(\d+)\s*(second|min|hour|day|week|month|year)/.exec(trimmed.toLowerCase());
    if (relative !== null) {
        const amount = parseInt(relative[1] ?? "0", 10);
        const unit = relative[2];
        const ms =
            unit === "second"
                ? 1_000
                : unit === "min"
                  ? 60_000
                  : unit === "hour"
                    ? 3_600_000
                    : unit === "day"
                      ? 86_400_000
                      : unit === "week"
                        ? 604_800_000
                        : unit === "month"
                          ? 2_592_000_000
                          : 31_536_000_000;
        return new Date(Date.now() - amount * ms);
    }

    const direct = new Date(trimmed);
    return isNaN(direct.getTime()) ? new Date() : direct;
}
