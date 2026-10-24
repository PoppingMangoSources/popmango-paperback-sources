/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    CloudflareError,
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
    type Tag,
    type TagSection,
} from "../../common";

import {
    DISCOVER_SECTIONS,
    DOMAIN,
    FILTERS,
    MAX_CATALOGUE_PAGES,
    MIN_QUERY_LENGTH,
    PAGE_SIZE,
    SECTIONS,
    SETTINGS_KEYS,
    SHOW_LOCKED_KEY,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    filterTag,
    splitFilterTag,
    type HomeResponse,
    type PageMetadata,
    type SectionId,
    type SeriesItem,
    type SeriesPage,
} from "./models";
import {
    QiScansInterceptor,
    fetchAllChapters,
    fetchChapter,
    fetchGenres,
    fetchHome,
    fetchLatest,
    fetchSeries,
    fetchSeriesList,
    searchSeries,
    seriesUrl,
    type SeriesFilters,
} from "./network";
import {
    isReadable,
    toChapters,
    toDiscoverItem,
    toGenreOptions,
    toPages,
    toSearchResult,
    toSourceManga,
} from "./parsers";

export const QiScansInfo = sourceInfo({
    name: "QiScans",
    description: "Extension that pulls manhwa, manhua and manga from qimanga.com.",
    version: "1.0.2",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

type HomeItem = "featuredCarouselItem" | "simpleCarouselItem" | "prominentCarouselItem";

const HOME_ROWS: Partial<Record<SectionId, { key: keyof HomeResponse; item: HomeItem }>> = {
    [SECTIONS.FEATURED]: { key: "banners", item: "featuredCarouselItem" },
    [SECTIONS.POPULAR]: { key: "popular", item: "simpleCarouselItem" },
    [SECTIONS.PINNED]: { key: "pinned", item: "simpleCarouselItem" },
    [SECTIONS.EDITORS_PICK]: { key: "editorsPick", item: "prominentCarouselItem" },
};

const CATALOGUE_TTL = 2 * 60 * 1000;

const nextPage = (result: SeriesPage, page: number): PageMetadata | undefined =>
    result.next !== null && result.next > page ? { page: page + 1 } : undefined;

const normalize = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export class QiScans extends PopmangoSource {
    // Matches for a title search with filters, so later pages do not rescan the catalogue
    private catalogue?: { key: string; at: number; items: SeriesItem[] };

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            // Pages come from a separate media host. The API allows 60 requests per 30 seconds, and more
            // than one a second runs into it while a library refreshes.
            rateLimit: { numberOfRequests: 10, bufferInterval: 1 },
            apiRateLimit: { numberOfRequests: 1, bufferInterval: 1 },
            interceptor: new QiScansInterceptor(),
        });
    }

    private get showLocked(): boolean {
        return this.settings.boolean(SHOW_LOCKED_KEY, false);
    }

    override getMangaShareUrl(mangaId: string): string {
        return seriesUrl(mangaId);
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "chapters",
                header: "Chapters",
                footer: "Paid chapters show their price and open only once unlocked. Chapters you own may open after signing in on the website through the cloud button.",
                rows: [
                    switchRow("show_locked", {
                        label: "Show paid chapters",
                        get: () => this.showLocked,
                        set: (value) => this.settings.set(SHOW_LOCKED_KEY, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return DISCOVER_SECTIONS;
    }

    async getDiscoverSectionItems(section: DiscoverSection, metadata: unknown): Promise<PagedResults<DiscoverSectionItem>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        if (section.id === SECTIONS.LATEST) {
            const result = await fetchLatest(page);
            return {
                items: result.data
                    .filter(isReadable)
                    .map((series) => toDiscoverItem(series, "chapterUpdatesCarouselItem"))
                    .filter((item): item is DiscoverSectionItem => item !== undefined),
                metadata: nextPage(result, page),
            };
        }
        if (section.id === SECTIONS.NEW) {
            const result = await fetchSeriesList(page, { sort: "newest", genres: [] });
            return {
                items: result.data.filter(isReadable).map((series) => toDiscoverItem(series, "simpleCarouselItem")!),
                metadata: nextPage(result, page),
            };
        }

        const row = HOME_ROWS[section.id as SectionId];
        if (row === undefined) {
            return { items: [] };
        }
        // Every home row reads the same response; identical requests are shared by the runtime.
        const home = await fetchHome();
        return {
            items: (home[row.key] ?? []).filter(isReadable).map((series) => toDiscoverItem(series, row.item)!),
        };
    }

    // 0.8 has no sort or single-choice control, so each is a tag section; the first pick wins.
    override async getFilterSections(): Promise<TagSection[]> {
        const genres = await fetchGenres().catch((error: unknown) => {
            if (error instanceof CloudflareError) {
                throw error;
            }
            return [];
        });

        const section = (id: string, title: string, options: Tag[]): TagSection => ({
            id,
            title,
            tags: options.map((option) => filterTag(id, option.id, option.title)),
        });

        return [
            section(FILTERS.SORT, "Sort by", SORT_OPTIONS),
            section(FILTERS.TYPE, "Type", TYPE_OPTIONS),
            section(FILTERS.STATUS, "Status", STATUS_OPTIONS),
            ...(genres.length > 0 ? [section(FILTERS.GENRE, "Genres (all must match)", toGenreOptions(genres))] : []),
        ];
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const filters: SeriesFilters = { sort: "latest", genres: [] };
        const picked = new Set<string>();
        for (const tag of query.includedTags) {
            const split = splitFilterTag(tag.id);
            if (split === undefined) {
                continue;
            }
            if (split.section === FILTERS.GENRE) {
                filters.genres.push(split.value);
            } else if (!picked.has(split.section)) {
                picked.add(split.section);
                if (split.section === FILTERS.SORT) filters.sort = split.value;
                if (split.section === FILTERS.TYPE) filters.type = split.value;
                if (split.section === FILTERS.STATUS) filters.status = split.value;
            }
        }
        const title = (query.title ?? "").trim().replace(/\s+/g, " ");

        if (title.length === 0) {
            const result = await fetchSeriesList(page, filters);
            return { items: result.data.filter(isReadable).map(toSearchResult), metadata: nextPage(result, page) };
        }
        if (title.length < MIN_QUERY_LENGTH) {
            throw new Error(`Type at least ${MIN_QUERY_LENGTH} characters to search Qi Scans.`);
        }
        if (filters.type === undefined && filters.status === undefined && filters.genres.length === 0) {
            const result = await searchSeries(title, page);
            return { items: result.data.filter(isReadable).map(toSearchResult), metadata: nextPage(result, page) };
        }

        // Search takes no filters, so a filtered title search matches within the filtered catalogue
        const matches = await this.filteredMatches(title, filters);
        const items = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        return {
            items: items.map(toSearchResult),
            metadata: page * PAGE_SIZE < matches.length ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    private async filteredMatches(title: string, filters: SeriesFilters): Promise<SeriesItem[]> {
        const key = JSON.stringify([title, filters]);
        if (this.catalogue?.key === key && Date.now() - this.catalogue.at < CATALOGUE_TTL) {
            return this.catalogue.items;
        }
        const needle = normalize(title);
        const matches: SeriesItem[] = [];
        for (let page = 1; page <= MAX_CATALOGUE_PAGES; page++) {
            const result = await fetchSeriesList(page, filters);
            matches.push(
                ...result.data.filter(
                    (series) =>
                        isReadable(series) &&
                        [series.title, ...(series.alternativeTitles ?? "").split(/\s*[•;|,\r\n]\s*/)].some((name) =>
                            normalize(name ?? "").includes(needle),
                        ),
                ),
            );
            if (nextPage(result, page) === undefined) {
                break;
            }
        }
        this.catalogue = { key, at: Date.now(), items: matches };
        return matches;
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return toSourceManga(await fetchSeries(mangaId));
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return toChapters(await fetchAllChapters(sourceManga.mangaId), sourceManga, this.showLocked);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const mangaId = chapter.sourceManga.mangaId;
        return { id: chapter.chapterId, mangaId, pages: toPages(await fetchChapter(mangaId, chapter.chapterId)) };
    }

    // The reader needs only the ids, so a chapter opened from history skips refetching the list.
    protected override chapterFromIds(mangaId: string, chapterId: string): Chapter {
        return { chapterId, chapNum: 0, sourceManga: { mangaId } as SourceManga };
    }
}
