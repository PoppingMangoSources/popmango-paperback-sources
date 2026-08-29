/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import {
    Application,
    ContentRating,
    MangaStatus,
    type Chapter,
    type SourceManga,
    type Tag,
} from "../../common";

import { RELATIVE_UNIT_MS, genreIdFromTitle, type MangagoListing } from "./models";
import { absoluteUrl, canonicalReaderUrl, readerPathOf } from "./urls";

function clean(value?: string | null): string {
    return Application.decodeHTMLEntities(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

/** Like `clean`, but keeps the paragraph breaks a synopsis depends on. */
function cleanDescription(value?: string | null): string {
    return Application.decodeHTMLEntities(value ?? "")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** A cover's real source, which lazy loading hides behind a placeholder. */
function imageSource($image: Cheerio<Element>): string {
    return absoluteUrl(
        $image.attr("data-src") ??
            $image.attr("data-cfsrc") ??
            $image.attr("data-lazy-src") ??
            $image.attr("srcset")?.split(/\s+/)[0] ??
            $image.attr("src") ??
            "",
    );
}

/**
 * Reduces a link to the path the app will store as an id.
 *
 * Ids are replayed long after the page they came from is gone, so keeping the
 * host in them would pin a title to whichever mirror happened to serve it.
 */
function toPathname(href: string): string {
    const trimmed = href.trim();
    return trimmed.length === 0 ? "" : readerPathOf(absoluteUrl(trimmed));
}

/** Times on the listings are relative — "3 days" — and absolute on a chapter row. */
function parseTime(text: string): Date | undefined {
    const relative = text.toLowerCase().match(/(\d+)\s*(second|minute|hour|day|week|month|year)/);

    if (relative !== null) {
        const unit = RELATIVE_UNIT_MS[relative[2] ?? ""];
        if (unit !== undefined) {
            return new Date(Date.now() - Number(relative[1]) * unit);
        }
    }

    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

/** The tiles on a search or browse page. */
export function parseListings(html: string): MangagoListing[] {
    const $ = Application.loadDocument(html);
    const items: MangagoListing[] = [];
    const seen = new Set<string>();

    $(".updatesli, .pic_list > li").each((_index, element) => {
        const $item = $(element);
        const $link = $item.find("a.thm-effect").first();
        if ($link.length === 0) {
            return;
        }

        const mangaId = toPathname($link.attr("href") ?? "");
        if (mangaId.length === 0 || seen.has(mangaId)) {
            return;
        }

        const $image = $link.find("img").first();
        const title = clean($link.attr("title") ?? $image.attr("alt") ?? $link.text());
        if (title.length === 0) {
            return;
        }

        // The newest chapter, shown under the title when it is a chapter link
        // rather than a second link to the series itself.
        const $chapter = $item.find(".chapter a, a[href*='/read-manga/'][href*='/c']").first();
        const chapterHref = $chapter.attr("href");
        const chapterId = chapterHref !== undefined ? toPathname(chapterHref) : "";
        const isChapter = chapterId.length > 0 && chapterId !== mangaId;

        seen.add(mangaId);
        items.push({
            mangaId,
            title,
            imageUrl: imageSource($image),
            subtitle: isChapter ? clean($chapter.text()) || undefined : undefined,
            chapterId: isChapter ? chapterId : undefined,
        });
    });

    return items;
}

export function hasNextPage(html: string): boolean {
    return Application.loadDocument(html)(".current + li > a").length > 0;
}

/**
 * The latest-updates page, which carries more than the plain browse grid.
 *
 * Update times, genres and a link to the newest chapter all live here, which
 * is what lets the new-chapters row show a real chapter rather than another
 * cover.
 */
export function parseLatestUpdates(html: string): MangagoListing[] {
    const $ = Application.loadDocument(html);
    const items: MangagoListing[] = [];
    const seen = new Set<string>();

    // The phone and desktop layouts differ, but both wrap the title in the
    // first row with the rest as siblings, so the title is the stable anchor.
    $(".row-1 .tit a").each((_index, element) => {
        const $titleLink = $(element);
        const href = $titleLink.attr("href") ?? "";
        if (!href.includes("/read-manga/")) {
            return;
        }

        const mangaId = toPathname(href);
        if (mangaId.length === 0 || seen.has(mangaId)) {
            return;
        }

        const title = clean($titleLink.attr("title") ?? $titleLink.text());
        if (title.length === 0) {
            return;
        }

        const $content = $titleLink.closest(".row-1").parent();
        const $chapter = $content.find("a.chico").first();
        const chapterHref = $chapter.attr("href");

        let publishDate: Date | undefined;
        $content.find(".blue").each((_position, label) => {
            const $label = $(label);
            if ($label.text().trim().toLowerCase().startsWith("update date")) {
                publishDate = parseTime(clean($label.parent().text()).replace(/^update date:\s*/i, ""));
            }
        });

        const genres = $content
            .find(".row-4 .gray")
            .text()
            .split(/[/,]/)
            .map((genre) => clean(genre))
            .filter((genre) => genre.length > 0);

        seen.add(mangaId);
        items.push({
            mangaId,
            title,
            imageUrl: imageSource($content.prev().find("img").first()),
            subtitle: clean($chapter.text()) || undefined,
            chapterId: chapterHref !== undefined ? toPathname(chapterHref) || undefined : undefined,
            publishDate,
            genres: genres.length > 0 ? genres : undefined,
        });
    });

    return items;
}

/** Walks a details page's information rows as label and row pairs. */
function eachInfoRow($: CheerioAPI, visit: (label: string, $row: Cheerio<Element>) => void): void {
    $("#information .manga_info li, #information .manga_right tr").each((_index, element) => {
        const $row = $(element);
        visit($row.find("b, label").first().text().trim().toLowerCase(), $row);
    });
}

/** The score as the site shows it, out of ten. */
function ratingText($: CheerioAPI): string | undefined {
    const text = $(".rating_num").first().text().replace(/\s+/g, "");
    return /^\d+(?:\.\d+)?$/.test(text) ? text : undefined;
}

/** The synopsis, without the credit line the site appends to it. */
function summaryText($: CheerioAPI): string | undefined {
    const $summary = $(".manga_summary").first();
    $summary.find("font").remove();
    return cleanDescription($summary.text()) || undefined;
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
    const $ = Application.loadDocument(html);
    const normalisedId = toPathname(mangaId) || mangaId;

    let status: string = MangaStatus.UNKNOWN;
    let author = "";
    let artist = "";
    const secondaryTitles: string[] = [];
    const tags: Tag[] = [];
    const genreTitles: string[] = [];

    eachInfoRow($, (label, $row) => {
        const value = clean($row.find("span").first().text());

        if (label.startsWith("status")) {
            const lowered = value.toLowerCase();
            if (lowered === "ongoing") {
                status = MangaStatus.ONGOING;
            } else if (lowered === "completed") {
                status = MangaStatus.COMPLETED;
            }
        }

        if (label.startsWith("author")) {
            author = joinLinks($, $row);
        }

        if (label.startsWith("artist")) {
            artist = joinLinks($, $row);
        }

        // Alternative names make a title easier to find and easier to match
        // against a tracker. The site separates them with semicolons, slashes
        // or line breaks.
        if (label.startsWith("alternative") || label.includes("other name")) {
            const raw = value.length > 0 ? value : clean($row.text().replace(/^[^:]*:/, ""));
            for (const name of raw.split(/[;/\n]+/).map((entry) => entry.trim())) {
                if (name.length > 0 && !secondaryTitles.includes(name)) {
                    secondaryTitles.push(name);
                }
            }
        }

        if (label.startsWith("genre")) {
            $row.find("a").each((_index, anchor) => {
                const genre = clean($(anchor).text());
                if (genre.length === 0) {
                    return;
                }
                genreTitles.push(genre);
                tags.push({ id: genreIdFromTitle(genre), title: genre });
            });
        }
    });

    // The site scores out of ten; the app wants a fraction of one.
    const score = Number(ratingText($));

    return {
        mangaId: normalisedId,
        mangaInfo: {
            primaryTitle: clean($(".w-title h1").first().text()) || normalisedId,
            secondaryTitles,
            thumbnailUrl: imageSource($("#information").find("img").first()),
            synopsis: summaryText($) ?? "",
            author,
            artist,
            status,
            rating: Number.isFinite(score) ? Math.min(1, Math.max(0, score / 10)) : 0,
            contentRating: contentRatingForGenres(genreTitles),
            tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
        },
    };
}

function joinLinks($: CheerioAPI, $row: Cheerio<Element>): string {
    return $row
        .find("a")
        .map((_index, anchor) => clean($(anchor).text()))
        .get()
        .filter((name) => name.length > 0)
        .join(", ");
}

/**
 * Splits a chapter's heading into its number and its name.
 *
 * Headings run "Vol.3 Ch.12: The Title", with any of the three parts missing.
 */
function parseChapterHeading(input: string): { chapter?: number; title?: string } {
    const trimmed = input.trim();
    const colon = trimmed.indexOf(":");

    let left = colon >= 0 ? trimmed.slice(0, colon).trim() : trimmed;
    const right = colon >= 0 ? trimmed.slice(colon + 1).trim() : "";

    let chapter: number | undefined;

    const volume = /^Vol\.\s*(?:(\d+(?:\.\d+)?)|TBA|N\/?A|NA)?\s*/i.exec(left);
    if (volume !== null) {
        left = left.slice(volume[0].length).trimStart();
    }

    if (/^Ch\./i.test(left)) {
        left = left.slice(3).trimStart();
        const number = /^(\d+(?:\.\d+)?)/.exec(left);
        if (number !== null) {
            chapter = Number(number[1]);
            left = left.slice((number[1] ?? "").length).trimStart();
        }
    }

    let title: string | undefined;
    if (right.length > 0 && left.length > 0) {
        title = `${left}: ${right}`;
    } else if (right.length > 0) {
        title = right;
    } else if (left.length > 0) {
        title = left;
    }

    return { chapter, title };
}

/**
 * Falls back to reading a number out of the heading.
 *
 * The slug is no help — the number in it is an upload id, not the chapter
 * number — so a heading with no number keeps zero, which sorts it last.
 */
function parseChapterNumber(name: string): number {
    const raw =
        name.match(/chapter\s*(\d+(?:\.\d+)?)/i)?.[1] ??
        name.match(/ch\.\s*(\d+(?:\.\d+)?)/i)?.[1] ??
        // Only a leading number is likely to be the chapter's; one in the
        // middle of a title usually belongs to a season or a volume.
        name.match(/^\s*(\d+(?:\.\d+)?)/)?.[1];

    const number = raw !== undefined ? Number(raw) : 0;
    return Number.isFinite(number) ? number : 0;
}

function isOfficial(text: string): boolean {
    return /\bofficial\b/i.test(text);
}

/** The group named in the heading's brackets, when one is named there. */
function groupFromHeading(title: string): string {
    for (const match of title.matchAll(/(?:\[([^\]]{2,80})\]|\(([^()]{2,80})\))/g)) {
        const value = clean(match[1] ?? match[2] ?? "");
        if (value.length === 0) {
            continue;
        }
        if (isOfficial(value)) {
            return "Official";
        }
        if (/\b(scans?|scanlations?|translations?|translators?|team|group)\b/i.test(value)) {
            return value;
        }
    }
    return "";
}

/**
 * Who released a chapter.
 *
 * The site lists several releases of the same chapter side by side, so this is
 * what tells them apart in the chapter list.
 */
export function buildChapterGroup(rawUploader: string, heading: string): string | undefined {
    const uploader = clean(rawUploader);
    const named = isOfficial(uploader) ? "Official" : uploader;
    const group = groupFromHeading(heading) || (isOfficial(heading) ? "Official" : "");

    if (group.length === 0) {
        return named.length > 0 ? named : undefined;
    }
    if (named.length === 0 || group.toLowerCase() === named.toLowerCase()) {
        return group;
    }
    return `${group} - ${named}`;
}

function firstUploader(candidates: string[], heading: string): string {
    return (
        candidates
            .map((candidate) => clean(candidate))
            .find(
                (candidate) =>
                    candidate.length > 0 &&
                    candidate !== heading &&
                    // Skipped when the heading is empty, or every candidate
                    // would be rejected for "containing" it.
                    (heading.length === 0 || !candidate.includes(heading)),
            ) ?? ""
    );
}

function extractUploader($: CheerioAPI, $row: Cheerio<Element>): string {
    const heading = clean($row.find("a.chico").first().text());

    const fromProfile = firstUploader(
        $row
            .find("a[href*='/home/'], a[href*='/user/'], a[href*='/profile/']")
            .not("a.chico")
            .map((_index, element) => $(element).text())
            .get(),
        heading,
    );
    if (fromProfile.length > 0) {
        return fromProfile;
    }

    // The uploader and the date share a class, and the date is always the last
    // cell, so it is excluded by position rather than by guessing at content.
    const $date = $row.find("td").last();
    return firstUploader(
        $row
            .find(
                "td.no a, td.no, td.uk-table-shrink a, td.uk-table-shrink, td[class*='upload'] a, td[class*='upload'], td[class*='group'] a, td[class*='group']",
            )
            .not($date)
            .not($date.find("a"))
            .map((_index, element) => $(element).text())
            .get(),
        heading,
    );
}

export function parseChapters(html: string, sourceManga: SourceManga): Chapter[] {
    const $ = Application.loadDocument(html);
    const chapters: Chapter[] = [];

    $("table#chapter_table > tbody > tr, table.uk-table > tbody > tr").each((_index, element) => {
        const $row = $(element);
        const $link = $row.find("a.chico").first();
        const href = ($link.attr("href") ?? "").trim();
        if (href.length === 0) {
            return;
        }

        // An absolute link points at a mirror that has to be kept, because the
        // main host will not serve that chapter; anything else is stored as a
        // path so it is not pinned to whichever host answered today.
        const chapterId = href.startsWith("http") ? canonicalReaderUrl(href) : toPathname(href);
        if (chapterId.length === 0) {
            return;
        }

        const heading = clean($link.text());
        const parsed = parseChapterHeading(heading);

        chapters.push({
            chapterId,
            sourceManga,
            title: parsed.title ?? heading,
            chapNum: parsed.chapter ?? parseChapterNumber(heading),
            volume: 0,
            group: buildChapterGroup(extractUploader($, $row), heading),
            publishDate: parseTime(clean($row.find("td").last().text())),
            langCode: "en",
            sortingIndex: 0,
        });
    });

    chapters.sort((a, b) => {
        // A chapter with no number sorts to the end rather than to the front.
        if (a.chapNum === 0 && b.chapNum === 0) {
            return compareGroups(a, b);
        }
        if (a.chapNum === 0) {
            return 1;
        }
        if (b.chapNum === 0) {
            return -1;
        }
        if (a.chapNum !== b.chapNum) {
            return b.chapNum - a.chapNum;
        }
        return compareGroups(a, b);
    });

    return chapters.map((chapter, index) => ({
        ...chapter,
        sortingIndex: chapters.length - index,
    }));
}

/** Official releases come first; the rest keep a stable alphabetical order. */
function compareGroups(a: Chapter, b: Chapter): number {
    const aOfficial = a.group?.startsWith("Official") ?? false;
    const bOfficial = b.group?.startsWith("Official") ?? false;

    if (aOfficial !== bOfficial) {
        return aOfficial ? -1 : 1;
    }
    return (a.group ?? "").localeCompare(b.group ?? "");
}

/**
 * How explicit a title is, judged by its genres.
 *
 * The listings carry no rating of their own, so the same rule is applied to a
 * genre-locked home row as to a details page and the two agree.
 */
export function contentRatingForGenres(genres: string[]): ContentRating {
    const lowered = genres.map((genre) => genre.trim().toLowerCase());

    if (lowered.some((genre) => genre === "adult" || genre === "smut" || genre === "yaoi")) {
        return ContentRating.ADULT;
    }
    if (lowered.some((genre) => genre === "ecchi")) {
        return ContentRating.MATURE;
    }
    return ContentRating.EVERYONE;
}
