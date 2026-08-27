/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import {
    ContentRating,
    type Chapter,
    type ChapterDetails,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import {
    isOfficialTeam,
    type CatalogItem,
    type ChapterEntry,
    type HomeLinkCard,
    type HomeUpdate,
    type ReaderChapter,
    type SeriesProps,
    type TopSeriesCountry,
} from "./models";
import { getShowAllVersions } from "./site";

const FLIGHT_CHUNK = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

const COVER_URL =
    /https:\/\/opics\.online\/media\/covers\/[^"\\\s]+\.(?:jpe?g|png|webp|gif|avif)(?:\?[^"\\\s]*)?/i;

/**
 * Reassembles the page's data stream.
 *
 * A rendered page pushes its data over in chunks; joining and unescaping them
 * gives back the same text the data route would have sent directly.
 */
export function decodeFlightPayload(html: string): string {
    const parts: string[] = [];
    let match: RegExpExecArray | null;

    FLIGHT_CHUNK.lastIndex = 0;
    while ((match = FLIGHT_CHUNK.exec(html)) !== null) {
        try {
            parts.push(JSON.parse(`"${match[1]}"`) as string);
        } catch {
            // A chunk that will not parse is skipped; the rest still joins up.
        }
    }

    return parts.length > 0 ? parts.join("") : html;
}

function extractBalancedJson(text: string, start: number): string | undefined {
    const open = text[start];
    const close = open === "{" ? "}" : open === "[" ? "]" : undefined;
    if (close === undefined) {
        return undefined;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === open) {
            depth += 1;
        } else if (char === close) {
            depth -= 1;
            if (depth === 0) {
                return text.slice(start, index + 1);
            }
        }
    }

    return undefined;
}

function parseJsonAt<T>(payload: string, anchor: string, offset = 0): T | undefined {
    const index = payload.indexOf(anchor);
    if (index < 0) {
        return undefined;
    }

    const blob = extractBalancedJson(payload, index + offset);
    if (blob === undefined) {
        return undefined;
    }

    try {
        return JSON.parse(blob) as T;
    } catch {
        return undefined;
    }
}

/**
 * Resolves a value the stream deduped into a row of its own.
 *
 * A long description arrives as a pointer like "$1b"; the row it names carries
 * the real text, prefixed by its length in bytes.
 */
function resolveFlightTextReference(payload: string, value: string | undefined): string | undefined {
    const reference = /^\$([0-9a-f]+)$/i.exec(value ?? "")?.[1];
    if (reference === undefined) {
        return value;
    }

    const marker = new RegExp(`(?:^|\\n)${reference}:T([0-9a-f]+),`, "i").exec(payload);
    if (marker === null) {
        return value;
    }

    const byteLength = parseInt(marker[1] ?? "0", 16);
    const start = marker.index + marker[0].length;
    let bytes = 0;
    let resolved = "";

    for (const character of payload.slice(start)) {
        const codePoint = character.codePointAt(0) ?? 0;
        const characterBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;

        if (bytes + characterBytes > byteLength) {
            return value;
        }
        resolved += character;
        bytes += characterBytes;

        if (bytes === byteLength) {
            return resolved;
        }
    }

    return value;
}

export function parseCatalogItems(items: CatalogItem[] | undefined): CatalogItem[] {
    return (items ?? []).filter((item) => Boolean(item.slug) && Boolean(item.title));
}

export function getContentRatingForGenres(genres: string[] | undefined): ContentRating {
    const lower = (genres ?? []).map((genre) => genre.toLowerCase());

    if (["hentai", "adult", "smut", "lolicon", "shotacon"].some((genre) => lower.includes(genre))) {
        return ContentRating.ADULT;
    }
    if (["ecchi", "mature", "harem"].some((genre) => lower.includes(genre))) {
        return ContentRating.MATURE;
    }
    return ContentRating.EVERYONE;
}

export function toSearchResultItem(item: CatalogItem): SearchResultItem {
    const chapters = item._count?.chapters ?? 0;

    return {
        mangaId: item.slug,
        title: item.title,
        imageUrl: item.poster,
        contentRating: getContentRatingForGenres(item.genres),
        subtitle: chapters > 0 ? `${chapters} chapters` : (item.type ?? ""),
    };
}

