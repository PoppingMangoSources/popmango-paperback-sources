/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import {
    Application,
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
    CONTENT_RATING_GENRES,
    CONTENT_RATING_OPTIONS,
    EDITION_TEAM_KEY,
    LANGUAGE_OPTIONS,
    LEGACY_FORMAT_MAP,
    LEGACY_TYPE_MAP,
    TAG_TITLE_OVERRIDES,
    TRANSLATED_LANGUAGE_KEY,
    type ChapterData,
    type ChapterPagesResponse,
    type ComicData,
    type ComicNode,
    type ContentPreferenceRating,
    type LatestUploadsResult,
    type RankedMetric,
    type XComicPreferences,
} from "./models";

const PORNOGRAPHIC_GENRES = new Set<string>(CONTENT_RATING_GENRES.pornographic);
const EROTICA_GENRES = new Set<string>(CONTENT_RATING_GENRES.erotica);
const SUGGESTIVE_GENRES = new Set<string>(CONTENT_RATING_GENRES.suggestive);

/** Characters the app accepts in an id it will store and replay. */
const UNSAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const sanitizeId = (value: string): string => value.replace(UNSAFE_ID, "-");

/** The settings that change how a title is shown, rather than which titles are. */
export interface ViewOptions {
    /** The mirror relative links are resolved against. */
    baseUrl: string;
    /** Whether a title carries its edition's team name. */
    showEditionInTitle: boolean;
}

type CarouselItemType = "simpleCarouselItem" | "prominentCarouselItem" | "chapterUpdatesCarouselItem";

/** STATUS values the API uses, mapped to what the app displays. */
const STATUS_LABELS: Record<string, string> = {
    releasing: "Ongoing",
    ongoing: "Ongoing",
    completed: "Completed",
    hiatus: "Hiatus",
    cancelled: "Cancelled",
    canceled: "Cancelled",
    upcoming: "Upcoming",
    pending: "Upcoming",
};

const hasCoverUrl = (url: string | null | undefined): url is string =>
    typeof url === "string" && url.trim().length > 0;

const titleCase = (value: string): string => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/** Groups digits in threes, without leaning on a locale the runtime may not carry. */
const formatCount = (value: number): string =>
    String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const contentPreferenceRating = (comic: ComicData): ContentPreferenceRating => {
    const taxonomy = [...(comic.genres ?? []), ...(comic.tags ?? [])].map((value) => value.trim().toLowerCase());
    const rating = comic.contentRating?.trim().toLowerCase();

    // A rating the API adds later stays gated at the top rather than passing as safe.
    if (rating && !CONTENT_RATING_OPTIONS.some((option) => option.id === rating)) {
        return "pornographic";
    }
    if (rating === "pornographic" || taxonomy.some((value) => PORNOGRAPHIC_GENRES.has(value))) {
        return "pornographic";
    }
    if (rating === "erotica" || taxonomy.some((value) => EROTICA_GENRES.has(value))) {
        return "erotica";
    }
    if (rating === "suggestive" || comic.sfw_result === false || taxonomy.some((value) => SUGGESTIVE_GENRES.has(value))) {
        return "suggestive";
    }
    return "safe";
};

const normalizedType = (type?: string | null): string | undefined => (type ? (LEGACY_TYPE_MAP[type] ?? type) : undefined);

const normalizedTaxonomyId = (id: string): string => LEGACY_FORMAT_MAP[id] ?? id;

const toContentRating = (comic: ComicData): ContentRating => {
    const rating = contentPreferenceRating(comic);
    if (rating === "erotica" || rating === "pornographic") {
        return ContentRating.ADULT;
    }
    return rating === "suggestive" ? ContentRating.MATURE : ContentRating.EVERYONE;
};

export const isComicAllowed = (comic: ComicData, preferences: XComicPreferences): boolean => {
    if (
        preferences.contentRatings.length === 0 ||
        preferences.types.length === 0 ||
        !hasCoverUrl(comic.urlCover ?? comic.remoteCoverUrl)
    ) {
        return false;
    }

    if (
        preferences.originalLanguages.length > 0 &&
        (!comic.originalLanguage || !preferences.originalLanguages.includes(comic.originalLanguage))
    ) {
        return false;
    }

    const translatedLanguages = comic.translatedLanguages ?? (comic.translatedLanguage ? [comic.translatedLanguage] : []);
    // An edition that states no language is no reason to hide the work.
    if (
        preferences.translatedLanguages.length > 0 &&
        translatedLanguages.length > 0 &&
        !translatedLanguages.some((language) => preferences.translatedLanguages.includes(language))
    ) {
        return false;
    }

    const type = normalizedType(comic.type);
    if (type && !preferences.types.includes(type as XComicPreferences["types"][number])) {
        return false;
    }

    if (!preferences.contentRatings.includes(contentPreferenceRating(comic))) {
        return false;
    }

    const excluded = new Set([...preferences.excludedGenres, ...preferences.excludedFormats]);
    return ![...(comic.genres ?? []), ...(comic.tags ?? [])].map(normalizedTaxonomyId).some((id) => excluded.has(id));
};

