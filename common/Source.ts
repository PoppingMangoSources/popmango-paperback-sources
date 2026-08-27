/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";
import type {
    DUISection,
    Chapter as RuntimeChapter,
    ChapterDetails as RuntimeChapterDetails,
    ChapterProviding,
    CloudflareBypassRequestProviding,
    HomePageSectionsProviding,
    HomeSection,
    PagedResults as RuntimePagedResults,
    PartialSourceManga,
    Request,
    RequestManager,
    SearchField as RuntimeSearchField,
    SearchRequest as RuntimeSearchRequest,
    SearchResultsProviding,
    SourceManga as RuntimeSourceManga,
    SourceStateManager,
    TagSection as RuntimeTagSection,
} from "@paperback/types";

import { CloudflareError } from "./Cloudflare";
import {
    toChapter,
    toChapterDetails,
    toHomeSection,
    toPagedResults,
    toPartialFromDiscover,
    toPartialFromSearch,
    toSourceManga,
    toTagSection,
} from "./Convert";
import { isRenderableSection } from "./Discover";
import {
    BasicRateLimiter,
    CookieStorageInterceptor,
    InterceptorChain,
    PaperbackInterceptor,
} from "./Interceptor";
import { settingsMenu, type MenuSection } from "./Menu";
import { Application } from "./Runtime";
import { SettingsStore } from "./Settings";
import type {
    Chapter,
    ChapterDetails,
    DiscoverSection,
    DiscoverSectionItem,
    PagedResults,
    SearchField,
    SearchQuery,
    SearchResultItem,
    SourceManga,
    TagSection,
} from "./Types";

/** Wiring a source hands to the base class. */
export interface SourceOptions {
    /** Front page of the site, used as the Cloudflare bypass target. */
    domain: string;
    /**
     * Setting keys this source stores.
     *
     * They have to be listed so their values can be read into memory before
     * anything needs them; see `SettingsStore`.
     */
    settingsKeys?: readonly string[];
    /** Throttling. Left off, requests are not spaced out at all. */
    rateLimit?: { numberOfRequests: number; bufferInterval: number; ignoreImages?: boolean };
    /** The source's own interceptor, if it needs one. */
    interceptor?: PaperbackInterceptor;
    /** Seconds before a request is abandoned. */
    requestTimeout?: number;
}

/**
 * Base class for every source in this repository.
 *
 * Sources are written against the model vocabulary in `Types.ts` — series
 * carry a primary title and a content rating, chapters know their parent,
 * home sections describe their own layout. This class implements the
 * interfaces the 0.8 app actually calls and translates between the two, so a
 * source never has to think about the runtime's shapes.
 *
 * The translation is not free of loss, and the places where it is lossy are
 * called out at each method.
 */
