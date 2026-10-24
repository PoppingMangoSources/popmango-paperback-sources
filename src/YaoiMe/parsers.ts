/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import {
    Application,
    ContentRating,
    MangaStatus,
    type Chapter,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import { aesGcmDecrypt, sha256 } from "./crypto";
import {
    DOMAIN,
    FILTERS,
    filterTag,
    type ChapterGroup,
    type ChapterVariant,
    type ContentRatingName,
    type MangaCard,
    type ReaderPage,
} from "./models";

const SAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const SERIES_PATH = /^\/series\/\d+\/[a-zA-Z0-9._~-]+$/;
const CHAPTER_PATH = /^\/chapter\/\d+\/\d+$/;
const RATING_NAMES = new Set(["safe", "suggestive", "erotica", "pornographic"]);

const cleanText = (value?: string | null): string =>
    Application.decodeHTMLEntities(value ?? "")
        .replace(/\s+/g, " ")
        .trim();

const safePath = (value?: string | null): string =>
    (value ?? "")
        .replace(/^https?:\/\/[^/]+/i, "")
        .replace(/[?#].*$/, "")
        .replace(SAFE_ID, "-");

export function parseMangaId(value?: string | null): string {
    const path = safePath(value);
    return SERIES_PATH.test(path) ? path : "";
}

const parseChapterId = (value?: string | null): string => {
    const path = safePath(value);
    return CHAPTER_PATH.test(path) ? path : "";
};

// Tag ids are the percent-encoded name, as the site's /tag/ links carry them; !'*~ are encoded too.
const toTagId = (name: string): string =>
    encodeURIComponent(name).replace(/[!'*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export function fromTagId(id: string): string {
    try {
        return decodeURIComponent(id);
    } catch {
        return id;
    }
}

const absoluteUrl = (value?: string | null, cover = false): string => {
    let path = Application.decodeHTMLEntities(value ?? "").trim();
    if (!path) {
        return "";
    }
    if (path.startsWith("//")) {
        path = `https:${path}`;
    }
    if (!/^https?:\/\//i.test(path)) {
        path = `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`;
    }
    return cover && path.includes("/i/c/") ? `${path.replace(/\?.*$/, "")}?w=720` : path;
};

const ratingFrom = (element: Cheerio<AnyNode>): ContentRatingName => {
    const exact = cleanText(element.find(".card-trail b, .card-trail strong, .badge").text())
        .toLowerCase()
        .match(/safe|suggestive|erotica|pornographic/)?.[0];
    if (exact !== undefined && RATING_NAMES.has(exact)) {
        return exact as ContentRatingName;
    }
    return element.find(".mature-cover, .text-mature").length > 0 ? "erotica" : "safe";
};

export function toContentRating(rating: ContentRatingName): ContentRating {
    if (rating === "pornographic" || rating === "erotica") {
        return ContentRating.ADULT;
    }
    return rating === "suggestive" ? ContentRating.MATURE : ContentRating.EVERYONE;
}

const chapterText = (value?: string): string | undefined => {
    const match = value?.match(/(?:chapters?|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i);
    return match ? `Ch. ${match[1]}` : undefined;
};

function parseCard($: CheerioAPI, node: AnyNode): MangaCard | undefined {
    const element = $(node);
    const titleLink = element.is('a[href^="/series/"]')
        ? element
        : element.find('a.card-title[href^="/series/"], a[title][href^="/series/"]').first();
    const mangaId = parseMangaId(titleLink.attr("href"));
    const title = cleanText(titleLink.attr("title") || titleLink.find(".card-title").text() || titleLink.text());
    if (!mangaId || !title) {
        return undefined;
    }

    const status = cleanText(
        element
            .find(".cover-labels span")
            .filter((_, item) => /ongoing|completed|hiatus|cancelled/i.test($(item).text()))
            .first()
            .text(),
    );
    const facts = element.find('.card-facts, [class~="mt-0.5"].flex.flex-wrap').first();
    const typeName = cleanText(
        facts
            .children("span")
            .filter((_, item) => /^(?:Manga|Manhwa|Manhua|OEL|Novel|Other)$/i.test($(item).text().trim()))
            .first()
            .text(),
    );
    const rating = cleanText(
        element.find(".card-rating").first().text() || element.find(".lucide-star").first().closest("span").text(),
    ).match(/\d+(?:\.\d+)?/)?.[0];
    const chapterLink = element.find('a[href^="/chapter/"]').last();
    const datetime = element.find("time").last().attr("datetime");
    const publishDate = datetime ? new Date(datetime) : undefined;

    return {
        mangaId,
        title,
        imageUrl: absoluteUrl(element.find('img[src*="/i/c/"]').first().attr("src"), true),
        status: status || undefined,
        typeName: typeName || undefined,
        rating,
        chapter:
            chapterText(cleanText(chapterLink.text())) ??
            chapterText(cleanText(element.find(".card-chapters").text())) ??
            chapterText(cleanText(element.text())),
        chapterId: parseChapterId(chapterLink.attr("href")) || undefined,
        publishDate: publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate : undefined,
        contentRating: ratingFrom(element),
    };
}

// The heading sits in a .section-head row; the cards are that row's next sibling.
function sectionContainer($: CheerioAPI, heading: string): Cheerio<AnyNode> {
    const title = $("h2")
        .filter((_, element) => cleanText($(element).text()).toLowerCase() === heading.toLowerCase())
        .first();
    const head = title.closest(".section-head");
    return (head.length ? head : title.parent()).next();
}

export function parseHomeCards($: CheerioAPI, heading: string): MangaCard[] {
    const container = sectionContainer($, heading);
    const candidates =
        heading === "Popular updates"
            ? container.children('a[href^="/series/"]')
            : heading === "Latest releases"
              ? container.find('div.relative.flex:has(a.card-title[href^="/series/"])')
              : container.children(".min-w-0");
    const cards: MangaCard[] = [];
    const seen = new Set<string>();
    candidates.each((_, element) => {
        const card = parseCard($, element);
        if (card !== undefined && !seen.has(card.mangaId)) {
            seen.add(card.mangaId);
            cards.push(card);
        }
    });
    return cards;
}

export function parseBrowseCards($: CheerioAPI): MangaCard[] {
    const cards: MangaCard[] = [];
    const seen = new Set<string>();
    $('a.card-title[href^="/series/"]').each((_, link) => {
        // The outer row first: its text column also carries min-w-0, and the cover is not in it
        const row = $(link).closest("div.relative.flex");
        const element = row.length ? row : $(link).closest("div.min-w-0");
        const card = parseCard($, element.get(0) ?? link);
        if (card !== undefined && !seen.has(card.mangaId)) {
            seen.add(card.mangaId);
            cards.push(card);
        }
    });
    return cards;
}

export function hasNextPage($: CheerioAPI, page: number): boolean {
    return (
        $('a[rel="next"]').length > 0 ||
        $('a[href*="page="]')
            .toArray()
            .some((element) => new RegExp(`[?&]page=${page + 1}(?:&|$)`).test($(element).attr("href") ?? ""))
    );
}

const cardSubtitle = (card: MangaCard): string | undefined =>
    [card.chapter, card.rating ? `★ ${card.rating}` : undefined].filter(Boolean).join(" • ") || undefined;

export function toDiscoverItem(card: MangaCard, type: DiscoverSectionItem["type"]): DiscoverSectionItem | undefined {
    const base = { mangaId: card.mangaId, title: card.title, imageUrl: card.imageUrl };
    switch (type) {
        case "chapterUpdatesCarouselItem":
            return card.chapterId === undefined
                ? undefined
                : { ...base, type, chapterId: card.chapterId, subtitle: cardSubtitle(card), publishDate: card.publishDate };
        case "featuredCarouselItem":
            return { ...base, type, subtitle: [card.status, card.chapter].filter(Boolean).join(" • ") || undefined };
        default:
            return { ...base, type, subtitle: cardSubtitle(card) } as DiscoverSectionItem;
    }
}

export function toSearchResult(card: MangaCard): SearchResultItem {
    return {
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        subtitle: [card.chapter, card.typeName].filter(Boolean).join(" • ") || undefined,
        contentRating: toContentRating(card.contentRating),
    };
}

// The Next.js page payload, where the full chapter list and the reader data live.
function flightData($: CheerioAPI): string {
    let output = "";
    $("script").each((_, element) => {
        const match = ($(element).html() ?? "").match(/^self\.__next_f\.push\(\[1,("[\s\S]*")\]\)$/);
        if (match?.[1] !== undefined) {
            output += JSON.parse(match[1]) as string;
        }
    });
    return output;
}

export function parseGenres($: CheerioAPI): Tag[] {
    const match = flightData($).match(/"genres":(\[[^\]]*\])/);
    if (match?.[1] !== undefined) {
        try {
            const names = (JSON.parse(match[1]) as Array<{ name?: unknown }>)
                .map(({ name }) => name)
                .filter((name): name is string => typeof name === "string" && name.length > 0);
            if (names.length > 0) {
                return names.map((name) => ({ id: toTagId(name), title: name }));
            }
        } catch {
            // Fall back to the genre links below
        }
    }
    const genres = new Map<string, Tag>();
    $('a[href^="/genre/"]').each((_, element) => {
        const title = cleanText($(element).text());
        if (title) {
            genres.set(title, { id: toTagId(title), title });
        }
    });
    return [...genres.values()];
}

function statusOf(value: string | undefined): string {
    switch (value?.toLowerCase()) {
        case "ongoing":
            return MangaStatus.ONGOING;
        case "completed":
            return MangaStatus.COMPLETED;
        case "hiatus":
            return MangaStatus.HIATUS;
        case "cancelled":
            return MangaStatus.CANCELLED;
        default:
            return MangaStatus.UNKNOWN;
    }
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
    const titleElement = $("h1").first();
    const header = titleElement.parent();
    const primaryTitle = cleanText(titleElement.text());
    if (!primaryTitle) {
        throw new Error("Yaoi.me returned a title page without a title.");
    }
    const secondaryTitle = cleanText(titleElement.next("div").text());

    // The credits read "Story by A, B · Art by C"; both name lists link to /author/
    const credits = header.find('a[href^="/author/"]').first().parent();
    const [storyHtml = "", artHtml = ""] = (credits.html() ?? "").split(/Art by/i);
    const names = (html: string): string => {
        const $credits = Application.loadDocument(html);
        return $credits('a[href^="/author/"]')
            .toArray()
            .map((element) => cleanText($credits(element).text()))
            .filter(Boolean)
            .join(", ");
    };
    const artist = names(artHtml);
    const author = names(storyHtml) || artist;

    const headerText = cleanText(header.children("div").first().text());
    const typeName = headerText.match(/Manga|Manhwa|Manhua|OEL|Novel|Other/i)?.[0];
    const ratingName = headerText.toLowerCase().match(/safe|suggestive|erotica|pornographic/)?.[0] as
        | ContentRatingName
        | undefined;
    // Out of 10, in the number beside its "score" label
    const score = Number.parseFloat(
        $("span.text-muted")
            .filter((_, element) => cleanText($(element).text()) === "score")
            .first()
            .prev()
            .text(),
    );

    // Namespaced like the filters, so tapping one searches by it; genres and tags filter separately
    const group = (id: string, title: string, prefix: string, section: string): TagSection => {
        const found = new Set<string>();
        $(`a[href^="${prefix}"]`).each((_, element) => {
            const name = cleanText($(element).text());
            if (name) {
                found.add(name);
            }
        });
        return { id, title, tags: [...found].map((name) => filterTag(section, toTagId(name), name)) };
    };
    const tagGroups = [group("genres", "Genres", "/genre/", FILTERS.GENRE), group("tags", "Tags", "/tag/", TAG_SECTION)].filter(
        (entry) => entry.tags.length > 0,
    );

    const synopsis = cleanText(
        $("h2")
            .filter((_, element) => cleanText($(element).text()) === "Synopsis")
            .first()
            .parent()
            .find(".prose-text")
            .first()
            .text(),
    );

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles: secondaryTitle && secondaryTitle !== primaryTitle ? [secondaryTitle] : [],
            thumbnailUrl: absoluteUrl($('[class*="grid-area:cover"] img').first().attr("src"), true),
            synopsis,
            author: author || undefined,
            artist: artist || author || undefined,
            status: statusOf(headerText.match(/Ongoing|Completed|Hiatus|Cancelled/i)?.[0]),
            contentRating: toContentRating(ratingName ?? ratingFrom(header)),
            rating: Number.isFinite(score) ? Math.min(1, Math.max(0, score / 10)) : undefined,
            tagGroups,
            additionalInfo: typeName ? { Type: typeName } : undefined,
        },
    };
}

export const TAG_SECTION = "tag"; // Filter namespace for a single tag tapped on a details page

const NUMBERED_LABEL = /^(?:vol(?:ume)?\.?\s*\d+(?:\.\d+)?\s*)?(?:chapter|chap|ch|episode|ep)\.?\s*\d+(?:\.\d+)?/i;

// "Vol.2 Ch.1.5" is only a number and "Ch.5: The Fall" carries a title; "Ch.17.2-21" is a range, kept whole.
function chapterTitle(label: string): string | undefined {
    const prefix = NUMBERED_LABEL.exec(label);
    if (!prefix) {
        return label || undefined;
    }
    const rest = label.slice(prefix[0].length).trim();
    if (!rest) {
        return undefined;
    }
    return /^[-–—:]\s*(\D.*)$/.exec(rest)?.[1] ?? label;
}

// The JSON value opening at `start`, reading past brackets inside strings.
function sliceJson(payload: string, start: number): string | undefined {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < payload.length; index++) {
        const char = payload[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
        } else if (char === '"') {
            inString = true;
        } else if (char === "[" || char === "{") {
            depth++;
        } else if (char === "]" || char === "}") {
            depth--;
            if (depth === 0) {
                return payload.slice(start, index + 1);
            }
        }
    }
    return undefined;
}

const isChapterGroup = (value: unknown): value is ChapterGroup =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as ChapterGroup).label === "string" &&
    Array.isArray((value as ChapterGroup).variants);