/** Home page cards and the chapter list must agree, or a card cannot be matched to its chapter. */
const toChapterId = (chapter: { id: string; urlPath?: string | null }): string =>
    sanitizeId(chapter.urlPath ?? `/comic/chapter/${chapter.id}`);

const chapterNumber = (chapter?: ChapterData | null): number | undefined => {
    const value = chapter?.chaNum ?? chapter?.serial;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const formatChapter = (chapter?: ChapterData | null): string | undefined => {
    const number = chapterNumber(chapter) ?? /(?:chapter|ch\.?)[\s_]*(\d+(?:\.\d+)?)/i.exec(chapter?.dname ?? "")?.[1];
    if (number === undefined) {
        return undefined;
    }
    return `Ch. ${String(number).replace(/\.0$/, "")}`;
};

const dateFromTimestamp = (value?: number | null): Date | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }
    // The API mixes seconds and milliseconds.
    const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? undefined : date;
};

const formatType = (type?: string | null): string | undefined =>
    type === "oel" ? "OEL" : type ? titleCase(type) : undefined;

/** An importer marker: an id-shaped prefix, a colon and no words after it ("src-site:mfx"). */
const isMachineTag = (value: string): boolean => /^[a-z0-9_-]+:\S*$/i.test(value);

/** The "[Team]" suffix the site appends to a comic's own name. */
const bracketedTeam = (name: string): string | undefined => {
    const trimmed = name.trimEnd();
    if (!trimmed.endsWith("]")) {
        return undefined;
    }
    return trimmed.slice(0, -1).split("[").pop()?.trim() || undefined;
};

/**
 * The team behind an edition.
 *
 * subName carries it on a title's editions, but a single comic's record leaves
 * it empty, so the details page falls back to the suffix on the name. An
 * importer marker is not a team and is dropped.
 */
const editionLabel = (comic: ComicData): string | undefined => {
    const subName = comic.subName?.trim();
    if (subName && !isMachineTag(subName)) {
        return Application.decodeHTMLEntities(subName);
    }

    const team = bracketedTeam(comic.name);
    return team && !isMachineTag(team) ? Application.decodeHTMLEntities(team) : undefined;
};

const statusLabel = (value?: string | null): string => {
    const key = value?.trim().toLowerCase();
    if (!key) {
        return "Unknown";
    }
    return STATUS_LABELS[key] ?? titleCase(key);
};

const latestChapterLabel = (comic: ComicData): string | undefined => {
    const chapter = formatChapter(comic.chapterNodes_last?.[0]?.data);
    if (chapter) {
        return chapter;
    }
    return typeof comic.totalChapters === "number" && comic.totalChapters > 0
        ? `${formatCount(comic.totalChapters)} Chapters`
        : undefined;
};

const cardSubtitle = (comic: ComicData): string | undefined =>
    [latestChapterLabel(comic), formatType(normalizedType(comic.type))]
        .filter((value): value is string => Boolean(value))
        .join(" • ") || undefined;

/**
 * A title groups every edition of a work.
 *
 * Each edition is its own comic, so it inherits the title's artwork and
 * taxonomy and overrides only what belongs to that edition.
 */
const toTitleSource = (node: ComicNode, source: ComicNode): ComicNode => ({
    data: {
        ...node.data,
        id: source.data.id,
        name: source.data.name.trim() || node.data.name,
        subName: source.data.subName,
        urlPath: source.data.urlPath ?? `/source/${source.data.id}`,
        translatedLanguage: source.data.translatedLanguage,
        translatedLanguages: source.data.translatedLanguage ? [source.data.translatedLanguage] : [],
        chaps_normal: source.data.chaps_normal,
        totalChapters: source.data.chaps_normal,
    },
});

/**
 * Tells apart editions that carry the same team name.
 *
 * Two editions of one work can share a label; the comic id separates them so
 * their library entries and chapter groups do not collide.
 */