export abstract class PopmangoSource
    implements
        ChapterProviding,
        SearchResultsProviding,
        HomePageSectionsProviding,
        CloudflareBypassRequestProviding
{
    readonly cheerio: CheerioAPI;
    readonly requestManager: RequestManager;
    readonly stateManager: SourceStateManager;
    readonly cookieStorage: CookieStorageInterceptor;

    /**
     * The source's saved settings.
     *
     * Readable synchronously once loaded, which the base class arranges before
     * any source method runs.
     */
    readonly settings: SettingsStore;

    private readonly domain: string;

    /**
     * The last challenge the site served, kept so the app can be pointed at
     * the exact URL that failed rather than the front page.
     */
    private pendingChallenge?: Request;

    /** Sections from the most recent home page build, for "view more" lookups. */
    private sections?: DiscoverSection[];

    /** The series most recently fetched, so a chapter list need not refetch it. */
    private lastManga?: SourceManga;

    /** Chapters of the series above, so page lookups have the full chapter. */
    private lastChapters = new Map<string, Chapter>();

    constructor(cheerio: CheerioAPI, options: SourceOptions) {
        this.cheerio = cheerio;
        this.domain = options.domain;
        this.stateManager = App.createSourceStateManager();
        this.cookieStorage = new CookieStorageInterceptor(this.stateManager);
        this.settings = new SettingsStore(this.stateManager, options.settingsKeys ?? []);

        this.requestManager = App.createRequestManager({
            requestsPerSecond: options.rateLimit
                ? Math.max(1, Math.round(options.rateLimit.numberOfRequests / Math.max(1, options.rateLimit.bufferInterval)))
                : 4,
            requestTimeout: (options.requestTimeout ?? 20) * 1000,
            interceptor: new InterceptorChain({
                rateLimiter: options.rateLimit ? new BasicRateLimiter(options.rateLimit) : undefined,
                cookieStorage: this.cookieStorage,
                interceptor: options.interceptor,
            }),
        });

        Application.bind(this.requestManager, cheerio);
    }

    // ---------------------------------------------------------------------
    // What a source implements
    // ---------------------------------------------------------------------

    /** The home page sections this source offers. Return `[]` for none. */
    abstract getDiscoverSections(): Promise<DiscoverSection[]>;

    /** One page of items for a home page section. */
    abstract getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>>;

    /** One page of search results. */
    abstract getSearchResultItems(
        query: SearchQuery,
        metadata: unknown,
    ): Promise<PagedResults<SearchResultItem>>;

    /** Everything the details screen shows for one series. */
    abstract getMangaInfo(mangaId: string): Promise<SourceManga>;

    /** Every chapter of one series. */
    abstract getChapterList(sourceManga: SourceManga): Promise<Chapter[]>;

    /** The page images of one chapter. */
    abstract getPages(chapter: Chapter): Promise<ChapterDetails>;

    /**
     * Filters offered on the search screen.
     *
     * 0.8 renders these as selectable tags. A source with a sort order to
     * offer exposes it here as a section of mutually exclusive tags, since
     * 0.8 has no separate sort control.
     */
    async getFilterSections(): Promise<TagSection[]> {
        return [];
    }

    /**
     * Free-text boxes offered beside the filters.
     *
     * A 0.9 search form could hold anything; 0.8 renders selectable tags and
     * these boxes, and nothing else. A filter that is not a choice from a list
     * belongs here — what the reader types comes back in
     * `SearchQuery.parameters` under the field's id.
     */
    async getSearchFieldList(): Promise<SearchField[]> {
        return [];
    }

    /** Whether the site can express "everything except this tag". */
    async supportsTagExclusion(): Promise<boolean> {
        return false;
    }

    /** The public URL of a series, for the share sheet. */
    getMangaShareUrl(mangaId: string): string {
        return `${this.domain}/${mangaId}`;
    }

    /**
     * The source's settings screen, if it has one.
     *
     * Rows are built with the helpers in `Menu.ts` and read and write through
     * `this.settings`. Returning `[]` means the source has no settings, and
     * the app is told as much.
     */
    getSettingsSections(): MenuSection[] | Promise<MenuSection[]> {
        return [];
    }

    // ---------------------------------------------------------------------
    // What the app calls
    // ---------------------------------------------------------------------

    async getMangaDetails(mangaId: string): Promise<RuntimeSourceManga> {
        const manga = await this.guard(() => this.getMangaInfo(mangaId));
        this.lastManga = manga;
        return toSourceManga(manga);
    }

    /**
     * 0.8 asks for chapters by id alone, while a source is given the whole
     * series so its parsers can reuse what the details page already said. The
     * details are taken from the previous call when they are for this series —
     * which is the normal case, since the app opens the details screen first —
     * and fetched otherwise.
     */
    async getChapters(mangaId: string): Promise<RuntimeChapter[]> {
        return this.guard(async () => {
            const manga =
                this.lastManga?.mangaId === mangaId ? this.lastManga : await this.getMangaInfo(mangaId);
            this.lastManga = manga;

            const chapters = await this.getChapterList(manga);

            this.lastChapters = new Map(chapters.map((chapter) => [chapter.chapterId, chapter]));
            return chapters.map(toChapter);
        });
    }

    /**
     * 0.8 asks for pages by ids alone. The chapter object is recovered from
     * the list fetched a moment ago; if the app skipped straight here — as it
     * does when opening a chapter from the reading queue after a restart — the
     * list is fetched again so the source still receives a complete chapter.
     */
    async getChapterDetails(mangaId: string, chapterId: string): Promise<RuntimeChapterDetails> {
        return this.guard(async () => {
            let chapter = this.lastChapters.get(chapterId);

            if (chapter === undefined || chapter.sourceManga.mangaId !== mangaId) {
                await this.getChapters(mangaId);
                chapter = this.lastChapters.get(chapterId);
            }

            if (chapter === undefined) {
                throw new Error(`Chapter ${chapterId} is no longer listed under ${mangaId}.`);
            }

            return toChapterDetails(await this.getPages(chapter));
        });
    }

    async getSearchResults(query: RuntimeSearchRequest, metadata: unknown): Promise<RuntimePagedResults> {
        return this.guard(async () => {
            const page = await this.getSearchResultItems(
                {
                    title: query.title?.trim() === "" ? undefined : query.title,
                    includedTags: query.includedTags.map((tag) => ({ id: tag.id, title: tag.label })),
                    excludedTags: query.excludedTags.map((tag) => ({ id: tag.id, title: tag.label })),
                    parameters: query.parameters ?? {},
                },
                metadata,
            );

            return toPagedResults(page.items.map(toPartialFromSearch), page.metadata);
        });
    }

    async getSourceMenu(): Promise<DUISection> {
        await this.settings.load();
        return settingsMenu("Settings", () => this.getSettingsSections());
    }

    async getSearchTags(): Promise<RuntimeTagSection[]> {
        const sections = await this.guard(() => this.getFilterSections());
        return sections.map(toTagSection);
    }

    async getSearchFields(): Promise<RuntimeSearchField[]> {
        const fields = await this.guard(() => this.getSearchFieldList());
        return fields.map((field) =>
            App.createSearchField({ id: field.id, name: field.name, placeholder: field.placeholder }),
        );
    }

    /**
     * Builds the home page.
     *
     * Each section is announced empty first so the app can lay the page out
     * immediately, then filled in as its request comes back. Sections are
     * fetched together rather than in turn, and one that fails is left empty
     * instead of taking the whole page down with it.
     *
     * The app tracks a section by object identity rather than by id, so the
     * placeholder is kept and its items are set on it — announcing a second,
     * equal-looking section instead leaves the page with duplicates or with
     * rows that never fill in.
     */
    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const sections = (await this.guard(() => this.getDiscoverSections())).filter((section) =>
            isRenderableSection(section.type),
        );
        this.sections = sections;

        // Built up front so the layout is settled before any request is made.
        const placeholders = sections.map((section) => toHomeSection(section, [], false));
        for (const placeholder of placeholders) {
            sectionCallback(placeholder);
        }

        await Promise.all(
            sections.map(async (section, index) => {
                const placeholder = placeholders[index];
                if (placeholder === undefined) {
                    return;
                }

                let items: PartialSourceManga[] = [];
                let hasMore = false;

                try {
                    const page = await this.getDiscoverSectionItems(section, undefined);
                    items = page.items.map(toPartialFromDiscover);
                    hasMore = page.metadata !== undefined;
                } catch (error: unknown) {
                    this.rememberChallenge(error);
                }

                placeholder.items = items;
                placeholder.containsMoreItems = hasMore;
                sectionCallback(placeholder);
            }),
        );
    }

    async getViewMoreItems(homepageSectionId: string, metadata: unknown): Promise<RuntimePagedResults> {
        return this.guard(async () => {
            // The app can ask for more after a restart, before the home page
            // has been built in this session.
            this.sections ??= await this.getDiscoverSections();

            const section = this.sections.find((candidate) => candidate.id === homepageSectionId);
            if (section === undefined) {
                throw new Error(`Unknown home page section: ${homepageSectionId}`);
            }

            const page = await this.getDiscoverSectionItems(section, metadata);
            return toPagedResults(page.items.map(toPartialFromDiscover), page.metadata);
        });
    }

    /**
     * Points the app at a page that will settle the challenge.
     *
     * The URL that actually failed is preferred, because a challenge is often
     * scoped to a path rather than the whole site.
     */
    async getCloudflareBypassRequestAsync(): Promise<Request> {
        if (this.pendingChallenge !== undefined) {
            return this.pendingChallenge;
        }

        return App.createRequest({
            url: this.domain,
            method: "GET",
            headers: { "user-agent": await Application.getDefaultUserAgent() },
        });
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /**
     * Runs a source call, noting any Cloudflare challenge on the way past.
     *
     * The error is still rethrown — the app shows the bypass prompt in
     * response to it — but by then the failing request has been recorded so
     * the prompt opens the right page.
     */
    private async guard<T>(work: () => Promise<T>): Promise<T> {
        try {
            // Settings are consulted from places that cannot wait — an
            // interceptor rewriting a header, a URL being assembled — so they
            // are in memory before any of that starts.
            await this.settings.load();
            return await work();
        } catch (error: unknown) {
            this.rememberChallenge(error);
            throw error;
        }
    }

    private rememberChallenge(error: unknown): void {
        if (error instanceof CloudflareError) {
            this.pendingChallenge = error.request;
        }
    }
}
