/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    CloudflareError,
    ContentRating,
    PopmangoSource,
    inputRow,
    selectRow,
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
    BROWSE_SORT,
    CONTENT_RATING_OPTIONS,
    DEFAULT_CONTENT_RATINGS,
    DEFAULT_LANGUAGES,
    DEFAULT_MIRROR,
    DISCOVER_SECTIONS,
    DISTURBING_OPTIONS,
    DOMAIN,
    FIELDS,
    FILTERS,
    FORMAT_OPTIONS,
    GENRE_TYPES,
    HOME_ROW_SIZE,
    LANGUAGE_OPTIONS,
    MATCH_OPTIONS,
    MAX_FILTER_PAGES,
    MIRRORS,
    PAGE_SIZE,
    SECTIONS,
    SECTION_IDS,
    SECTION_OPTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATE_KEYS,
    STATUS_OPTIONS,
    TRENDING_SIZE,
    UPLOAD_SOURCE_OPTIONS,
    filterTag,
    splitFilterTag,
    type ContentRatingId,
    type DisturbingMode,
    type GenreEntry,
    type KaganeSection,
    type PageMetadata,
    type SearchOptions,
    type SectionId,
    type SeriesSummary,
    type TagEntry,
    type UploadSourceMode,
} from "./models";
import {
    KaganeInterceptor,
    ageBandOf,
    buildSearchBody,
    coverUrl,
    fetchBookIndex,
    fetchGenres,
    fetchSeries,
    fetchSources,
    fetchTags,
    fetchTrending,
    openReader,
    pageUrl,
    pornographicFlag,
    resolveName,
    searchSeries,
} from "./network";
import {
    TAG_SECTION,
    contentRatingOf,
    orderedPages,
    parseBookIndex,
    toChapters,
    toDiscoverItem,
    toSearchResult,
    toSourceManga,
    type ViewOptions,
} from "./parsers";
import { HIDDEN_THEMES, POPULAR_TAGS, tagVariants } from "./tags";