export function toProminentCarouselItem(item: CatalogItem): DiscoverSectionItem {
    return {
        type: "prominentCarouselItem",
        mangaId: item.slug,
        title: item.title,
        imageUrl: item.poster,
        subtitle:
            typeof item.rating === "number" && item.rating > 0
                ? `Rating ${item.rating.toFixed(1)}`
                : (item.type ?? ""),
    };
}

export function toSimpleCarouselItem(item: CatalogItem): DiscoverSectionItem {
    const chapters = item._count?.chapters ?? 0;

    return {
        type: "simpleCarouselItem",
        mangaId: item.slug,
        title: item.title,
        imageUrl: item.poster,
        subtitle: chapters > 0 ? `Ch. ${chapters}` : (item.type ?? ""),
    };
}

export function toFeaturedItem(item: CatalogItem): DiscoverSectionItem {
    return {
        type: "featuredCarouselItem",
        mangaId: item.slug,
        title: item.title,
        imageUrl: item.poster,
        // 0.9 gave this tile a type line and a row of counters; 0.8 has one
        // line, so both go on it.
        subtitle:
            [item.type ?? "", item.year !== undefined ? String(item.year) : ""]
                .filter((part) => part.length > 0)
                .join(" • ") || undefined,
    };
}

export function toHomeCarouselItem(item: CatalogItem): DiscoverSectionItem {
    return {
        type: "simpleCarouselItem",
        mangaId: item.slug,
        title: item.title,
        imageUrl: item.poster,
        subtitle:
            [item.type ?? "", item.year !== undefined ? String(item.year) : ""]
                .filter((part) => part.length > 0)
                .join(" ") || undefined,
    };
}

export function toLinkCardSimpleItem(card: HomeLinkCard): DiscoverSectionItem {
    return {
        type: "simpleCarouselItem",
        mangaId: card.slug,
        title: card.title,
        imageUrl: card.cover,
        subtitle: [card.type ?? "", card.year ?? ""].filter((part) => part.length > 0).join(" ") || undefined,
    };
}

export function toLinkCardProminentItem(card: HomeLinkCard, index: number): DiscoverSectionItem {
    return {
        type: "prominentCarouselItem",
        mangaId: card.slug,
        title: card.title,
        imageUrl: card.cover,
        subtitle: `#${index + 1}`,
    };
}

/** A home page shelf whose items the page data carries as a list. */
export function parseHomeSection(html: string, title: string): CatalogItem[] {
    const payload = decodeFlightPayload(html);

    const heading = payload.indexOf(`{"title":"${title}","moreHref"`);
    if (heading < 0) {
        return [];
    }

    const arrayStart = payload.indexOf('"items":[', heading);
    if (arrayStart < 0) {
        return [];
    }

    const blob = extractBalancedJson(payload, arrayStart + '"items":'.length);
    if (blob === undefined) {
        return [];
    }

    try {
        return parseCatalogItems(JSON.parse(blob) as CatalogItem[]);
    } catch {
        return [];
    }
}

export function parseHomeTopSeries(html: string, country: TopSeriesCountry): CatalogItem[] {
    const groups = parseJsonAt<Partial<Record<TopSeriesCountry, CatalogItem[]>>>(
        decodeFlightPayload(html),
        '{"korea":[',
    );
    return parseCatalogItems(groups?.[country]);
}

/** A row the stream deferred, named by its id rather than inlined. */
function resolveLazyRow(payload: string, id: string): string | undefined {
    const marker = new RegExp(`(?:^|\\n)${id}:`).exec(payload);
    if (marker === null) {
        return undefined;
    }

    const start = marker.index + marker[0].length;
    if (payload[start] !== "[") {
        return undefined;
    }
    return extractBalancedJson(payload, start);
}

function unescapeText(raw: string): string {
    try {
        return JSON.parse(`"${raw}"`) as string;
    } catch {
        return raw;
    }
}

/**
 * Reads the cards out of a rendered shelf.
 *
 * These shelves are markup rather than data, so each card is found by its link
 * and the rest is read from the slice of text that follows it.
 */
