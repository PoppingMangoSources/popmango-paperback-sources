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
    type SearchField,
    type SearchQuery,
    type SearchResultItem,
    type SourceManga,
    type TagSection,
} from "../../common";

import {
    CHAPTER_COUNT_OPTIONS,
    CONTENT_RATING_OPTIONS,
    CONTENT_TYPE_OPTIONS,
    DEFAULT_CONTENT_RATINGS,
    DEFAULT_CONTENT_TYPES,
    DEFAULT_LANGUAGES,
    DISCOVER_SECTIONS,
    DOMAIN,
    FILTERS,
    FORMAT_OPTIONS,
    LANGUAGE_OPTIONS,
    MAX_LATEST_REQUESTS,
    MODE_OPTIONS,
    MOST_VIEWS_OPTIONS,
    PAGE_SIZE,
    SECTIONS,
    SECTION_IDS,
    SECTION_OPTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATE_KEYS,
    STATUS_OPTIONS,
    YEAR_FIELD,
    filterTag,
    splitFilterTag,
    type BrowseSelect,
    type ComicNode,
    type ContentPreferenceRating,
    type FilterOptions,
    type GenreMode,
    type PageMetadata,
    type SectionId,
    type SeriesType,
    type XComicPreferences,
} from "./models";
import {
    XComicInterceptor,
    fetchBrowse,
    fetchChapterPages,
    fetchChapters,
    fetchComic,
    fetchLatestUploads,
    fetchRecentlyAdded,
    fetchSearchPage,
} from "./network";
import {
    isComicAllowed,
    parseChapterDetails,
    parseFilterOptions,
    toChapter,
    toDiscoverItems,
    toLatestUploadNodes,
    toSearchResultItem,
    toSourceManga,
} from "./parsers";

