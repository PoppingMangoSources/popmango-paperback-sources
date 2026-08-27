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
    type Tag,
    type TagSection,
} from "../../common";

import { DOMAIN, MANGA_DIR, TYPE_COUNTRIES, type LatestCard, type MangaCard } from "./models";

/** Characters that are safe to keep in an id the app will store and replay. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const ADULT_GENRES = new Set(["adult", "hentai", "pornographic", "erotica"]);
const MATURE_GENRES = new Set(["ecchi", "mature", "smut", "yaoi", "yuri", "adult romance"]);

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

/** Some chapters ship their pages as a JSON list instead of as markup. */
const IMAGE_LIST = /"images"\s*:\s*(\[[\s\S]*?\])/;

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function cleanText(value?: string | null): string {
    return Application.decodeHTMLEntities(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

function sanitizeId(value: string): string {
    return value.replace(UNSAFE_ID, "-");
}

export function parseMangaId(value?: string | null): string {
    return sanitizeId((value ?? "").match(new RegExp(`/${MANGA_DIR}/([^/?#]+)`, "i"))?.[1] ?? "");
}

function parseChapterId(value?: string | null): string {
    const path = (value ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    return sanitizeId(path.split("/").pop() ?? "");
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

/** The theme lazy-loads covers, so the real URL sits in a data attribute. */
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
        image.attr("data-lazy-src") ??
            image.attr("data-src") ??
            image.attr("data-cfsrc") ??
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

export function parseDate(value?: string | null): Date | undefined {
    const text = cleanText(value);
    if (text.length === 0) {
        return undefined;
    }

    const absolute = text.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (absolute !== null) {
        const month = MONTHS[(absolute[1] ?? "").toLowerCase().slice(0, 3)];
        if (month !== undefined) {
            return new Date(
                Date.UTC(
                    Number.parseInt(absolute[3] ?? "", 10),
                    month,
                    Number.parseInt(absolute[2] ?? "", 10),
                ),
            );
        }
    }

    const relative = text.toLowerCase().match(/(\d+)\s*(second|min|hour|day|week|month|year)/);
    if (relative !== null) {
        const amount = Number.parseInt(relative[1] ?? "", 10);
        const milliseconds = {
            second: 1_000,
            min: 60_000,
            hour: 3_600_000,
            day: 86_400_000,
            week: 604_800_000,
            month: 2_592_000_000,
            year: 31_536_000_000,
        }[relative[2] ?? ""];

        if (milliseconds !== undefined) {
            return new Date(Date.now() - amount * milliseconds);
        }
    }

    const direct = new Date(text);
    return Number.isNaN(direct.getTime()) ? undefined : direct;
}

function chapterLabel(chapter?: string): string | undefined {
    if (chapter === undefined || chapter.length === 0) {
        return undefined;
    }
    const number = chapter.match(/(\d+(?:\.\d+)?)/)?.[1];
    return number !== undefined ? `Ch. ${number}` : chapter;
}

function joinDetails(parts: Array<string | undefined>): string | undefined {
    const joined = parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ");
    return joined.length > 0 ? joined : undefined;
}

function parseCard($: CheerioAPI, element: AnyNode): MangaCard | undefined {
    const unit = $(element);
    const link = unit.is("a") ? unit : unit.find("a").first();
    const mangaId = parseMangaId(link.attr("href") ?? "");

    if (mangaId.length === 0) {
        return undefined;
    }

    const image = unit.find("img").first();
    const title = cleanText(
        unit.find(".bigor .tt a").first().text() ||
            unit.find(".bigor .tt").first().text() ||
            image.attr("title") ||
            link.attr("title"),
    );

    if (title.length === 0) {
        return undefined;
    }

    // The origin is carried as an extra class on the type badge.
    const typeName = (unit.find("span.type").first().attr("class") ?? "").replace(/\btype\b/, "").trim();
    const chapter = cleanText(unit.find(".epxs").first().text());
    const rating = cleanText(unit.find(".numscore").first().text());

    return {
        mangaId,
        title,
        imageUrl: imageUrlFrom(image),
        chapter: chapter.length > 0 ? chapter : undefined,
        rating: rating.length > 0 ? rating : undefined,
        typeName: typeName.length > 0 ? typeName : undefined,
        genres: [],
    };
}

export function parseCards($: CheerioAPI): MangaCard[] {
    const cards: MangaCard[] = [];
    const seen = new Set<string>();

    $(".listupd .bs .bsx, .listo .bs .bsx").each((_, element) => {
        const card = parseCard($, element);
        if (card === undefined || seen.has(card.mangaId)) {
            return;
        }
        seen.add(card.mangaId);
        cards.push(card);
    });

    return cards;
}

/** Home page widgets carry no ids, so they are found by their heading. */
function widgetByHeading($: CheerioAPI, heading: string): Cheerio<AnyNode> {
    return $(`.releases:contains("${heading}")`).first().closest(".bixbox, .section");
}

export function parseWidgetCards($: CheerioAPI, heading: string): MangaCard[] {
    const cards: MangaCard[] = [];
    const seen = new Set<string>();

    widgetByHeading($, heading)
        .find(".bsx")
        .each((_, element) => {
            const card = parseCard($, element);
            if (card === undefined || seen.has(card.mangaId)) {
                return;
            }
            seen.add(card.mangaId);
            cards.push(card);
        });

    return cards;
}

export function parseLatestCards($: CheerioAPI, heading: string): LatestCard[] {
    const cards: LatestCard[] = [];
    const seen = new Set<string>();

    widgetByHeading($, heading)
        .find(".bsx")
        .each((_, element) => {
            const card = parseCard($, element);
            if (card === undefined || seen.has(card.mangaId)) {
                return;
            }
            seen.add(card.mangaId);

            const latest = $(element).find("ul.chfiv li a").first();
            const href = latest.attr("href") ?? "";
            const chapterName = cleanText(latest.find(".fivchap").text());

            cards.push({
                ...card,
                chapterId: href.length > 0 ? parseChapterId(href) : undefined,
                chapterName: chapterName.length > 0 ? chapterName : undefined,
                publishDate: parseDate(latest.find(".fivtime").text()),
            });
        });

    return cards;
}

export function parseTrendingCards($: CheerioAPI, range: string): MangaCard[] {
    const cards: MangaCard[] = [];
    const seen = new Set<string>();

    $(`.serieslist.wpop.${range} ul li, #wpop-items .${range} ul li`).each((_, element) => {
        const item = $(element);
        const link = item.find("a.series").first();
        const mangaId = parseMangaId(link.attr("href"));

        if (mangaId.length === 0 || seen.has(mangaId)) {
            return;
        }

        const title = cleanText(item.find(".leftseries h2 a").first().text() || link.attr("title"));
        if (title.length === 0) {
            return;
        }
        seen.add(mangaId);

        const rank = Number.parseInt(cleanText(item.find(".ctr").first().text()), 10);
        const rating = cleanText(item.find(".numscore").first().text());

        cards.push({
            mangaId,
            title,
            imageUrl: imageUrlFrom(item.find("img").first()),
            rating: rating.length > 0 ? rating : undefined,
            rank: Number.isFinite(rank) ? rank : undefined,
            genres: item
                .find('a[href*="/genres/"]')
                .toArray()
                .map((genre) => cleanText($(genre).text()))
                .filter((genre) => genre.length > 0),
        });
    });

    return cards;
}

export function parseGenreOptions($: CheerioAPI): Tag[] {
    const genres: Tag[] = [];
    const seen = new Set<string>();

    $("ul.genrez li").each((_, element) => {
        const item = $(element);
        const id = (item.find("input[type=checkbox]").attr("value") ?? "").trim();
        const title = cleanText(item.find("label").text());

        if (id.length === 0 || title.length === 0 || seen.has(id)) {
            return;
        }
        seen.add(id);
        genres.push({ id, title });
    });

    return genres;
}

/** Collects the text of every match, dropping the theme's placeholders. */
function collectText($: CheerioAPI, scope: Cheerio<AnyNode>, selector: string): string[] {
    const values: string[] = [];

    scope.find(selector).each((_, element) => {
        const value = cleanText($(element).text());
        if (value.length > 0 && value !== "-" && value.toLowerCase() !== "n/a") {
            values.push(value);
        }
    });

    return values;
}

function parseStatus(status: string): string {
    const value = status.toLowerCase();

    if (value.length === 0) {
        return "Unknown";
    }
    if (value.includes("complet") || value.includes("finished")) {
        return "Completed";
    }
    if (value.includes("ongoing") || value.includes("publishing") || value.includes("updating")) {
        return "Ongoing";
    }
    if (value.includes("hiatus") || value.includes("hold")) {
        return "Hiatus";
    }
    if (value.includes("cancel") || value.includes("drop")) {
        return "Cancelled";
    }
    return "Unknown";
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const details = $(DETAILS_SCOPE).first();
    const scope: Cheerio<AnyNode> = details.length > 0 ? details : $.root();

    const primaryTitle = cleanText(scope.find(TITLE_SELECTOR).first().text()) || mangaId;

    let synopsis = "";
    scope.find(DESC_SELECTOR).each((_, element) => {
        const value = $(element).text().trim();
        if (value.length > 0) {
            synopsis += (synopsis.length > 0 ? "\n" : "") + value;
        }
    });

    const secondaryTitles = cleanText(scope.find(ALT_NAME_SELECTOR).first().text())
        .split(/[,;|]/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value.toLowerCase() !== primaryTitle.toLowerCase());

    const genreTags: Tag[] = [];
    const seenGenres = new Set<string>();

    scope.find(GENRE_SELECTOR).each((_, element) => {
        const title = cleanText($(element).text());
        if (title.length === 0) {
            return;
        }

        const id = sanitizeId(title.toLowerCase().replace(/\s+/g, "-"));
        if (seenGenres.has(id)) {
            return;
        }
        seenGenres.add(id);
        genreTags.push({ id, title });
    });

    const tagGroups: TagSection[] =
        genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : [];

    const author = collectText($, scope, AUTHOR_SELECTOR).join(", ");
    const artist = collectText($, scope, ARTIST_SELECTOR).join(", ");

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles,
            thumbnailUrl: imageUrlFrom(scope.find(THUMB_SELECTOR).first()),
            synopsis: Application.decodeHTMLEntities(synopsis),
            author: author.length > 0 ? author : undefined,
            artist: artist.length > 0 ? artist : undefined,
            status: parseStatus(cleanText(scope.find(STATUS_SELECTOR).first().text())),
            contentRating: contentRatingForGenres(genreTags.map((tag) => tag.title)),
            tagGroups,
        },
    };
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    $(CHAPTER_SELECTOR).each((_, element) => {
        const item = $(element);
        const link = item.is("a") ? item : item.find("a").first();
        const chapterId = parseChapterId(link.attr("href"));

        if (chapterId.length === 0 || seen.has(chapterId)) {
            return;
        }
        seen.add(chapterId);

        const title = cleanText(item.find(CHAPTER_NAME_SELECTOR).first().text() || link.text());
        const number = title.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i) ?? title.match(/(\d+(?:\.\d+)?)/);

        chapters.push({
            chapterId,
            sourceManga,
            title,
            chapNum: number === null ? 0 : Number.parseFloat(number[1] ?? ""),
            volume: 0,
            publishDate: parseDate(item.find(CHAPTER_DATE_SELECTOR).first().text()),
            langCode: "🇬🇧",
        });
    });

    // The site lists newest chapters first; the app wants oldest lowest.
    return chapters.map((chapter, index) => ({ ...chapter, sortingIndex: chapters.length - index }));
}

/**
 * Collects a chapter's page images.
 *
 * Most chapters put them in the markup; where the reader builds itself from a
 * JSON list instead, that is read as a fallback.
 */
export function parseChapterPages($: CheerioAPI): string[] {
    const pages: string[] = [];

    $(PAGE_SELECTOR).each((_, element) => {
        const image = imageUrlFrom($(element));
        if (image.length > 0) {
            pages.push(image);
        }
    });

    if (pages.length === 0) {
        const match = ($.root().html() ?? "").match(IMAGE_LIST);

        if (match !== null) {
            let images: unknown;
            try {
                images = JSON.parse(match[1] ?? "");
            } catch {
                throw new Error("The reader's image list could not be read.");
            }

            if (Array.isArray(images)) {
                for (const entry of images) {
                    if (typeof entry !== "string") {
                        continue;
                    }
                    const url = toAbsoluteUrl(entry.trim().replace(/\\\//g, "/"));
                    if (url.length > 0) {
                        pages.push(url);
                    }
                }
            }
        }
    }

    return [...new Set(pages)];
}

/**
 * Builds a home page tile.
 *
 * 0.8 tiles carry a single subtitle line, so the newest chapter, the rating
 * and the origin are joined into one.
 */
export function toDiscoverItem(card: MangaCard): DiscoverSectionItem {
    const typeName = card.typeName?.toLowerCase();

    return {
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        subtitle: joinDetails([
            card.rank === undefined ? undefined : `#${card.rank}`,
            chapterLabel(card.chapter),
            card.rating === undefined ? undefined : `★ ${card.rating}`,
            typeName === undefined ? undefined : (TYPE_COUNTRIES[typeName] ?? card.typeName),
        ]),
    };
}

/** Like `toDiscoverItem`, but only for entries that actually have a chapter. */
export function toLatestItem(card: LatestCard): DiscoverSectionItem | undefined {
    if (card.chapterId === undefined) {
        return undefined;
    }

    return {
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        subtitle: card.chapterName,
        chapterId: card.chapterId,
        publishDate: card.publishDate,
    };
}

export function toSearchResultItem(card: MangaCard): SearchResultItem {
    return {
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        subtitle: joinDetails([
            card.rank === undefined ? undefined : `#${card.rank}`,
            chapterLabel(card.chapter),
            card.rating === undefined ? undefined : `★ ${card.rating}`,
        ]),
        contentRating: contentRatingForGenres(card.genres),
    };
}
