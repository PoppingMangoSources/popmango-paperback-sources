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
    CHAPTER_COUNT_OPTIONS,
    CONTENT_RATING_OPTIONS,
    CONTENT_TYPE_OPTIONS,
    DEFAULT_CONTENT_RATINGS,
    DEFAULT_CONTENT_TYPES,
    DEFAULT_LANGUAGES,
    DEMOGRAPHIC_OPTIONS,
    DISCOVER_SECTIONS,
    DOMAIN,
    FILTERS,
    FORMAT_OPTIONS,
    GENRE_OPTIONS,
    HOME_ROW_SIZE,
    LANGUAGE_OPTIONS,
    LEGACY_DEFAULT_TYPE_SETS,
    LEGACY_FORMAT_MAP,
    LEGACY_TYPE_MAP,
    MAX_LATEST_REQUESTS,
    MIRRORS,
    MIRROR_IDS,
    MODE_OPTIONS,
    PAGE_SIZE,
    SECTIONS,
    SECTIONS_ADDED_SINCE_LAST_CHOICE,
    SECTION_IDS,
    SECTION_OPTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATE_KEYS,
    STATUS_OPTIONS,
    VISIBLE_SECTIONS_VERSION,
    YEAR_FIELD,
    filterTag,
    splitFilterTag,
    type BrowseSelect,
    type ComicNode,
    type ContentPreferenceRating,
    type GenreMode,
    type PageMetadata,
    type RankedMetric,
    type SectionId,
    type SeriesType,
    type XComicPreferences,
} from "./models";
import { XComicClient, XComicInterceptor, type MirrorSettings } from "./network";
import { XComicParser, isComicAllowed, toLatestUploadNodes, toPreferredTitleSource, toTitleSources } from "./parsers";