export const XCOMICInfo = sourceInfo({
    name: "XCOMIC",
    description: "Extension that pulls content from xcomic.me.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class XCOMIC extends PopmangoSource {
    /** The site's filter lists, which the search page publishes. */
    private filterOptions?: Promise<FilterOptions>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 3, bufferInterval: 1, ignoreImages: true },
            interceptor: new XComicInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/comic/${mangaId}`;
    }

    override async getSettingsSections(): Promise<MenuSection[]> {
        // The genre list is the site's own, so the settings screen waits for it
        // rather than offering a list that does not match the catalogue.
        const options = await this.getFilterOptions().catch(() => undefined);

        const sections: MenuSection[] = [
            {
                id: "content",
                header: "What to show",
                footer: "Titles outside these ratings and formats are left out everywhere.",
                rows: [
                    selectRow("content_ratings", {
                        label: "Content ratings",
                        options: CONTENT_RATING_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.contentRatings,
                        set: (value) => this.settings.set(STATE_KEYS.CONTENT_RATINGS, value),
                    }),
                    selectRow("content_types", {
                        label: "Formats",
                        options: CONTENT_TYPE_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.types,
                        set: (value) => this.settings.set(STATE_KEYS.CONTENT_TYPES, value),
                    }),
                    selectRow("languages", {
                        label: "Languages",
                        options: LANGUAGE_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.languages,
                        set: (value) => this.settings.set(STATE_KEYS.LANGUAGES, value),
                    }),
                ],
            },
            {
                id: "sections",
                header: "Home page",
                footer: "Choose which sections appear. Leave everything unticked to show them all.",
                rows: [
                    selectRow("visible_sections", {
                        label: "Sections shown",
                        options: SECTION_OPTIONS,
                        multiple: true,
                        get: () => this.visibleSections,
                        set: (value) => this.settings.set(STATE_KEYS.VISIBLE_SECTIONS, value),
                    }),
                ],
            },
        ];

        const excluded: MenuSection = {
            id: "excluded",
            header: "Never show",
            footer: "A title carrying any of these is left out of every list.",
            rows: [
                selectRow("excluded_formats", {
                    label: "Excluded formats",
                    options: FORMAT_OPTIONS,
                    multiple: true,
                    get: () => this.preferences.excludedFormats,
                    set: (value) => this.settings.set(STATE_KEYS.EXCLUDED_FORMATS, value),
                }),
            ],
        };

        if (options !== undefined && options.genres.length > 0) {
            excluded.rows.unshift(
                selectRow("excluded_genres", {
                    label: "Excluded genres",
                    options: options.genres.map((genre) => ({ id: genre.id, title: genre.title })),
                    multiple: true,
                    get: () => this.preferences.excludedGenres,
                    set: (value) => this.settings.set(STATE_KEYS.EXCLUDED_GENRES, value),
                }),
            );
        }

        sections.push(excluded);
        return sections;
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const visible = this.visibleSections;
        const wanted = visible.length > 0 ? new Set(visible) : undefined;

        return SECTION_IDS.filter((id) => wanted === undefined || wanted.has(id)).map(
            (id) => DISCOVER_SECTIONS[id],
        );
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = metadata as PageMetadata | undefined;

        switch (section.id as SectionId) {
            case SECTIONS.TOP_RATED: {
                const current = page?.page ?? 1;
                const result = await this.browse(current, "field_score", "", new Map(), new Map(), undefined);
                return {
                    items: toDiscoverItems(result.nodes, "featuredCarouselItem"),
                    metadata: result.nextPage !== undefined ? { page: result.nextPage } : undefined,
                };
            }

            case SECTIONS.LATEST_UPLOADS: {
                const result = await this.latestUploads(page?.before);
                return {
                    items: toDiscoverItems(result.nodes, "chapterUpdatesCarouselItem"),
                    metadata: result.before !== undefined ? { before: result.before } : undefined,
                };
            }

            case SECTIONS.RECENTLY_ADDED: {
                const preferences = this.preferences;
                const nodes = (await fetchRecentlyAdded()).get_comic_recentlyAdded?.items ?? [];
                return {
                    items: toDiscoverItems(
                        nodes.filter((node) => isComicAllowed(node.data, preferences, true)),
                        "simpleCarouselItem",
                    ),
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
        const options = await this.getFilterOptions().catch(() => undefined);

        const sections: TagSection[] = [
            {
                id: FILTERS.SORT,
                title: "Sort by",
                tags: SORT_OPTIONS.map((option) => filterTag(FILTERS.SORT, option.id, option.title)),
            },
            {
                id: FILTERS.VIEWS,
                title: "View charts",
                tags: MOST_VIEWS_OPTIONS.map((option) => filterTag(FILTERS.VIEWS, option.id, option.title)),
            },
        ];

        if (options !== undefined && options.genres.length > 0) {
            sections.push({
                id: FILTERS.GENRE,
                title: "Genres",
                tags: options.genres.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.title)),
            });
        }

        sections.push({
            id: FILTERS.FORMAT,
            title: "Formats",
            tags: FORMAT_OPTIONS.map((option) => filterTag(FILTERS.FORMAT, option.id, option.title)),
        });

        if (options !== undefined && options.demographics.length > 0) {
            sections.push({
                id: FILTERS.DEMOGRAPHIC,
                title: "Demographics",
                tags: options.demographics.map((entry) =>
                    filterTag(FILTERS.DEMOGRAPHIC, entry.id, entry.title),
                ),
            });
        }

        sections.push(
            {
                id: FILTERS.INC_MODE,
                title: "Included genre matching",
                tags: MODE_OPTIONS.map((option) => filterTag(FILTERS.INC_MODE, option.id, option.title)),
            },
            {
                id: FILTERS.EXC_MODE,
                title: "Excluded genre matching",
                tags: MODE_OPTIONS.map((option) => filterTag(FILTERS.EXC_MODE, option.id, option.title)),
            },
            {
                id: FILTERS.ORIG_STATUS,
                title: "Original status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.ORIG_STATUS, option.id, option.title)),
            },
            {
                id: FILTERS.SITE_STATUS,
                title: "Upload status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.SITE_STATUS, option.id, option.title)),
            },
            {
                id: FILTERS.CHAPTERS,
                title: "Chapter count",
                tags: CHAPTER_COUNT_OPTIONS.map((option) =>
                    filterTag(FILTERS.CHAPTERS, option.id, option.title),
                ),
            },
            {
                id: FILTERS.TLANG,
                title: "Translated language",
                tags: LANGUAGE_OPTIONS.map((option) => filterTag(FILTERS.TLANG, option.id, option.title)),
            },
            {
                id: FILTERS.OLANG,
                title: "Original language",
                tags: LANGUAGE_OPTIONS.map((option) => filterTag(FILTERS.OLANG, option.id, option.title)),
            },
        );

        return sections;
    }

    /** The release year is a number, so it gets a box rather than a tag. */
    override async getSearchFieldList(): Promise<SearchField[]> {
        return [{ id: YEAR_FIELD, name: "Release year", placeholder: "e.g. 2019 or 2015-2019" }];
    }

    /** The browse query takes an explicit exclusion list of its own. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const title = (query.title ?? "").trim();
        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);

        const pasted = await this.resolvePastedUrl(title, excluded);
        if (pasted !== undefined) {
            return pasted;
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        // A chosen view chart is a sort order rather than a separate listing,
        // so it simply replaces the sort.
        const sortBy = included.get(FILTERS.VIEWS)?.[0] ?? included.get(FILTERS.SORT)?.[0] ?? "field_score";

        const result = await this.browse(page, sortBy, title, included, excluded, yearField(query));

        return {
            items: result.nodes.map(toSearchResultItem),
            metadata: result.nextPage !== undefined ? ({ page: result.nextPage } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        const response = await fetchComic(mangaId);
        if (response.get_comicNode === null || response.get_comicNode === undefined) {
            throw new Error(`No series was found for ${mangaId}.`);
        }
        return toSourceManga(response.get_comicNode);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const first = await fetchChapters(sourceManga.mangaId, 1);
        const firstResult = first.get_comic_chapterList_uniqList;
        if (firstResult === null || firstResult === undefined) {
            return [];
        }

        const pageCount = firstResult.paging?.pages ?? 1;
        const rest = await Promise.all(
            Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
                fetchChapters(sourceManga.mangaId, index + 2),
            ),
        );

        return [first, ...rest].flatMap((response) =>
            (response.get_comic_chapterList_uniqList?.items ?? [])
                // Anything else is a draft or a removal the site still lists.
                .filter((item) => item.data.dbStatus === "normal")
                .map((item) => toChapter(item.data, sourceManga)),
        );
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const id = chapter.chapterId.split("/").pop()?.split("-")[0];
        if (id === undefined || id.length === 0) {
            throw new Error(`Cannot work out a chapter id from ${chapter.chapterId}.`);
        }
        return parseChapterDetails(await fetchChapterPages(id), chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    /** What the reader has chosen to see, with the site's defaults behind it. */
    private get preferences(): XComicPreferences {
        return {
            contentRatings: choices<ContentPreferenceRating>(
                this.settings.stringArray(STATE_KEYS.CONTENT_RATINGS),
                CONTENT_RATING_OPTIONS.map((option) => option.id),
                DEFAULT_CONTENT_RATINGS,
            ),
            types: choices<SeriesType>(
                this.settings.stringArray(STATE_KEYS.CONTENT_TYPES),
                CONTENT_TYPE_OPTIONS.map((option) => option.id),
                DEFAULT_CONTENT_TYPES,
            ),
            languages: (() => {
                const chosen = this.settings.stringArray(STATE_KEYS.LANGUAGES);
                return chosen.length > 0 ? chosen : DEFAULT_LANGUAGES;
            })(),
            excludedGenres: this.settings.stringArray(STATE_KEYS.EXCLUDED_GENRES),
            excludedFormats: this.settings.stringArray(STATE_KEYS.EXCLUDED_FORMATS),
        };
    }

    private get visibleSections(): string[] {
        return this.settings.stringArray(STATE_KEYS.VISIBLE_SECTIONS, new Set<string>(SECTION_IDS));
    }

    private getFilterOptions(): Promise<FilterOptions> {
        this.filterOptions ??= fetchSearchPage()
            .then(parseFilterOptions)
            .catch((error: unknown) => {
                this.filterOptions = undefined;
                throw error;
            });
        return this.filterOptions;
    }

    /**
     * The reader's settings, plus anything the search screen adds on top.
     *
     * A filter chosen for one search narrows that search only; it never
     * loosens what the settings screen has ruled out.
     */
    private effectivePreferences(excluded: Map<string, string[]>): XComicPreferences {
        const preferences = this.preferences;

        return {
            ...preferences,
            excludedGenres: [...preferences.excludedGenres, ...(excluded.get(FILTERS.GENRE) ?? [])],
            excludedFormats: [...preferences.excludedFormats, ...(excluded.get(FILTERS.FORMAT) ?? [])],
        };
    }

    private async browse(
        page: number,
        sortBy: string,
        word: string,
        included: Map<string, string[]>,
        excluded: Map<string, string[]>,
        year: string | undefined,
    ): Promise<{ nodes: ComicNode[]; nextPage?: number }> {
        const preferences = this.effectivePreferences(excluded);
        const select = buildBrowseSelect(page, sortBy, word, included, preferences, year);

        const nodes = (await fetchBrowse(select)).get_comic_browse_items ?? [];

        return {
            nodes: nodes.filter((node) => isComicAllowed(node.data, preferences)),
            // The query has no total, so a full page is taken to mean another.
            nextPage: nodes.length === PAGE_SIZE ? page + 1 : undefined,
        };
    }

    /**
     * Walks the upload feed until a page survives filtering.
     *
     * The feed carries every language and format at once and cannot be
     * narrowed by the site, so a page can filter down to nothing.
     */
    private async latestUploads(before?: number): Promise<{ nodes: ComicNode[]; before?: number }> {
        const preferences = this.preferences;
        const nodes: ComicNode[] = [];
        const seen = new Set<string>();
        let cursor = before;

        for (let attempt = 0; attempt < MAX_LATEST_REQUESTS && nodes.length === 0; attempt += 1) {
            const result = (await fetchLatestUploads(cursor)).get_comic_latestUploads;

            for (const node of toLatestUploadNodes(result)) {
                if (seen.has(node.data.id) || !isComicAllowed(node.data, preferences, true)) {
                    continue;
                }
                seen.add(node.data.id);
                nodes.push(node);
            }

            cursor =
                typeof result?.before === "number" && isFinite(result.before) ? result.before : undefined;
            if (cursor === undefined) {
                break;
            }
        }

        // Offering a cursor after an empty walk makes the app page forever, ten
        // requests at a time.
        return { nodes, before: nodes.length > 0 ? cursor : undefined };
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(
        title: string,
        excluded: Map<string, string[]>,
    ): Promise<PagedResults<SearchResultItem> | undefined> {
        const id = /^https?:\/\/(?:www\.)?xcomic\.(?:me|net)\/comic\/([a-zA-Z0-9]+)/i.exec(title)?.[1];
        if (id === undefined) {
            return undefined;
        }

        const response = await fetchComic(id);
        if (response.get_comicNode === null || response.get_comicNode === undefined) {
            return undefined;
        }

        // A link to something the reader has ruled out returns nothing rather
        // than quietly ignoring their settings.
        if (!isComicAllowed(response.get_comicNode.data, this.effectivePreferences(excluded))) {
            return { items: [] };
        }

        return { items: [toSearchResultItem(response.get_comicNode)] };
    }
}

function buildBrowseSelect(
    page: number,
    sortBy: string,
    word: string,
    included: Map<string, string[]>,
    preferences: XComicPreferences,
    year: string | undefined,
): BrowseSelect {
    const includedTagIds = [...(included.get(FILTERS.GENRE) ?? []), ...(included.get(FILTERS.FORMAT) ?? [])];
    const excludedTagIds = [...preferences.excludedGenres, ...preferences.excludedFormats];

    const { min, max } = yearRange(year);
    const translated = included.get(FILTERS.TLANG);

    return {
        where: "browse",
        page,
        size: PAGE_SIZE,
        init: (page - 1) * PAGE_SIZE,
        sortby: sortBy,
        word,
        incOLangs: included.get(FILTERS.OLANG) ?? [],
        incTLangs: translated !== undefined && translated.length > 0 ? translated : preferences.languages,
        incGenres: [...new Set(includedTagIds)],
        excGenres: [...new Set(excludedTagIds)],
        incGenresMode: (included.get(FILTERS.INC_MODE)?.[0] as GenreMode | undefined) ?? "and",
        excGenresMode: (included.get(FILTERS.EXC_MODE)?.[0] as GenreMode | undefined) ?? "or",
        incTypes: preferences.types,
        incDemographics: included.get(FILTERS.DEMOGRAPHIC) ?? [],
        incContentRatings: preferences.contentRatings,
        releaseYearMin: min,
        releaseYearMax: max,
        origStatus: included.get(FILTERS.ORIG_STATUS)?.[0] ?? null,
        siteStatus: included.get(FILTERS.SITE_STATUS)?.[0] ?? null,
        chapCount: included.get(FILTERS.CHAPTERS)?.[0] ?? "",
        ignoreGlobalULangs: true,
        ignoreGlobalGenres: true,
        ignoreGlobalBlocks: true,
    };
}

/** Reads a year or a span of years, in either order. */
function yearRange(year: string | undefined): { min: number | null; max: number | null } {
    const value = (year ?? "").trim();
    if (value.length === 0) {
        return { min: null, max: null };
    }

    if (value.includes("-")) {
        const [from, to] = value.split("-").map((part) => Number(part) || null);
        // The site labels its own ranges newest-first ("2009-2005").
        if (from !== null && from !== undefined && to !== null && to !== undefined) {
            return { min: Math.min(from, to), max: Math.max(from, to) };
        }
        const single = from ?? to ?? null;
        return { min: single, max: single };
    }

    const single = Number(value) || null;
    return { min: single, max: single };
}

function yearField(query: SearchQuery): string | undefined {
    const value = query.parameters[YEAR_FIELD];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Keeps only the stored values still recognised, falling back to a default. */
function choices<T extends string>(stored: string[], allowed: readonly string[], fallback: T[]): T[] {
    const kept = stored.filter((value): value is T => allowed.includes(value));
    return kept.length > 0 ? kept : fallback;
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