const numbered = (group: ChapterGroup): group is ChapterGroup & { num: number } =>
    group.numReal !== 0 && typeof group.num === "number" && Number.isFinite(group.num);

const validDate = (value?: number): Date | undefined => {
    const date = value ? new Date(value) : undefined;
    return date && !Number.isNaN(date.getTime()) ? date : undefined;
};

// The HTML renders only the first rows; the full list, with every upload of each chapter, is in
// the page payload. Each upload is a chapter, grouped by its upload source.
export function parseChapters(
    $: CheerioAPI,
    sourceManga: SourceManga,
    languages: string[],
    dedupe: boolean,
): Chapter[] {
    const payload = flightData($);
    const groupsAt = payload.indexOf('"groups":[{');
    const groupsJson = groupsAt >= 0 ? sliceJson(payload, groupsAt + '"groups":'.length) : undefined;
    if (groupsJson === undefined) {
        throw new Error("Yaoi.me's title page no longer carries its chapter list.");
    }
    const sourcesAt = payload.indexOf('"sources":{', groupsAt);
    const sourcesJson = sourcesAt >= 0 ? sliceJson(payload, sourcesAt + '"sources":'.length) : undefined;

    let groups: ChapterGroup[];
    let sources: Record<string, string>;
    try {
        groups = (JSON.parse(groupsJson) as unknown[]).filter(isChapterGroup);
        sources = sourcesJson ? (JSON.parse(sourcesJson) as Record<string, string>) : {};
    } catch {
        throw new Error("Yaoi.me returned a chapter list that could not be read.");
    }

    // Oldest first, keeping the site's placement of extras between chapters
    const inLanguage = [...groups].reverse().flatMap((group) => {
        const variants = group.variants.filter(
            (variant) =>
                typeof variant?.id === "number" && typeof variant.s === "number" && languages.includes(variant.lang || "en"),
        );
        return variants.length > 0 ? [{ group, variants }] : [];
    });
    const toChapter = (group: ChapterGroup, variant: ChapterVariant, title: string | undefined, date?: number) => ({
        chapterId: `/chapter/${variant.s}/${variant.id}`,
        sourceManga,
        title,
        chapNum: numbered(group) ? group.num : 0,
        volume: typeof group.vol === "number" && group.vol > 0 ? group.vol : undefined,
        publishDate: validDate(date ?? group.createdAt),
        langCode: variant.lang || "en",
    });

    if (dedupe) {
        const deduped = dedupeChapters(inLanguage).map(({ group, variant, date }, index): Chapter => ({
            ...toChapter(group, variant, undefined, date),
            chapNum: Math.floor(group.num),
            group: sourceName(sources, variant.s),
            sortingIndex: index + 1,
        }));
        if (deduped.length > 0) {
            return deduped;
        }
    }

    let index = 0;
    return inLanguage.flatMap(({ group, variants }) => {
        const perSource = new Map<number, number>();
        for (const variant of variants) {
            perSource.set(variant.s, (perSource.get(variant.s) ?? 0) + 1);
        }
        const seen = new Map<number, number>();
        return variants.map((variant): Chapter => {
            const name = sourceName(sources, variant.s);
            const occurrence = (seen.get(variant.s) ?? 0) + 1;
            seen.set(variant.s, occurrence);
            // Several uploads from one source are numbered in the site's order
            const groupName = name && (perSource.get(variant.s) ?? 0) > 1 ? `${name} (${occurrence})` : name;
            return {
                ...toChapter(group, variant, chapterTitle(cleanText(group.label))),
                group: groupName,
                sortingIndex: ++index,
            };
        });
    });
}

