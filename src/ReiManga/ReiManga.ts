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
    DOMAIN,
    FILTERS,
    GENRES,
    MOST_READ_PERIOD,
    PAGE_SIZE,
    PERIOD_OPTIONS,
    SECTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    filterTag,
    splitFilterTag,
    type ApiManga,
    type ApiMangaDetails,
    type ApiMangaList,
    type PageMetadata,
} from "./models";
import { ReiMangaInterceptor, buildSearchUrl, fetchFlight, fetchJson } from "./network";
import {
    mangaIdFor,
    numericIdFrom,
    parseChapterPages,
    parseChapters,
    toDiscoverItem,
    toSearchResultItem,
    toSourceManga,
} from "./parsers";

export const ReiMangaInfo = sourceInfo({
    name: "ReiManga",
    description: "Extension that pulls content from reimanga.net.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class ReiManga extends PopmangoSource {
    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 4, bufferInterval: 1, ignoreImages: true },
            interceptor: new ReiMangaInterceptor(() => this.baseUrl),
        });
    }

    /** The site's address, which a reader can point elsewhere if it moves. */
    private get baseUrl(): string {
        return this.settings.string(BASE_URL_KEY, DOMAIN);
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
                    `default (${DOMAIN}). An address that does not look like a website is ignored.`,
                rows: [
                    inputRow("base_url", {
                        label: "Address",
                        get: () => this.settings.string(BASE_URL_KEY, ""),
                        set: (value) => {
                            const normalised = normaliseUrlOverride(value);
                            if (normalised !== undefined) {
                                this.settings.set(BASE_URL_KEY, normalised);
                            }
                        },
                    }),
                    labelRow("base_url_current", "Currently using", this.baseUrl),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
            // 0.9 let the reader switch this chart between day, week and month.
            // 0.8 sections carry no controls, so it shows the weekly chart and
            // the other windows stay reachable through the search filters.
            { id: SECTIONS.MOST_READ, title: "Most Read This Week", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.NEW, title: "New Manga", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.TOP_RATED, title: "Top Rated", type: DiscoverSectionType.simpleCarousel },
        ];
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        const base = this.baseUrl;

        switch (section.id) {
            case SECTIONS.FEATURED: {
                const list = await fetchJson<ApiManga[]>(`${base}/api/manga/trending?limit=10&full=1`);
                return { items: list.map((manga) => toDiscoverItem(base, manga, "rating")) };
            }

            case SECTIONS.MOST_READ: {
                const list = await fetchJson<ApiManga[]>(
                    `${base}/api/manga/most-read?limit=30&period=${encodeURIComponent(MOST_READ_PERIOD)}`,
                );
                return { items: list.map((manga, index) => toDiscoverItem(base, manga, "reads", index + 1)) };
            }

            case SECTIONS.NEW: {
                const list = await fetchJson<ApiMangaList>(`${base}/api/manga/new?limit=12`);
                return { items: (list.data ?? []).map((manga) => toDiscoverItem(base, manga, "chapter")) };
            }

            case SECTIONS.LATEST: {
                const list = await fetchJson<ApiMangaList>(`${base}/api/manga/latest-updates?limit=18`);
                return { items: (list.data ?? []).map((manga) => toDiscoverItem(base, manga, "updated")) };
            }

            case SECTIONS.TOP_RATED: {
                const list = await fetchJson<ApiMangaList>(
                    `${base}/api/manga?page=1&limit=${PAGE_SIZE}&sort=scored&order=desc`,
                );
                return {
                    items: (list.data ?? []).map((manga, index) => toDiscoverItem(base, manga, "rating", index + 1)),
                };
            }

            default:
                return { items: [] };
        }
    }

    /**
     * Offers the site's filters as tag sections.
     *
     * 0.8 has no separate sort control, so the sort order is a section of tags
     * as well; picking more than one leaves the first in effect.
     */
    override async getFilterSections(): Promise<TagSection[]> {
        return [
            {
                id: FILTERS.SORT,
                title: "Sort by",
                tags: SORT_OPTIONS.map((option) => filterTag(FILTERS.SORT, option.id, option.title)),
            },
            {
                id: FILTERS.PERIOD,
                title: "Rankings",
                tags: PERIOD_OPTIONS.map((option) => filterTag(FILTERS.PERIOD, option.id, option.title)),
            },
            {
                id: FILTERS.GENRE,
                title: "Genres",
                tags: GENRES.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.title)),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
        ];
    }

    /** The catalogue takes an explicit exclusion list of its own. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const base = this.baseUrl;

        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const included = groupTags(query.includedTags);
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        // A chosen ranking replaces the catalogue query; it is a fixed-size
        // list with no paging of its own.
        const period = included.get(FILTERS.PERIOD)?.[0];
        if (period !== undefined) {
            const list = await fetchJson<ApiManga[]>(
                `${base}/api/manga/most-read?limit=30&period=${encodeURIComponent(period)}`,
            );
            return { items: list.map((manga) => toSearchResultItem(base, manga)) };
        }

        const url = buildSearchUrl(base, {
            page,
            term: query.title,
            sortBy: included.get(FILTERS.SORT)?.[0],
            status: included.get(FILTERS.STATUS)?.[0],
            includedGenres: included.get(FILTERS.GENRE),
            excludedGenres: groupTags(query.excludedTags).get(FILTERS.GENRE),
        });

        const list = await fetchJson<ApiMangaList>(url);
        const current = list.pagination?.currentPage ?? page;
        const total = list.pagination?.totalPages ?? current;

        return {
            items: (list.data ?? []).map((manga) => toSearchResultItem(base, manga)),
            metadata: current < total ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        const numericId = numericIdFrom(mangaId);
        if (numericId === undefined) {
            throw new Error(`Cannot work out a series id from ${mangaId}.`);
        }

        const details = await fetchJson<ApiMangaDetails>(`${this.baseUrl}/api/manga/${numericId}`);
        if (details.manga === undefined) {
            throw new Error(`Unable to read the details for ${mangaId}.`);
        }

        return toSourceManga(this.baseUrl, details.manga, mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const body = await fetchFlight(`${this.baseUrl}/manga/${sourceManga.mangaId}`);
        return parseChapters(body, sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const body = await fetchFlight(
            `${this.baseUrl}/manga/${chapter.sourceManga.mangaId}/${chapter.chapterId}`,
        );
        return parseChapterPages(body, chapter);
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const host = this.baseUrl.replace(/^https?:\/\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const mangaId = new RegExp(`^https?://(?:www\\.)?${host}/manga/([^/?#]+)/?$`, "i").exec(
            (title ?? "").trim(),
        )?.[1];

        if (mangaId === undefined || numericIdFrom(mangaId) === undefined) {
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