export const KaganeInfo = sourceInfo({
    name: "Kagane",
    description: "Extension that pulls manga, manhwa, manhua and comics from kagane.cx.",
    version: "5.0.1",
    icon: "icon.png",
    language: "Multi",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

// Series id, with or without the slug prefix.
const SERIES_LINK = new RegExp(
    `^https?://(?:www\\.)?(?:${MIRRORS.map((host) => host.replace(/\./g, "\\.")).join("|")})/series/` +
        "(?:[^/?#]*-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)",
    "i",
);

export class Kagane extends PopmangoSource {
    private readonly pageCounts = new Map<string, number>();

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 3, bufferInterval: 1 },
            interceptor: new KaganeInterceptor(() => this.mirror),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${this.site}/series/${mangaId}`;
    }

    override async getSettingsSections(): Promise<MenuSection[]> {
        const genres = await fetchGenres(this.site).catch(() => [] as GenreEntry[]);

        const sections: MenuSection[] = [
            {
                id: "site",
                header: "Site",
                footer: "Every mirror serves the same library.",
                rows: [
                    selectRow("mirror", {
                        label: "Mirror",
                        options: MIRRORS.map((host) => ({ id: host, title: host })),
                        get: () => [this.mirror],
                        set: (value) => this.settings.set(STATE_KEYS.MIRROR, value[0] ?? DEFAULT_MIRROR),
                    }),
                ],
            },
            {
                id: "content",
                header: "What to show",
                footer:
                    "Untick every language to see all of them. Hidden genres and tags apply when browsing; " +
                    "a search by name still finds the title asked for.",
                rows: [
                    selectRow("content_ratings", {
                        label: "Content ratings",
                        options: CONTENT_RATING_OPTIONS,
                        multiple: true,
                        get: () => this.contentRatings,
                        set: (value) => this.settings.set(STATE_KEYS.CONTENT_RATINGS, value),
                    }),
                    selectRow("languages", {
                        label: "Languages",
                        options: LANGUAGE_OPTIONS,
                        multiple: true,
                        get: () => this.languages,
                        set: (value) => this.settings.set(STATE_KEYS.LANGUAGES, value),
                    }),
                    selectRow("upload_source", {
                        label: "Uploads",
                        options: UPLOAD_SOURCE_OPTIONS,
                        get: () => [this.uploadSource],
                        set: (value) => this.settings.set(STATE_KEYS.UPLOAD_SOURCE, value[0] ?? "all"),
                    }),
                    switchRow("hide_disturbing", {
                        label: "Hide disturbing content",
                        get: () => this.hideDisturbing,
                        set: (value) => this.settings.set(STATE_KEYS.HIDE_DISTURBING, value),
                    }),
                    ...(genres.length > 0
                        ? [
                              selectRow("excluded_genres", {
                                  label: "Hidden genres",
                                  options: [...genres]
                                      .sort((left, right) => left.genre_name.localeCompare(right.genre_name))
                                      .map((genre) => ({ id: genre.id, title: genre.genre_name })),
                                  multiple: true,
                                  get: () => this.settings.stringArray(STATE_KEYS.EXCLUDED_GENRES),
                                  set: (value) => this.settings.set(STATE_KEYS.EXCLUDED_GENRES, value),
                              }),
                          ]
                        : []),
                    selectRow("hidden_themes", {
                        label: "Hidden themes",
                        options: HIDDEN_THEMES.map((theme) => ({ id: theme.id, title: theme.title })),
                        multiple: true,
                        get: () => this.settings.stringArray(STATE_KEYS.HIDDEN_THEMES),
                        set: (value) => this.settings.set(STATE_KEYS.HIDDEN_THEMES, value),
                    }),
                    // ~9,700 tags: too many for a picker
                    inputRow("hidden_tags", {
                        label: "Hidden tags (comma separated)",
                        get: () => this.settings.string(STATE_KEYS.HIDDEN_TAGS, ""),
                        set: (value) => this.settings.set(STATE_KEYS.HIDDEN_TAGS, value),
                    }),
                ],
            },
            {
                id: "display",
                header: "Display",
                rows: [
                    switchRow("show_source", {
                        label: "Show upload source in titles",
                        get: () => this.settings.boolean(STATE_KEYS.SHOW_SOURCE_IN_TITLE, false),
                        set: (value) => this.settings.set(STATE_KEYS.SHOW_SOURCE_IN_TITLE, value),
                    }),
                    switchRow("show_spoilers", {
                        label: "Show spoiler tags",
                        get: () => this.settings.boolean(STATE_KEYS.SHOW_SPOILER_TAGS, false),
                        set: (value) => this.settings.set(STATE_KEYS.SHOW_SPOILER_TAGS, value),
                    }),
                ],
            },
            {
                id: "home",
                header: "Home page",
                footer: "Leave everything unticked to show every row.",
                rows: [
                    selectRow("visible_sections", {
                        label: "Rows shown",
                        options: SECTION_OPTIONS,
                        multiple: true,
                        get: () => this.visibleSections,
                        set: (value) => this.settings.set(STATE_KEYS.VISIBLE_SECTIONS, value),
                    }),
                ],
            },
        ];

        return sections;
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const visible = new Set<string>(this.visibleSections);
        return SECTION_IDS.filter((id) => visible.has(id)).map((id) => DISCOVER_SECTIONS[id]);
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const spec = DISCOVER_SECTIONS[section.id as SectionId] as KaganeSection | undefined;
        if (spec === undefined) {
            return { items: [] };
        }

        const view = await this.view();
        const ratings = this.contentRatings;

        if (spec.id === SECTIONS.WEEKLY_CHART) {
            // Single ranked list, no pagination
            return { items: await this.weeklyChart(view, ratings) };
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const response = await searchSeries(this.site, buildSearchBody(await this.searchOptions({ sort: spec.sort })), {
            page,
            size: page === 1 ? HOME_ROW_SIZE : PAGE_SIZE,
            sort: spec.sort,
            exactMatch: false,
        });

        return {
            items: withinRatings(response.content ?? [], ratings).flatMap((series) => {
                const item = toDiscoverItem(series, spec.type, view);
                return item !== undefined ? [item] : [];
            }),
            metadata: response.last === false ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    // 0.8 has no sort or single-choice control, so those are tag sections; the first pick wins.
    override async getFilterSections(): Promise<TagSection[]> {
        const [genres, sources] = await Promise.all([
            fetchGenres(this.site).catch(() => [] as GenreEntry[]),
            fetchSources(this.site).catch(() => []),
        ]);

        const section = (id: string, title: string, options: Array<{ id: string; title: string }>): TagSection => ({
            id,
            title,
            tags: options.map((option) => filterTag(id, option.id, option.title)),
        });

        const sections: TagSection[] = [
            section(FILTERS.SORT, "Sort by", SORT_OPTIONS),
            section(FILTERS.RATING, "Content ratings", CONTENT_RATING_OPTIONS),
        ];

        // All genre types share one filter; the site only groups them for display
        for (const kind of GENRE_TYPES) {
            const ofKind = genres
                .filter((genre) => (genre.genre_type ?? "genre") === kind.id)
                .sort((left, right) => left.genre_name.localeCompare(right.genre_name));
            if (ofKind.length > 0) {
                sections.push({
                    id: `${FILTERS.GENRE}-${kind.id}`,
                    title: kind.title,
                    tags: ofKind.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.genre_name)),
                });
            }
        }

        sections.push(
            {
                id: TAG_SECTION,
                title: "Popular tags",
                tags: POPULAR_TAGS.map(([title, ids]) => filterTag(TAG_SECTION, ids[0] ?? "", title)),
            },
            section(FILTERS.GENRE_MATCH, "Chosen genres", MATCH_OPTIONS),
            section(FILTERS.TAG_MATCH, "Chosen tags", MATCH_OPTIONS),
            section(FILTERS.FORMAT, "Format", FORMAT_OPTIONS),
            section(FILTERS.STATUS, "Upload status", STATUS_OPTIONS),
            section(FILTERS.PUBLICATION, "Publication status", STATUS_OPTIONS),
            section(FILTERS.DISTURBING, "Disturbing content", DISTURBING_OPTIONS),
            section(FILTERS.EXACT, "Title", [{ id: "exact", title: "Exact title match" }]),
        );

        if (sources.length > 0) {
            sections.push(
                section(
                    FILTERS.SOURCE,
                    "Upload source",
                    [...sources]
                        .sort((left, right) => left.title.localeCompare(right.title))
                        .map((source) => ({
                            id: source.source_id,
                            title: source.source_type === "Official" ? `${source.title} ⭐` : source.title,
                        })),
                ),
            );
        }

        return sections;
    }

    override async getSearchFieldList(): Promise<SearchField[]> {
        return [
            { id: FIELDS.TAGS, name: "Tags", placeholder: "e.g. Isekai, Villainess, -Gore" },
            { id: FIELDS.STAFF, name: "Author or artist", placeholder: "Full name" },
            { id: FIELDS.GROUP, name: "Scanlation group", placeholder: "Full name" },
            { id: FIELDS.CHAPTERS, name: "Chapters", placeholder: "e.g. 50, 10-100 or 200+" },
            { id: FIELDS.START_YEAR, name: "Year started", placeholder: "e.g. 2020 or 2015-2020" },
        ];
    }

    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const title = (query.title ?? "").trim();

        const pasted = await this.resolvePastedLink(title);
        if (pasted !== undefined) {
            return pasted;
        }

        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);
        const first = (section: string): string | undefined => included.get(section)?.[0];

        const chosenRatings = (included.get(FILTERS.RATING) ?? []).filter(isRating);
        const ratings = chosenRatings.length > 0 ? chosenRatings : this.contentRatings;

        // Typed and popular tags may map to several ids; a details-page tag maps to one
        const typed = await this.typedTags(textField(query, FIELDS.TAGS));
        const tappedTags = included.get(TAG_SECTION) ?? [];
        const tagGroups = [...typed.included, ...tappedTags.map(tagVariants)];
        const tagsMatchAll = first(FILTERS.TAG_MATCH) !== "any";

        const options = await this.searchOptions({
            query: title || undefined,
            sort: first(FILTERS.SORT) ?? (title ? "" : BROWSE_SORT),
            exactMatch: first(FILTERS.EXACT) === "exact",
            contentRatings: ratings,
            disturbing: (first(FILTERS.DISTURBING) as DisturbingMode | undefined) ?? undefined,
            formats: included.get(FILTERS.FORMAT) ?? [],
            statuses: included.get(FILTERS.STATUS) ?? [],
            publicationStatuses: included.get(FILTERS.PUBLICATION) ?? [],
            sourceIds: included.get(FILTERS.SOURCE) ?? [],
            genres: {
                included: included.get(FILTERS.GENRE) ?? [],
                excluded: excluded.get(FILTERS.GENRE) ?? [],
                matchAll: first(FILTERS.GENRE_MATCH) !== "any",
            },
            tags: {
                included: tagGroups,
                excluded: [...typed.excluded, ...(excluded.get(TAG_SECTION) ?? []).flatMap(tagVariants)],
                matchAll: tagsMatchAll,
            },
            staffId: await this.resolveId("staff", textField(query, FIELDS.STAFF)),
            groupId: await this.resolveId("groups", textField(query, FIELDS.GROUP)),
            chapters: rangeField(query, FIELDS.CHAPTERS, "Chapters"),
            startYear: rangeField(query, FIELDS.START_YEAR, "Year started"),
        });

        if (options.contentRatings.length === 0) {
            return { items: [] };
        }

        const view = await this.view();
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        // "(A or A') and B" can't be expressed in one request: fetch the union and check locally
        const checkLocally =
            options.tags.matchAll && options.tags.included.length > 1 && options.tags.included.some((group) => group.length > 1);
        const body = buildSearchBody(checkLocally ? { ...options, tags: { ...options.tags, matchAll: false } } : options);

        let next = page;
        for (let walked = 0; walked < (checkLocally ? MAX_FILTER_PAGES : 1); walked += 1) {
            const response = await searchSeries(this.site, body, {
                page: next,
                size: PAGE_SIZE,
                sort: options.sort,
                exactMatch: options.exactMatch,
            });
            next += 1;

            const items = withinRatings(response.content ?? [], options.contentRatings)
                .filter((series) => !checkLocally || matchesEveryGroup(series.tags ?? [], options.tags.included))
                .map((series) => toSearchResult(series, view));

            const more = response.last === false;
            if (items.length > 0 || !more || !checkLocally) {
                return { items, metadata: more ? ({ page: next } satisfies PageMetadata) : undefined };
            }
        }

        throw new Error("Too few titles matched every typed tag. Narrow the search or match any tag.");
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        const [details, view] = await Promise.all([fetchSeries(this.site, mangaId), this.view(true)]);
        return toSourceManga(mangaId, details, view);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const books = parseBookIndex(await fetchBookIndex(this.site, sourceManga.mangaId));
        for (const book of books) {
            if (book.pageCount !== undefined) {
                this.pageCounts.set(book.bookId, book.pageCount);
            }
        }

        const language = sourceManga.mangaInfo.additionalInfo?.["Translated language"] ?? "en";
        return toChapters(books, sourceManga, language);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const session = await openReader(this.site, chapter.chapterId);
        const pages = orderedPages(session.manifest?.pages ?? [], this.pageCounts.get(chapter.chapterId));

        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages: pages.map((page) =>
                pageUrl(session.cache_url, chapter.chapterId, `${page.page_id}.${page.ext ?? "jxl"}`, session.access_token),
            ),
        };
    }

    // The reader only needs the id, so history opens skip refetching the chapter list.
    protected override chapterFromIds(mangaId: string, chapterId: string): Chapter {
        return { chapterId, chapNum: 0, sourceManga: { mangaId } as SourceManga };
    }

    private get mirror(): string {
        const value = this.settings.string(STATE_KEYS.MIRROR, DEFAULT_MIRROR);
        return MIRRORS.includes(value) ? value : DEFAULT_MIRROR;
    }

    private get site(): string {
        return `https://${this.mirror}`;
    }

    // Ticking none means the default, not nothing
    private get contentRatings(): ContentRatingId[] {
        const chosen = this.settings.stringArray(STATE_KEYS.CONTENT_RATINGS).filter(isRating);
        return chosen.length > 0 ? chosen : DEFAULT_CONTENT_RATINGS;
    }

    // Unset means English; explicitly empty means every language
    private get languages(): string[] {
        if (this.settings.get(STATE_KEYS.LANGUAGES) === undefined) {
            return DEFAULT_LANGUAGES;
        }
        return this.settings.stringArray(STATE_KEYS.LANGUAGES);
    }

    private get uploadSource(): UploadSourceMode {
        const value = this.settings.string(STATE_KEYS.UPLOAD_SOURCE, "all");
        return UPLOAD_SOURCE_OPTIONS.some((option) => option.id === value) ? (value as UploadSourceMode) : "all";
    }

    private get hideDisturbing(): boolean {
        return this.settings.boolean(STATE_KEYS.HIDE_DISTURBING, true);
    }

    private get visibleSections(): SectionId[] {
        const chosen = this.settings.stringArray(STATE_KEYS.VISIBLE_SECTIONS, new Set<string>(SECTION_IDS)) as SectionId[];
        return chosen.length > 0 ? chosen : SECTION_IDS;
    }

    private async view(full = false): Promise<ViewOptions> {
        const showSource = this.settings.boolean(STATE_KEYS.SHOW_SOURCE_IN_TITLE, false);
        const sources = showSource ? await fetchSources(this.site).catch(() => []) : [];

        return {
            cover: (imageId, wantFull) => coverUrl(this.site, imageId, wantFull ?? full),
            sourceNames: showSource ? new Map(sources.map((source) => [source.source_id, source.title])) : undefined,
            showSpoilerTags: this.settings.boolean(STATE_KEYS.SHOW_SPOILER_TAGS, false),
        };
    }

    // Hide-lists apply only when browsing: a title search should still find what was asked for.
    private async searchOptions(chosen: Partial<SearchOptions>): Promise<SearchOptions> {
        const browsing = !chosen.query;
        const hiddenGenres = browsing ? this.settings.stringArray(STATE_KEYS.EXCLUDED_GENRES) : [];
        const hiddenTags = browsing ? await this.hiddenTagIds() : [];

        const genres = chosen.genres ?? { included: [], excluded: [], matchAll: true };
        const tags = chosen.tags ?? { included: [], excluded: [], matchAll: true };

        return {
            query: chosen.query,
            sort: chosen.sort ?? BROWSE_SORT,
            exactMatch: chosen.exactMatch ?? false,
            contentRatings: chosen.contentRatings ?? this.contentRatings,
            languages: this.languages,
            uploadSource: this.uploadSource,
            disturbing: chosen.disturbing ?? (this.hideDisturbing ? "hide" : "show"),
            formats: chosen.formats ?? [],
            statuses: chosen.statuses ?? [],
            publicationStatuses: chosen.publicationStatuses ?? [],
            sourceIds: chosen.sourceIds ?? [],
            genres: { ...genres, excluded: [...genres.excluded, ...hiddenGenres] },
            tags: { ...tags, excluded: [...tags.excluded, ...hiddenTags] },
            staffId: chosen.staffId,
            groupId: chosen.groupId,
            chapters: chosen.chapters,
            startYear: chosen.startYear,
        };
    }

    // Comma-separated names, "-" to exclude. A name maps to all its case-variant ids.
    private async typedTags(text: string | undefined): Promise<{ included: string[][]; excluded: string[] }> {
        const names = (text ?? "")
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);
        if (names.length === 0) {
            return { included: [], excluded: [] };
        }

        const tags = await fetchTags(this.site);
        const included: string[][] = [];
        const excluded: string[] = [];

        for (const raw of names) {
            const exclude = raw.startsWith("-");
            const name = (exclude ? raw.slice(1) : raw).trim().toLowerCase();
            const ids = idsNamed(tags, name);
            if (ids.length === 0) {
                throw new Error(`Kagane has no tag named ${exclude ? raw.slice(1).trim() : raw}.`);
            }
            if (exclude) {
                excluded.push(...ids);
            } else {
                included.push(ids);
            }
        }

        return { included, excluded };
    }

    private async hiddenTagIds(): Promise<string[]> {
        const themes = new Set(this.settings.stringArray(STATE_KEYS.HIDDEN_THEMES));
        const typed = (await this.typedTags(this.settings.string(STATE_KEYS.HIDDEN_TAGS, ""))).included.flat();
        return [...typed, ...HIDDEN_THEMES.filter((theme) => themes.has(theme.id)).flatMap((theme) => theme.tagIds)];
    }

    private async resolveId(kind: "staff" | "groups", name: string | undefined): Promise<string | undefined> {
        return name !== undefined ? resolveName(this.site, kind, name) : undefined;
    }

    // The chart can't filter hidden genres/tags or more than five languages; checked locally.
    private async weeklyChart(view: ViewOptions, ratings: ContentRatingId[]): Promise<DiscoverSectionItem[]> {
        if (ratings.length === 0) {
            return [];
        }

        const languages = this.languages;
        const hiddenGenres = new Set(this.settings.stringArray(STATE_KEYS.EXCLUDED_GENRES));
        const hiddenTags = new Set(await this.hiddenTagIds());

        const chart = await fetchTrending(this.site, {
            limit: TRENDING_SIZE,
            ageRatings: ratings.map(ageBandOf).filter((band, index, all) => all.indexOf(band) === index),
            languages,
            pornographic: pornographicFlag(ratings),
            disturbing: this.hideDisturbing ? false : undefined,
        });

        const series = (chart.items ?? [])
            .filter((entry) => entry.hidden_by_filter !== true)
            .flatMap((entry) => (entry.series ? [entry.series] : []))
            .filter(
                (entry) =>
                    (languages.length <= 5 ||
                        languages.includes((entry.translated_language ?? "").toLowerCase())) &&
                    !(entry.genres ?? []).some((id) => hiddenGenres.has(id)) &&
                    !(entry.tags ?? []).some((id) => hiddenTags.has(id)),
            );

        return withinRatings(series, ratings).flatMap((entry) => {
            const item = toDiscoverItem(entry, DISCOVER_SECTIONS[SECTIONS.WEEKLY_CHART].type, view);
            return item !== undefined ? [item] : [];
        });
    }

    private async resolvePastedLink(title: string): Promise<PagedResults<SearchResultItem> | undefined> {
        const seriesId = SERIES_LINK.exec(title)?.[1];
        if (seriesId === undefined) {
            return undefined;
        }

        try {
            const manga = await this.getMangaInfo(seriesId);
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
            // Surface challenges; otherwise fall back to a normal text search
            if (error instanceof CloudflareError) {
                throw error;
            }
            return undefined;
        }
    }
}