function sourceName(sources: Record<string, string>, id: number): string | undefined {
    const key = sources[id] ?? "";
    return key ? key.charAt(0).toUpperCase() + key.slice(1) : undefined;
}

// Like the site's "Deduplicate chapters": one entry per volume and whole chapter number, from its
// first upload; extras and unnumbered chapters are left out.
function dedupeChapters(
    entries: Array<{ group: ChapterGroup; variants: ChapterVariant[] }>,
): Array<{ group: ChapterGroup & { num: number }; variant: ChapterVariant; date?: number }> {
    const buckets = new Map<string, Array<{ group: ChapterGroup & { num: number }; variants: ChapterVariant[] }>>();
    for (const { group, variants } of entries) {
        if (!numbered(group) || group.extra === true || !variants.some((variant) => variant.d !== 1)) {
            continue;
        }
        const key = `${group.vol ?? 0}:${Math.floor(group.num)}`;
        buckets.set(key, [...(buckets.get(key) ?? []), { group, variants }]);
    }
    return [...buckets.values()].flatMap((bucket) => {
        const first = bucket.reduce((best, entry) => (entry.group.num < best.group.num ? entry : best));
        const variant = first.variants.find((entry) => entry.d !== 1) ?? first.variants[0];
        const date = Math.max(...bucket.map((entry) => entry.group.createdAt ?? 0)) || undefined;
        return variant !== undefined ? [{ group: first.group, variant, date }] : [];
    });
}

