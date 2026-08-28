/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    CloudflareError,
    Capability,
    ContentRating,
    DiscoverSectionType,
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
    AGE_RATING_OPTIONS,
    ALL_VERSIONS_KEY,
    BASE_URL_KEY,
    CHAPTERS_FROM_FIELD,
    CHAPTERS_TO_FIELD,
    DEFAULT_DOMAIN,
    FILTERS,
    GENRE_MATCH_OPTIONS,
    GENRE_OPTIONS,
    HOME_HEADINGS,
    MIN_RATING_OPTIONS,
    NOVEL_TYPE,
    SECTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TAG_FIELD,
    TOP_SERIES_CHIPS,
    TYPE_OPTIONS,
    YEAR_OPTIONS,
    filterTag,
    resolveOptionValues,
    splitFilterTag,
    type CatalogItem,
    type CatalogQuery,
    type PageMetadata,
    type TopSeriesCountry,
} from "./models";
import {
    OMangaInterceptor,
    buildSeriesNavigationHeaders,
    fetchCatalog,
    fetchFlightPayload,
    fetchHtmlPage,
    fetchPagePayload,
} from "./network";
import {
    parseChapterDetails,
    parseChapters,
    parseCatalogItems,
    parseHomeLinkSection,
    parseHomeSection,
    parseHomeTopSeries,
    parseHomeUpdates,
    parseMangaDetails,
    toFeaturedItem,
    toHomeCarouselItem,
    toLinkCardProminentItem,
    toLinkCardSimpleItem,
    toProminentCarouselItem,
    toSearchResultItem,
    toSimpleCarouselItem,
} from "./parsers";
import { bindSite, getDomain } from "./site";

