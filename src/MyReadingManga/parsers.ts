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

import { DOMAIN, LANGUAGES, type FilterTaxonomies, type MangaCard } from "./models";

const IMAGE_EXTENSION = /\.(jpg|jpeg|png|webp|gif|avif)/i;

/** Characters the app refuses to accept inside an id. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

function sanitizeId(value: string): string {
    return value.toLowerCase().replace(UNSAFE_ID, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// Entry titles carry the circle and the language alongside the work itself —
// "[Author] Title [Eng] (Update)" — so both are stripped for display.
function cleanTitle(raw: string): string {
    const withoutBrackets = raw.replace(/\[[^\]]*\]/g, "").trim();
    const parenIndex = withoutBrackets.lastIndexOf("(");
    return (parenIndex > 0 ? withoutBrackets.slice(0, parenIndex) : withoutBrackets).trim();
}

function bracketAuthor(raw: string): string | undefined {
    return /\[([^\]]+)\]/.exec(raw)?.[1]?.trim();
}

function imageFrom(img: Cheerio<AnyNode>): string {
    for (const attribute of ["data-src", "data-cfsrc", "src", "data-lazy-src"]) {
        const value = (img.attr(attribute) ?? "").trim();
        if (!IMAGE_EXTENSION.test(value)) {
            continue;
        }
        if (value.startsWith("http")) {
            return value;
        }
        if (value.startsWith("//")) {
            return `https:${value}`;
        }
        if (value.startsWith("/")) {
            return `${DOMAIN}${value}`;
        }
    }
    return "";
}

// A thumbnail's URL carries its size ("-150x216.jpg"); the full image lives at
// the same address without it.
function stripThumbnailSize(src: string): string {
    return src.replace(/-\d+x\d+(\.\w+)$/, "$1");
}

function toMangaId(href: string): string {
    return href
        .replace(/^https?:\/\/[^/]+\//, "")
        .replace(/[?#].*$/, "")
        .replace(/\/+$/, "");
}

export interface ListingFilter {
    languages?: string[];
    excludeClasses?: string[];
}

export function parseListing($: CheerioAPI, filter: ListingFilter = {}): MangaCard[] {
    const cards: MangaCard[] = [];
    const seen = new Set<string>();
    const languages = filter.languages ?? [];
    const excluded = new Set(filter.excludeClasses ?? []);

    for (const element of $("article, div.post, div.item, ul.wpp-list li").toArray()) {
        const article = $(element);
        const classes = article.attr("class") ?? "";

        // Video posts have no pages to read.
        if (classes.includes("category-video")) {
            continue;
        }

        const classList = classes.split(/\s+/);
        if (classList.some((name) => excluded.has(name))) {
            continue;
        }

        // An entry with no language class at all is kept; only a stated one
        // outside the chosen set is dropped.
        if (
            languages.length > 0 &&
            classes.includes("lang-") &&
            !languages.some((language) => classList.includes(`lang-${language}`))
        ) {
            continue;
        }

        const link = article
            .find(".entry-title a, h1 a, h2 a, h3 a, a.wpp-post-title, a[rel=bookmark]")
            .first();
        const href = (link.attr("href") ?? "").trim();
        const title = cleanTitle(Application.decodeHTMLEntities(link.text().trim()));

        if (href.length === 0 || title.length === 0) {
            continue;
        }

        const mangaId = toMangaId(href);
        if (mangaId.length === 0 || seen.has(mangaId)) {
            continue;
        }
        seen.add(mangaId);

        const image = article.find("img.post-image, img.entry-image, img.wpp-thumbnail, img").first();
        cards.push({ mangaId, title, imageUrl: stripThumbnailSize(imageFrom(image)) });
    }

    return cards;
}

export function hasNextPage($: CheerioAPI): boolean {
    return $("a.next.page-numbers, li.pagination-next").length > 0;
}

function detectLanguageCode($: CheerioAPI): string {
    for (const element of $("p.entry-meta span.entry-terms").toArray()) {
        const span = $(element);
        if (!span.find(".meta-label").first().text().includes("Lang")) {
            continue;
        }

        const name = span.find("a").first().text().trim().toLowerCase();
        const language = LANGUAGES.find((entry) => entry.name.toLowerCase() === name);
        if (language !== undefined) {
            return language.code;
        }
    }
    return "en";
}

/** The page's own structured data, which names the full-size cover. */
function schemaThumbnail($: CheerioAPI): string {
    const schema = $("script.yoast-schema-graph").first().text();
    return /"thumbnailUrl":"([^"]+)"/.exec(schema)?.[1]?.replace(/\\\//g, "/") ?? "";
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const heading = Application.decodeHTMLEntities($("h1.entry-title, h1").first().text().trim());
    const author = bracketAuthor(heading);

    const thumbnailUrl =
        schemaThumbnail($) ||
        imageFrom($("img.img-myreadingmanga").first()) ||
        imageFrom($("div.entry-content img").first());

    const collectTags = (selector: string): Tag[] => {
        const tags: Tag[] = [];
        const seen = new Set<string>();

        for (const element of $(selector).toArray()) {
            const title = Application.decodeHTMLEntities($(element).text().trim());
            if (title.length === 0) {
                continue;
            }
            const id = sanitizeId(title);
            if (id.length === 0 || seen.has(id)) {
                continue;
            }
            seen.add(id);
            tags.push({ id, title });
        }

        return tags;
    };

    const tagGroups: TagSection[] = [];
    const genres = collectTags(".entry-header a[href*='/genre/']");
    const tags = collectTags(".entry-header a[href*='/tag/']");
    const categories = collectTags("span.entry-categories a");

    if (genres.length > 0) {
        tagGroups.push({ id: "genres", title: "Genres", tags: genres });
    }
    if (tags.length > 0) {
        tagGroups.push({ id: "tags", title: "Tags", tags });
    }
    if (categories.length > 0) {
        tagGroups.push({ id: "categories", title: "Categories", tags: categories });
    }

    const scanGroups = $(".entry-terms a[href*='/group/']")
        .toArray()
        .map((element) => $(element).text().trim())
        .filter((name) => name.length > 0);

    // A paragraph carrying a pipe is the entry's own metadata row, not prose.
    const paragraphs = $("div.entry-content p")
        .toArray()
        .map((element) => Application.decodeHTMLEntities($(element).text().trim()))
        .filter((text) => text.length > 0 && !text.includes("|"));

    const synopsis = [scanGroups.length > 0 ? `Scanlated by: ${scanGroups.join(", ")}` : "", ...paragraphs]
        .filter((part) => part.length > 0)
        .join("\n");

    const statusText = $("a[href*='/status/']").first().text().trim();

    return {
        mangaId,
        mangaInfo: {
            primaryTitle: cleanTitle(heading),
            secondaryTitles: [],
            thumbnailUrl,
            synopsis,
            author,
            artist: author,
            status: statusText.length > 0 ? statusText : "Unknown",
            contentRating: ContentRating.ADULT,
            tagGroups: tagGroups.length > 0 ? tagGroups : undefined,
        },
    };
}