function parseLinkCards(fragment: string): HomeLinkCard[] {
    const cards: HomeLinkCard[] = [];
    const anchors = [...fragment.matchAll(/"href":"\/manga\/([a-z0-9-]+)"/g)];

    for (let index = 0; index < anchors.length; index += 1) {
        const anchor = anchors[index];
        if (anchor === undefined) {
            continue;
        }

        const start = anchor.index ?? 0;
        const end = index + 1 < anchors.length ? (anchors[index + 1]?.index ?? fragment.length) : fragment.length;
        const segment = fragment.slice(start, end);

        const cover = /"src":"(https:\/\/[^"]+)"/.exec(segment)?.[1];
        const alt = /"alt":"((?:[^"\\]|\\.)*)"/.exec(segment)?.[1];
        if (cover === undefined || alt === undefined) {
            continue;
        }

        const sub = /"hl-card-sub","children":\["((?:[^"\\]|\\.)*)"," (\d{4})"\]/.exec(segment);

        cards.push({
            slug: anchor[1] ?? "",
            title: unescapeText(alt),
            cover,
            type: sub?.[1] !== undefined ? unescapeText(sub[1]) : undefined,
            year: sub?.[2],
        });
    }

    return cards;
}

export function parseHomeLinkSection(html: string, heading: string, containerMarker: string): HomeLinkCard[] {
    const payload = decodeFlightPayload(html);

    const headingIndex = payload.indexOf(`"children":"${heading}"`);
    if (headingIndex < 0) {
        return [];
    }

    const containerIndex = payload.indexOf(containerMarker, headingIndex);
    if (containerIndex < 0) {
        return [];
    }

    const arrayStart = payload.indexOf('"children":[', containerIndex);
    if (arrayStart < 0) {
        return [];
    }

    const blob = extractBalancedJson(payload, arrayStart + '"children":'.length);
    if (blob === undefined) {
        return [];
    }

    const cards: HomeLinkCard[] = [];
    const tokens = [...blob.matchAll(/"href":"\/manga\/([a-z0-9-]+)"|"\$L([0-9a-f]+)"/g)];

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === undefined) {
            continue;
        }

        if (token[1] !== undefined) {
            const start = token.index ?? 0;
            const end = index + 1 < tokens.length ? (tokens[index + 1]?.index ?? blob.length) : blob.length;
            cards.push(...parseLinkCards(blob.slice(start, end)));
        } else if (token[2] !== undefined) {
            const row = resolveLazyRow(payload, token[2]);
            if (row !== undefined) {
                cards.push(...parseLinkCards(row));
            }
        }
    }

    const seen = new Set<string>();
    return cards.filter((card) => {
        if (card.slug.length === 0 || seen.has(card.slug)) {
            return false;
        }
        seen.add(card.slug);
        return true;
    });
}

/** Reads a date the stream writes with a "$D" prefix. */
function parsePayloadDate(value?: string | null): Date | undefined {
    if (value === null || value === undefined || value.length === 0) {
        return undefined;
    }

    const parsed = new Date(value.replace(/^\$D/, ""));
    return isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseHomeUpdates(html: string): DiscoverSectionItem[] {
    const payload = decodeFlightPayload(html);
    const updates = parseJsonAt<HomeUpdate[]>(payload, '"updates":[', '"updates":'.length) ?? [];

    const seen = new Set<string>();
    const items: DiscoverSectionItem[] = [];

    for (const update of updates) {
        const manga = update.manga;
        if (manga?.slug === undefined || !manga.poster || typeof update.number !== "number") {
            continue;
        }
        if (seen.has(manga.slug)) {
            continue;
        }
        seen.add(manga.slug);

        items.push({
            type: "chapterUpdatesCarouselItem",
            mangaId: manga.slug,
            chapterId: String(update.number),
            title: manga.title,
            imageUrl: manga.poster,
            subtitle: `Ch. ${update.number}`,
            publishDate: parsePayloadDate(update.createdAt),
        });
    }

    return items;
}

export function parseSeriesProps(html: string, slug: string): SeriesProps {
    const payload = decodeFlightPayload(html);
    const props = parseJsonAt<SeriesProps>(payload, '{"initialTab"');

    if (props === undefined || !props.title) {
        throw new Error(`No series data was found for ${slug}; the page layout may have changed.`);
    }

    return { ...props, description: resolveFlightTextReference(payload, props.description) };
}

/** The cover, which the page carries in several places depending on the route. */
export function parseCoverUrl(html: string): string {
    const payload = decodeFlightPayload(html);

    for (const source of [payload, html]) {
        const cover =
            COVER_URL.exec(source)?.[0] ??
            /"image":"(https:\/\/[^"]+\.(?:jpe?g|png|webp|gif|avif))"/i.exec(source)?.[1] ??
            /property="og:image"\s+content="([^"]+)"/.exec(source)?.[1] ??
            /"og:image","content":"([^"]+)"/.exec(source)?.[1];

        if (cover !== undefined) {
            return cover;
        }
    }

    return "";
}

