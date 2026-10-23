/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Application,
    Capability,
    CloudflareError,
    ContentRating,
    DiscoverSectionType,
    PopmangoSource,
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
    type Tag,
    type TagSection,
} from "../../common";

import { deriveReaderKey, signReaderPath, type ReaderKey } from "./crypto";
import {
    CONTENT_RATING_OPTIONS,
    COUNTRY_OPTIONS,
    DEFAULT_CONTENT_RATINGS,
    DEMOGRAPHIC_OPTIONS,
    DOMAIN,
    FIELDS,
    FILTERS,
    HAS_CHAPTERS,
    MATCH_MODE_OPTIONS,
    ORDER_OPTIONS,
    PAGE_SIZE,
    READER_BUILD,
    READER_SECRET,
    SECTIONS,
    SECTION_DEFINITIONS,
    SECTION_IDS,
    SECTION_OPTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATE_KEYS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    UPLOAD_CHOICE_OPTIONS,
    filterTag,
    splitFilterTag,
    type FacetsResponse,
    type LatestResponse,
    type PageMetadata,
    type ReaderKeyResponse,
    type ReaderLimit,
    type SectionId,
    type Series,
    type SeriesListResponse,
    type UploadChoice,
} from "./models";
import {
    ToonkotsuInterceptor,
    fetchBrowse,
    fetchDiscoveryRanking,
    fetchFacets,
    fetchLatest,
    fetchReadingRanking,
    fetchSeries,
    fetchSiteSession,
    requestChapter,
    requestReaderKey,
    type CatalogueParams,
} from "./network";
import {
    fromTagId,
    hasWrappedKeys,
    parseChapterPages,
    parseChapters,
    parseMangaDetails,
    parseMangaIdFromUrl,
    parseRatingId,
    parseReaderKeyResponse,
    parseTagGroups,
    toCarouselItems,
    toFeaturedItems,
    toLatestItems,
    toSearchResults,
} from "./parsers";