/**
 * Reads the chapter list.
 *
 * An entry is a single post split into numbered pages, so each of those pages
 * is one chapter and the pagination links say how many there are.
 */
export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
    const langCode = detectLanguageCode($);
    const publishDateText = $(".entry-time").first().text().trim();
    const publishDate = publishDateText.length > 0 ? new Date(publishDateText) : undefined;

    const partNumbers = $("a.page-numbers:not(.next):not(.prev)")
        .toArray()
        .map((element) => parseInt($(element).text().trim(), 10))
        .filter((value) => !isNaN(value));

    const lastPart = Math.max(1, ...partNumbers);
    const chapters: Chapter[] = [];

    for (let part = lastPart; part >= 1; part -= 1) {
        chapters.push({
            chapterId: String(part),
            sourceManga,
            langCode,
            chapNum: part,
            title: `Part ${part}`,
            volume: 0,
            publishDate: publishDate !== undefined && !isNaN(publishDate.getTime()) ? publishDate : undefined,
        });
    }

    return chapters;
}

export function parsePages($: CheerioAPI, chapter: Chapter): ChapterDetails {
    const pages: string[] = [];
    const seen = new Set<string>();

    for (const element of $("div.entry-content img, div.separator img").toArray()) {
        const src = imageFrom($(element));
        if (src.length === 0 || seen.has(src)) {
            continue;
        }
        seen.add(src);
        pages.push(src);
    }

    if (pages.length === 0) {
        throw new Error(
            `No pages were found for chapter ${chapter.chapterId}. The entry may be a video post.`,
        );
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
}

/** The search sidebar carries one widget per filterable facet. */
export function parseFilterTaxonomies($: CheerioAPI): FilterTaxonomies {
    const widgetIds: Record<string, string> = {
        genre: "genre",
        category: "category",
        tag: "tag",
        "circle/ artist": "artist",
        pairing: "pairing",
        status: "status",
    };

    const taxonomies: FilterTaxonomies = {};

    for (const element of $("aside.ep-search-sidebar div.ep-filter-widget").toArray()) {
        const widget = $(element);
        const title = widget.find("h3.ep-filter-title").first().text().trim().toLowerCase();
        const id = widgetIds[title];
        if (id === undefined) {
            continue;
        }

        const options = widget
            .find("div.term")
            .toArray()
            .flatMap((term) => {
                const name = ($(term).attr("data-term-name") ?? "").trim();
                const slug = ($(term).attr("data-term-slug") ?? "").trim();
                return name.length > 0 && slug.length > 0 ? [{ id: slug, title: name }] : [];
            });

        if (options.length > 0) {
            taxonomies[id] = options;
        }
    }

    return taxonomies;
}
