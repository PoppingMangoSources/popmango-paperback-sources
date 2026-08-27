/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    ContentRating,
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
    DISCOVER_SECTIONS,
    DOMAIN,
    FILTERS,
    PAGE_SIZE,
    PAID_CHAPTER_SUFFIX,
    SECTIONS,
    SETTINGS_KEYS,
    SHOW_PAID_CHAPTERS_KEY,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TRENDING_RANGES,
    filterTag,
    splitFilterTag,
    type BrowseSeries,
    type HomeSections,
    type PageMetadata,
    type TrendingRange,
} from "./models";
import {
    TempleScanInterceptor,
    fetchChapterPage,
    fetchDirectory,
    fetchFeatured,
    fetchHomePage,
    fetchSeriesPage,
    fetchTrending,
    mangaUrl,
} from "./network";
import {
    parseChapterPages,
    parseChapters,
    parseDirectory,
    parseFeatured,
    parseHomeSections,
    parseSeriesData,
    parseTrending,
    toFeaturedItems,
    toNewSeriesItems,
    toSearchResultItem,
    toSourceManga,
    toTrendingItems,
    toUpdateItems,
    withFeaturedCovers,
} from "./parsers";

export const TempleScanInfo = sourceInfo({
    name: "Temple Scan",
    description: "Extension that pulls content from templetoons.com.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class TempleScan extends PopmangoSource {
    /** The browse endpoint returns the whole directory; hold on to it. */
    private directory?: Promise<BrowseSeries[]>;

    private featured?: Promise<DiscoverSectionItem[]>;

    /** New Series and Latest Updates share one page, so they share one fetch. */
    private home?: Promise<HomeSections>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 2, bufferInterval: 1, ignoreImages: true },
            interceptor: new TempleScanInterceptor(),
        });
    }

    /** Whether chapters that have to be bought are listed at all. */
    private get showPaidChapters(): boolean {
        return this.settings.boolean(SHOW_PAID_CHAPTERS_KEY, false);
    }

    override getMangaShareUrl(mangaId: string): string {
        return mangaUrl(mangaId);
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "chapters",
                header: "Chapters",
                footer: "Paid chapters have to be unlocked on the website before they will open.",
                rows: [
                    switchRow("show_paid_chapters", {
                        label: "Show paid chapters",
                        get: () => this.showPaidChapters,
                        set: (value) => this.settings.set(SHOW_PAID_CHAPTERS_KEY, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return DISCOVER_SECTIONS;
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        switch (section.id) {
            case SECTIONS.FEATURED:
                return { items: await this.getFeatured() };

            case SECTIONS.NEW_SERIES:
                return { items: toNewSeriesItems((await this.getHome()).newSeries) };

            case SECTIONS.LATEST:
                return { items: toUpdateItems((await this.getHome()).updates) };

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
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
        ];
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const included = groupTags(query.includedTags);

        // A chosen chart replaces the directory query; it is a fixed-size list
        // from the site's own ranking with no paging of its own.
        const range = included.get(FILTERS.TRENDING)?.[0] as TrendingRange | undefined;
        if (range !== undefined) {
            return { items: toTrendingItems(parseTrending(await fetchTrending(), range)) };
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const title = (query.title ?? "").trim().toLowerCase();
        const status = included.get(FILTERS.STATUS)?.[0];
        const sort = included.get(FILTERS.SORT)?.[0];

        // The site has no search endpoint — the browse route hands over the
        // whole directory, so the filtering and paging happen here.
        const matches = (await this.getDirectory()).filter((series) => {
            const matchesTitle =
                title.length === 0 ||
                series.title.toLowerCase().includes(title) ||
                (series.alternative_names ?? "").toLowerCase().includes(title);

            return matchesTitle && (status === undefined || series.status === status);
        });

        const sorted = matches.sort((left, right) => {
            switch (sort) {
                case "updated":
                    return time(right.update_chapter) - time(left.update_chapter);
                case "created":
                    return time(right.created_at) - time(left.created_at);
                default:
                    return (right.total_views ?? 0) - (left.total_views ?? 0);
            }
        });

        return {
            items: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toSearchResultItem),
            metadata: page * PAGE_SIZE < sorted.length ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return toSourceManga(parseSeriesData(await fetchSeriesPage(mangaId), mangaId), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const data = parseSeriesData(await fetchSeriesPage(sourceManga.mangaId), sourceManga.mangaId);
        return parseChapters(data, sourceManga, this.showPaidChapters);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        if (chapter.chapterId.endsWith(PAID_CHAPTER_SUFFIX)) {
            throw new Error("This chapter has to be bought. Unlock it on the website before reading.");
        }

        const payload = await fetchChapterPage(chapter.sourceManga.mangaId, chapter.chapterId);
        return parseChapterPages(payload, chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private getDirectory(): Promise<BrowseSeries[]> {
        // A failed fetch is forgotten, so the next search tries again rather
        // than handing back the same error for the rest of the session.
        this.directory ??= fetchDirectory()
            .then(parseDirectory)
            .catch((error: unknown) => {
                this.directory = undefined;
                throw error;
            });
        return this.directory;
    }

    private getFeatured(): Promise<DiscoverSectionItem[]> {
        this.featured ??= Promise.all([fetchFeatured().then(parseFeatured), this.getDirectory()])
            .then(([entries, directory]) => toFeaturedItems(withFeaturedCovers(entries, directory)))
            .catch((error: unknown) => {
                this.featured = undefined;
                throw error;
            });
        return this.featured;
    }

    private getHome(): Promise<HomeSections> {
        // Held only for the length of one home page build, so a refresh shows
        // what the site has now rather than what it had at launch.
        this.home ??= fetchHomePage()
            .then(parseHomeSections)
            .finally(() => {
                this.home = undefined;
            });
        return this.home;
    }
}

/** Reads a date that may be missing or unparseable. */
function time(value: string | null | undefined): number {
    const parsed = new Date(value ?? "").getTime();
    return isNaN(parsed) ? 0 : parsed;
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
