/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { AnyNode } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";

import {
    Application,
    ContentRating,
    URL,
    parseDate,
    type Chapter,
    type ChapterDetails,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import { DOMAIN, type ListingChapter, type MangaListItem } from "./models";

/** Characters that are safe to keep in an id the app will store and replay. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

/** Kana, Han and Hangul ranges, used to spot a title in its original script. */
const ORIGINAL_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

const ADULT_GENRES = new Set(["18", "adult", "hentai", "smut"]);
const MATURE_GENRES = new Set(["mature", "soft yaoi", "soft yuri", "yaoi", "yaoibl", "yuri"]);

/** Labels the theme emits that are metadata rather than real genres. */
const NOT_A_GENRE = /(?:publication:|status:|upload status:|read direction:|[\uf000-\uf8ff])/i;

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
    const slug = (value ?? "").match(/\/manga\/([^/?#]+)/i)?.[1] ?? "";
    return sanitizeId(slug);
}

function chapterIdFromUrl(value?: string | null): string {
    const path = (value ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    return sanitizeId(path.split("/").pop() ?? "");
}

function toAbsoluteUrl(value?: string | null): string {
    const url = Application.decodeHTMLEntities(value ?? "")
        .replace(/\s+/g, "")
        .trim();

    if (url.length === 0) {
        return "";
    }
    if (url.startsWith("//")) {
        return `https:${url}`;
    }
    if (/^https?:\/\//i.test(url)) {
        return url.replace(/^http:\/\//i, "https://");
    }
    return URL(DOMAIN).setPath(url).build();
}

/**
 * Finds the best image URL on a tile.
 *
 * The theme lazy-loads covers, so the real URL sits in one of several data
 * attributes and `src` holds a placeholder. Where a srcset is offered the
 * widest candidate is taken, since covers are displayed large.
 */
function imageUrlFrom(image: Cheerio<AnyNode>): string {
    const srcset = (image.attr("data-srcset") ?? image.attr("srcset"))
        ?.split(",")
        .map((entry) => {
            const [url, width] = entry.trim().split(/\s+/);
            return { url, width: Number.parseInt(width ?? "", 10) || 0 };
        })
        .filter((entry) => entry.url !== undefined)
        .sort((left, right) => right.width - left.width)[0]?.url;

    return toAbsoluteUrl(
        image.attr("data-cfsrc") ??
            image.attr("data-src") ??
            image.attr("data-lazy-src") ??
            srcset ??
            image.attr("src"),
    );
}

/**
 * Rates a title from its genres.
 *
 * The site carries adult work throughout, so a title with no genres listed is
 * assumed adult rather than assumed safe.
 */
export function contentRatingForGenres(genres: string[], fallback = ContentRating.ADULT): ContentRating {
    const normalised = genres.map((genre) => genre.toLowerCase());

    if (normalised.some((genre) => ADULT_GENRES.has(genre))) {
        return ContentRating.ADULT;
    }
    if (normalised.some((genre) => MATURE_GENRES.has(genre))) {
        return ContentRating.MATURE;
    }
    return genres.length > 0 ? ContentRating.EVERYONE : fallback;
}

/** Picks the most useful alternate title, preferring one in the original script. */
function pickOriginalTitle(value: string, primaryTitle: string): string | undefined {
    const titles = splitTitles(value, primaryTitle);
    return titles.find((title) => ORIGINAL_SCRIPT.test(title)) ?? titles[0];
}

function splitTitles(value: string, primaryTitle: string): string[] {
    return value
        .split(/\s*[;/]\s*/)
        .map(cleanText)
        .filter(
            (title, index, values) =>
                title.length > 0 &&
                !/^none$/i.test(title) &&
                title.toLowerCase() !== primaryTitle.toLowerCase() &&
                values.indexOf(title) === index,
        );
}

function chapterNumber(value: string): number | undefined {
    const match = value.match(/\b(?:chapter|chap|ch\.?|episode|ep\.?)\s*[-_:]?\s*(\d+(?:\.\d+)?)/i);
    if (match === null) {
        return undefined;
    }
    const number = Number.parseFloat(match[1] ?? "");
    return Number.isFinite(number) ? number : undefined;
}

function volumeNumber(value: string): number {
    const match = value.match(/\bvol(?:ume)?\.?\s*[-_:]?\s*(\d+(?:\.\d+)?)/i);
    const number = match === null ? 0 : Number.parseFloat(match[1] ?? "");
    return Number.isFinite(number) ? number : 0;
}

/** Strips the volume and chapter numbers, leaving whatever title remains. */
function chapterTitle(value: string): string | undefined {
    const remainder = cleanText(
        value
            .replace(/\bvol(?:ume)?\.?\s*[-_:]?\s*\d+(?:\.\d+)?/i, "")
            .replace(/\b(?:chapter|chap|ch\.?|episode|ep\.?)\s*[-_:]?\s*\d+(?:\.\d+)?/i, "")
            .replace(/^[-:.\s]+|[-:.\s]+$/g, ""),
    );
    return remainder.length > 0 ? remainder : undefined;
}

function parseListingChapter($: CheerioAPI, container: Cheerio<AnyNode>): ListingChapter | undefined {
    const link = container.find(".latest-chap .chapter a, .chapter-item .chapter a").first();
    const chapterId = chapterIdFromUrl(link.attr("href"));
    const title = cleanText(link.text());

    if (chapterId.length === 0 || title.length === 0) {
        return undefined;
    }

    const chapterRow = link.closest(".chapter-item");
    const dateContainer =
        chapterRow.length > 0 ? chapterRow.find(".post-on") : container.find(".meta-item.post-on").first();

    return {
        chapterId,
        title,
        // The exact date hides in a tooltip; the visible text is relative.
        publishDate: parseDate(dateContainer.find(".c-new-tag").first().attr("title") ?? dateContainer.text()),
    };
}

export function parseMangaList(
    $: CheerioAPI,
    elements = $(".c-tabs-item__content, .page-item-detail, .related__item, .slider__item").toArray(),
): MangaListItem[] {
    const items: MangaListItem[] = [];
    const seen = new Set<string>();

    for (const element of elements) {
        const item = $(element);
        const titleLink = item
            .find(
                ".post-title a, .related__title a, .slider__content h4 a, h3 a[href*='/manga/'], h4 a[href*='/manga/']",
            )
            .first();

        const mangaId = parseMangaId(titleLink.attr("href"));
        const title = cleanText(titleLink.text().length > 0 ? titleLink.text() : titleLink.attr("title"));
        const imageUrl = imageUrlFrom(
            item.find(".item-thumb img, .tab-thumb img, .related__thumb img, .slider__thumb img, img").first(),
        );

        // The same title turns up in several rails on the home page.
        if (mangaId.length === 0 || title.length === 0 || imageUrl.length === 0 || seen.has(mangaId)) {
            continue;
        }
        seen.add(mangaId);

        const genres = item
            .find(".mg_genres .summary-content a, .genres-content a")
            .map((_, link) => cleanText($(link).text()))
            .toArray()
            .filter((genre) => genre.length > 0);

        const rawRating = Number.parseFloat(item.find(".meta-item.rating .score").first().text());
        const alternative = cleanText(item.find(".mg_alternative .summary-content").first().text());
        const status = cleanText(item.find(".mg_status .summary-content").first().text());

        items.push({
            mangaId,
            title,
            imageUrl,
            contentRating: contentRatingForGenres(genres),
            genres,
            alternativeTitle: pickOriginalTitle(alternative, title),
            status: status.length > 0 ? status : undefined,
            chapter: parseListingChapter($, item),
            rating: Number.isFinite(rawRating) ? rawRating : undefined,
        });
    }

    return items;
}

/**
 * Pulls one named rail off the home page.
 *
 * The rails carry no ids, so they are located by their heading text. The
 * heading is cloned and stripped of children first, because it also holds a
 * "see all" link whose text would otherwise be part of the comparison.
 */
export function parseHomepageRail($: CheerioAPI, title: string): MangaListItem[] {
    const heading = $(".tp-heading")
        .filter((_, element) => {
            const clone = $(element).clone();
            clone.children().remove();
            return cleanText(clone.text()).toLowerCase() === title.toLowerCase();
        })
        .first();

    const block = heading.nextAll(".wp-block-wp-manga-gutenberg-manga-sliders-block").first();
    return parseMangaList($, block.find(".related__item, .slider__item").toArray());
}

/** Reads the genre checkboxes off the search form. */
export function parseGenreTags($: CheerioAPI): Tag[] {
    const tags: Tag[] = [];
    const seenIds = new Set<string>();
    const seenTitles = new Set<string>();

    for (const element of $('input[name="genre[]"]').toArray()) {
        const input = $(element);
        const id = sanitizeId(input.attr("value") ?? "");
        const title = cleanText($(`label[for="${input.attr("id") ?? ""}"]`).first().text()).replace(
            /\s+,\s*$/,
            "",
        );

        if (
            id.length === 0 ||
            title.length === 0 ||
            title.length > 64 ||
            NOT_A_GENRE.test(title) ||
            seenIds.has(id) ||
            seenTitles.has(title.toLowerCase())
        ) {
            continue;
        }

        seenIds.add(id);
        seenTitles.add(title.toLowerCase());
        tags.push({ id, title });
    }

    return tags.sort((left, right) => left.title.localeCompare(right.title));
}

export function hasNextPage($: CheerioAPI): boolean {
    return $("a.nextpostslink, a[rel='next']").length > 0;
}

/**
 * Builds a home page tile.
 *
 * 0.8 tiles carry a single subtitle line, so the newest chapter, the rating
 * and the status are joined into one where more than one is known.
 */
export function toDiscoverItem(item: MangaListItem): DiscoverSectionItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([item.chapter?.title, item.rating === undefined ? undefined : `★ ${item.rating}`]),
    };
}

/** Like `toDiscoverItem`, but only for entries that actually have a new chapter. */
export function toChapterUpdateItem(item: MangaListItem): DiscoverSectionItem | undefined {
    if (item.chapter === undefined) {
        return undefined;
    }

    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: item.chapter.title,
        chapterId: item.chapter.chapterId,
        publishDate: item.chapter.publishDate,
    };
}

export function toSearchResultItem(item: MangaListItem): SearchResultItem {
    return {
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        subtitle: joinDetails([item.chapter?.title, item.status]),
        contentRating: item.contentRating,
    };
}

function joinDetails(parts: Array<string | undefined>): string | undefined {
    const joined = parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ");
    return joined.length > 0 ? joined : undefined;
}

/** Finds the value of a labelled row on the details page. */
function labelledContent($: CheerioAPI, label: string): Cheerio<AnyNode> | undefined {
    for (const element of $(".post-content_item").toArray()) {
        const item = $(element);
        const heading = cleanText(item.find(".summary-heading").first().text())
            .replace(/\(s\)$/i, "")
            .toLowerCase();

        if (heading === label.toLowerCase()) {
            return item.find(".summary-content").first();
        }
    }
    return undefined;
}

function tagsFrom($: CheerioAPI, selector: string): Tag[] {
    const tags: Tag[] = [];
    const seen = new Set<string>();

    for (const element of $(selector).toArray()) {
        const link = $(element);
        const href = (link.attr("href") ?? "").replace(/\/+$/, "");
        const id = sanitizeId(href.split("/").pop() ?? "");
        const title = cleanText(link.text());

        if (id.length === 0 || title.length === 0 || seen.has(id)) {
            continue;
        }
        seen.add(id);
        tags.push({ id, title });
    }

    return tags;
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const primaryTitle = cleanText($(".profile-manga .post-title h1, .post-title h1, #manga-title h1").first().text());
    const thumbnailUrl = imageUrlFrom($(".summary_image img, .tab-summary img").first());

    // Without these two the details screen has nothing to show, and an empty
    // entry is worse than a visible failure.
    if (primaryTitle.length === 0 || thumbnailUrl.length === 0) {
        throw new Error(`Unable to read the details page for ${mangaId}.`);
    }

    const genres = tagsFrom($, ".genres-content a");
    const tags = tagsFrom($, ".tags-content a");
    const rawRating = Number.parseFloat(
        $("#averagerate, [itemprop=ratingValue], .post-total-rating .score").first().text(),
    );

    const tagGroups: TagSection[] = [];
    if (genres.length > 0) {
        tagGroups.push({ id: "genres", title: "Genres", tags: genres });
    }
    if (tags.length > 0) {
        tagGroups.push({ id: "tags", title: "Tags", tags });
    }

    const author = namedPerson($, ".author-content", "Author");
    const artist = namedPerson($, ".artist-content", "Artist");
    const status = cleanText(labelledContent($, "Status")?.text());

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles: splitTitles(cleanText(labelledContent($, "Alternative")?.text()), primaryTitle),
            thumbnailUrl,
            synopsis: cleanDescription(
                $(".description-summary .summary__content, .description-summary, .manga-excerpt").first().text(),
            ),
            author,
            artist,
            status: status.length > 0 ? status : "Unknown",
            // The site rates out of five; the app expects a fraction of one.
            rating: Number.isFinite(rawRating) ? Math.min(1, Math.max(0, rawRating / 5)) : undefined,
            contentRating: contentRatingForGenres(genres.map((genre) => genre.title)),
            tagGroups,
        },
    };
}