function isRating(value: string): value is ContentRatingId {
    return CONTENT_RATING_OPTIONS.some((option) => option.id === value);
}

// The API filters by age band, which lumps Erotica with Pornographic; split them here.
function withinRatings(series: SeriesSummary[], ratings: ContentRatingId[]): SeriesSummary[] {
    return series.filter((entry) => entry.hidden_by_filter !== true && ratings.includes(contentRatingOf(entry)));
}

export function idsNamed(tags: TagEntry[], name: string): string[] {
    const exact = tags.filter((tag) => tag.tag_name.trim().toLowerCase() === name).map((tag) => tag.id);
    if (exact.length > 0) {
        return exact;
    }
    // Fall back to names with stray trailing punctuation (" Fantasy,")
    const loose = (value: string): string => value.trim().replace(/[\s,;.]+$/, "").toLowerCase();
    return tags.filter((tag) => loose(tag.tag_name) === name).map((tag) => tag.id);
}

export function matchesEveryGroup(ids: string[], groups: string[][]): boolean {
    const present = new Set(ids.map((id) => id.toLowerCase()));
    return groups.every((group) => group.some((id) => present.has(id.toLowerCase())));
}

function textField(query: SearchQuery, field: string): string | undefined {
    const value = query.parameters[field];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// "50", "10-100" or "200+". Malformed input throws rather than being silently ignored.
export function parseRange(text: string | undefined, label: string): { min?: number; max?: number } | undefined {
    if (text === undefined) {
        return undefined;
    }
    const match = /^(\d+)\s*(?:(-)\s*(\d+)|(\+))?$/.exec(text.trim());
    if (match === null) {
        throw new Error(`${label}: use a number, a range such as 10-100, or a minimum such as 200+.`);
    }

    const min = Number(match[1]);
    const max = match[4] !== undefined ? undefined : Number(match[3] ?? match[1]);
    if (max !== undefined && max < min) {
        throw new Error(`${label}: the range must go from low to high.`);
    }
    return { min, ...(max !== undefined ? { max } : {}) };
}

function rangeField(query: SearchQuery, field: string, label: string): { min?: number; max?: number } | undefined {
    return parseRange(textField(query, field), label);
}

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
