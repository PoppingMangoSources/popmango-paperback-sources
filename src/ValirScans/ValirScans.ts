/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    ContentRating,
    PopmangoSource,
    inputRow,
    labelRow,
    normaliseUrlOverride,
    sourceInfo,
    switchRow,
    type Chapter,
    type ChapterDetails,
    type DiscoverSection,
    type DiscoverSectionItem,
    type MenuSection,
    type PagedResults,
    type SearchField,
    type SearchQuery,
    type SearchResultItem,
    type SourceManga,
    type TagSection,
} from "../../common";

import {
    BASE_URL_KEY,
    DISCOVER_SECTIONS,
    DOMAIN,
    FILTERS,
    GENRES,
    LOCKED_CHAPTER_PREFIX,
    MAX_CHAPTERS_FIELD,
    MIN_CHAPTERS_FIELD,
    ORIGIN_OPTIONS,
    SECTIONS,
    SETTINGS_KEYS,
    SHOW_PAID_CHAPTERS_KEY,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    filterTag,
    splitFilterTag,
    type FilterTaxonomy,
    type HomeSections,
    type PageMetadata,
} from "./models";
import {
    ValirScansInterceptor,
    fetchBrowsePage,
    fetchChapterPage,
    fetchHomePage,
    fetchSeriesPage,
    mangaUrl,
} from "./network";
import {
    parseBrowsePage,
    parseChapterDetails,
    parseChapters,
    parseFilterTaxonomy,
    parseHomeSections,
    parseMangaDetails,
    parseSeriesPage,
    toCarouselItems,
    toChapterUpdateItems,
    toFeaturedItems,
    toSearchResultItem,
} from "./parsers";
import { bindBaseUrl } from "./site";

