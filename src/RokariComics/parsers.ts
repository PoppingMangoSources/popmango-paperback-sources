/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import {
    Application,
    ContentRating,
    type Chapter,
    type ChapterDetails,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import { MONTHS, type SearchCard } from "./models";

// Scraped markup double-encodes entities on some titles, so display text is
// decoded once more at the parser boundary.
export function cleanText(value: string): string {
    return Application.decodeHTMLEntities(value).trim();
}

/** Reads a cover out of an image element, whichever attribute carries it. */
export function getImageSrc(image: Cheerio<AnyNode> | undefined): string {
    let src =
        image?.attr("data-src") ??
        image?.attr("data-lazy-src") ??
        image?.attr("srcset")?.split(" ")[0] ??
        image?.attr("src") ??
        image?.attr("data-cfsrc") ??
        "";

    // A "?resize" query hands back a thumbnail rather than the full cover.
    src = src.split("?resize")[0] ?? "";
    src = src.replace(/^\/\//, "https://").replace(/^\//, "https:/");

    return encodeURI(decodeURI(src.trim()));
}

/** The last path component of a link, which is how the site names a series. */
export function idCleaner(value: string): string {
    return value.replace(/\/$/, "").split("/").pop() ?? "";
}

/** The path a slug sits under, needed to look its post id up. */
export function pathOf(href: string): string {
    return href.replace(/\/$/, "").split("/").slice(-2).shift() ?? "";
}

/** Reads a date written out in words, as the chapter list does. */
export function parseChapterDate(text: string): Date | undefined {
    const normalised = text.trim().toLowerCase();
    if (normalised.length === 0) {
        return undefined;
    }

    const match = /([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(normalised);
    if (match !== null) {
        const month = MONTHS[match[1] ?? ""];
        if (month !== undefined) {
            return new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
        }
    }

    const direct = new Date(text);
    return isNaN(direct.getTime()) ? undefined : direct;
}

/** Reads a date written as an age, as the home page does. */
export function parseRelativeDate(text: string): Date | undefined {
    const match = /(\d+|an?)\s*(min(?:ute)?|hour|day|week|month|year)s?\b/.exec(text.toLowerCase());
    if (match === null) {
        return undefined;
    }

    const amount = /^\d/.test(match[1] ?? "") ? parseInt(match[1] ?? "0", 10) : 1;
    const date = new Date();

    switch (match[2]) {
        case "min":
        case "minute":
            date.setMinutes(date.getMinutes() - amount);
            break;
        case "hour":
            date.setHours(date.getHours() - amount);
            break;
        case "day":
            date.setDate(date.getDate() - amount);
            break;
        case "week":
            date.setDate(date.getDate() - amount * 7);
            break;
        case "month":
            date.setMonth(date.getMonth() - amount);
            break;
        case "year":
            date.setFullYear(date.getFullYear() - amount);
            break;
    }

    return date;
}

/** Reads a labelled value out of the details table, whichever layout it uses. */
function labelledValue($: CheerioAPI, label: string): string {
    return cleanText(
        $(
            `span:contains(${label}), .fmed b:contains(${label})+span, ` +
                `.imptdt:contains(${label}) i, tr td:contains(${label}) + td`,
        )
            .contents()
            .remove()
            .last()
            .text(),
    );
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const titles = [cleanText($("h1.entry-title").text())];

    const altTitles = $(
        "span:contains(Alternative Titles), b:contains(Alternative Titles)+span, " +
            ".imptdt:contains(Alternative Titles) i, h1.entry-title+span",
    )
        .contents()
        .remove()
        .last()
        .text()
        .split(",");

    for (const title of altTitles) {
        const cleaned = cleanText(title);
        if (cleaned.length > 0) {
            titles.push(cleaned);
        }
    }

    const tags: Tag[] = [];
    for (const element of $("a", "span.mgen").toArray()) {
        const title = cleanText($(element).text());
        const id = idCleaner($(element).attr("href") ?? "");
        if (id.length === 0 || title.length === 0) {
            continue;
        }
        tags.push({ id, title });
    }

    const tagGroups: TagSection[] = tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [];

    const author = labelledValue($, "Author");
    const artist = labelledValue($, "Artist");

    return {
        mangaId,
        mangaInfo: {
            primaryTitle: titles.shift() ?? mangaId,
            secondaryTitles: titles,
            thumbnailUrl: getImageSrc($("img", 'div[itemprop="image"]')),
            status: parseStatus(labelledValue($, "Status")),
            // The site writes "Unknown" where it has no credit; an absent value
            // reads better than the word.
            author: author.length > 0 && author !== "Unknown" ? author : undefined,
            artist: artist.length > 0 && artist !== "Unknown" ? artist : undefined,
            synopsis: cleanText($('div[itemprop="description"] p').text()),
            contentRating: ContentRating.EVERYONE,
            tagGroups,
        },
    };
}

function parseStatus(status: string): string {
    const text = status.toLowerCase();
    if (text.includes("complet")) {
        return "Completed";
    }
    if (text.includes("hiatus")) {
        return "Hiatus";
    }
    if (text.includes("cancel") || text.includes("drop")) {
        return "Cancelled";
    }
    return "Ongoing";
}

export function parseChapterList($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
    const chapters: Chapter[] = [];

    for (const element of $("li", "div#chapterlist").toArray()) {
        // A gold marker means the chapter is behind a paywall.
        if ($(".text-gold", element).length > 0) {
            continue;
        }

        // The chapter's own number is its id here; the reader page is looked up
        // from the list when the chapter is opened.
        const chapterId = (element.attribs["data-num"] ?? "").replace(/ /g, "-");
        if (chapterId.length === 0) {
            continue;
        }

        const title = cleanText($("span.chapternum", element).text()).replace(/\s+/g, " ");
        const number = /(\d+\.?\d?)+/.exec(chapterId);

        chapters.push({
            chapterId,
            sourceManga,
            langCode: "🇬🇧",
            chapNum: number !== null ? Number(number[1] ?? 0) : 0,
            title,
            publishDate: parseChapterDate($("span.chapterdate", element).text()),
            volume: 0,
        });
    }

    if (chapters.length === 0) {
        throw new Error(`No chapters were found for ${sourceManga.mangaId}.`);
    }

    // The page lists newest first, which is the order the app wants reversed.
    return chapters.map((chapter, index) => ({ ...chapter, sortingIndex: chapters.length - index }));
}

/** The reader's page list, which the site hands to its own script. */
export function parseChapterPages($: CheerioAPI, chapter: Chapter): ChapterDetails {
    const script = $("script")
        .toArray()
        .map((element) => $(element).html() ?? "")
        .find((html) => html.includes("ts_reader.run"));

    if (script === undefined) {
        throw new Error(`No reader script was found for chapter ${chapter.chapterId}.`);
    }

    const match = /ts_reader\.run\((.*?(?=\);|},))/.exec(script);
    let payload = match?.[1] ?? "";

    if (payload.length === 0) {
        throw new Error(`The reader script could not be read for chapter ${chapter.chapterId}.`);
    }
    if (!payload.endsWith("}")) {
        payload += "}";
    }

    let parsed: { sources?: Array<{ images?: string[] }> };
    try {
        parsed = JSON.parse(payload) as { sources?: Array<{ images?: string[] }> };
    } catch {
        throw new Error(`The reader script could not be read for chapter ${chapter.chapterId}.`);
    }

    const pages: string[] = [];
    for (const source of parsed.sources ?? []) {
        for (const image of source.images ?? []) {
            pages.push(encodeURI(image.trim()));
        }
    }

    if (pages.length === 0) {
        throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
}

/** The directory page carries the filter lists as its own dropdowns. */
export function parseTags($: CheerioAPI): Array<{ id: string; tags: Tag[] }> {
    const sections: Array<{ id: string; tags: Tag[] }> = [
        { id: "genres", tags: [] },
        { id: "status", tags: [] },
        { id: "type", tags: [] },
    ];

    const dropdowns = $("ul.dropdown-menu.c4.genrez, ul.dropdown-menu.c1").toArray();

    for (let index = 0; index < sections.length; index += 1) {
        const dropdown = dropdowns[index];
        const section = sections[index];
        if (dropdown === undefined || section === undefined) {
            continue;
        }

        for (const element of $("li", dropdown).toArray()) {
            const title = cleanText($("label", element).text());
            const value = $("input", element).attr("value") ?? "";
            if (value.length === 0 || title.length === 0) {
                continue;
            }
            section.tags.push({ id: value, title });
        }
    }

    return sections;
}

export function parseSearchResults($: CheerioAPI): SearchCard[] {
    const results: SearchCard[] = [];

    for (const element of $("div.bs", "div.listupd").toArray()) {
        const anchor = $("a", element).first();
        const href = anchor.attr("href") ?? "";
        const slug = idCleaner(href);
        const path = pathOf(href);

        if (slug.length === 0 || path.length === 0) {
            continue;
        }

        results.push({
            slug,
            path,
            postId: anchor.attr("rel"),
            title: cleanText(anchor.attr("title") ?? $("div.tt", element).first().text()),
            imageUrl: getImageSrc($("img", element)),
            subtitle: cleanText($("div.epxs", element).text()) || undefined,
        });
    }

    return results;
}

/** The site's own ranked lists, one per window. */
export function parseRankingList($: CheerioAPI, range: string): SearchCard[] {
    const results: SearchCard[] = [];

    for (const element of $(`div.serieslist.pop.wpop-${range} li`).toArray()) {
        const anchor = $("a.series", element).first();
        const href = anchor.attr("href") ?? "";
        const slug = idCleaner(href);

        const title = cleanText($("div.leftseries h2 a", element).first().text() || (anchor.attr("title") ?? ""));
        if (slug.length === 0 || title.length === 0) {
            continue;
        }

        results.push({
            slug,
            path: pathOf(href),
            postId: anchor.attr("rel"),
            title,
            imageUrl: getImageSrc($("img", element)),
            subtitle:
                $("div.leftseries span", element)
                    .first()
                    .text()
                    .replace(/^\s*Genres:\s*/i, "")
                    .trim() || undefined,
        });
    }

    return results;
}