const disambiguateEditions = (sources: ComicNode[]): ComicNode[] => {
    const counts = new Map<string, number>();
    for (const source of sources) {
        const label = editionLabel(source.data)?.toLowerCase();
        if (label) {
            counts.set(label, (counts.get(label) ?? 0) + 1);
        }
    }

    return sources.map((source) => {
        const label = editionLabel(source.data);
        if (!label || (counts.get(label.toLowerCase()) ?? 0) < 2) {
            return source;
        }
        return { ...source, data: { ...source.data, subName: `${label} [${source.data.id}]` } };
    });
};

/** Every edition of a title, the reader's languages first and then the fullest. */
export const toTitleSources = (node: ComicNode, preferredLanguages: string[]): ComicNode[] => {
    const languageRank = (source: ComicNode): number => {
        const index = preferredLanguages.indexOf(source.data.translatedLanguage ?? "");
        return index === -1 ? preferredLanguages.length : index;
    };

    const sources = (node.comicNodes ?? [])
        .filter((source): source is ComicNode => Boolean(source?.data.id))
        // An edition that states no language is no reason to hide the work.
        .filter(
            (source) =>
                preferredLanguages.length === 0 ||
                !source.data.translatedLanguage ||
                preferredLanguages.includes(source.data.translatedLanguage),
        )
        .sort(
            (left, right) =>
                languageRank(left) - languageRank(right) || (right.data.chaps_normal ?? 0) - (left.data.chaps_normal ?? 0),
        )
        .map((source) => toTitleSource(node, source));

    return disambiguateEditions(sources);
};

export const toPreferredTitleSource = (node: ComicNode, preferredLanguages: string[]): ComicNode | undefined =>
    toTitleSources(node, preferredLanguages)[0];

export const toLatestUploadNodes = (result?: LatestUploadsResult | null): ComicNode[] => {
    if (!result || !Array.isArray(result.items)) {
        throw new Error("XCOMIC's latest uploads were missing from its answer.");
    }

    return result.items
        .flatMap(({ chapters }) => chapters ?? [])
        .filter(({ data }) => data.dbStatus === "normal")
        .sort((left, right) => (right.data.datePublic ?? 0) - (left.data.datePublic ?? 0))
        .flatMap((chapter) => {
            const data = chapter.data.comicNode?.data;
            if (!data || !hasCoverUrl(data.urlCover ?? data.remoteCoverUrl) || !chapter.data.id) {
                return [];
            }
            return [{ data: { ...data, chapterNodes_last: [chapter] } }];
        });
};

const nodeNames = (nodes?: Array<{ data?: { name?: string } | null } | null> | null): string[] =>
    (nodes ?? [])
        .map((node) => node?.data?.name?.trim())
        .filter((name): name is string => Boolean(name))
        .map((name) => Application.decodeHTMLEntities(name));

/** A synopsis as plain text, keeping its paragraph breaks. */
const stripHtml = (html?: string | null): string => {
    if (!html) {
        return "";
    }

    const $ = Application.loadDocument(html);
    $("br").replaceWith("\n");
    $("p, div, li, blockquote").each((_index, element) => {
        $(element).append("\n");
    });

    return Application.decodeHTMLEntities(
        $.root()
            .text()
            .replace(/\n{3,}/g, "\n\n")
            .trim(),
    );
};

const formatDateYmd = (value: ComicData["originalPubFrom"]): string | undefined => {
    if (!value?.y) {
        return undefined;
    }
    return [value.y, value.m?.toString().padStart(2, "0"), value.d?.toString().padStart(2, "0")]
        .filter(Boolean)
        .join("-");
};

const languageName = (code: string): string => LANGUAGE_OPTIONS.find(({ id }) => id === code)?.title ?? code;

/** Turns the site's records into what the app shows. */
export class XComicParser {
    constructor(private readonly view: ViewOptions) {}

    private absoluteUrl(url: string | null | undefined): string {
        if (typeof url !== "string" || !url.trim()) {
            return "";
        }
        const normalized = url.trim();
        if (/^https?:\/\//i.test(normalized)) {
            return normalized;
        }
        if (normalized.startsWith("//")) {
            return `https:${normalized}`;
        }
        return `${this.view.baseUrl}${normalized.startsWith("/") ? "" : "/"}${normalized}`;
    }

    private displayTitle(comic: ComicData): string {
        const trimmed = comic.name.trimEnd();
        const suffix = bracketedTeam(trimmed);
        // An importer marker in the name is noise on a shelf, not part of the title.
        const name = Application.decodeHTMLEntities(
            suffix && isMachineTag(suffix) ? trimmed.slice(0, trimmed.lastIndexOf("[")).trimEnd() : trimmed,
        );

        if (!this.view.showEditionInTitle) {
            return name;
        }
        const edition = editionLabel(comic);
        return edition && !name.includes(edition) ? `${name} (${edition})` : name;
    }

