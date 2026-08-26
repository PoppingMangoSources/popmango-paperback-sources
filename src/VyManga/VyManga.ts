/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    ContentRating,
    DiscoverSectionType,
    PopmangoSource,
    inputRow,
    labelRow,
    normaliseUrlOverride,
    sourceInfo,
    type Chapter,
    type ChapterDetails,
    type DiscoverSection,
    type DiscoverSectionItem,
    type MenuSection,
    type PagedResults,
    type SearchQuery,
    type SearchResultItem,
    type SourceManga,
    type TagSection,
} from "../../common";

import {
    BASE_URL_KEY,
    BROWSE_SORT,
    DEFAULT_DOMAIN,
    FILTERS,
    GENRES_KEY,
    MATCH_OPTIONS,
    NEXT_PAGE_SELECTOR,
    ORDER_OPTIONS,
    SEARCH_PATH,
    SECTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    filterTag,
    splitFilterTag,
    type MangaCard,
    type OptionItem,
    type PageMetadata,
    type SearchRequest,
} from "./models";
import { VyMangaInterceptor, buildBrowseUrl, buildSearchUrl, fetchPage } from "./network";
import { extractMangaId, parseCards, parseChapterPages, parseChapters, parseGenres, parseMangaDetails } from "./parsers";

export const VyMangaInfo = sourceInfo({
    name: "VyManga",
    description: "Extension that pulls content from mangavyvy.net.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DEFAULT_DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

/** Cards carry no rating of their own, so the site's own level stands in. */
const LISTING_RATING = ContentRating.MATURE;

export class VyManga extends PopmangoSource {
    /** The genre list, cached in settings since it rarely changes. */
    private genres?: Promise<OptionItem[]>;

    /** Which host the cached genres were read from. */
    private genresDomain?: string;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DEFAULT_DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 5, bufferInterval: 2, ignoreImages: true },
            interceptor: new VyMangaInterceptor(() => this.baseUrl),
        });
    }

    /** The site's address, which a reader can point elsewhere if it moves. */
    private get baseUrl(): string {
        return this.settings.string(BASE_URL_KEY, DEFAULT_DOMAIN);
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${this.baseUrl}/manga/${mangaId}`;
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "domain",
                header: "Website address",
                footer:
                    `Point the extension somewhere else if the site moves. Leave this empty for the ` +
                    `default (${DEFAULT_DOMAIN}). An address that does not look like a website is ignored.`,
                rows: [
                    inputRow("base_url", {
                        label: "Address",
                        get: () => this.settings.string(BASE_URL_KEY, ""),
                        set: (value) => {
                            const normalised = normaliseUrlOverride(value);
                            if (normalised === undefined) {
                                return;
                            }
                            this.settings.set(BASE_URL_KEY, normalised);
                            // The genre list belongs to whichever host it came
                            // from, so it is dropped along with the address.
                            this.settings.set(GENRES_KEY, "");
                            this.genres = undefined;
                        },
                    }),
                    labelRow("base_url_current", "Currently using", this.baseUrl),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
            { id: SECTIONS.LATEST_UPDATES, title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.TOP_RATED, title: "Top Rated", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.NEWEST, title: "Newest", type: DiscoverSectionType.simpleCarousel },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        // The featured rail is the most-viewed listing, which does not paginate.
        const sort = section.id === SECTIONS.POPULAR ? "viewed" : (BROWSE_SORT[section.id] ?? "updated_at");
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        const document = await fetchPage(buildBrowseUrl(this.baseUrl, sort, page));
        const items = parseCards(document, this.baseUrl).map(toDiscoverItem);

        if (section.id === SECTIONS.POPULAR) {
            return { items };
        }

        return {
            items,
            metadata: hasNextPage(document) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    /**
     * Offers the site's filters as tag sections.
     *
     * 0.8 has no separate sort control, so the sort order and direction are
     * sections of tags as well; picking more than one leaves the first in
     * effect.
     */
    override async getFilterSections(): Promise<TagSection[]> {
        return [
            {
                id: FILTERS.SORT,
                title: "Sort by",
                tags: SORT_OPTIONS.map((option) => filterTag(FILTERS.SORT, option.id, option.title)),
            },
            {
                id: FILTERS.ORDER,
                title: "Order",
                tags: ORDER_OPTIONS.map((option) => filterTag(FILTERS.ORDER, option.id, option.title)),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
            {
                id: FILTERS.MATCH,
                title: "Matching",
                tags: MATCH_OPTIONS.map((option) => filterTag(FILTERS.MATCH, option.id, option.title)),
            },
            {
                id: FILTERS.GENRE,
                title: "Genres",
                tags: (await this.getGenres()).map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.value)),
            },
        ];
    }

    /** The site takes an explicit exclusion list of its own. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        // A pasted series URL should open that series rather than search for it.
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const document = await fetchPage(buildSearchUrl(this.baseUrl, this.toSearchRequest(query, page)));

        return {
            items: parseCards(document, this.baseUrl).map(toSearchResultItem),
            metadata: hasNextPage(document) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        const document = await fetchPage(`${this.baseUrl}/manga/${mangaId}`);
        return parseMangaDetails(document, this.baseUrl, mangaId, LISTING_RATING);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const document = await fetchPage(`${this.baseUrl}/manga/${sourceManga.mangaId}`);
        return parseChapters(document, this.baseUrl, sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        // Ids here are whole URLs, so a list saved before that changed cannot
        // be resolved and the reader is told to refresh rather than shown an
        // empty chapter.
        if (!/^https?:\/\//i.test(chapter.chapterId)) {
            throw new Error("Refresh the chapter list to reload this chapter.");
        }

        // `view=0` asks for every page at once instead of the paged reader.
        const url = `${chapter.chapterId}${chapter.chapterId.includes("?") ? "&" : "?"}view=0`;
        const pages = parseChapterPages(await fetchPage(url), this.baseUrl);

        if (pages.length === 0) {
            throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
        }

        return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    /**
     * The genre list, read from the search form and remembered.
     *
     * It is kept in settings rather than only in memory so the search screen
     * has filters to show without a round trip on every launch.
     */
    private getGenres(): Promise<OptionItem[]> {
        if (this.genresDomain !== this.baseUrl) {
            this.genresDomain = this.baseUrl;
            this.genres = undefined;
        }
        return (this.genres ??= this.loadGenres());
    }

    private async loadGenres(): Promise<OptionItem[]> {
        const stored = this.storedGenres();
        if (stored.length > 0) {
            return stored;
        }

        const genres = parseGenres(await fetchPage(`${this.baseUrl}/${SEARCH_PATH}`));
        if (genres.length > 0) {
            this.settings.set(GENRES_KEY, JSON.stringify(genres));
        }
        return genres;
    }

    private storedGenres(): OptionItem[] {
        const raw = this.settings.string(GENRES_KEY, "");
        if (raw.length === 0) {
            return [];
        }

        try {
            const parsed = JSON.parse(raw) as unknown;
            return Array.isArray(parsed) ? (parsed as OptionItem[]) : [];
        } catch {
            return [];
        }
    }

    /** Turns the chosen filter tags into the site's own search parameters. */
    private toSearchRequest(query: SearchQuery, page: number): SearchRequest {
        const included = groupTags(query.includedTags);
        const match = included.get(FILTERS.MATCH) ?? [];

        return {
            page,
            title: query.title,
            sortBy: included.get(FILTERS.SORT)?.[0],
            order: included.get(FILTERS.ORDER)?.[0],
            status: included.get(FILTERS.STATUS)?.[0],
            // "Begins with" and "ends with" are one setting on the site;
            // searching descriptions is a separate switch sharing this section.
            searchType: match.find((value) => value === "1" || value === "2") ?? "0",
            searchDescriptions: match.includes("desc"),
            includedGenres: included.get(FILTERS.GENRE),
            excludedGenres: groupTags(query.excludedTags).get(FILTERS.GENRE),
        };
    }

    /**
     * Turns a pasted series URL into a single result.
     *
     * Only URLs on the host currently in use are accepted, since an id from
     * somewhere else would not resolve.
     */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const query = (title ?? "").trim();
        if (!/^https?:\/\//i.test(query)) {
            return undefined;
        }

        const host = query.match(/^https?:\/\/([^/]+)/i)?.[1]?.toLowerCase();
        const baseHost = this.baseUrl.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase();

        if (host === undefined || host !== baseHost) {
            return undefined;
        }

        const mangaId = extractMangaId(query);
        if (mangaId === undefined) {
            return undefined;
        }

        const manga = await this.getMangaInfo(mangaId);
        return {
            items: [
                {
                    mangaId,
                    title: manga.mangaInfo.primaryTitle,
                    imageUrl: manga.mangaInfo.thumbnailUrl,
                    contentRating: manga.mangaInfo.contentRating,
                },
            ],
        };
    }
}

/** Groups chosen tags by the filter section they came from. */
function groupTags(tags: Array<{ id: string }>): Map<string, string[]> {
    const chosen = new Map<string, string[]>();

    for (const tag of tags) {
        const split = splitFilterTag(tag.id);
        if (split === undefined) {
            continue;
        }
        chosen.set(split.section, [...(chosen.get(split.section) ?? []), split.value]);
    }
    return chosen;
}

function hasNextPage(document: CheerioAPI): boolean {
    return document(NEXT_PAGE_SELECTOR).length > 0;
}

function toDiscoverItem(card: MangaCard): DiscoverSectionItem {
    return {
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        subtitle: card.subtitle,
    };
}

function toSearchResultItem(card: MangaCard): SearchResultItem {
    return {
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        subtitle: card.subtitle,
        contentRating: LISTING_RATING,
    };
}
