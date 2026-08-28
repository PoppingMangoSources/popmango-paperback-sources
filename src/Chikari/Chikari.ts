/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    CloudflareError,
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
    type Tag,
    type TagSection,
} from "../../common";

import {
    CONTENT_RATING_OPTIONS,
    CONTENT_TYPE_OPTIONS,
    DEFAULT_CONTENT_RATINGS,
    DEFAULT_CONTENT_TYPES,
    DOMAIN,
    FILTERS,
    MIN_CHAPTERS_FIELD,
    PAGE_SIZE,
    PERIOD_OPTIONS,
    SECTIONS,
    SECTION_DEFINITIONS,
    SECTION_IDS,
    SECTION_OPTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATE_KEYS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    YEAR_FIELD,
    filterTag,
    splitFilterTag,
    type ChikariPreferences,
    type ContentPreferenceRating,
    type HomeResponse,
    type PageMetadata,
    type Period,
    type SectionId,
    type SeriesStatus,
    type SeriesType,
    type SortId,
} from "./models";
import {
    ChikariInterceptor,
    fetchChapterDetails,
    fetchChapters,
    fetchGenres,
    fetchHome,
    fetchSeries,
    fetchSeriesDetails,
    fetchTags,
    mangaUrl,
} from "./network";
import {
    detailsToSearchResultItem,
    findHomeRow,
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    toFeaturedItem,
    toGenreOptions,
    toRecentlyUpdatedItem,
    toSearchResultItem,
    toTagOptions,
} from "./parsers";