    private baseCard(node: ComicNode): { mangaId: string; title: string; imageUrl: string } {
        return {
            mangaId: sanitizeId(node.data.id),
            title: this.displayTitle(node.data),
            imageUrl: this.absoluteUrl(node.data.urlCover ?? node.data.remoteCoverUrl),
        };
    }

    searchResult(node: ComicNode): SearchResultItem {
        return {
            ...this.baseCard(node),
            subtitle: cardSubtitle(node.data),
            contentRating: toContentRating(node.data),
        };
    }

    discoverItems(nodes: ComicNode[], type: CarouselItemType): DiscoverSectionItem[] {
        return nodes.flatMap((node): DiscoverSectionItem[] => {
            if (type !== "chapterUpdatesCarouselItem") {
                return [{ type, ...this.baseCard(node), subtitle: cardSubtitle(node.data) }];
            }

            const chapter = node.data.chapterNodes_last?.[0]?.data;
            if (!chapter?.id) {
                return [];
            }
            return [
                {
                    type,
                    ...this.baseCard(node),
                    chapterId: toChapterId(chapter),
                    subtitle: cardSubtitle(node.data),
                    publishDate: dateFromTimestamp(chapter.datePublic ?? chapter.dateModify ?? chapter.dateCreate),
                },
            ];
        });
    }

    /**
     * Cards for a ranked row.
     *
     * The upstream cards carry the figure the row is ranked by as a separate
     * badge; a 0.8 tile has one subtitle line, so the figure goes there.
     */
    rankedItems(nodes: ComicNode[], metric: RankedMetric): DiscoverSectionItem[] {
        return nodes.map((node): DiscoverSectionItem => {
            const comic = node.data;
            const card = this.baseCard(node);

            switch (metric) {
                case "follows":
                    return {
                        type: "prominentCarouselItem",
                        ...card,
                        subtitle: typeof comic.follows === "number" ? `♥ ${formatCount(comic.follows)} Follows` : undefined,
                    };

                case "chapters":
                    return {
                        type: "simpleCarouselItem",
                        ...card,
                        subtitle:
                            typeof comic.totalChapters === "number"
                                ? `${formatCount(comic.totalChapters)} Chapters`
                                : undefined,
                    };

                case "reviews":
                    return {
                        type: "featuredCarouselItem",
                        ...card,
                        subtitle: typeof comic.reviews === "number" ? `${formatCount(comic.reviews)} Reviews` : undefined,
                    };

                case "comments":
                    return {
                        type: "featuredCarouselItem",
                        ...card,
                        subtitle:
                            typeof comic.comments_total === "number"
                                ? `${formatCount(comic.comments_total)} Comments`
                                : undefined,
                    };

                case "top": {
                    const score =
                        typeof comic.score_val === "number" && Number.isFinite(comic.score_val)
                            ? `★ ${comic.score_val.toFixed(1)}`
                            : undefined;
                    return {
                        type: "featuredCarouselItem",
                        ...card,
                        subtitle:
                            [latestChapterLabel(comic), score]
                                .filter((value): value is string => Boolean(value))
                                .join(" • ") || undefined,
                    };
                }
            }
        });
    }

