/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

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

import { decodeBase64Url, unwrapPageKey, type ReaderKey } from "./crypto";
import {
    CONTENT_TAGS,
    DOMAIN,
    FILTERS,
    FORMAT_TAGS,
    PORNOGRAPHIC_TAGS,
    STATUS_NAMES,
    TAG_GROUPS,
    THEME_TAGS,
    UNLISTED_TAGS,
    filterTag,
    type ChapterEntry,
    type ChapterRelease,
    type ContentRatingId,
    type FacetsResponse,
    type LatestResponse,
    type ReaderKeyResponse,
    type Series,
    type SeriesResponse,
    type UploadChoice,
} from "./models";
import { encodePageUrl } from "./network";

// A tag id is the name percent-encoded so it passes the app's id rules and
// decodes back to the name the browse filters expect. encodeURIComponent
// leaves !'*~ alone, and the app rejects them.
export const toTagId = (name: string): string =>
    encodeURIComponent(name).replace(/[!'*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export const fromTagId = (id: string): string => {
    try {
        return decodeURIComponent(id);
    } catch {
        return id;
    }
};

const HID_REGEX = /^[a-z][0-9a-z]{4}$/;

export const parseMangaIdFromUrl = (value: string): string | undefined => {
    const hid = value.match(/^(?:https?:\/\/)?toonkotsu\.com\/title\/([a-z][0-9a-z]{4})(?:[-/?#]|$)/i)?.[1];
    return hid && HID_REGEX.test(hid) ? hid : undefined;
};

const COVER_SIZE_REGEX = /\/(?:220|460|720)\.webp$/;

const toAbsoluteUrl = (path: string): string =>
    path.startsWith("http") ? path : `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`;

const parseCoverUrl = (cover: string | null | undefined, size: 460 | 720 = 460): string =>
    cover ? toAbsoluteUrl(cover).replace(COVER_SIZE_REGEX, `/${size}.webp`) : `${DOMAIN}/images/cover.webp`;

// The site's own rating ladder: a series flagged adult or tagged Hentai is
// pornographic, Smut or Adult is erotica, Ecchi or Mature is suggestive.
export const parseRatingId = (series: Series): ContentRatingId => {
    const tags = series.tags ?? [];
    if (series.adult || tags.includes("Hentai")) {
        return "pornographic";
    }
    if (tags.some((tag) => tag === "Smut" || tag === "Adult")) {
        return "erotica";
    }
    if (tags.some((tag) => tag === "Ecchi" || tag === "Mature")) {
        return "suggestive";
    }
    return "safe";
};

const toContentRating = (rating: ContentRatingId): ContentRating => {
    switch (rating) {
        case "safe":
            return ContentRating.EVERYONE;
        case "suggestive":
            return ContentRating.MATURE;
        default:
            return ContentRating.ADULT;
    }
};

const cleanText = (value: string | null | undefined): string =>
    Application.decodeHTMLEntities(value ?? "")
        .replace(/\s+/g, " ")
        .trim();

// Scores are out of 100.
const scoreOutOfTen = (score: number | null | undefined): number | undefined =>
    score && score > 0 ? score / 10 : undefined;

const formatCount = (count: number): string => (count >= 1000 ? `${Number((count / 1000).toFixed(1))}K` : String(count));

const formatChapterNumber = (value: number): string => String(Number(value.toFixed(2)));

const joinDetails = (parts: Array<string | undefined>): string | undefined =>
    parts.filter((part): part is string => part !== undefined && part.length > 0).join(" • ") || undefined;

// A oneshot is numbered 0 and labelled as such, so its label reads better than "Ch. 0".
const chapterSubtitle = (series: Series): string | undefined => {
    const number = series.latest?.n;
    const label = cleanText(series.latest?.label);
    if (number === 0 && label && !/\d/.test(label)) {
        return label;
    }
    if (typeof number === "number") {
        return `Ch. ${formatChapterNumber(number)}`;
    }
    return series.chapters ? `${series.chapters} Chapters` : undefined;
};

const baseItem = (series: Series, mangaId: string) => ({
    mangaId,
    title: cleanText(series.title),
    imageUrl: parseCoverUrl(series.cover),
});

const withMangaId = <T>(series: Series, build: (mangaId: string) => T): T[] =>
    series.hid && HID_REGEX.test(series.hid) ? [build(series.hid)] : [];

/**
 * Cards for the ranked row.
 *
 * 0.9 shows the rank and type above the title and the score and reads as icon
 * rows below it; a 0.8 tile has one subtitle line, so the useful parts are
 * joined into it.
 */
export const toFeaturedItems = (items: { series: Series; rank: number }[]): DiscoverSectionItem[] =>
    items.flatMap(({ series, rank }) =>
        withMangaId(series, (mangaId): DiscoverSectionItem => {
            const score = scoreOutOfTen(series.score);
            return {
                type: "featuredCarouselItem",
                ...baseItem(series, mangaId),
                subtitle: joinDetails([
                    `#${rank}`,
                    score === undefined ? undefined : `★ ${score.toFixed(1)}`,
                    series.count ? `${formatCount(series.count)} reads` : chapterSubtitle(series),
                ]),
            };
        }),
    );

export const toCarouselItems = (
    items: Series[],
    type: "prominentCarouselItem" | "simpleCarouselItem",
): DiscoverSectionItem[] =>
    items.flatMap((series) =>
        withMangaId(series, (mangaId) => ({ type, ...baseItem(series, mangaId), subtitle: chapterSubtitle(series) })),
    );

export const toSearchResults = (items: Series[]): SearchResultItem[] =>
    items.flatMap((series) =>
        withMangaId(series, (mangaId) => ({
            ...baseItem(series, mangaId),
            subtitle: chapterSubtitle(series),
            contentRating: toContentRating(parseRatingId(series)),
        })),
    );

// A label reads "Chapter 12: Title [Group]"; the bracketed group and the bare
// number are not part of the title.
const parseLabel = (release: ChapterRelease, number?: number | null) => {
    let label = cleanText(release.label);
    const bracket = /\s*\[([^\]]+)\]\s*$/.exec(label);
    const bracketGroup = bracket?.[1]?.trim();
    if (bracket) {
        label = label.slice(0, bracket.index).trim();
    }
    const numbered = /^(?:[A-Za-z]+\.?)?\s*#?\s*[\d.]+\s*(?:[:\-–—.|]\s*(.*))?$/.exec(label);
    const title = (numbered ? numbered[1] : label)?.trim();
    const group = cleanText(release.group?.name) || bracketGroup;
    const bare = title?.replace(/^(?:chapter|ch\.?|episode|ep\.?)\s*#?\s*/i, "");
    const isNumber = number != null && bare !== undefined && bare !== "" && Number(bare) === number;
    return {
        title: title && !isNumber && title.toLowerCase() !== group?.toLowerCase() ? title : undefined,
        group,
    };
};

export const toLatestItems = (items: LatestResponse["items"]): DiscoverSectionItem[] =>
    items.flatMap(({ chapter, series }) =>
        withMangaId(series, (mangaId): DiscoverSectionItem => {
            const { group } = parseLabel(chapter, chapter.n);
            return {
                type: "chapterUpdatesCarouselItem",
                ...baseItem(series, mangaId),
                chapterId: String(chapter.id),
                subtitle: joinDetails([
                    typeof chapter.n === "number" ? `Ch. ${formatChapterNumber(chapter.n)}` : undefined,
                    group,
                ]),
                publishDate: chapter.at ? new Date(chapter.at) : undefined,
            };
        }),
    );

const tagGroupId = (name: string, category: string | null | undefined): string => {
    if (category || THEME_TAGS.has(name)) {
        return "themes";
    }
    if (CONTENT_TAGS.has(name)) {
        return "content";
    }
    return FORMAT_TAGS.has(name) ? "format" : "genres";
};

/**
 * The site's tags, grouped as its tag picker groups them.
 *
 * Hentai, Adult and Smut are offered once erotica is allowed, and tags the
 * catalogue flags adult only with pornographic titles, as the site does. Ids
 * are the bare tag ids; a filter section namespaces them itself.
 */
export const parseTagGroups = (facets: FacetsResponse, ratings: string[]): TagSection[] => {
    const groups = new Map<string, Tag[]>();
    for (const facet of facets.genres ?? []) {
        if (UNLISTED_TAGS.has(facet.name) || facet.category === "Demographic") {
            continue;
        }
        if (facet.isAdult && !ratings.includes("pornographic")) {
            continue;
        }
        if (PORNOGRAPHIC_TAGS.has(facet.name) && !ratings.includes("erotica") && !ratings.includes("pornographic")) {
            continue;
        }
        const id = tagGroupId(facet.name, facet.category);
        groups.set(id, [...(groups.get(id) ?? []), { id: toTagId(facet.name), title: facet.name }]);
    }
    return TAG_GROUPS.flatMap(({ id, title }) => {
        const tags = groups.get(id)?.sort((a, b) => a.title.localeCompare(b.title)) ?? [];
        return tags.length ? [{ id, title, tags }] : [];
    });
};

const DEMOGRAPHICS = new Set(["Shounen", "Shoujo", "Seinen", "Josei"]);

/**
 * Everything the details screen shows.
 *
 * Tags carry the same ids as the search filters, so tapping one searches for
 * it.
 */
export const parseMangaDetails = ({ series }: SeriesResponse, mangaId: string, facets: FacetsResponse): SourceManga => {
    const primaryTitle = cleanText(series.title);
    const secondaryTitles = [
        ...new Set(
            [series.titles?.english, series.titles?.romaji, series.titles?.native, ...(series.alt ?? [])]
                .map(cleanText)
                .filter((title) => title && title !== primaryTitle),
        ),
    ];
    const spoilers = new Set(series.spoilerTags ?? []);
    const categories = new Map((facets.genres ?? []).map((facet) => [facet.name, facet.category]));
    const tags = (series.tags ?? []).filter((tag) => !UNLISTED_TAGS.has(tag) && !spoilers.has(tag));
    const demographic = (series.tags ?? []).find((tag) => DEMOGRAPHICS.has(tag));
    // Most titles have no banner but carry the wide hero image the site shows in its place.
    const banner = series.banner || series.hero;
    const authors = (series.authors ?? []).map(cleanText).filter(Boolean).join(", ");

    const tagGroups: TagSection[] = [
        ...TAG_GROUPS.flatMap(({ id, title }) => {
            const groupTags = tags.filter((tag) => tagGroupId(tag, categories.get(tag)) === id);
            return groupTags.length
                ? [{ id, title, tags: groupTags.map((tag) => filterTag(FILTERS.GENRE, toTagId(tag), tag)) }]
                : [];
        }),
        ...(demographic
            ? [
                  {
                      id: "demographics",
                      title: "Demographic",
                      tags: [filterTag(FILTERS.DEMOGRAPHIC, demographic.toLowerCase(), demographic)],
                  },
              ]
            : []),
    ];

    return {
        mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles,
            thumbnailUrl: parseCoverUrl(series.cover, 720),
            bannerUrl: banner ? toAbsoluteUrl(banner) : undefined,
            synopsis: cleanText(series.description),
            contentRating: toContentRating(parseRatingId(series)),
            status: series.status ? (STATUS_NAMES[series.status] ?? series.status) : "Unknown",
            author: authors || undefined,
            artist: authors || undefined,
            rating: series.score ? Math.round(series.score) / 100 : undefined,
            tagGroups,
        },
    };
};

const parseChapterNumber = (value: string | number | null | undefined): number | undefined => {
    if (value == null || String(value).trim() === "") {
        return undefined;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
};

const parseChapterSeason = (entry: ChapterEntry): number | undefined => {
    const match = /^\s*\[?\s*(?:s|season)\s*(\d{1,3})\s*\]?\s*(?=[-:·–—|]|\s|$)/i.exec(entry.label ?? "");
    return match ? Number(match[1]) : undefined;
};

// The site separates volumes/seasons when at least three chapter numbers occur in multiple ones.
const hasChapterNumberResets = (
    entries: ChapterEntry[],
    section: (entry: ChapterEntry) => number | undefined,
): boolean => {
    const sections = new Map<number, Set<number>>();
    for (const entry of entries) {
        const number = parseChapterNumber(entry.n);
        const value = section(entry);
        if (number === undefined || value === undefined) {
            continue;
        }
        const values = sections.get(number) ?? new Set<number>();
        values.add(value);
        sections.set(number, values);
    }
    return [...sections.values()].filter((values) => values.size > 1).length >= 3;
};

// The download as the site quotes it: whole megabytes from 100 up, one decimal below.
const sizeLabel = (mb: number | null | undefined): string | undefined =>
    mb && mb > 0 ? `${Number(mb.toFixed(mb >= 100 ? 0 : 1))} MB` : undefined;

/**
 * Every chapter, one upload per group.
 *
 * A group's best upload of each chapter is kept, its widest and then largest,
 * as the site's chapter list does; choosing the smallest keeps its lightest
 * instead. With mainOnly only one upload of each chapter is kept: the one the
 * site lists first, or with the smallest choice the lightest of them all. With
 * showSize a group's uploads of different sizes stay apart, each with its size
 * in the title. Complete uploads always win over partial ones.
 *
 * 0.9 renumbers same-numbered chapters in different volumes, because it merges
 * chapters that share a number. 0.8 lists every chapter by its own id, so the
 * numbers are left as the site gives them.
 */
export const parseChapters = (
    { chapters }: SeriesResponse,
    sourceManga: SourceManga,
    { mainOnly, showSize, choice = "best" }: { mainOnly: boolean; showSize: boolean; choice?: UploadChoice },
): Chapter[] => {
    const smallest = choice === "smallest";
    const releases = chapters.flatMap((entry, position) =>
        (mainOnly && !smallest ? [entry] : [entry, ...(entry.alts ?? [])]).map((release, index) => ({
            ...release,
            n: entry.n,
            vol: entry.vol,
            label: release.label ?? entry.label,
            at: release.at ?? entry.at,
            canonicalId: entry.id,
            catalogueDefault: index === 0,
            position,
        })),
    );
    type Release = (typeof releases)[number];

    const byVolume = hasChapterNumberResets(releases, (entry) => parseChapterNumber(entry.vol));
    const bySeason = hasChapterNumberResets(releases, parseChapterSeason);
    const chapterKey = (release: Release): string =>
        JSON.stringify([
            byVolume ? (parseChapterNumber(release.vol) ?? release.vol?.toString().trim().toLowerCase()) : "",
            bySeason ? (parseChapterSeason(release) ?? 1) : "",
            parseChapterNumber(release.n) ?? `id:${release.canonicalId}`,
        ]);

    const selected = new Map<string, { release: Release; order: number }>();
    // Prefer complete uploads, then the widest and largest (or the lightest,
    // then the widest), then catalogue defaults, position and ID. An upload of
    // unknown size counts as the heaviest.
    const compareSize = (a: Release, b: Release): number =>
        smallest
            ? (a.mb ?? Infinity) - (b.mb ?? Infinity) || (b.w ?? 0) - (a.w ?? 0)
            : (b.w ?? 0) - (a.w ?? 0) || (b.mb ?? 0) - (a.mb ?? 0);
    const compareReleases = (a: Release, b: Release): number =>
        Number(!!a.partial) - Number(!!b.partial) ||
        compareSize(a, b) ||
        Number(b.catalogueDefault) - Number(a.catalogueDefault) ||
        a.position - b.position ||
        a.id - b.id;
    const complete = new Set(releases.filter((release) => !release.partial).map(chapterKey));

    for (const release of releases) {
        const key = chapterKey(release);
        if (release.partial && complete.has(key)) {
            continue;
        }
        const { group } = parseLabel(release, release.n);
        const groupKey = JSON.stringify([
            key,
            // Deduplicating to the smallest keeps one upload of a chapter, whoever made it.
            mainOnly && smallest ? "" : (release.group?.slug ?? group?.toLowerCase() ?? ""),
            showSize ? (sizeLabel(release.mb) ?? "") : "",
        ]);
        const current = selected.get(groupKey);
        if (!current || compareReleases(release, current.release) < 0) {
            selected.set(groupKey, { release, order: current?.order ?? selected.size });
        }
    }

    const ordered = [...selected.values()].sort(({ release: a, order: aOrder }, { release: b, order: bOrder }) => {
        if (bySeason) {
            const season = (parseChapterSeason(b) ?? 1) - (parseChapterSeason(a) ?? 1);
            if (season) {
                return season;
            }
        }
        // Unassigned volumes are newest; a whole-volume upload heads its volume.
        return (
            (parseChapterNumber(b.vol) ?? Infinity) - (parseChapterNumber(a.vol) ?? Infinity) ||
            (parseChapterNumber(b.n) ?? Infinity) - (parseChapterNumber(a.n) ?? Infinity) ||
            a.position - b.position ||
            aOrder - bOrder
        );
    });

    const hasVolumeData = ordered.some(({ release }) => parseChapterNumber(release.vol) !== undefined);

    return ordered.map(({ release }, index): Chapter => {
        const { title, group } = parseLabel(release, release.n);
        const volume = parseChapterNumber(release.vol);
        const size = showSize ? sizeLabel(release.mb) : undefined;
        return {
            chapterId: String(release.id),
            sourceManga,
            chapNum: parseChapterNumber(release.n) ?? 0,
            title: title && size ? `${title} (${size})` : (title ?? size),
            group,
            // Zero means no volume data; undefined means an unassigned volume in a numbered series.
            volume: volume ?? (hasVolumeData ? undefined : 0),
            publishDate: release.at ? new Date(release.at) : undefined,
            langCode: "🇬🇧",
            // The list runs newest first and keeps the site's volume-first
            // order; the app wants the oldest lowest.
            sortingIndex: ordered.length - index,
        };
    });
};

export const parseReaderKeyResponse = (value: unknown): ReaderKeyResponse => {
    const record = (value ?? {}) as Record<string, unknown>;
    const { key, build, now } = record;
    if (
        typeof key !== "string" ||
        typeof build !== "string" ||
        !build.trim() ||
        typeof now !== "number" ||
        !Number.isFinite(now) ||
        now <= 0
    ) {
        throw new Error("Toonkotsu returned invalid reader session data. The source may need an update.");
    }
    try {
        decodeBase64Url(key);
    } catch {
        throw new Error("Toonkotsu returned an invalid reader signing key.");
    }
    return { key, build, now };
};

// A "v1" wrap masks the page keys, which only a signed read can unmask.
export const hasWrappedKeys = (response: unknown): boolean => {
    const wrap = (response as { wrap?: unknown } | null)?.wrap;
    return wrap !== undefined && wrap !== null && wrap !== "";
};

/**
 * The page URLs of a chapter, each carrying its key when the page is encrypted.
 *
 * The interceptor decrypts a page on its way in, which is the only place a
 * 0.8 source can touch an image's bytes.
 */
export const parseChapterPages = (response: unknown, readerKey?: ReaderKey): string[] => {
    const body = (response ?? {}) as { chapter?: { pages?: unknown }; wrap?: unknown };
    const pages = body.chapter?.pages;
    if (!Array.isArray(pages)) {
        throw new Error("Toonkotsu returned invalid chapter page data. The source may need an update.");
    }

    const wrap = body.wrap;
    if (wrap !== undefined && wrap !== null && wrap !== "" && wrap !== "v1") {
        throw new Error("Unsupported Toonkotsu reader encryption version. Please update the source.");
    }
    if (wrap === "v1" && !readerKey) {
        throw new Error("Toonkotsu masked this chapter's page keys.");
    }
    if (pages.length === 0) {
        throw new Error("This chapter has no pages.");
    }

    return pages.map((page: unknown, index) => {
        const entry = (page ?? {}) as { src?: unknown; k?: unknown; n?: unknown };
        if (typeof entry.src !== "string" || !entry.src.trim()) {
            throw new Error(`Toonkotsu page ${index + 1} has no valid image URL.`);
        }
        const path = entry.src.trim();
        if (/\s/.test(path) || (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^https?:\/\//i.test(path))) {
            throw new Error(`Toonkotsu page ${index + 1} has an invalid image URL.`);
        }
        const src = path.startsWith("//") ? `https:${path}` : /^https?:\/\//i.test(path) ? path : toAbsoluteUrl(path);
        if (!/^https?:\/\/[^/?#\s]+/i.test(src)) {
            throw new Error(`Toonkotsu page ${index + 1} has an invalid image URL.`);
        }

        const key = entry.k;
        const nonce = entry.n;
        if (key == null && nonce == null) {
            return src;
        }
        if (typeof key !== "string" || typeof nonce !== "string") {
            throw new Error(`Toonkotsu page ${index + 1} has incomplete encryption metadata.`);
        }
        try {
            const keyBytes = decodeBase64Url(key);
            if (![16, 24, 32].includes(keyBytes.length)) {
                throw new Error(`Unsupported AES key length (${keyBytes.length} bytes).`);
            }
            if (decodeBase64Url(nonce).length < 8) {
                throw new Error("The AES-CTR nonce is too short.");
            }
            const pageKey = wrap === "v1" && readerKey ? unwrapPageKey(readerKey, key, nonce) : key;
            return encodePageUrl(src, pageKey, nonce);
        } catch (error: unknown) {
            throw new Error(
                `Toonkotsu page ${index + 1}: ${error instanceof Error ? error.message : "Invalid encryption metadata."} The source may need an update.`,
            );
        }
    });
};
