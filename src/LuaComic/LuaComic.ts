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
    type TagSection,
} from "../../common";

import {
    DOMAIN,
    FALLBACK_GENRES,
    FILTERS,
    PAID_CHAPTER_SUFFIX,
    SECTIONS,
    SETTINGS_KEYS,
    SHOW_ADULT_KEY,
    SHOW_PAID_KEY,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TRENDING_RANGES,
    filterTag,
    splitFilterTag,
    type LuaHomePage,
    type OptionItem,
    type PageMetadata,
} from "./models";
import {
    LuaComicInterceptor,
    fetchAllChapters,
    fetchChapterPage,
    fetchHomePage,
    fetchQuery,
    fetchSeriesPage,
    fetchTags,
    fetchTrending,
    mangaUrl,
} from "./network";
import {
    decodeSlugId,
    encodeSlugId,
    parseChapterList,
    parseChapterPages,
    parseHomePage,
    parseMangaDetails,
    parseSeriesPage,
    tagNames,
    toBannerItems,
    toLatestItems,
    toPopularItems,
    toRankedItems,
    toRecommendedItems,
    toSearchResultItems,
    toTrendingSearchItems,
} from "./parsers";

export const LuaComicInfo = sourceInfo({
    name: "Lua Comic",
    description: "Extension that pulls content from luacomic.org.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class LuaComic extends PopmangoSource {
    /** The home page, which three sections read from. */
    private homePage?: Promise<LuaHomePage>;

    /** The genre list, which the site publishes as its own endpoint. */
    private genres?: Promise<OptionItem[]>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 15, bufferInterval: 10, ignoreImages: true },
            interceptor: new LuaComicInterceptor(),
        });
    }

    private get showPaidChapters(): boolean {
        return this.settings.boolean(SHOW_PAID_KEY, false);
    }

    private get showAdultContent(): boolean {
        return this.settings.boolean(SHOW_ADULT_KEY, false);
    }

    override getMangaShareUrl(mangaId: string): string {
        return mangaUrl(decodeSlugId(mangaId));
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "content",
                header: "What to show",
                footer:
                    "Paid chapters have to be unlocked on the website before they will open. " +
                    "Adult series are left out of browsing and search unless asked for.",
                rows: [
                    switchRow("show_paid", {
                        label: "Show paid chapters",
                        get: () => this.showPaidChapters,
                        set: (value) => this.settings.set(SHOW_PAID_KEY, value),
                    }),
                    switchRow("show_adult", {
                        label: "Show adult content",
                        get: () => this.showAdultContent,
                        set: (value) => this.settings.set(SHOW_ADULT_KEY, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        // 0.9 also showed strips of links into the trending charts and the
        // genre list. 0.8 has no tile that can hold a link, so both moved to
        // the search filters.
        return [
            { id: SECTIONS.POPULAR, title: "Most Popular", type: DiscoverSectionType.featured },
            { id: SECTIONS.RECOMMENDED, title: "Recommended", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
            { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
            { id: SECTIONS.EDITORS, title: "Editor's Choice", type: DiscoverSectionType.simpleCarousel },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        switch (section.id) {
            case SECTIONS.POPULAR: {
                const data = await fetchQuery({ page: 1, orderBy: "total_views", adult: this.showAdultContent });
                return { items: toPopularItems(data.data ?? []) };
            }

            case SECTIONS.FEATURED:
                return { items: toBannerItems((await this.getHomePage()).banners) };

            case SECTIONS.RECOMMENDED:
                return { items: toRecommendedItems((await this.getHomePage()).recommended) };

            case SECTIONS.EDITORS:
                return { items: toRankedItems((await this.getHomePage()).editors) };

            case SECTIONS.LATEST: {
                const page = (metadata as PageMetadata | undefined)?.page ?? 1;
                const data = await fetchQuery({ page, orderBy: "updated_at", adult: this.showAdultContent });

                return {
                    items: toLatestItems(data.data ?? []),
                    metadata:
                        (data.meta?.last_page ?? 1) > page
                            ? ({ page: page + 1 } satisfies PageMetadata)
                            : undefined,
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
                id: FILTERS.TRENDING,
                title: "Trending charts",
                tags: TRENDING_RANGES.map((range) => filterTag(FILTERS.TRENDING, range.id, range.title)),
            },
            {
                id: FILTERS.GENRE,
                title: "Genres",
                tags: (await this.getGenres()).map((genre) =>
                    filterTag(FILTERS.GENRE, genre.id, genre.value),
                ),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
        ];
    }

    /** Excluded genres are filtered out here; the endpoint takes inclusions only. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const included = groupTags(query.includedTags);

        // A chosen chart replaces the catalogue query; it is a fixed-size list
        // from the site's own ranking with no paging of its own.
        const range = included.get(FILTERS.TRENDING)?.[0];
        if (range !== undefined) {
            return { items: toTrendingSearchItems(await fetchTrending(range)) };
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        const data = await fetchQuery({
            page,
            search: (query.title ?? "").trim() || undefined,
            orderBy: included.get(FILTERS.SORT)?.[0],
            status: included.get(FILTERS.STATUS)?.[0],
            genres: included.get(FILTERS.GENRE),
            adult: this.showAdultContent,
        });

        // The endpoint takes inclusions only, so exclusions are applied here.
        const excluded = new Set((groupTags(query.excludedTags).get(FILTERS.GENRE) ?? []).map((id) => id.toLowerCase()));
        const entries = (data.data ?? []).filter(
            (series) => excluded.size === 0 || !tagNames(series).some((name) => excluded.has(name.toLowerCase())),
        );

        return {
            items: toSearchResultItems(entries),
            metadata:
                (data.meta?.last_page ?? 1) > page ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        const slug = decodeSlugId(mangaId);
        return parseMangaDetails(parseSeriesPage(await fetchSeriesPage(slug), slug));
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const chapters = await fetchAllChapters(decodeSlugId(sourceManga.mangaId));
        return parseChapterList(chapters, sourceManga, this.showPaidChapters);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        if (chapter.chapterId.endsWith(PAID_CHAPTER_SUFFIX)) {
            throw new Error("This chapter has to be bought. Unlock it on the website before reading.");
        }

        const html = await fetchChapterPage(
            decodeSlugId(chapter.sourceManga.mangaId),
            decodeSlugId(chapter.chapterId),
        );
        return parseChapterPages(html, chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private getHomePage(): Promise<LuaHomePage> {
        this.homePage ??= fetchHomePage()
            .then(parseHomePage)
            .catch((error: unknown) => {
                this.homePage = undefined;
                throw error;
            });
        return this.homePage;
    }

    private getGenres(): Promise<OptionItem[]> {
        this.genres ??= fetchTags()
            .then((tags) => (tags.length > 0 ? tags : FALLBACK_GENRES))
            .catch((error: unknown) => {
                // A challenge has to reach the app; anything else just means
                // the search screen shows the bundled list instead.
                if (error instanceof CloudflareError) {
                    this.genres = undefined;
                    throw error;
                }
                return FALLBACK_GENRES;
            });
        return this.genres;
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const slug = /^https?:\/\/(?:www\.)?luacomic\.org\/series\/([^/?#]+)/i.exec((title ?? "").trim())?.[1];
        if (slug === undefined) {
            return undefined;
        }

        const manga = await this.getMangaInfo(encodeSlugId(decodeSlugId(slug)));
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