    sourceManga(node: ComicNode, mangaId = sanitizeId(node.data.id)): SourceManga {
        const comic = node.data;
        const authorNames = nodeNames(comic.authorNodes);
        const artistNames = nodeNames(comic.artistNodes);
        const distinctArtists = artistNames.filter((artist) => !authorNames.includes(artist));

        const toTags = (values: string[]): Tag[] =>
            [...new Set(values.map(sanitizeId))].map((id) => ({ id, title: TAG_TITLE_OVERRIDES[id] ?? titleCase(id) }));

        const tagGroups: TagSection[] = [
            { id: "genres", title: "Genres", tags: toTags(comic.genres ?? []) },
            { id: "demographics", title: "Demographics", tags: toTags(comic.demographics ?? []) },
            { id: "tags", title: "Tags", tags: toTags(comic.tags ?? nodeNames(comic.tagNodes)) },
        ].filter((group) => group.tags.length > 0);

        const publicationFrom = formatDateYmd(comic.originalPubFrom);
        const publicationTill = formatDateYmd(comic.originalPubTill);
        const publishers = nodeNames(comic.publisherNodes);
        const team = editionLabel(comic);

        const additionalInfo: Record<string, string> = {};
        if (comic.type) {
            additionalInfo["Type"] = titleCase(comic.type);
        }
        if (team) {
            additionalInfo[EDITION_TEAM_KEY] = team;
        }
        if (comic.originalLanguage) {
            additionalInfo["Original Language"] = languageName(comic.originalLanguage);
        }
        if (comic.translatedLanguage) {
            additionalInfo[TRANSLATED_LANGUAGE_KEY] = languageName(comic.translatedLanguage);
        }
        if (publicationFrom) {
            additionalInfo["Publication"] = publicationTill ? `${publicationFrom} – ${publicationTill}` : publicationFrom;
        }
        if (comic.originalPubZone) {
            additionalInfo["Region"] = comic.originalPubZone;
        }
        if (typeof comic.chaps_normal === "number") {
            additionalInfo["Chapters"] = String(comic.chaps_normal);
        }
        if (typeof comic.follows === "number") {
            additionalInfo["Follows"] = String(comic.follows);
        }
        if (typeof comic.reviews === "number") {
            additionalInfo["Reviews"] = String(comic.reviews);
        }
        if (typeof comic.comments_total === "number") {
            additionalInfo["Comments"] = String(comic.comments_total);
        }
        if (publishers.length > 0) {
            additionalInfo["Publishers"] = publishers.join(", ");
        }

        return {
            mangaId,
            mangaInfo: {
                primaryTitle: this.displayTitle(comic),
                secondaryTitles: (comic.altNames ?? []).map((title) => Application.decodeHTMLEntities(title)),
                thumbnailUrl: this.absoluteUrl(comic.urlCover ?? comic.remoteCoverUrl),
                synopsis: stripHtml(comic.summary?.html ?? comic.description),
                author: authorNames.join(", ") || undefined,
                artist: distinctArtists.join(", ") || undefined,
                contentRating: toContentRating(comic),
                rating:
                    typeof comic.score_val === "number" && Number.isFinite(comic.score_val)
                        ? Math.min(1, Math.max(0, comic.score_val / 10))
                        : undefined,
                status: statusLabel(comic.originalStatus || comic.uploadStatus),
                tagGroups,
                additionalInfo,
            },
        };
    }

    chapter(data: ChapterData, sourceManga: SourceManga): Chapter {
        const title = [data.dname?.trim(), data.title?.trim()]
            .filter((value): value is string => Boolean(value))
            .filter((value, index, values) => index === 0 || value !== values[0])
            .map((value) => Application.decodeHTMLEntities(value))
            .join(": ");

        // The edition's own team names the upload; srcName is only the
        // aggregator it came through.
        const team = sourceManga.mangaInfo.additionalInfo?.[EDITION_TEAM_KEY];
        const sourceName = data.srcName?.trim();
        const profileNames = nodeNames(data.profileNodes);
        const scanlators =
            typeof team === "string" && team
                ? [team]
                : sourceName
                  ? [Application.decodeHTMLEntities(sourceName.charAt(0).toUpperCase() + sourceName.slice(1))]
                  : profileNames.length > 0
                    ? profileNames
                    : nodeNames(data.groupNodes);

        const uploaderName = data.userNode?.data?.name?.trim();
        const uploader = uploaderName ? Application.decodeHTMLEntities(uploaderName) : undefined;

        const language = sourceManga.mangaInfo.additionalInfo?.[TRANSLATED_LANGUAGE_KEY];
        const languageCode =
            typeof language === "string" ? (LANGUAGE_OPTIONS.find(({ title }) => title === language)?.id ?? language) : undefined;
        const langCode = languageCode ? (languageCode === "_t" ? "und" : languageCode.replace(/_/g, "-")) : "en";

        return {
            chapterId: toChapterId(data),
            sourceManga,
            chapNum: chapterNumber(data) ?? 0,
            volume: 0,
            title: title || undefined,
            langCode,
            publishDate: dateFromTimestamp(data.dateModify ?? data.dateCreate ?? data.datePublic),
            group: scanlators.join(", ") || uploader || undefined,
        };
    }

    chapterDetails(response: ChapterPagesResponse, chapter: Chapter): ChapterDetails {
        const pages = (response.get_chapterNode?.data?.imageUrls ?? [])
            .map((url) => this.absoluteUrl(url))
            .filter((url) => url.length > 0);

        if (pages.length === 0) {
            throw new Error("XCOMIC returned no pages for this chapter.");
        }
        return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
    }
}
