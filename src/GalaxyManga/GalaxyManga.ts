/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    ContentRating,
    PopmangoSource,
    selectRow,
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
    type Tag,
    type TagSection,
} from "../../common";

import {
    DOMAIN,
    FILTERS,
    HOME_HEADINGS,
    NEXT_PAGE_SELECTOR,
    SECTIONS,
    SECTION_DEFINITIONS,
    SECTION_OPTIONS,
    SECTION_ORDER,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TRENDING_RANGE,
    TRENDING_RANGES,
    TYPE_OPTIONS,
    VISIBLE_SECTIONS_KEY,
    filterTag,
    splitFilterTag,
    type PageMetadata,
    type SectionId,
} from "./models";
import {
    GalaxyMangaInterceptor,
    fetchChapterPage,
    fetchDirectoryPage,
    fetchHomePage,
    fetchMangaPage,
    mangaUrl,
} from "./network";
import {
    parseCards,
    parseChapterPages,
    parseChapters,
    parseGenreOptions,
    parseLatestCards,
    parseMangaDetails,
    parseMangaId,
    parseTrendingCards,
    parseWidgetCards,
    toDiscoverItem,
    toLatestItem,
    toSearchResultItem,
} from "./parsers";

export const GalaxyMangaInfo = sourceInfo({
    name: "Galaxy Manga",
    description: "Extension that pulls content from galaxymanga.io.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class GalaxyManga extends PopmangoSource {
    /** The home page, shared by the sections that all read from it. */
    private homePage?: Promise<CheerioAPI>;

    /** The genre list, which the directory publishes on its own page. */
    private genres?: Promise<Tag[]>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 4, bufferInterval: 1, ignoreImages: true },
            interceptor: new GalaxyMangaInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return mangaUrl(mangaId);
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "sections",
                header: "Home page",
                footer: "Choose which sections appear. Leave everything unticked to show them all.",
                rows: [
                    selectRow("visible_sections", {
                        label: "Sections shown",
                        options: SECTION_OPTIONS,
                        multiple: true,
                        get: () => this.settings.stringArray(VISIBLE_SECTIONS_KEY, new Set(SECTION_ORDER)),
                        set: (value) => this.settings.set(VISIBLE_SECTIONS_KEY, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const chosen = this.settings.stringArray(VISIBLE_SECTIONS_KEY, new Set(SECTION_ORDER));
        const wanted = chosen.length > 0 ? new Set(chosen) : undefined;

        return SECTION_ORDER.filter((id) => wanted === undefined || wanted.has(id)).map(
            (id) => SECTION_DEFINITIONS[id],
        );
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        const document = await this.getHomePage();

        switch (section.id as SectionId) {
            case SECTIONS.POPULAR:
                return { items: parseCards(document).map(toDiscoverItem) };

            case SECTIONS.TRENDING:
                return { items: parseTrendingCards(document, TRENDING_RANGE).map(toDiscoverItem) };

            case SECTIONS.POPULAR_TODAY:
                return { items: parseWidgetCards(document, HOME_HEADINGS.POPULAR_TODAY).map(toDiscoverItem) };

            case SECTIONS.FRESH:
                return { items: parseWidgetCards(document, HOME_HEADINGS.FRESH).map(toDiscoverItem) };

            case SECTIONS.LATEST:
                return {
                    items: parseLatestCards(document, HOME_HEADINGS.LATEST).flatMap((card) => {
                        const item = toLatestItem(card);
                        return item === undefined ? [] : [item];
                    }),
                };

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
                tags: (await this.getGenres()).map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.title)),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
            {
                id: FILTERS.TYPE,
                title: "Type",
                tags: TYPE_OPTIONS.map((option) => filterTag(FILTERS.TYPE, option.id, option.title)),
            },
        ];
    }

    /** The directory takes exclusions in the same parameter as inclusions. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const included = groupTags(query.includedTags);

        // A chosen chart replaces the directory query; it is a fixed-size list
        // read off the home page with no paging of its own.
        const range = included.get(FILTERS.TRENDING)?.[0];
        if (range !== undefined) {
            const cards = parseTrendingCards(await this.getHomePage(), range);
            return { items: cards.map(toSearchResultItem) };
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const document = await fetchDirectoryPage(page, {
            title: query.title,
            order: included.get(FILTERS.SORT)?.[0],
            status: included.get(FILTERS.STATUS)?.[0],
            type: included.get(FILTERS.TYPE)?.[0],
            includedGenres: included.get(FILTERS.GENRE),
            excludedGenres: groupTags(query.excludedTags).get(FILTERS.GENRE),
        });

        return {
            items: parseCards(document).map(toSearchResultItem),
            metadata:
                document(NEXT_PAGE_SELECTOR).length > 0 ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(await fetchMangaPage(sourceManga.mangaId), sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const pages = parseChapterPages(await fetchChapterPage(chapter.chapterId));

        if (pages.length === 0) {
            throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
        }

        return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private getHomePage(): Promise<CheerioAPI> {
        return (this.homePage ??= fetchHomePage());
    }

    private getGenres(): Promise<Tag[]> {
        return (this.genres ??= fetchDirectoryPage(1).then(parseGenreOptions));
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const query = (title ?? "").trim();
        if (!/^https?:\/\/(?:www\.)?galaxymanga\.io\//i.test(query)) {
            return undefined;
        }

        const mangaId = parseMangaId(query);
        if (mangaId.length === 0) {
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