export const ValirScansInfo = sourceInfo({
    name: "Valir Scans",
    description: "Extension that pulls comics from valirscans.org.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class ValirScans extends PopmangoSource {
    /** The home page, which every section but New Series reads from. */
    private home?: Promise<HomeSections>;

    /** The genre and tag lists, which the browse page carries as its filter. */
    private taxonomy?: Promise<FilterTaxonomy>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 4, bufferInterval: 1, ignoreImages: true },
            interceptor: new ValirScansInterceptor(),
        });

        // Parsers and the interceptor need the address without being able to
        // wait for it, so they read it from here.
        bindBaseUrl(() => this.baseUrl);
    }

    /** The site's address, which a reader can point elsewhere if it moves. */
    private get baseUrl(): string {
        return this.settings.string(BASE_URL_KEY, DOMAIN);
    }

    /** Whether chapters that have to be unlocked are listed at all. */
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
                footer: "Paid chapters are marked with a lock and have to be unlocked on the website.",
                rows: [
                    switchRow("show_paid_chapters", {
                        label: "Show paid chapters",
                        get: () => this.showPaidChapters,
                        set: (value) => this.settings.set(SHOW_PAID_CHAPTERS_KEY, value),
                    }),
                ],
            },
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
                                this.home = undefined;
                                this.taxonomy = undefined;
                            }
                        },
                    }),
                    labelRow("base_url_current", "Currently using", this.baseUrl),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        // 0.9 also carried a Latest Novel Updates shelf. Novels are not read
        // by this extension, so it is gone rather than empty.
        return DISCOVER_SECTIONS;
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        if (section.id === SECTIONS.NEW_SERIES) {
            const page = (metadata as PageMetadata | undefined)?.page ?? 1;
            const browse = parseBrowsePage(await fetchBrowsePage({ page, sort: "newest" }));

            return {
                items: toCarouselItems(browse.series, "simpleCarouselItem"),
                metadata: browse.hasMore ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
            };
        }

        const home = await this.getHome();

        switch (section.id) {
            case SECTIONS.FEATURED:
                return { items: toFeaturedItems(home.featured) };

            case SECTIONS.EDITORS_PICKS:
                return { items: toCarouselItems(home.editorsPicks, "prominentCarouselItem") };

            case SECTIONS.LATEST_COMICS:
                return { items: toChapterUpdateItems(home.latestUpdates) };

            case SECTIONS.POPULAR_TODAY:
                return { items: toCarouselItems(home.popularToday, "prominentCarouselItem") };

            case SECTIONS.MOST_POPULAR:
                return { items: toCarouselItems(home.mostPopular, "simpleCarouselItem", true) };

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
        const taxonomy = await this.getTaxonomy();

        const sections: TagSection[] = [
            {
                id: FILTERS.SORT,
                title: "Sort by",
                tags: SORT_OPTIONS.map((option) => filterTag(FILTERS.SORT, option.id, option.title)),
            },
            {
                id: FILTERS.GENRE,
                title: "Genres",
                tags: taxonomy.genres.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.title)),
            },
        ];

        if (taxonomy.tags.length > 0) {
            sections.push({
                id: FILTERS.TAG,
                title: "Tags",
                tags: taxonomy.tags.map((tag) => filterTag(FILTERS.TAG, tag.id, tag.title)),
            });
        }

        sections.push(
            {
                id: FILTERS.TYPE,
                title: "Type",
                tags: TYPE_OPTIONS.map((option) => filterTag(FILTERS.TYPE, option.id, option.title)),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
            {
                id: FILTERS.ORIGIN,
                title: "Origin",
                tags: ORIGIN_OPTIONS.map((option) => filterTag(FILTERS.ORIGIN, option.id, option.title)),
            },
        );

        return sections;
    }

    /** The chapter count bounds are numbers, so they get boxes rather than tags. */
    override async getSearchFieldList(): Promise<SearchField[]> {
        return [
            { id: MIN_CHAPTERS_FIELD, name: "Fewest chapters", placeholder: "No minimum" },
            { id: MAX_CHAPTERS_FIELD, name: "Most chapters", placeholder: "No maximum" },
        ];
    }

    /** The browse listing takes an exclusion list for each filter. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);

        const browse = parseBrowsePage(
            await fetchBrowsePage({
                page,
                query: query.title,
                sort: included.get(FILTERS.SORT)?.[0],
                includedGenres: included.get(FILTERS.GENRE),
                excludedGenres: excluded.get(FILTERS.GENRE),
                includedTags: included.get(FILTERS.TAG),
                excludedTags: excluded.get(FILTERS.TAG),
                types: included.get(FILTERS.TYPE),
                statuses: included.get(FILTERS.STATUS),
                origins: included.get(FILTERS.ORIGIN),
                minChapters: numberField(query, MIN_CHAPTERS_FIELD),
                maxChapters: numberField(query, MAX_CHAPTERS_FIELD),
            }),
        );

        return {
            items: browse.series.map(toSearchResultItem),
            metadata: browse.hasMore ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(parseSeriesPage(await fetchSeriesPage(mangaId)), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const firstPage = parseSeriesPage(await fetchSeriesPage(sourceManga.mangaId));

        // The chapter list is paginated; the first page says how many there are.
        const laterPages = await Promise.all(
            Array.from({ length: Math.max(0, (firstPage.totalPages ?? 1) - 1) }, (_, index) =>
                fetchSeriesPage(sourceManga.mangaId, index + 2).then(parseSeriesPage),
            ),
        );

        return parseChapters([firstPage, ...laterPages], sourceManga, this.showPaidChapters);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        if (chapter.chapterId.startsWith(LOCKED_CHAPTER_PREFIX)) {
            throw new Error("This chapter is locked. Unlock it on the website before reading.");
        }

        const html = await fetchChapterPage(chapter.sourceManga.mangaId, chapter.chapterId);
        return parseChapterDetails(html, chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private getTaxonomy(): Promise<FilterTaxonomy> {
        this.taxonomy ??= fetchBrowsePage({ page: 1 })
            .then(parseFilterTaxonomy)
            // The bundled genre list stands in when the page does not carry one.
            .then((taxonomy) => (taxonomy.genres.length > 0 ? taxonomy : { ...taxonomy, genres: GENRES }))
            .catch((error: unknown) => {
                // Drop the failed attempt so the next search tries again, then
                // let the error — a challenge, say — reach the app.
                this.taxonomy = undefined;
                throw error;
            });
        return this.taxonomy;
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

/** Reads a typed-in number, ignoring anything that is not one. */
function numberField(query: SearchQuery, field: string): string | undefined {
    const value = query.parameters[field];
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? trimmed : undefined;
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