// A sealed list is inline, or a "$<id>" pointing at a text row "<id>:T<hex length>,<data>".
function sealedValue(payload: string): string | undefined {
    const value = payload.match(/"sealed":"([^"]+)"/)?.[1];
    if (value === undefined || !value.startsWith("$")) {
        return value;
    }
    const header = new RegExp(`(?:^|\\n)${value.slice(1)}:T([0-9a-f]+),`, "i").exec(payload);
    if (header?.[1] === undefined) {
        return undefined;
    }
    const start = header.index + header[0].length;
    return payload.slice(start, start + Number.parseInt(header[1], 16));
}

// The key lives in one of the page's scripts and changes with each deploy, so the build id and
// the script list come along to find it.
export function parseReaderPage(html: string): ReaderPage {
    const $ = Application.loadDocument(html);
    const payload = flightData($);
    const pages = payload.match(/"pages":\[([\s\S]*?)\],"chapters"/)?.[1] ?? "";
    const scripts = new Set<string>();
    for (const match of payload.matchAll(/\/_next\/static\/chunks\/[\w.-]+\.js/g)) {
        scripts.add(match[0]);
    }
    $('script[src^="/_next/static/chunks/"]').each((_, element) => {
        scripts.add($(element).attr("src") ?? "");
    });
    return {
        hashes: [...pages.matchAll(/"hash":"([^"]+)"/g)].map((match) => match[1] ?? "").filter(Boolean),
        sealed: sealedValue(payload),
        build: payload.match(/"b":"([^"]+)"/)?.[1],
        scripts: [...scripts].filter(Boolean).map((path) => `${DOMAIN}${path}`),
    };
}

