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
    ADULT_OPTIONS,
    DOMAIN,
    FIELDS,
    FILTERS,
    GENRES_MAX_AGE_MS,
    ORDER_OPTIONS,
    ORIGIN_OPTIONS,
    RANGED_SECTIONS,
    SECTIONS,
    SECTION_DEFINITIONS,
    SECTION_IDS,
    SECTION_OPTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATE_KEYS,
    STATUS_OPTIONS,
    TAG_GROUPS,
    TIME_RANGE_OPTIONS,
    filterTag,
    splitFilterTag,
    tagGroupOf,
    type AdultChoice,
    type PageMetadata,
    type SearchResponse,
    type SectionId,
    type TimeRange,
} from "./models";
import {
    MangaDotInterceptor,
    fetchChapterImages,
    fetchChapterList,
    fetchGenres,
    fetchManga,
    fetchPeople,
    fetchRankedSection,
    fetchSearch,
    fetchSectionList,
} from "./network";
import {
    fromTagId,
    listOf,
    parseChapterPages,
    parseChapters,
    parseMangaDetails,
    toCarouselItems,
    toFeaturedItems,
    toLatestItems,
    toSearchResults,
    toTagId,
} from "./parsers";

export const MangaDotInfo = sourceInfo({
    name: "MangaDot",
    description: "Extension that pulls content from mangadot.net.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    // Suggestive titles are listed by default, and adult ones on request.
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

const ORIGIN_IDS: ReadonlySet<string> = new Set(ORIGIN_OPTIONS.map(({ id }) => id));

/** The site's origin parameter for the chosen content types; none chosen means all of them. */
const originParam = (ids: string[]): string | undefined =>
    ORIGIN_OPTIONS.filter(({ id }) => ids.includes(id))
        .map(({ value }) => value)
        .join(",") || undefined;

const nextPage = (data: SearchResponse, page: number): PageMetadata | undefined =>
    (data.pagination?.total_pages ?? 0) > page ? { page: page + 1 } : undefined;

export class MangaDot extends PopmangoSource {
    private genresPromise?: Promise<string[]>;

    /** Chapters the site serves from its uploads rather than its chapter store, by id. */
    private readonly trustedUploads = new Set<string>();

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 5, bufferInterval: 1, ignoreImages: true },
            interceptor: new MangaDotInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/manga/${mangaId}`;
    }

    // -----------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------

    private get searchOrigins(): string[] {
        return this.settings.stringArray(STATE_KEYS.SEARCH_ORIGINS, ORIGIN_IDS);
    }

    private get sectionOrigins(): string[] {
        return this.settings.stringArray(STATE_KEYS.SECTION_ORIGINS, ORIGIN_IDS);
    }

    private get hiddenTags(): string[] {
        return this.settings.stringArray(STATE_KEYS.HIDDEN_TAGS);
    }

    private get adult(): AdultChoice {
        return this.settings.choice(
            STATE_KEYS.ADULT,
            ADULT_OPTIONS.map(({ id }) => id),
            "0",
        );
    }

    private get timeRange(): TimeRange {
        return this.settings.choice(
            STATE_KEYS.TIME_RANGE,
            TIME_RANGE_OPTIONS.map(({ id }) => id),
            "all",
        );
    }

    /** The rows to show; nothing chosen means all of them. */
    private get visibleSections(): SectionId[] {
        const visible = this.settings.stringArray(STATE_KEYS.VISIBLE_SECTIONS, new Set<string>(SECTION_IDS)) as SectionId[];
        return visible.length > 0 ? visible : SECTION_IDS;
    }

    override async getSettingsSections(): Promise<MenuSection[]> {
        // The tags come from the site; when it cannot be reached, the ones
        // already hidden stay listed so they can still be shown again.
        const tagOptions: Tag[] = (await this.getGenres().catch(() => this.hiddenTags.map(fromTagId))).map(
            (name) => ({ id: toTagId(name), title: name }),
        );

        return [
            {
                id: "search",
                header: "Search",
                footer:
                    "Defaults for every search. Content types narrow it to those kinds of comics, and hidden tags " +
                    "leave out titles that carry them, unless a search asks for the tag. Choosing nothing means " +
                    "everything.",
                rows: [
                    selectRow("search_origins", {
                        label: "Content types",
                        options: [...ORIGIN_OPTIONS],
                        multiple: true,
                        get: () => this.searchOrigins,
                        set: (value) => this.settings.set(STATE_KEYS.SEARCH_ORIGINS, value),
                    }),
                    selectRow("hidden_tags", {
                        label: "Hidden tags",
                        options: tagOptions,
                        multiple: true,
                        get: () => this.hiddenTags,
                        set: (value) => this.settings.set(STATE_KEYS.HIDDEN_TAGS, value),
                    }),
                ],
            },
            {
                id: "home",
                header: "Home page",
                footer:
                    "Content types narrow the rows the same way. A time range ranks Top Rated, Most Tracked and " +
                    "Recently Added over the last day, week or month instead of all time; those lists are shorter " +
                    "and come as a single page. Leave the rows unticked to show them all.",
                rows: [
                    selectRow("section_origins", {
                        label: "Content types",
                        options: [...ORIGIN_OPTIONS],
                        multiple: true,
                        get: () => this.sectionOrigins,
                        set: (value) => this.settings.set(STATE_KEYS.SECTION_ORIGINS, value),
                    }),
                    selectRow("time_range", {
                        label: "Time range",
                        options: [...TIME_RANGE_OPTIONS],
                        get: () => [this.timeRange],
                        set: (value) => this.settings.set(STATE_KEYS.TIME_RANGE, value[0] ?? "all"),
                    }),
                    selectRow("visible_sections", {
                        label: "Rows shown",
                        options: SECTION_OPTIONS,
                        multiple: true,
                        get: () => this.visibleSections,
                        set: (value) => this.settings.set(STATE_KEYS.VISIBLE_SECTIONS, value),
                    }),
                ],
            },
            {
                id: "adult",
                header: "Adult content",
                footer: "Applies to search and the home page. A search can still choose otherwise.",
                rows: [
                    selectRow("adult", {
                        label: "Show adult results",
                        options: [...ADULT_OPTIONS],
                        get: () => [this.adult],
                        set: (value) => this.settings.set(STATE_KEYS.ADULT, value[0] ?? "0"),
                    }),
                ],
            },
        ];
    }

    // -----------------------------------------------------------------
    // Home page
    // -----------------------------------------------------------------

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const visible = new Set<string>(this.visibleSections);
        return SECTION_IDS.filter((id) => visible.has(id)).map((id) => SECTION_DEFINITIONS[id]);
    }

    async getDiscoverSectionItems(section: DiscoverSection, metadata: unknown): Promise<PagedResults<DiscoverSectionItem>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const id = section.id as SectionId;
        const filters = { origin: originParam(this.sectionOrigins), adult: this.adult };
        const type = section.type === DiscoverSectionType.prominentCarousel ? "prominentCarouselItem" : "simpleCarouselItem";

        // These two come as one list, so they have no further pages.
        if (id === SECTIONS.LATEST_UPDATES) {
            const data = await fetchSectionList(SECTIONS.LATEST_UPDATES, { ...filters, limit: 100 });
            return { items: toLatestItems(listOf(data.items, "latest updates")) };
        }
        if (RANGED_SECTIONS.has(id) && this.timeRange !== "all") {
            const data = await fetchSectionList(id, { ...filters, range: this.timeRange, limit: 100 });
            return { items: toCarouselItems(listOf(data.items, `${section.title} row`), type) };
        }

        const data =
            id === SECTIONS.MOST_VIEWED
                ? await fetchSearch({ ...filters, page, sortBy: "views", sortOrder: "desc" })
                : await fetchRankedSection(id, { ...filters, page });
        const items = listOf(data.manga_list, `${section.title} row`);
        return {
            items:
                section.type === DiscoverSectionType.featured ? toFeaturedItems(items) : toCarouselItems(items, type),
            metadata: nextPage(data, page),
        };
    }

    // -----------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------

    /**
     * Offers the site's filters as tag sections.
     *
     * 0.8 has no sort control or single-choice picker, so those are tag
     * sections too: where only one value makes sense, the first chosen wins.
     * Every tag group filters the same genres parameter.
     */
    override async getFilterSections(): Promise<TagSection[]> {
        const section = (id: string, title: string, options: readonly Tag[]): TagSection => ({
            id,
            title,
            tags: options.map((option) => filterTag(id, option.id, option.title)),
        });

        let genres: string[] = [];
        try {
            genres = await this.getGenres();
        } catch (error: unknown) {
            if (error instanceof CloudflareError) {
                throw error;
            }
            // The fixed filters still work without the site's tag list.
        }

        return [
            section(FILTERS.SORT, "Sort by", SORT_OPTIONS),
            section(FILTERS.ORDER, "Order", ORDER_OPTIONS),
            ...TAG_GROUPS.flatMap(({ id, title }) => {
                const tags = genres
                    .filter((genre) => tagGroupOf(genre) === id)
                    .map((genre) => filterTag(FILTERS.GENRE, toTagId(genre), genre));
                return tags.length > 0 ? [{ id: `${FILTERS.GENRE}-${id}`, title, tags }] : [];
            }),
            section(FILTERS.STATUS, "Status", STATUS_OPTIONS),
            section(FILTERS.ORIGIN, "Content type", ORIGIN_OPTIONS),
            section(FILTERS.ADULT, "Adult results", ADULT_OPTIONS),
        ];
    }

    /** 0.9 picks authors and artists from the site's suggestions; here they are typed. */
    override async getSearchFieldList(): Promise<SearchField[]> {
        return [
            { id: FIELDS.AUTHOR, name: "Author", placeholder: "Name, or several separated by commas" },
            { id: FIELDS.ARTIST, name: "Artist", placeholder: "Name, or several separated by commas" },
        ];
    }

    /** Tags can be ruled out as well as asked for. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const title = (query.title ?? "").trim();
        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);
        const chosen = (section: string): string[] => included.get(section) ?? [];
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        // A hidden tag is ruled out of every search that does not ask for it.
        const includedGenres = chosen(FILTERS.GENRE).map(fromTagId);
        const excludedGenres = [...new Set([...(excluded.get(FILTERS.GENRE) ?? []), ...this.hiddenTags].map(fromTagId))]
            .filter((genre) => !includedGenres.includes(genre));

        // Relevance ranks by the search term, so without one the site's default order applies.
        const requested = chosen(FILTERS.SORT)[0];
        const sort = requested === "relevance" && !title ? "latest" : (requested ?? (title ? "relevance" : "latest"));
        // A title list starts at A, as on the site; every other order starts at the top.
        const order = sort === "relevance" ? "desc" : (chosen(FILTERS.ORDER)[0] ?? (sort === "alphabetical" ? "asc" : "desc"));

        const [authors, artists] = await Promise.all([
            this.matchPeople("author", textField(query, FIELDS.AUTHOR)),
            this.matchPeople("artist", textField(query, FIELDS.ARTIST)),
        ]);
        const origins = chosen(FILTERS.ORIGIN).length > 0 ? chosen(FILTERS.ORIGIN) : this.searchOrigins;

        const data = await fetchSearch({
            search: title || undefined,
            page,
            genres: [...includedGenres, ...excludedGenres.map((genre) => `-${genre}`)].join(",") || undefined,
            origin: originParam(origins),
            status: chosen(FILTERS.STATUS).join(",") || undefined,
            author: authors.join(",") || undefined,
            artist: artists.join(",") || undefined,
            sortBy: sort,
            sortOrder: order,
            adult: chosen(FILTERS.ADULT)[0] ?? this.adult,
        });

        return {
            items: toSearchResults(listOf(data.manga_list, "search results")),
            metadata: nextPage(data, page),
        };
    }

    // -----------------------------------------------------------------
    // Series and chapters
    // -----------------------------------------------------------------

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchManga(mangaId), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const entries = listOf(await fetchChapterList(sourceManga.mangaId), "chapter list");
        for (const entry of entries) {
            if (entry.uploader_upload_status === "trusted") {
                this.trustedUploads.add(String(entry.id));
            } else {
                this.trustedUploads.delete(String(entry.id));
            }
        }
        return parseChapters(entries, sourceManga);
    }

    /**
     * A chapter's pages.
     *
     * Where they are served from depends on the upload, which only the chapter
     * list says. The base class lists the chapters again before this whenever
     * it has not seen them this session, so the list is always known here.
     */
    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const images = await fetchChapterImages(
            chapter.chapterId,
            chapter.sourceManga.mangaId,
            this.trustedUploads.has(chapter.chapterId),
        );
        return parseChapterPages(images, chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    /** The site's genre list: kept for two days, as the 0.9 source keeps it, and in memory for the session. */
    private getGenres(): Promise<string[]> {
        return (this.genresPromise ??= this.loadGenres().catch((error: unknown) => {
            this.genresPromise = undefined;
            throw error;
        }));
    }

    private async loadGenres(): Promise<string[]> {
        const stored = this.settings.stringArray(STATE_KEYS.GENRES);
        const fetchedAt = Number(this.settings.get(STATE_KEYS.GENRES_FETCHED_AT) ?? 0);
        if (stored.length > 0 && Date.now() - fetchedAt < GENRES_MAX_AGE_MS) {
            return stored;
        }

        try {
            const genres = listOf(await fetchGenres(), "genre list")
                .filter((genre): genre is string => typeof genre === "string" && genre.trim().length > 0)
                .sort((a, b) => a.localeCompare(b));
            this.settings.set(STATE_KEYS.GENRES, genres);
            this.settings.set(STATE_KEYS.GENRES_FETCHED_AT, Date.now());
            return genres;
        } catch (error: unknown) {
            // An old list beats none while the site is down; a challenge still has to reach the app.
            if (stored.length > 0 && !(error instanceof CloudflareError)) {
                return stored;
            }
            throw error;
        }
    }

    /**
     * The names to filter by.
     *
     * The site's own form fills these from its suggestions, so each typed name
     * is matched to one: the same name if it is suggested, otherwise the first
     * suggestion. The site suggests from three letters; a name it has nothing
     * for is sent as typed.
     */
    private async matchPeople(kind: "author" | "artist", typed: string | undefined): Promise<string[]> {
        const wanted = (typed ?? "")
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);

        return Promise.all(
            wanted.map(async (name) => {
                if (name.length < 3) {
                    return name;
                }
                try {
                    const suggestions = (await fetchPeople(kind, name)).suggestions ?? [];
                    return suggestions.find((entry) => entry.toLowerCase() === name.toLowerCase()) ?? suggestions[0] ?? name;
                } catch (error: unknown) {
                    if (error instanceof CloudflareError) {
                        throw error;
                    }
                    return name;
                }
            }),
        );
    }
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