/** Reads an author or artist, treating the theme's placeholder as absent. */
function namedPerson($: CheerioAPI, selector: string, label: string): string | undefined {
    const direct = cleanText($(selector).first().text());
    const value = direct.length > 0 ? direct : cleanText(labelledContent($, label)?.text());
    return value.length === 0 || /^updating$/i.test(value) ? undefined : value;
}

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
    // Locked chapters render as list items too, but lead to a paywall.
    const nodes = $("li.wp-manga-chapter:not(.premium)").toArray();
    const seen = new Set<string>();

    const chapters = nodes.flatMap((element, index) => {
        const item = $(element);
        const link = item.find("a").first();
        const chapterId = chapterIdFromUrl(link.attr("href"));
        const rawTitle = cleanText(link.text());

        if (chapterId.length === 0 || seen.has(chapterId)) {
            return [];
        }
        seen.add(chapterId);

        return [
            {
                chapterId,
                sourceManga,
                langCode: "🇬🇧",
                chapNum: chapterNumber(rawTitle.length > 0 ? rawTitle : chapterId) ?? 0,
                title: chapterTitle(rawTitle),
                volume: volumeNumber(rawTitle),
                // The page lists newest first; the app wants oldest lowest.
                sortingIndex: nodes.length - index,
                publishDate: parseDate(
                    item.find(".chapter-release-date .c-new-tag").first().attr("title") ??
                        item.find(".chapter-release-date").text(),
                ),
            },
        ];
    });

    if (chapters.length === 0) {
        throw new Error(`No readable chapters were found for ${sourceManga.mangaInfo.primaryTitle}.`);
    }
    return chapters;
}

export function parseChapterDetails($: CheerioAPI, chapter: Chapter): ChapterDetails {
    const pages = $(".reading-content .page-break img, .reading-content img.wp-manga-chapter-img")
        .toArray()
        .map((element) => imageUrlFrom($(element)))
        .filter((url) => url.length > 0);

    if (pages.length === 0) {
        throw new Error(
            `No pages were found for ${chapter.sourceManga.mangaInfo.primaryTitle}, chapter ${chapter.chapNum}.`,
        );
    }

    return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        pages,
    };
}