function contentRatingForSeries(props: SeriesProps): ContentRating {
    const age = (props.ageRating ?? "").trim();
    if (age === "18+" || age === "21+") {
        return ContentRating.ADULT;
    }
    if (age === "15+" || age === "16+") {
        return ContentRating.MATURE;
    }

    const fromGenres = getContentRatingForGenres(props.genres);
    return fromGenres === ContentRating.ADULT ? fromGenres : ContentRating.EVERYONE;
}

function toTagSection(id: string, title: string, names: string[]): TagSection | undefined {
    if (names.length === 0) {
        return undefined;
    }

    const tags: Tag[] = names.map((name) => ({
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title: name,
    }));
    return { id, title, tags };
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
    const props = parseSeriesProps(html, mangaId);

    const tagGroups = [
        toTagSection("genres", "Genres", props.genres ?? []),
        toTagSection("tags", "Tags", props.tags ?? []),
    ].filter((section): section is TagSection => section !== undefined);

    return {
        mangaId,
        mangaInfo: {
            thumbnailUrl: parseCoverUrl(html),
            synopsis: props.description ?? "",
            primaryTitle: props.title,
            secondaryTitles: props.altNames ?? [],
            contentRating: contentRatingForSeries(props),
            status: props.status ?? "Unknown",
            artist: props.artist || undefined,
            author: props.author || undefined,
            tagGroups,
        },
    };
}

function toChapter(entry: ChapterEntry, sourceManga: SourceManga, allVersions: boolean): Chapter {
    const teamName = entry.team?.name ?? entry.translator ?? undefined;
    // A star marks an official release, which is usually the better scan.
    const group =
        teamName !== undefined && isOfficialTeam(teamName, entry.team?.slug) ? `★ ${teamName}` : teamName;

    // With every version listed, the team has to be part of the id or two
    // versions of the same chapter would collide.
    const teamSuffix =
        allVersions && entry.team?.slug !== undefined ? `?team=${encodeURIComponent(entry.team.slug)}` : "";

    return {
        chapterId: `${entry.number}${teamSuffix}`,
        sourceManga,
        langCode: "🇬🇧",
        chapNum: entry.number,
        title: entry.title?.trim() ?? "",
        volume: 0,
        group,
        sortingIndex: entry.number,
        publishDate: parsePayloadDate(entry.createdAt),
    };
}

export function parseChapters(html: string, sourceManga: SourceManga): Chapter[] {
    const props = parseSeriesProps(html, sourceManga.mangaId);
    const allVersions = getShowAllVersions();

    const seen = new Set<string>();
    const chapters: Chapter[] = [];

    for (const entry of props.chapters ?? []) {
        if (entry.isLocked === true || typeof entry.number !== "number") {
            continue;
        }

        const key = allVersions ? `${entry.number}|${entry.team?.slug ?? ""}` : String(entry.number);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        chapters.push(toChapter(entry, sourceManga, allVersions));
    }

    return chapters;
}

export function parseChapterDetails(html: string, chapter: Chapter): ChapterDetails {
    const payload = decodeFlightPayload(html);
    const reader = parseJsonAt<ReaderChapter>(payload, '"chapter":{"id":', '"chapter":'.length);

    const pages =
        reader?.pages !== undefined && reader.pages.length > 0 ? reader.pages : (reader?.pagesAlt ?? []);

    if (pages.length === 0) {
        throw new Error(`No pages were returned for chapter ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
}