export const OMangaInfo = sourceInfo({
    name: "OManga",
    description: "Extension that pulls content from omanga.to.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DEFAULT_DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class OManga extends PopmangoSource {
    /** The home page, which every section reads from. */
    private homePage?: { domain: string; promise: Promise<string> };

    /** The series page most recently read, since details and chapters share it. */
    private seriesPage?: { key: string; promise: Promise<string> };

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DEFAULT_DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 10, bufferInterval: 1, ignoreImages: true },
            interceptor: new OMangaInterceptor(),
        });

        // Parsers and the interceptor need these without being able to wait
        // for them, so they read them from here.
        bindSite(
            () => this.settings.string(BASE_URL_KEY, DEFAULT_DOMAIN),
            () => this.settings.boolean(ALL_VERSIONS_KEY, true),
        );
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${getDomain()}/manga/${mangaId}`;
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
                            if (normalised !== undefined) {
                                this.settings.set(BASE_URL_KEY, normalised);
                                this.homePage = undefined;
                                this.seriesPage = undefined;
                            }
                        },
                    }),
                    labelRow("base_url_current", "Currently using", getDomain()),
                ],
            },
            {
                id: "chapters",
                header: "Chapters",
                footer:
                    "Several teams often translate the same chapter. Listing them all lets you " +
                    "choose; listing one keeps the chapter list short.",
                rows: [
                    switchRow("all_versions", {
                        label: "Show every team's version",
                        get: () => this.settings.boolean(ALL_VERSIONS_KEY, true),
                        set: (value) => this.settings.set(ALL_VERSIONS_KEY, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        // 0.9 also showed strips of links into the country charts and the
        // genre list. 0.8 has no tile that can hold a link, so both moved to
        // the search filters.
        return [
            { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
            { id: SECTIONS.UPDATES, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
            { id: SECTIONS.NEW_SEASON, title: "New Season", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.MOST_LIKED, title: "Most Liked", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.BEST_ONGOING, title: "Best Ongoings", type: DiscoverSectionType.prominentCarousel },
            { id: SECTIONS.TREND, title: "In the Trend", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.POPULAR_TODAY, title: "Popular Today", type: DiscoverSectionType.prominentCarousel },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = metadata as PageMetadata | undefined;

        if (section.id === SECTIONS.UPDATES) {
            return { items: parseHomeUpdates(await this.getHomePage(true)) };
        }

        if (section.id === SECTIONS.POPULAR) {
            let items = parseHomeSection(await this.getHomePage(), HOME_HEADINGS.POPULAR);
            if (items.length === 0) {
                items = (await this.catalogPage({ sort: "by_views", order: "desc" }, page)).items;
            }
            return { items: items.filter((item) => item.poster.length > 0).map(toFeaturedItem) };
        }

        if (section.id === SECTIONS.MOST_LIKED) {
            const items = parseHomeSection(await this.getHomePage(), HOME_HEADINGS.MOST_LIKED);
            if (items.length > 0) {
                return { items: items.filter((item) => item.poster.length > 0).map(toHomeCarouselItem) };
            }
        }

        // These shelves are rendered rather than carried as data, so they are
        // read out of the page and only fall back to the catalogue if empty.
        const linkShelf = LINK_SHELVES[section.id];
        if (linkShelf !== undefined) {
            const cards = parseHomeLinkSection(await this.getHomePage(), linkShelf.heading, linkShelf.container);
            if (cards.length > 0) {
                return {
                    items: cards.map((card, index) =>
                        linkShelf.prominent ? toLinkCardProminentItem(card, index) : toLinkCardSimpleItem(card),
                    ),
                };
            }
        }

        const query = CATALOG_FALLBACKS[section.id] ?? { sort: "real_views", order: "desc" };
        const { items, nextMetadata } = await this.catalogPage(query, page);
        const prominent = section.id === SECTIONS.BEST_ONGOING || section.id === SECTIONS.POPULAR_TODAY;

        return {
            items: items
                .map(prominent ? toProminentCarouselItem : toSimpleCarouselItem)
                .filter((item) => item.imageUrl.length > 0),
            metadata: nextMetadata,
        };
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
                id: FILTERS.TOP,
                title: "Country charts",
                tags: TOP_SERIES_CHIPS.map((chip) => filterTag(FILTERS.TOP, chip.id, chip.title)),
            },
            {
                id: FILTERS.GENRE,
                title: "Genres",
                tags: GENRE_OPTIONS.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.value)),
            },
            {
                id: FILTERS.GENRE_MODE,
                title: "Genre matching",
                tags: GENRE_MATCH_OPTIONS.map((option) =>
                    filterTag(FILTERS.GENRE_MODE, option.id, option.title),
                ),
            },
            {
                id: FILTERS.TYPE,
                title: "Type",
                tags: TYPE_OPTIONS.map((option) => filterTag(FILTERS.TYPE, option.id, option.value)),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.value)),
            },
            {
                id: FILTERS.AGE,
                title: "Age rating",
                tags: AGE_RATING_OPTIONS.map((option) => filterTag(FILTERS.AGE, option.id, option.value)),
            },
            {
                id: FILTERS.RATING,
                title: "Minimum rating",
                tags: MIN_RATING_OPTIONS.map((option) => filterTag(FILTERS.RATING, option.id, option.value)),
            },
            {
                id: FILTERS.YEAR,
                title: "Release year",
                tags: YEAR_OPTIONS.map((option) => filterTag(FILTERS.YEAR, option.id, option.value)),
            },
        ];
    }

    /** The chapter bounds and the free tag are typed in rather than picked. */
    override async getSearchFieldList(): Promise<SearchField[]> {
        return [
            { id: CHAPTERS_FROM_FIELD, name: "Fewest chapters", placeholder: "No minimum" },
            { id: CHAPTERS_TO_FIELD, name: "Most chapters", placeholder: "No maximum" },
            { id: TAG_FIELD, name: "Tag", placeholder: "Any tag" },
        ];
    }

    /** The catalogue takes an exclusion list for genres and types. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const title = (query.title ?? "").trim();
        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);

        // A chosen chart replaces the catalogue query; it is the site's own
        // ranking for a country and takes no other filter.
        const country = included.get(FILTERS.TOP)?.[0] as TopSeriesCountry | undefined;
        if (country !== undefined) {
            const items = parseHomeTopSeries(
                await fetchPagePayload(`${getDomain()}/`, '{"korea":['),
                country,
            );
            const results = items.map(toSearchResultItem).filter((item) => item.imageUrl.length > 0);
            if (results.length > 0) {
                return { items: results };
            }
        }

        const { items, nextMetadata } = await this.catalogPage(
            {
                q: title.length > 0 ? title : undefined,
                genre: resolveOptionValues(GENRE_OPTIONS, included.get(FILTERS.GENRE)),
                excludeGenre: resolveOptionValues(GENRE_OPTIONS, excluded.get(FILTERS.GENRE)),
                genreStrict: included.get(FILTERS.GENRE_MODE)?.[0] === "and" ? "true" : undefined,
                type: resolveOptionValues(TYPE_OPTIONS, included.get(FILTERS.TYPE)),
                // Novels are not carried here, so they are excluded on every
                // query rather than only when the reader asks.
                excludeType: [
                    NOVEL_TYPE,
                    ...(resolveOptionValues(TYPE_OPTIONS, excluded.get(FILTERS.TYPE)) ?? []),
                ],
                status: included.get(FILTERS.STATUS),
                ageRating: resolveOptionValues(AGE_RATING_OPTIONS, included.get(FILTERS.AGE)),
                minRating: included.get(FILTERS.RATING)?.[0],
                year: included.get(FILTERS.YEAR),
                chaptersFrom: numberField(query, CHAPTERS_FROM_FIELD),
                chaptersTo: numberField(query, CHAPTERS_TO_FIELD),
                tag: textField(query, TAG_FIELD),
                sort: included.get(FILTERS.SORT)?.[0] ?? "real_views",
                order: "desc",
            },
            metadata as PageMetadata | undefined,
        );

        return {
            items: items.map(toSearchResultItem).filter((item) => item.imageUrl.length > 0),
            metadata: nextMetadata,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await this.getSeriesPage(mangaId), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(await this.getSeriesPage(sourceManga.mangaId), sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const url = `${getDomain()}/manga/${chapter.sourceManga.mangaId}/chapter/${chapter.chapterId}`;

        try {
            return parseChapterDetails(await fetchFlightPayload(url), chapter);
        } catch (error: unknown) {
            if (error instanceof CloudflareError) {
                throw error;
            }
        }

        // The data route sometimes answers without the reader's own record;
        // the rendered page always carries it.
        return parseChapterDetails(await fetchHtmlPage(url), chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private async catalogPage(
        query: CatalogQuery,
        metadata: PageMetadata | undefined,
    ): Promise<{ items: CatalogItem[]; nextMetadata: PageMetadata | undefined }> {
        const page = metadata?.page ?? 1;
        const response = await fetchCatalog({ ...query, page: String(page) });
        const items = parseCatalogItems(response.items);

        const nextPage = response.nextPage ?? page + 1;

        return {
            items,
            // A cursor that does not move would leave the app paging forever.
            nextMetadata: response.hasMore && items.length > 0 && nextPage > page ? { page: nextPage } : undefined,
        };
    }

    private getHomePage(refresh = false): Promise<string> {
        const domain = getDomain();

        if (!refresh && this.homePage?.domain === domain) {
            return this.homePage.promise;
        }

        const entry = { domain, promise: fetchPagePayload(`${domain}/`, '"updates":[') };
        entry.promise.catch(() => {
            if (this.homePage === entry) {
                this.homePage = undefined;
            }
        });
        this.homePage = entry;

        return entry.promise;
    }

    private getSeriesPage(slug: string): Promise<string> {
        const key = `${getDomain()}/manga/${slug}`;

        if (this.seriesPage?.key === key) {
            return this.seriesPage.promise;
        }

        const entry = {
            key,
            promise: fetchPagePayload(key, '{"initialTab"', buildSeriesNavigationHeaders(slug)),
        };
        entry.promise.catch(() => {
            if (this.seriesPage === entry) {
                this.seriesPage = undefined;
            }
        });
        this.seriesPage = entry;

        return entry.promise;
    }
}

/** Home page shelves the site renders as markup rather than data. */
const LINK_SHELVES: Record<string, { heading: string; container: string; prominent: boolean } | undefined> = {
    [SECTIONS.NEW_SEASON]: { heading: HOME_HEADINGS.NEW_SEASON, container: '"hl-col-items"', prominent: false },
    [SECTIONS.TREND]: { heading: HOME_HEADINGS.TREND, container: '"hl-col-items"', prominent: false },
    [SECTIONS.POPULAR_TODAY]: {
        heading: HOME_HEADINGS.POPULAR_TODAY,
        container: '"hl-col-items"',
        prominent: true,
    },
    [SECTIONS.BEST_ONGOING]: {
        heading: HOME_HEADINGS.BEST_ONGOING,
        container: '"grid gap-2',
        prominent: true,
    },
};

/** What a shelf asks the catalogue for when the home page has nothing. */
const CATALOG_FALLBACKS: Record<string, CatalogQuery | undefined> = {
    [SECTIONS.BEST_ONGOING]: { sort: "rating", order: "desc", status: "Ongoing" },
    [SECTIONS.POPULAR_TODAY]: { sort: "votes", order: "desc" },
    [SECTIONS.NEW_SEASON]: { sort: "by_date", order: "desc" },
    [SECTIONS.TREND]: { sort: "by_views", order: "desc" },
    [SECTIONS.MOST_LIKED]: { sort: "votes", order: "desc" },
};

/** Reads a typed-in number, ignoring anything that is not one. */
function numberField(query: SearchQuery, field: string): string | undefined {
    const value = query.parameters[field];
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? trimmed : undefined;
}

function textField(query: SearchQuery, field: string): string | undefined {
    const value = query.parameters[field];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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