export const ChikariInfo = sourceInfo({
    name: "Chikari",
    description: "Extension that pulls comics from chikari.moe.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class Chikari extends PopmangoSource {
    /** The home page, which both sections read from. */
    private home?: Promise<HomeResponse>;

    /** The genre and tag lists, and the setting they were fetched for. */
    private genres?: { adult: boolean; promise: Promise<Tag[]> };
    private tags?: { adult: boolean; promise: Promise<Tag[]> };

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 3, bufferInterval: 1, ignoreImages: true },
            interceptor: new ChikariInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return mangaUrl(mangaId);
    }

    override async getSettingsSections(): Promise<MenuSection[]> {
        // The genre and tag lists are the site's own, so the settings screen
        // waits for them rather than offering lists that do not match.
        const [genres, tags] = await Promise.all([
            this.getGenreOptions().catch(() => [] as Tag[]),
            this.getTagOptions().catch(() => [] as Tag[]),
        ]);

        const sections: MenuSection[] = [
            {
                id: "content",
                header: "What to show",
                footer:
                    "Titles outside these ratings and types are left out everywhere. Choosing " +
                    "Erotica or Pornographic also unlocks the site's adult catalogue.",
                rows: [
                    selectRow("content_ratings", {
                        label: "Content ratings",
                        options: CONTENT_RATING_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.contentRatings,
                        set: (value) => this.settings.set(STATE_KEYS.CONTENT_RATINGS, value),
                    }),
                    selectRow("content_types", {
                        label: "Types",
                        options: CONTENT_TYPE_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.types,
                        set: (value) => this.settings.set(STATE_KEYS.CONTENT_TYPES, value),
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

        const hidden: MenuSection = {
            id: "hidden",
            header: "Never show",
            footer: "A title carrying any of these is left out of every list.",
            rows: [],
        };

        if (genres.length > 0) {
            hidden.rows.push(
                selectRow("excluded_genres", {
                    label: "Excluded genres",
                    options: genres.map((genre) => ({ id: genre.id, title: genre.title })),
                    multiple: true,
                    get: () => this.settings.stringArray(STATE_KEYS.EXCLUDED_GENRES),
                    set: (value) => this.settings.set(STATE_KEYS.EXCLUDED_GENRES, value),
                }),
            );
        }

        if (tags.length > 0) {
            hidden.rows.push(
                selectRow("excluded_tags", {
                    label: "Excluded tags",
                    options: tags.map((tag) => ({ id: tag.id, title: tag.title })),
                    multiple: true,
                    get: () => this.settings.stringArray(STATE_KEYS.EXCLUDED_TAGS),
                    set: (value) => this.settings.set(STATE_KEYS.EXCLUDED_TAGS, value),
                }),
            );
        }

        if (hidden.rows.length > 0) {
            sections.push(hidden);
        }

        return sections;
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const chosen = this.visibleSections;
        const wanted = chosen.length > 0 ? new Set(chosen) : undefined;

        return SECTION_IDS.filter((id) => wanted === undefined || wanted.has(id)).map(
            (id) => SECTION_DEFINITIONS[id],
        );
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        switch (section.id as SectionId) {
            case SECTIONS.FEATURED:
                return { items: findHomeRow(await this.getHome(), "popular").map(toFeaturedItem) };

            case SECTIONS.RECENTLY_UPDATED:
                return {
                    items: findHomeRow(await this.getHome(), "recently-updated").flatMap((series) => {
                        const item = toRecentlyUpdatedItem(series);
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
        const [genres, tags] = await Promise.all([
            this.getGenreOptions().catch(() => [] as Tag[]),
            this.getTagOptions().catch(() => [] as Tag[]),
        ]);

        const sections: TagSection[] = [
            {
                id: FILTERS.SORT,
                title: "Sort by",
                tags: SORT_OPTIONS.map((option) => filterTag(FILTERS.SORT, option.id, option.title)),
            },
            {
                id: FILTERS.PERIOD,
                title: "Trending window",
                tags: PERIOD_OPTIONS.map((option) => filterTag(FILTERS.PERIOD, option.id, option.title)),
            },
        ];

        if (genres.length > 0) {
            sections.push({
                id: FILTERS.GENRE,
                title: "Genres",
                tags: genres.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.title)),
            });
        }

        if (tags.length > 0) {
            sections.push({
                id: FILTERS.TAG,
                title: "Tags",
                tags: tags.map((tag) => filterTag(FILTERS.TAG, tag.id, tag.title)),
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
        );

        return sections;
    }

    /** The chapter count and the year are numbers, so they get boxes. */
    override async getSearchFieldList(): Promise<SearchField[]> {
        return [
            { id: MIN_CHAPTERS_FIELD, name: "Fewest chapters", placeholder: "No minimum" },
            { id: YEAR_FIELD, name: "Release year", placeholder: "Any year" },
        ];
    }

    /** The catalogue takes an exclusion list for genres and tags. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const preferences = this.preferences;
        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);

        const includedGenres = included.get(FILTERS.GENRE) ?? [];
        const includedTags = included.get(FILTERS.TAG) ?? [];

        // A genre the reader has hidden site-wide is still shown when they ask
        // for it here; the search screen is the more specific instruction.
        const excludedGenres = [
            ...new Set([
                ...preferences.excludedGenres.filter((genre) => !includedGenres.includes(genre)),
                ...(excluded.get(FILTERS.GENRE) ?? []),
            ]),
        ];
        const excludedTags = [
            ...new Set([
                ...preferences.excludedTags.filter((tag) => !includedTags.includes(tag)),
                ...(excluded.get(FILTERS.TAG) ?? []),
            ]),
        ];

        const chosenTypes = (included.get(FILTERS.TYPE) ?? []) as SeriesType[];
        const offset = (metadata as PageMetadata | undefined)?.offset ?? 0;
        const minChapters = Number(query.parameters[MIN_CHAPTERS_FIELD]);
        const year = textField(query, YEAR_FIELD);

        const response = await fetchSeries({
            adult: preferences.adult,
            contentRatings: preferences.contentRatings,
            excludedGenres,
            excludedTags,
            genres: includedGenres,
            limit: PAGE_SIZE,
            minChapters: isFinite(minChapters) && minChapters > 0 ? minChapters : undefined,
            offset,
            period: included.get(FILTERS.PERIOD)?.[0] as Period | undefined,
            query: (query.title ?? "").trim() || undefined,
            sort: (included.get(FILTERS.SORT)?.[0] as SortId | undefined) ?? "popular",
            statuses: (included.get(FILTERS.STATUS) ?? []) as SeriesStatus[],
            tags: includedTags,
            types: chosenTypes.length > 0 ? chosenTypes : preferences.types,
            years: year !== undefined ? [year] : [],
        });

        const nextOffset = offset + response.items.length;

        return {
            items: response.items.map(toSearchResultItem),
            metadata:
                response.items.length > 0 && nextOffset < response.total
                    ? ({ offset: nextOffset } satisfies PageMetadata)
                    : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchSeriesDetails(mangaId));
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const response = await fetchChapters(sourceManga.mangaId);
        return parseChapters(response.items, sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const response = await fetchChapterDetails(chapter.sourceManga.mangaId, chapter.chapterId);
        return parseChapterDetails(response, chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    /** What the reader has chosen to see, with the site's defaults behind it. */
    private get preferences(): ChikariPreferences {
        const contentRatings = choices<ContentPreferenceRating>(
            this.settings.stringArray(STATE_KEYS.CONTENT_RATINGS),
            CONTENT_RATING_OPTIONS.map((option) => option.id),
            DEFAULT_CONTENT_RATINGS,
        );

        return {
            // The site gates its adult catalogue behind one flag; asking for
            // either explicit rating is what turns it on.
            adult: contentRatings.some((rating) => rating === "erotica" || rating === "pornographic"),
            contentRatings,
            excludedGenres: this.settings.stringArray(STATE_KEYS.EXCLUDED_GENRES),
            excludedTags: this.settings.stringArray(STATE_KEYS.EXCLUDED_TAGS),
            types: choices<SeriesType>(
                this.settings.stringArray(STATE_KEYS.CONTENT_TYPES),
                CONTENT_TYPE_OPTIONS.map((option) => option.id),
                DEFAULT_CONTENT_TYPES,
            ),
        };
    }

    private get visibleSections(): string[] {
        return this.settings.stringArray(STATE_KEYS.VISIBLE_SECTIONS, new Set<string>(SECTION_IDS));
    }

    private getHome(): Promise<HomeResponse> {
        // Held only for the length of one home page build, so a refresh shows
        // what the site has now rather than what it had at launch.
        this.home ??= fetchHome(this.preferences).finally(() => {
            this.home = undefined;
        });
        return this.home;
    }

    private getGenreOptions(): Promise<Tag[]> {
        const adult = this.preferences.adult;

        // The adult catalogue has genres of its own, so the list belongs to
        // the setting it was fetched under.
        if (this.genres?.adult !== adult) {
            this.genres = undefined;
        }

        if (this.genres === undefined) {
            const entry = { adult, promise: fetchGenres(adult).then(toGenreOptions) };
            entry.promise.catch(() => {
                if (this.genres === entry) {
                    this.genres = undefined;
                }
            });
            this.genres = entry;
        }

        return this.genres.promise;
    }

    private getTagOptions(): Promise<Tag[]> {
        const adult = this.preferences.adult;

        if (this.tags?.adult !== adult) {
            this.tags = undefined;
        }

        if (this.tags === undefined) {
            const entry = { adult, promise: fetchTags(adult).then(toTagOptions) };
            entry.promise.catch(() => {
                if (this.tags === entry) {
                    this.tags = undefined;
                }
            });
            this.tags = entry;
        }

        return this.tags.promise;
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        // A novel link is left alone; this extension has nothing to open it with.
        const match = /^https?:\/\/(?:www\.)?chikari\.moe\/series\/([^/?#]+)/i.exec((title ?? "").trim());
        if (match?.[1] === undefined) {
            return undefined;
        }

        let slug: string;
        try {
            slug = decodeURIComponent(match[1]);
        } catch {
            return undefined;
        }

        try {
            return { items: [detailsToSearchResultItem(await fetchSeriesDetails(slug))] };
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

/** Keeps only the stored values still recognised, falling back to a default. */
function choices<T extends string>(stored: string[], allowed: readonly string[], fallback: T[]): T[] {
    const kept = stored.filter((value): value is T => allowed.includes(value));
    return kept.length > 0 ? kept : fallback;
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
