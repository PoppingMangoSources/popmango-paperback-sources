/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    CloudflareError,
    ContentRating,
    DiscoverSectionType,
    PopmangoSource,
    sourceInfo,
    switchRow,
    type Chapter,
    type ChapterDetails,
    type DiscoverSection,
    type DiscoverSectionItem,
    type MenuSection,
    type PagedResults,
    type SearchQuery,
    type SearchResultItem,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import {
    DOMAIN,
    FILTERS,
    PAGE_SIZE,
    PERIOD_OPTIONS,
    SECTIONS,
    SETTINGS_KEYS,
    SHOW_LOCKED_CHAPTERS_KEY,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    filterTag,
    splitFilterTag,
    type PageMetadata,
    type PopularPeriod,
} from "./models";
import {
    StoneScapeInterceptor,
    fetchBanner,
    fetchChapterPages,
    fetchChapters,
    fetchGenres,
    fetchPopular,
    fetchSeries,
    fetchSeriesDetails,
    mangaUrl,
} from "./network";
import {
    decodeChapterId,
    decodeMangaId,
    parseChapterList,
    parseChapterPages,
    parseMangaDetails,
    parseMangaList,
    toChapterUpdateItem,
    toFeaturedItem,
    toSearchResultItem,
} from "./parsers";

export const StoneScapeInfo = sourceInfo({
    name: "StoneScape",
    description: "Extension that pulls comics from stonescape.xyz.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class StoneScape extends PopmangoSource {
    /** The genre list, which the site publishes as its own endpoint. */
    private genres?: Promise<Tag[]>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 5, bufferInterval: 1, ignoreImages: true },
            interceptor: new StoneScapeInterceptor(),
        });
    }

    /** Whether chapters that have to be bought are listed at all. */
    private get showLockedChapters(): boolean {
        return this.settings.boolean(SHOW_LOCKED_CHAPTERS_KEY, false);
    }

    override getMangaShareUrl(mangaId: string): string {
        return mangaUrl(decodeMangaId(mangaId));
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "chapters",
                header: "Chapters",
                footer: "Locked chapters have to be unlocked on the website before they will open.",
                rows: [
                    switchRow("show_locked", {
                        label: "Show locked chapters",
                        get: () => this.showLockedChapters,
                        set: (value) => this.settings.set(SHOW_LOCKED_CHAPTERS_KEY, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        // The site's novel shelves are not carried here, and 0.9's strips of
        // links into the charts and genres moved to the search filters.
        return [
            { id: SECTIONS.FEATURED, title: "Featured Series", type: DiscoverSectionType.featured },
            { id: SECTIONS.LATEST, title: "Latest Releases", type: DiscoverSectionType.chapterUpdates },
        ];
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        switch (section.id) {
            case SECTIONS.FEATURED:
                return { items: await this.getFeatured() };

            case SECTIONS.LATEST: {
                const response = await fetchSeries({ page: 1, limit: 12 });
                return {
                    items: response.data.flatMap((series) => {
                        const item = toChapterUpdateItem(series);
                        return item === undefined || !/^https?:\/\/\S+$/i.test(item.imageUrl) ? [] : [item];
                    }),
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
                title: "Popular charts",
                tags: PERIOD_OPTIONS.map((period) => filterTag(FILTERS.PERIOD, period.id, period.title)),
            },
            {
                id: FILTERS.GENRE,
                title: "Genres",
                tags: (await this.getGenres()).map((genre) =>
                    filterTag(FILTERS.GENRE, genre.id, genre.title),
                ),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
        ];
    }

    /** Genres are filtered out here, since the endpoint only takes inclusions. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const included = groupTags(query.includedTags);

        // A chosen chart replaces the search; it is the site's own ranking for
        // a window and takes no other filter.
        const period = included.get(FILTERS.PERIOD)?.[0] as PopularPeriod | undefined;
        if (period !== undefined) {
            const popular = await fetchPopular(period, PAGE_SIZE);
            return { items: parseMangaList(popular.data).map(toSearchResultItem) };
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const includedGenres = included.get(FILTERS.GENRE) ?? [];

        const response = await fetchSeries({
            page,
            limit: PAGE_SIZE,
            genres: includedGenres.length > 0 ? includedGenres : undefined,
            status: statusForApi(included.get(FILTERS.STATUS)?.[0]),
            search: (query.title ?? "").trim() || undefined,
            sort: included.get(FILTERS.SORT)?.[0],
        });

        // The endpoint takes inclusions only, so exclusions are applied here.
        const excludedGenres = (groupTags(query.excludedTags).get(FILTERS.GENRE) ?? []).map(normalisedGenre);
        const series =
            excludedGenres.length === 0
                ? response.data
                : response.data.filter((item) => {
                      const genres = new Set((item.genres ?? []).map(normalisedGenre));
                      return !excludedGenres.some((genre) => genres.has(genre));
                  });

        return {
            items: parseMangaList(series).map(toSearchResultItem),
            metadata:
                page < response.pagination.totalPages ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchSeriesDetails(decodeMangaId(mangaId)));
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const response = await fetchChapters(decodeMangaId(sourceManga.mangaId));
        return parseChapterList(response.chapters, sourceManga, this.showLockedChapters);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const decoded = decodeChapterId(chapter.chapterId);
        if (decoded.locked) {
            throw new Error("This chapter has to be unlocked on the website before it can be read.");
        }
        return parseChapterPages(await fetchChapterPages(decoded.chapterId), chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    /**
     * The banner endpoint names the featured series but carries little about
     * them, so the listing is fetched alongside and the two are merged.
     */
    private async getFeatured(): Promise<DiscoverSectionItem[]> {
        const [banner, listing] = await Promise.all([fetchBanner(), fetchSeries({ page: 1, limit: 100 })]);

        const byId = new Map(listing.data.map((series) => [series.seriesId, series]));
        const featured = banner.featuredSeries.map((series) => ({ ...byId.get(series.seriesId), ...series }));

        return parseMangaList(featured)
            .filter((item) => item.imageUrl.length > 0)
            .map(toFeaturedItem);
    }

    private getGenres(): Promise<Tag[]> {
        this.genres ??= fetchGenres()
            .then((response) => response.genres.map((genre) => ({ id: genre.slug, title: genre.label })))
            .catch((error: unknown) => {
                this.genres = undefined;
                throw error;
            });
        return this.genres;
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const slug = /^https?:\/\/(?:www\.)?stonescape\.xyz\/series\/([^/?#]+)/i.exec((title ?? "").trim())?.[1];
        if (slug === undefined) {
            return undefined;
        }

        try {
            const manga = parseMangaDetails(await fetchSeriesDetails(decodeMangaId(slug)));
            return {
                items: [
                    {
                        mangaId: manga.mangaId,
                        title: manga.mangaInfo.primaryTitle,
                        imageUrl: manga.mangaInfo.thumbnailUrl,
                        contentRating: manga.mangaInfo.contentRating,
                    },
                ],
            };
        } catch (error: unknown) {
            // A challenge has to reach the app, but a link to something that is
            // not a series just falls through to an ordinary search.
            if (error instanceof CloudflareError) {
                throw error;
            }
            return undefined;
        }
    }
}

/** The filter and the endpoint disagree on what "in process" is called. */
function statusForApi(value: string | undefined): string | undefined {
    switch (value) {
        case "in-process":
            return "ongoing";
        case "completed":
        case "hiatus":
            return value;
        default:
            return undefined;
    }
}

function normalisedGenre(value: string): string {
    return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
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