const BYTE_LIST = "(\\d{1,3}(?:,\\d{1,3}){31})";

// The script exports sealKey as a 32-byte list XORed with a mask declared in the same module.
export function parseSealKey(script: string): string | undefined {
    const at = script.indexOf('"sealKey"');
    if (at < 0) {
        return undefined;
    }
    const module = script.slice(Math.max(0, script.lastIndexOf('"use strict"', at)), at + 400);
    const keyList = new RegExp(`"sealKey",0,\\(\\)=>\\w*\\(?\\[${BYTE_LIST}\\]`).exec(module)?.[1];
    if (keyList === undefined) {
        return undefined;
    }
    const maskName = /=>\w+\^(\w+)\[\w+\]/.exec(module)?.[1];
    const maskList = maskName ? new RegExp(`\\b${maskName}=\\[${BYTE_LIST}\\]`).exec(module)?.[1] : undefined;
    const mask = maskList ? maskList.split(",").map(Number) : [];
    return keyList
        .split(",")
        .map((byte, index) => (Number(byte) ^ (mask[index] ?? 0)).toString(16).padStart(2, "0"))
        .join("");
}

// sealed = base64url(salt[16] || iv[12] || ciphertext || tag[16]); AES key = SHA-256(seed || salt)
export function decryptPageList(sealed: string, keyHex: string): string[] {
    const data = Application.base64DecodeBytes(sealed);
    if (data.length < 44) {
        throw new Error("The sealed page list is too short.");
    }
    const seed = Uint8Array.from((keyHex.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16)));
    const material = new Uint8Array(seed.length + 16);
    material.set(seed);
    material.set(data.subarray(0, 16), seed.length);
    const plain = aesGcmDecrypt(sha256(material), data.subarray(16, 28), data.subarray(28));
    const manifest = JSON.parse(Application.utf8Decode(plain)) as { p?: unknown };
    return Array.isArray(manifest.p) ? manifest.p.filter((hash): hash is string => typeof hash === "string" && hash.length > 0) : [];
}

export const toPageUrls = (hashes: string[]): string[] => hashes.map((hash) => `${DOMAIN}/i/p/${hash}`);