export const ToonkotsuInfo = sourceInfo({
    name: "Toonkotsu",
    description: "Extension that pulls content from toonkotsu.com.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

type ReaderSession = { readerKey: ReaderKey; response: ReaderKeyResponse };

type SectionData =
    | { kind: "series"; items: Series[]; hasNext: boolean }
    | { kind: "latest"; items: LatestResponse["items"]; hasNext: boolean };

const hasNextPage = (data: SeriesListResponse, page: number): boolean =>
    data.hasNextPage ??
    (typeof data.total === "number"
        ? page * (data.limit ?? PAGE_SIZE) < data.total
        : data.items.length >= PAGE_SIZE);

export class Toonkotsu extends PopmangoSource {
    private facetsPromise?: Promise<FacetsResponse>;
    private readerKeyPromise?: Promise<ReaderSession | undefined>;
    private siteSessionPromise?: Promise<unknown>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 5, bufferInterval: 1, ignoreImages: true },
            interceptor: new ToonkotsuInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/title/${mangaId}`;
    }

    // -----------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------

    private get contentRatings(): string[] {
        const ratings = this.settings.stringArray(
            STATE_KEYS.CONTENT_RATINGS,
            new Set(CONTENT_RATING_OPTIONS.map(({ id }) => id)),
        );
        return ratings.length > 0 ? [...new Set(ratings)] : DEFAULT_CONTENT_RATINGS;
    }

    private get types(): string[] {
        const ids = TYPE_OPTIONS.map(({ id }) => id);
        const types = this.settings.stringArray(STATE_KEYS.TYPES, new Set(ids));
        return types.length > 0 ? [...new Set(types)] : ids;
    }

    private get hiddenTags(): string[] {
        return this.settings.stringArray(STATE_KEYS.HIDDEN_TAGS);
    }

    /** The rows to show; nothing chosen means all of them. */
    private get visibleSections(): SectionId[] {
        const visible = this.settings.stringArray(STATE_KEYS.VISIBLE_SECTIONS, new Set<string>(SECTION_IDS)) as SectionId[];
        return visible.length > 0 ? visible : SECTION_IDS;
    }

    private get deduplicateChapters(): boolean {
        return this.settings.boolean(STATE_KEYS.DEDUPLICATE_CHAPTERS, false);
    }

    private get uploadChoice(): UploadChoice {
        return this.settings.choice(
            STATE_KEYS.UPLOAD_CHOICE,
            UPLOAD_CHOICE_OPTIONS.map(({ id }) => id),
            "best",
        );
    }

    /**
     * Off by default, unlike 0.9.
     *
     * 0.9 shows the size beside the group as part of telling uploads apart; a
     * 0.8 chapter row has only its title for it, where a size reads as noise.
     */
    private get showUploadSize(): boolean {
        return this.settings.boolean(STATE_KEYS.SHOW_UPLOAD_SIZE, false);
    }

    override async getSettingsSections(): Promise<MenuSection[]> {
        // The tags come from the site; when it cannot be reached, the ones
        // already hidden stay listed so they can still be shown again.
        const tagOptions: Tag[] = await this.getFacets().then(
            (facets) =>
                parseTagGroups(facets, ["pornographic"])
                    .flatMap(({ tags }) => tags)
                    .sort((a, b) => a.title.localeCompare(b.title)),
            () => this.hiddenTags.map((id) => ({ id, title: fromTagId(id) })),
        );

        return [
            {
                id: "browse",
                header: "Browse",
                footer:
                    "Applies to the home page and search. Pornographic titles are only requested when that rating " +
                    "is on. Choosing no rating or type means the defaults.",
                rows: [
                    selectRow("content_ratings", {
                        label: "Content ratings",
                        options: CONTENT_RATING_OPTIONS,
                        multiple: true,
                        get: () => this.contentRatings,
                        set: (value) => this.settings.set(STATE_KEYS.CONTENT_RATINGS, value),
                    }),
                    selectRow("types", {
                        label: "Types",
                        options: TYPE_OPTIONS,
                        multiple: true,
                        get: () => this.types,
                        set: (value) => this.settings.set(STATE_KEYS.TYPES, value),
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
                id: "chapters",
                header: "Chapters",
                footer:
                    "Deduplicate Chapters lists only the upload the site shows first for each chapter, not one from " +
                    "every group. Upload Choice picks among a chapter's uploads: Best Quality keeps each group's " +
                    "widest, Smallest Download its lightest, which is less to download and decrypt; with Deduplicate " +
                    "Chapters on, Smallest Download keeps the lightest upload of each chapter from any group. Upload " +
                    "Size adds each upload's size to its title and lists a group's uploads of different sizes " +
                    "separately. Changing these lists other uploads of the same chapters, so chapters read under " +
                    "one choice can show as unread under another.",
                rows: [
                    switchRow("deduplicate_chapters", {
                        label: "Deduplicate Chapters",
                        get: () => this.deduplicateChapters,
                        set: (value) => this.settings.set(STATE_KEYS.DEDUPLICATE_CHAPTERS, value),
                    }),
                    selectRow("upload_choice", {
                        label: "Upload Choice",
                        options: UPLOAD_CHOICE_OPTIONS,
                        get: () => [this.uploadChoice],
                        set: (value) => this.settings.set(STATE_KEYS.UPLOAD_CHOICE, value[0] ?? "best"),
                    }),
                    switchRow("show_upload_size", {
                        label: "Upload Size",
                        get: () => this.showUploadSize,
                        set: (value) => this.settings.set(STATE_KEYS.SHOW_UPLOAD_SIZE, value),
                    }),
                ],
            },
            {
                id: "sections",
                header: "Home page",
                footer: "Choose which rows appear. Leave everything unticked to show them all.",
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
    }

    // -----------------------------------------------------------------
    // Home page
    // -----------------------------------------------------------------

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const visible = new Set<string>(this.visibleSections);
        return SECTION_IDS.filter((id) => visible.has(id)).map((id) => SECTION_DEFINITIONS[id]);
    }

    async getDiscoverSectionItems(section: DiscoverSection, metadata: unknown): Promise<PagedResults<DiscoverSectionItem>> {
        const previous = metadata as PageMetadata | undefined;
        const page = previous?.page ?? 1;
        const ratings = this.contentRatings;
        const data = await this.loadSection(section.id, page, this.catalogueParams(ratings));
        const allowed = (series: Series) => ratings.includes(parseRatingId(series));
        const seen = new Set(previous?.seen ?? []);

        let items: DiscoverSectionItem[];
        if (data.kind === "latest") {
            // The feed lists every new chapter, but the site shows each title once, at its newest.
            items = toLatestItems(
                data.items.filter(({ series }) => {
                    if (seen.has(series.id)) {
                        return false;
                    }
                    seen.add(series.id);
                    return allowed(series);
                }),
            );
        } else if (section.type === DiscoverSectionType.featured) {
            // Ranks are the site's positions, so a title hidden by the settings leaves its number unused.
            items = toFeaturedItems(
                data.items.flatMap((series, index) =>
                    allowed(series) ? [{ series, rank: (page - 1) * PAGE_SIZE + index + 1 }] : [],
                ),
            );
        } else {
            items = toCarouselItems(
                data.items.filter(allowed),
                section.type === DiscoverSectionType.prominentCarousel ? "prominentCarouselItem" : "simpleCarouselItem",
            );
        }

        return {
            items,
            metadata: data.hasNext
                ? ({ page: page + 1, ...(data.kind === "latest" ? { seen: [...seen] } : {}) } satisfies PageMetadata)
                : undefined,
        };
    }

    private async loadSection(sectionId: string, page: number, params: CatalogueParams): Promise<SectionData> {
        switch (sectionId) {
            case SECTIONS.MOST_READ:
            case SECTIONS.TRENDING: {
                const data = await fetchReadingRanking(sectionId === SECTIONS.TRENDING ? "trending" : "views", {
                    ...params,
                    sort: "latest",
                    order: "desc",
                    page,
                });
                return { kind: "series", items: data.items, hasNext: hasNextPage(data, page) };
            }
            case SECTIONS.HIDDEN_GEMS: {
                const data = await fetchDiscoveryRanking("gems", { ...params, page });
                return { kind: "series", items: data.items, hasNext: hasNextPage(data, page) };
            }
            case SECTIONS.LATEST: {
                const data = await fetchLatest(page, params);
                return { kind: "latest", items: data.items, hasNext: data.hasNextPage ?? false };
            }
            case SECTIONS.RECENTLY_ADDED:
                return this.browseSection({ ...params, sort: "new", order: "desc", page }, page);
            case SECTIONS.THIS_SEASON:
                return this.browseSection({ ...params, discovery: "seasonal", page }, page);
            case SECTIONS.COMPLETED:
                return this.browseSection({ ...params, discovery: "completed", page }, page);
            default:
                return { kind: "series", items: [], hasNext: false };
        }
    }

    private async browseSection(params: CatalogueParams, page: number): Promise<SectionData> {
        const data = await fetchBrowse(params);
        return { kind: "series", items: data.items, hasNext: hasNextPage(data, page) };
    }

    /**
     * What every catalogue request carries.
     *
     * The settings' types and hidden tags narrow every list; pornographic
     * titles are only requested when that rating is on. A hidden tag a search
     * asks for is shown for that search.
     */
    private catalogueParams(ratings: string[], extraExcluded: string[] = [], included: string[] = []): CatalogueParams {
        const types = this.types;
        const languages =
            types.length < TYPE_OPTIONS.length
                ? TYPE_OPTIONS.filter(({ id }) => types.includes(id)).flatMap(({ languages }) => languages)
                : [];
        const exclude = [...new Set([...this.hiddenTags.map(fromTagId), ...extraExcluded])].filter(
            (tag) => !included.includes(tag),
        );
        return {
            sfw: !ratings.includes("pornographic"),
            originalLanguage: languages.join(",") || undefined,
            exclude: exclude.join(",") || undefined,
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

        let tagGroups: TagSection[] = [];
        try {
            tagGroups = parseTagGroups(await this.getFacets(), this.contentRatings);
        } catch (error: unknown) {
            if (error instanceof CloudflareError) {
                throw error;
            }
            // The fixed filters still work without the site's tag list.
        }

        return [
            section(FILTERS.SORT, "Sort by", SORT_OPTIONS),
            section(FILTERS.ORDER, "Order", ORDER_OPTIONS),
            section(FILTERS.RATING, "Content rating", CONTENT_RATING_OPTIONS),
            section(FILTERS.STATUS, "Status", STATUS_OPTIONS),
            section(FILTERS.DEMOGRAPHIC, "Demographic", DEMOGRAPHIC_OPTIONS),
            section(FILTERS.COUNTRY, "Country", COUNTRY_OPTIONS),
            ...tagGroups.map((group) => ({
                id: `${FILTERS.GENRE}-${group.id}`,
                title: group.title,
                tags: group.tags.map((tag) => filterTag(FILTERS.GENRE, tag.id, tag.title)),
            })),
            section(FILTERS.INC_MODE, "Tag inclusion mode", MATCH_MODE_OPTIONS),
            section(FILTERS.EXC_MODE, "Tag exclusion mode", MATCH_MODE_OPTIONS),
            section(FILTERS.OPTIONS, "Options", [{ id: HAS_CHAPTERS, title: "Has chapters" }]),
        ];
    }

    /** The site's ranges and author filter are typed rather than picked. */
    override async getSearchFieldList(): Promise<SearchField[]> {
        return [
            { id: FIELDS.YEAR_FROM, name: "Year from", placeholder: "e.g. 2015" },
            { id: FIELDS.YEAR_TO, name: "Year to", placeholder: "e.g. 2024" },
            { id: FIELDS.CHAPTERS_MIN, name: "Chapters from", placeholder: "e.g. 10" },
            { id: FIELDS.CHAPTERS_MAX, name: "Chapters to", placeholder: "e.g. 200" },
            { id: FIELDS.AUTHOR, name: "Author", placeholder: "Name" },
        ];
    }

    /** Tags can be ruled out as well as asked for. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const title = (query.title ?? "").trim();

        const pastedId = parseMangaIdFromUrl(title);
        if (pastedId) {
            try {
                const manga = await this.getMangaInfo(pastedId);
                return {
                    items: [
                        {
                            mangaId: pastedId,
                            title: manga.mangaInfo.primaryTitle,
                            imageUrl: manga.mangaInfo.thumbnailUrl,
                            contentRating: manga.mangaInfo.contentRating,
                        },
                    ],
                };
            } catch (error: unknown) {
                if (error instanceof CloudflareError) {
                    throw error;
                }
                // URL lookup is optional; an unresolved link continues as an ordinary search.
            }
        }

        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);
        const chosen = (section: string): string[] => included.get(section) ?? [];

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const ratings = chosen(FILTERS.RATING).length > 0 ? chosen(FILTERS.RATING) : this.contentRatings;
        const includedGenres = chosen(FILTERS.GENRE).map(fromTagId);
        const excludedGenres = (excluded.get(FILTERS.GENRE) ?? []).map(fromTagId);

        // Best Match ranks by the text query, so without one the site's default order applies.
        const requested = chosen(FILTERS.SORT)[0];
        const sortId =
            requested === "relevance" && !title
                ? "lastUploadedChapterAt"
                : (requested ?? (title ? "relevance" : "lastUploadedChapterAt"));
        const sort = SORT_OPTIONS.find(({ id }) => id === sortId)?.value ?? "latest";
        // The site only ever sends whole numbers here, so anything else typed is left out, not sent.
        const whole = (field: string): number | undefined => {
            const value = textField(query, field);
            return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
        };

        const params = this.catalogueParams(ratings, excludedGenres, includedGenres);
        const data = await fetchBrowse({
            ...params,
            q: title || undefined,
            originalLanguage: chosen(FILTERS.COUNTRY).join(",") || params.originalLanguage,
            genres: includedGenres.join(",") || undefined,
            genreMode: chosen(FILTERS.INC_MODE)[0],
            excludeMode: chosen(FILTERS.EXC_MODE)[0],
            demographic: chosen(FILTERS.DEMOGRAPHIC).join(",") || undefined,
            status:
                chosen(FILTERS.STATUS)
                    .map((id) => STATUS_OPTIONS.find((option) => option.id === id)?.value ?? id)
                    .join(",") || undefined,
            author: textField(query, FIELDS.AUTHOR),
            yearFrom: whole(FIELDS.YEAR_FROM),
            yearTo: whole(FIELDS.YEAR_TO),
            chaptersMin: whole(FIELDS.CHAPTERS_MIN),
            chaptersMax: whole(FIELDS.CHAPTERS_MAX),
            hasChapters: chosen(FILTERS.OPTIONS).includes(HAS_CHAPTERS) ? "true" : undefined,
            sort,
            // Best Match has no direction. Every other sort takes the Order
            // filter, as on the site, which otherwise starts a title list at A
            // and every other list newest or highest first.
            order: sort === "relevance" ? "desc" : (chosen(FILTERS.ORDER)[0] ?? (sort === "title" ? "asc" : "desc")),
            page,
        });

        return {
            items: toSearchResults(data.items.filter((series) => ratings.includes(parseRatingId(series)))),
            metadata: hasNextPage(data, page) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    // -----------------------------------------------------------------
    // Series and chapters
    // -----------------------------------------------------------------

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        // The tag list only sorts the tags into groups, so the details still
        // open without it.
        const [series, facets] = await Promise.all([
            fetchSeries(mangaId),
            this.getFacets().catch((): FacetsResponse => ({})),
        ]);
        return parseMangaDetails(series, mangaId, facets);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(await fetchSeries(sourceManga.mangaId), sourceManga, {
            mainOnly: this.deduplicateChapters,
            showSize: this.showUploadSize,
            choice: this.uploadChoice,
        });
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const pages = await this.readChapter(chapter.chapterId);
        if (pages) {
            return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
        }
        // The site's human check needs the reader to see it, so the chapter is
        // opened in the site's own reader to pass it there. The session it is
        // passed in is the one the next read should use, so nothing from this
        // attempt is kept.
        this.siteSessionPromise = undefined;
        this.readerKeyPromise = undefined;
        throw new CloudflareError(
            Application.createRequest({
                url: `${DOMAIN}/chapter/${chapter.chapterId}`,
                method: "GET",
                headers: { "user-agent": await Application.getDefaultUserAgent() },
            }),
        );
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private getFacets(): Promise<FacetsResponse> {
        return (this.facetsPromise ??= fetchFacets().catch((error: unknown) => {
            this.facetsPromise = undefined;
            throw error;
        }));
    }

    /** The site issues its guest cookie here, and the reader refuses a visitor without one. */
    private getSiteSession(fresh = false): Promise<unknown> {
        return (this.siteSessionPromise ??= fetchSiteSession(fresh).catch((error: unknown) => {
            this.siteSessionPromise = undefined;
            throw error;
        }));
    }

    /** Resolves undefined when the site asks for its human check before handing out a key. */
    private getReaderKey(fresh = false): Promise<ReaderSession | undefined> {
        return (this.readerKeyPromise ??= (async () => {
            await this.getSiteSession();
            const { status, data } = await requestReaderKey(fresh);
            if (status < 200 || status >= 300) {
                const limit = status === 429 ? (data as ReaderLimit | undefined) : undefined;
                if (needsHumanCheck(limit)) {
                    return undefined;
                }
                throw readerError(status, limit, "the reader key");
            }
            const response = parseReaderKeyResponse(data);
            return { readerKey: deriveReaderKey(response, READER_SECRET), response };
        })().then(
            (session) => {
                if (!session) {
                    this.readerKeyPromise = undefined;
                }
                return session;
            },
            (error: unknown) => {
                this.readerKeyPromise = undefined;
                throw error;
            },
        ));
    }

    /** Resolves undefined when the site asks for its human check. */
    private async readChapter(chapterId: string): Promise<string[] | undefined> {
        const path = `/api/manga/chapter/${chapterId}`;
        await this.getSiteSession();

        let { status, data } = await requestChapter(path);
        if (status === 401 || status === 403) {
            this.siteSessionPromise = undefined;
            await this.getSiteSession(true);
            ({ status, data } = await requestChapter(path));
        }

        if (status >= 200 && status < 300 && !hasWrappedKeys(data)) {
            return parseChapterPages(data);
        }
        // A human check or a wait stands however the chapter is asked for; any
        // other refusal, or masked page keys, is answered by signing.
        if (needsHumanCheck(status === 429 ? (data as ReaderLimit | undefined) : undefined)) {
            return undefined;
        }
        return this.readSigned(chapterId, path);
    }

    /**
     * Reads a chapter with a signed request.
     *
     * An expired key, and a refused guest session with it, are refreshed once.
     * 0.9 then recovers a rotated signing secret by running the site's reader
     * in a web view; 0.8 has nothing to run it in, so a reader that has moved
     * on is reported as such instead.
     */
    private async readSigned(chapterId: string, path: string): Promise<string[] | undefined> {
        for (let attempt = 0; ; attempt++) {
            const session = await this.getReaderKey(attempt > 0);
            if (!session) {
                return undefined;
            }

            const { readerKey, response } = session;
            const { status, data } = await requestChapter(path, signReaderPath(readerKey, path));
            if (status >= 200 && status < 300) {
                return parseChapterPages(data, readerKey);
            }

            const limit = (status === 429 ? data : undefined) as ReaderLimit | undefined;
            const sessionRejected = status === 401 || status === 403;
            const signingRejected = sessionRejected || limit?.resign === true;
            if (attempt === 0 && signingRejected) {
                this.readerKeyPromise = undefined;
                if (sessionRejected) {
                    this.siteSessionPromise = undefined;
                    await this.getSiteSession(true);
                }
                continue;
            }

            if (needsHumanCheck(limit)) {
                return undefined;
            }
            const readerChanged = signingRejected && response.build !== READER_BUILD;
            // A guest session the site still refuses, with the reader unchanged,
            // is one only the site's own pages can set up: 0.8 has no way to
            // hand a source the web view's cookies, so the reader is sent there.
            if (sessionRejected && !readerChanged) {
                return undefined;
            }
            throw readerError(status, limit, `chapter ${chapterId}`, readerChanged);
        }
    }
}

// Guests are asked to confirm they are human before reading on. A timed limit
// is reported with its wait; any other reading limit is the human check.
const needsHumanCheck = (limit: ReaderLimit | undefined): boolean => {
    if (limit?.code !== "manga-limit" || limit.resign) {
        return false;
    }
    if (limit.transient || limit.reason === "wait") {
        throw new Error(
            `Toonkotsu is limiting reads right now. Try again in ${limit.retryAfterSec || (limit.reason === "wait" ? 600 : 10)} seconds.`,
        );
    }
    return true;
};

const readerError = (status: number, limit: ReaderLimit | undefined, subject: string, readerChanged = false): Error => {
    const reason = readerChanged ? " The site's reader has been updated, so this source needs an update too." : "";
    return new Error(`Could not load ${subject} (status ${status}${limit?.error ? `: ${limit.error}` : ""}).${reason}`);
};

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