export const XCOMICInfo = sourceInfo({
    name: "XCOMIC",
    description: "Extension that pulls content from xcomic.me.",
    version: "1.1.3",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

/** What a search adds on top of the reader's settings, read from the chosen tags. */
interface SearchFilters {
    included: Map<string, string[]>;
    excluded: Map<string, string[]>;
    year?: string;
}

export class XCOMIC extends PopmangoSource {
    private readonly client: XComicClient;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            // The app's throttle counts page images too, so this also sets how
            // fast a chapter's pages arrive; 3 a second left pages waiting.
            rateLimit: { numberOfRequests: 5, bufferInterval: 1, ignoreImages: true },
            interceptor: new XComicInterceptor(mirrorSettingsOf(() => this)),
        });
        this.client = new XComicClient(mirrorSettingsOf(() => this));
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${this.baseUrl}/comic/${mangaId}`;
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "mirror",
                header: "Mirror",
                footer:
                    "All four sites share one catalogue. When the chosen one is down, requests move to " +
                    "another on their own.",
                rows: [
                    selectRow("base_url", {
                        label: "Preferred mirror",
                        options: MIRRORS,
                        get: () => [this.selectedBaseUrl],
                        set: (value) => {
                            const mirror = MIRROR_IDS.includes(value[0] ?? "") ? (value[0] ?? DOMAIN) : DOMAIN;
                            this.settings.set(STATE_KEYS.BASE_URL, mirror);
                            // Choosing a mirror means starting there, not wherever last worked.
                            this.settings.set(STATE_KEYS.ACTIVE_BASE_URL, mirror);
                        },
                    }),
                ],
            },
            {
                id: "languages",
                header: "Languages",
                footer: "These apply to the home page and to search. No original language means all of them.",
                rows: [
                    selectRow("translated_languages", {
                        label: "Translated languages",
                        options: LANGUAGE_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.translatedLanguages,
                        set: (value) => this.settings.set(STATE_KEYS.TRANSLATED_LANGUAGES, value),
                    }),
                    selectRow("original_languages", {
                        label: "Original languages",
                        options: LANGUAGE_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.originalLanguages,
                        set: (value) => this.settings.set(STATE_KEYS.ORIGINAL_LANGUAGES, value),
                    }),
                ],
            },
            {
                id: "content",
                header: "What to show",
                footer: "Titles outside these types and ratings are left out everywhere.",
                rows: [
                    selectRow("content_types", {
                        label: "Content types",
                        options: CONTENT_TYPE_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.types,
                        set: (value) => this.settings.set(STATE_KEYS.CONTENT_TYPES, value),
                    }),
                    selectRow("content_ratings", {
                        label: "Content ratings",
                        options: CONTENT_RATING_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.contentRatings,
                        set: (value) => this.settings.set(STATE_KEYS.CONTENT_RATINGS, value),
                    }),
                ],
            },
            {
                id: "excluded",
                header: "Never show",
                footer: "A title carrying any of these is left out of every list.",
                rows: [
                    selectRow("excluded_genres", {
                        label: "Excluded genres",
                        options: GENRE_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.excludedGenres,
                        set: (value) => this.settings.set(STATE_KEYS.EXCLUDED_GENRES, value),
                    }),
                    selectRow("excluded_formats", {
                        label: "Excluded formats",
                        options: FORMAT_OPTIONS,
                        multiple: true,
                        get: () => this.preferences.excludedFormats,
                        set: (value) => this.settings.set(STATE_KEYS.EXCLUDED_FORMATS, value),
                    }),
                ],
            },
            {
                id: "titles",
                header: "Titles",
                footer:
                    "Some titles are uploaded by several teams; showing the edition tells them apart. Letter " +
                    "matching is the site's other way of matching a search, which it marks as the slower one.",
                rows: [
                    switchRow("show_edition_in_title", {
                        label: "Show edition in title",
                        get: () => this.showEditionInTitle,
                        set: (value) => this.settings.set(STATE_KEYS.SHOW_EDITION_IN_TITLE, value),
                    }),
                    switchRow("letter_matching", {
                        label: "Letter matching",
                        get: () => this.letterMatching,
                        set: (value) => this.settings.set(STATE_KEYS.LETTER_MATCHING, value),
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
                        set: (value) => {
                            this.settings.set(STATE_KEYS.VISIBLE_SECTIONS_VERSION, VISIBLE_SECTIONS_VERSION);
                            this.settings.set(STATE_KEYS.VISIBLE_SECTIONS, value);
                        },
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const visible = new Set<string>(this.visibleSections);
        return SECTION_IDS.filter((id) => visible.has(id)).map((id) => DISCOVER_SECTIONS[id]);
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = metadata as PageMetadata | undefined;

        switch (section.id as SectionId) {
            case SECTIONS.TOP_RATED:
                return this.rankedSection(page, "field_score", "top");
            case SECTIONS.RANDOM:
                return this.randomSection();
            case SECTIONS.MOST_FOLLOWS:
                return this.rankedSection(page, "field_follow", "follows");
            case SECTIONS.MOST_REVIEWS:
                return this.rankedSection(page, "field_review", "reviews");
            case SECTIONS.RECENTLY_ADDED:
                return this.recentlyAddedSection(page);
            case SECTIONS.LATEST_UPLOADS:
                return this.latestUploadsSection(page);
            case SECTIONS.MOST_COMMENTS:
                return this.rankedSection(page, "field_comment", "comments");
            case SECTIONS.MOST_CHAPTERS:
                return this.rankedSection(page, "field_chapter", "chapters");
            default:
                return { items: [] };
        }
    }

    /**
     * Offers the site's filters as tag sections.
     *
     * 0.8 has no sort control or single-choice picker, so those are tag
     * sections too: where only one value makes sense, the first chosen wins.
     */
    override async getFilterSections(): Promise<TagSection[]> {
        const section = (id: string, title: string, options: Array<{ id: string; title: string }>): TagSection => ({
            id,
            title,
            tags: options.map((option) => filterTag(id, option.id, option.title)),
        });

        return [
            section(FILTERS.SORT, "Sort by", SORT_OPTIONS),
            section(FILTERS.TYPE, "Types", CONTENT_TYPE_OPTIONS),
            section(FILTERS.RATING, "Content ratings", CONTENT_RATING_OPTIONS),
            section(FILTERS.GENRE, "Genres", GENRE_OPTIONS),
            section(FILTERS.FORMAT, "Formats", FORMAT_OPTIONS),
            section(FILTERS.DEMOGRAPHIC, "Demographics", DEMOGRAPHIC_OPTIONS),
            section(FILTERS.INC_MODE, "Included genres", MODE_OPTIONS),
            section(FILTERS.EXC_MODE, "Excluded genres", MODE_OPTIONS),
            section(FILTERS.ORIG_STATUS, "Original work status", STATUS_OPTIONS),
            // "Any" is what choosing nothing already means.
            section(
                FILTERS.CHAPTERS,
                "Chapter count",
                CHAPTER_COUNT_OPTIONS.filter((option) => option.id.length > 0),
            ),
            section(FILTERS.TLANG, "Translated languages", LANGUAGE_OPTIONS),
            section(FILTERS.OLANG, "Original languages", LANGUAGE_OPTIONS),
        ];
    }

    /** The release year is a number or a span, so it gets a box. */
    override async getSearchFieldList(): Promise<SearchField[]> {
        return [{ id: YEAR_FIELD, name: "Release year", placeholder: "e.g. 2015 or 2005-2009" }];
    }

    /** Genres and formats can be ruled out as well as asked for. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const title = (query.title ?? "").trim();
        const filters: SearchFilters = {
            included: groupTags(query.includedTags),
            excluded: groupTags(query.excludedTags),
            year: textField(query, YEAR_FIELD),
        };

        const pasted = await this.resolvePastedUrl(title, filters);
        if (pasted !== undefined) {
            return pasted;
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const sortBy = filters.included.get(FILTERS.SORT)?.[0] ?? "field_score";
        const preferences = this.effectivePreferences(filters);
        const response = await this.client.browse(this.browseSelect(page, sortBy, title, filters, preferences));

        // A search names one work, so every edition of it is on offer. With no
        // term this is browsing, and the site lists one row per title there.
        const expandEditions = title.length > 0;
        const nodes = (response.get_title_browse_items ?? [])
            .flatMap((node) => {
                const sources = toTitleSources(node, preferences.translatedLanguages);
                return expandEditions ? sources : sources.slice(0, 1);
            })
            .filter((node) => isComicAllowed(node.data, preferences));

        const parser = this.parser;
        return {
            items: nodes.map((node) => parser.searchResult(node)),
            metadata: nextPageOf(response.get_title_browse_pager?.next, page),
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        const node = (await this.client.comic(mangaId)).get_comicNode;
        if (node === null || node === undefined) {
            throw new Error(`No series was found for ${mangaId}.`);
        }
        return this.parser.sourceManga(node, mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const first = await this.client.chapters(sourceManga.mangaId, 1);
        const firstResult = first.get_comic_chapterList_uniqList;
        if (firstResult === null || firstResult === undefined) {
            return [];
        }

        const pageCount = firstResult.paging?.pages ?? 1;
        const rest = await Promise.all(
            Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
                this.client.chapters(sourceManga.mangaId, index + 2),
            ),
        );

        const parser = this.parser;
        return [first, ...rest].flatMap((response) =>
            (response.get_comic_chapterList_uniqList?.items ?? [])
                // Anything else is a draft or a removal the site still lists.
                .filter((item) => item.data.dbStatus === "normal")
                .map((item) => parser.chapter(item.data, sourceManga)),
        );
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const id = chapter.chapterId.split("/").pop()?.split("-")[0];
        if (id === undefined || id.length === 0) {
            throw new Error(`Cannot work out a chapter id from ${chapter.chapterId}.`);
        }
        return this.parser.chapterDetails(await this.client.chapterPages(id), chapter);
    }

    /**
     * getPages needs only the ids, so a chapter opened straight from history
     * does not have to wait for the whole chapter list — thousands of
     * chapters, for a long series — to be fetched again first.
     */
    protected override chapterFromIds(mangaId: string, chapterId: string): Chapter {
        return { chapterId, chapNum: 0, sourceManga: { mangaId } as SourceManga };
    }

    // -----------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------

    /** The mirror the reader picked. */
    get selectedBaseUrl(): string {
        const value = this.settings.string(STATE_KEYS.BASE_URL, DOMAIN);
        return MIRROR_IDS.includes(value) ? value : DOMAIN;
    }

    /** The mirror to try first: the last one that answered, else the one picked. */
    get baseUrl(): string {
        const value = this.settings.string(STATE_KEYS.ACTIVE_BASE_URL, "");
        return MIRROR_IDS.includes(value) ? value : this.selectedBaseUrl;
    }

    rememberWorkingMirror(origin: string): void {
        if (MIRROR_IDS.includes(origin) && this.settings.get(STATE_KEYS.ACTIVE_BASE_URL) !== origin) {
            this.settings.set(STATE_KEYS.ACTIVE_BASE_URL, origin);
        }
    }

    /** On by default: a title with several editions is ambiguous without it. */
    private get showEditionInTitle(): boolean {
        return this.settings.boolean(STATE_KEYS.SHOW_EDITION_IN_TITLE, true);
    }

    /** Off by default: the site marks it the slower way of matching a term. */
    private get letterMatching(): boolean {
        return this.settings.boolean(STATE_KEYS.LETTER_MATCHING, false);
    }

    /** What the reader has chosen to see, with the site's defaults behind it. */
    get preferences(): XComicPreferences {
        const validRatings = CONTENT_RATING_OPTIONS.map((option) => option.id);
        const ratings = this.settings
            .stringArray(STATE_KEYS.CONTENT_RATINGS)
            .filter((rating): rating is ContentPreferenceRating =>
                validRatings.includes(rating as ContentPreferenceRating),
            );

        const storedTypes = this.settings.stringArray(STATE_KEYS.CONTENT_TYPES);
        const types = unique(storedTypes.map((type) => LEGACY_TYPE_MAP[type] ?? type)).filter(
            (type): type is SeriesType => DEFAULT_CONTENT_TYPES.includes(type as SeriesType),
        );
        // A default an earlier release shipped was never really chosen.
        const hadLegacyDefaults = LEGACY_DEFAULT_TYPE_SETS.some(
            (set) => set.length === storedTypes.length && set.every((type) => storedTypes.includes(type)),
        );

        const validLanguages = new Set(LANGUAGE_OPTIONS.map(({ id }) => id));
        const originalLanguages = this.settings
            .stringArray(STATE_KEYS.ORIGINAL_LANGUAGES)
            .filter((language) => validLanguages.has(language));
        const translatedLanguages = this.settings
            .stringArray(STATE_KEYS.TRANSLATED_LANGUAGES)
            .filter((language) => validLanguages.has(language));

        return {
            contentRatings: ratings.length > 0 ? ratings : DEFAULT_CONTENT_RATINGS,
            originalLanguages,
            translatedLanguages: translatedLanguages.length > 0 ? translatedLanguages : DEFAULT_LANGUAGES,
            types: hadLegacyDefaults || types.length === 0 ? DEFAULT_CONTENT_TYPES : types,
            excludedFormats: this.settings
                .stringArray(STATE_KEYS.EXCLUDED_FORMATS)
                .map((id) => LEGACY_FORMAT_MAP[id] ?? id),
            excludedGenres: this.settings.stringArray(STATE_KEYS.EXCLUDED_GENRES),
        };
    }

    /**
     * The rows to show.
     *
     * A reader who chose rows before the newer ones existed would never see
     * them, so they are added once to an older choice.
     */
    private get visibleSections(): SectionId[] {
        const visible = this.settings.stringArray(STATE_KEYS.VISIBLE_SECTIONS, new Set<string>(SECTION_IDS)) as SectionId[];
        if (visible.length === 0) {
            return SECTION_IDS;
        }

        if (this.settings.get(STATE_KEYS.VISIBLE_SECTIONS_VERSION) !== VISIBLE_SECTIONS_VERSION) {
            const migrated = unique([...visible, ...SECTIONS_ADDED_SINCE_LAST_CHOICE]);
            this.settings.set(STATE_KEYS.VISIBLE_SECTIONS, migrated);
            this.settings.set(STATE_KEYS.VISIBLE_SECTIONS_VERSION, VISIBLE_SECTIONS_VERSION);
            return migrated;
        }

        return visible;
    }

    private get parser(): XComicParser {
        return new XComicParser({ baseUrl: this.baseUrl, showEditionInTitle: this.showEditionInTitle });
    }

    // -----------------------------------------------------------------
    // Home page
    // -----------------------------------------------------------------

    private async rankedSection(
        metadata: PageMetadata | undefined,
        sortBy: string,
        metric: RankedMetric,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = metadata?.page ?? 1;
        const preferences = this.preferences;
        const response = await this.client.browse(
            this.browseSelect(page, sortBy, "", undefined, preferences, HOME_ROW_SIZE),
        );

        const nodes = (response.get_title_browse_items ?? []).flatMap((node) => {
            const source = toPreferredTitleSource(node, preferences.translatedLanguages);
            return source !== undefined && isComicAllowed(source.data, preferences) ? [source] : [];
        });

        return {
            items: this.parser.rankedItems(nodes, metric),
            metadata: nextPageOf(response.get_title_browse_pager?.next, page),
        };
    }

    private async randomSection(): Promise<PagedResults<DiscoverSectionItem>> {
        const preferences = this.preferences;
        const nodes = ((await this.client.randomTitles()).get_title_randomList ?? [])
            .flatMap((node) => toTitleSources(node, preferences.translatedLanguages).slice(0, 1))
            .filter((node) => isComicAllowed(node.data, preferences));

        return { items: this.parser.discoverItems(nodes, "prominentCarouselItem") };
    }

    private async recentlyAddedSection(metadata: PageMetadata | undefined): Promise<PagedResults<DiscoverSectionItem>> {
        const preferences = this.preferences;
        const result = (await this.client.recentlyAdded(metadata?.before)).get_title_recentlyAdded;

        const nodes = (result?.items ?? []).flatMap((node) => {
            const source = toPreferredTitleSource(node, preferences.translatedLanguages);
            return source !== undefined && isComicAllowed(source.data, preferences) ? [source] : [];
        });

        const before = olderCursor(result?.before, metadata?.before);
        return {
            items: this.parser.discoverItems(nodes, "simpleCarouselItem"),
            // Offering a cursor past an empty page makes the app fetch forever.
            metadata: before !== undefined && nodes.length > 0 ? { before } : undefined,
        };
    }

    /**
     * Walks the upload feed until a page survives filtering.
     *
     * The feed carries every language and type at once and cannot be narrowed
     * by the site, so a page can filter down to nothing.
     */
    private async latestUploadsSection(metadata: PageMetadata | undefined): Promise<PagedResults<DiscoverSectionItem>> {
        const preferences = this.preferences;
        const nodes: ComicNode[] = [];
        const seen = new Set<string>();
        let cursor = metadata?.before;

        for (let attempt = 0; attempt < MAX_LATEST_REQUESTS && nodes.length === 0; attempt += 1) {
            const result = (await this.client.latestUploads(cursor)).get_title_latestUploads;

            for (const node of toLatestUploadNodes(result)) {
                if (seen.has(node.data.id) || !isComicAllowed(node.data, preferences)) {
                    continue;
                }
                seen.add(node.data.id);
                nodes.push(node);
            }

            cursor = olderCursor(result?.before, cursor);
            if (cursor === undefined) {
                break;
            }
        }

        return {
            items: this.parser.discoverItems(nodes, "chapterUpdatesCarouselItem"),
            // Offering a cursor after an empty walk makes the app page forever,
            // ten requests at a time.
            metadata: nodes.length > 0 && cursor !== undefined ? { before: cursor } : undefined,
        };
    }

    // -----------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------

    /**
     * The reader's settings with a search's own choices on top.
     *
     * A chosen type, rating or language replaces the setting for that search;
     * an excluded genre or format adds to the ones already ruled out.
     */
    private effectivePreferences(filters: SearchFilters): XComicPreferences {
        const preferences = this.preferences;
        const chosen = (section: string): string[] => filters.included.get(section) ?? [];

        const types = chosen(FILTERS.TYPE) as SeriesType[];
        const ratings = chosen(FILTERS.RATING) as ContentPreferenceRating[];

        return {
            ...preferences,
            types: types.length > 0 ? types : preferences.types,
            contentRatings: ratings.length > 0 ? ratings : preferences.contentRatings,
            originalLanguages: chosen(FILTERS.OLANG).length > 0 ? chosen(FILTERS.OLANG) : preferences.originalLanguages,
            translatedLanguages:
                chosen(FILTERS.TLANG).length > 0 ? chosen(FILTERS.TLANG) : preferences.translatedLanguages,
            excludedGenres: [...preferences.excludedGenres, ...(filters.excluded.get(FILTERS.GENRE) ?? [])],
            excludedFormats: [...preferences.excludedFormats, ...(filters.excluded.get(FILTERS.FORMAT) ?? [])],
        };
    }

    private browseSelect(
        page: number,
        sortBy: string,
        word: string,
        filters: SearchFilters | undefined,
        preferences: XComicPreferences,
        size = PAGE_SIZE,
    ): BrowseSelect {
        const chosen = (section: string): string[] => filters?.included.get(section) ?? [];
        const { min, max } = yearRange(filters?.year);

        return {
            // The slower mode only changes how a term is matched, so a browse
            // without one has nothing for it to do.
            where: word.length > 0 && this.letterMatching ? "letter" : "browse",
            page,
            size,
            sortby: sortBy,
            word,
            incOLangs: preferences.originalLanguages,
            incTLangs: preferences.translatedLanguages,
            incGenres: unique([...chosen(FILTERS.GENRE), ...chosen(FILTERS.FORMAT)]),
            excGenres: unique([...preferences.excludedGenres, ...preferences.excludedFormats]),
            incGenresMode: (chosen(FILTERS.INC_MODE)[0] as GenreMode | undefined) ?? "and",
            excGenresMode: (chosen(FILTERS.EXC_MODE)[0] as GenreMode | undefined) ?? "or",
            incTypes: preferences.types,
            incDemographics: chosen(FILTERS.DEMOGRAPHIC),
            incContentRatings: preferences.contentRatings,
            releaseYearMin: min,
            releaseYearMax: max,
            origStatus: chosen(FILTERS.ORIG_STATUS)[0] ?? null,
            chapCount: chosen(FILTERS.CHAPTERS)[0] || null,
            ignoreGlobalULangs: false,
            ignoreGlobalGenres: false,
            ignoreGlobalBlocks: false,
        };
    }

    /** Turns a pasted link to a comic, an edition or a title into the one result it names. */
    private async resolvePastedUrl(
        title: string,
        filters: SearchFilters,
    ): Promise<PagedResults<SearchResultItem> | undefined> {
        const match =
            /^https?:\/\/(?:www\.)?(?:xcomic\.(?:me|net)|yona\.to|comik\.to)\/(source|comic|title)\/([a-zA-Z0-9]+)/i.exec(
                title,
            );
        const kind = match?.[1];
        const id = match?.[2];
        if (kind === undefined || id === undefined) {
            return undefined;
        }

        const preferences = this.effectivePreferences(filters);

        let node: ComicNode | undefined;
        try {
            node =
                kind.toLowerCase() === "title"
                    ? await this.resolveTitleSource(id, preferences.translatedLanguages)
                    : ((await this.client.comic(id)).get_comicNode ?? undefined);
        } catch (error: unknown) {
            // A challenge has to reach the app; anything else falls through to
            // an ordinary search for the text.
            if (error instanceof CloudflareError) {
                throw error;
            }
            return undefined;
        }

        if (node === undefined) {
            return undefined;
        }
        // A link to something the reader has ruled out returns nothing, rather
        // than quietly ignoring their settings.
        if (!isComicAllowed(node.data, preferences)) {
            return { items: [] };
        }
        return { items: [this.parser.searchResult(node)] };
    }

    /**
     * The edition a title link should open.
     *
     * The site folds duplicate titles into one and leaves the old record
     * pointing at the keeper, so a link to the folded title still resolves.
     * One hop only: a longer chain is the site's to sort out.
     */
    private async resolveTitleSource(titleId: string, languages: string[]): Promise<ComicNode | undefined> {
        let node = (await this.client.titleNode(titleId)).get_title_titleNode ?? undefined;
        const mergedTo = node?.data.mergedTo?.trim();

        if (node?.data.isMerged && mergedTo && mergedTo !== titleId) {
            node = (await this.client.titleNode(mergedTo)).get_title_titleNode ?? node;
        }
        return node !== undefined ? toPreferredTitleSource(node, languages) : undefined;
    }
}

/**
 * Hands the network layer what it needs from the source, read when needed.
 *
 * The interceptor is built inside the base class's constructor, before the
 * source exists, so everything goes through a getter rather than a value.
 */
function mirrorSettingsOf(source: () => XCOMIC): MirrorSettings {
    return {
        baseUrl: () => source().baseUrl,
        selectedBaseUrl: () => source().selectedBaseUrl,
        rememberWorkingMirror: (origin) => source().rememberWorkingMirror(origin),
        translatedLanguages: () => source().preferences.translatedLanguages,
    };
}

/** The next page, but only when the site says there is one beyond this. */
function nextPageOf(next: number | null | undefined, page: number): PageMetadata | undefined {
    return typeof next === "number" && next > page ? { page: next } : undefined;
}

/** A cursor that actually moves back in time; anything else ends the walk. */
function olderCursor(next: number | null | undefined, current: number | undefined): number | undefined {
    if (typeof next !== "number" || !Number.isFinite(next)) {
        return undefined;
    }
    return current === undefined || next < current ? next : undefined;
}

/** Reads a year or a span of years, in either order — the site labels its own spans newest-first. */
function yearRange(year: string | undefined): { min: number | null; max: number | null } {
    const value = (year ?? "").replace(/[^\d-]/g, "");
    if (value.length === 0) {
        return { min: null, max: null };
    }

    if (value.includes("-")) {
        const [from, to] = value.split("-").map((part) => Number(part) || null);
        if (from !== null && from !== undefined && to !== null && to !== undefined) {
            return { min: Math.min(from, to), max: Math.max(from, to) };
        }
        const single = from ?? to ?? null;
        return { min: single, max: single };
    }

    const single = Number(value) || null;
    return { min: single, max: single };
}

function textField(query: SearchQuery, field: string): string | undefined {
    const value = query.parameters[field];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function unique<T>(values: T[]): T[] {
    return values.filter((value, index) => values.indexOf(value) === index);
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
