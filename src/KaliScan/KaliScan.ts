/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    ContentRating,
    DiscoverSectionType,
    PopmangoSource,
    URL,
    labelRow,
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
    ACTIVE_BASE_URL_KEY,
    AUTHOR_FIELD,
    BASE_URL_KEY,
    DOMAIN,
    FAILOVER_KEY,
    FILTERS,
    GENRES,
    GENRE_MODE_OPTIONS,
    MIRRORS,
    MIRROR_IDS,
    SECTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TOP_RANGES,
    filterTag,
    splitFilterTag,
    type PageMetadata,
} from "./models";
import { KaliScanInterceptor, fetchHtml } from "./network";
import {
    decodeSlugId,
    encodeSlugId,
    hasNextPage,
    mangaUrl,
    parseCards,
    parseChapterList,
    parseChapterPages,
    parseHotCells,
    parseMangaDetails,
    toFeaturedItems,
    toLatestItems,
    toRankedItems,
    toSearchResultItems,
} from "./parsers";
import { baseUrl, bindSite } from "./site";

export const KaliScanInfo = sourceInfo({
    name: "KaliScan",
    description: "Extension that pulls content from kaliscan.com and its mirrors.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class KaliScan extends PopmangoSource {
    /** The home page, which two sections read from. */
    private homePage?: { base: string; promise: Promise<string> };

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 5, bufferInterval: 4, ignoreImages: true },
            interceptor: new KaliScanInterceptor(),
        });

        // Parsers and the interceptor need the current mirror without being
        // able to wait for it, so they read it from here.
        bindSite({
            selected: () => this.settings.choice(BASE_URL_KEY, MIRROR_IDS, DOMAIN),
            failover: () => this.settings.boolean(FAILOVER_KEY, true),
            active: () =>
                this.settings.choice(
                    ACTIVE_BASE_URL_KEY,
                    MIRROR_IDS,
                    this.settings.choice(BASE_URL_KEY, MIRROR_IDS, DOMAIN),
                ),
            setActive: (origin) => this.settings.set(ACTIVE_BASE_URL_KEY, origin),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return mangaUrl(mangaId);
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "mirror",
                header: "Mirrors",
                footer:
                    "All four domains carry the same catalogue. Failover moves to another one only " +
                    "when the chosen site is blocked, unreachable, or returning an error.",
                rows: [
                    selectRow("base_url", {
                        label: "Preferred mirror",
                        options: MIRRORS,
                        get: () => [this.settings.choice(BASE_URL_KEY, MIRROR_IDS, DOMAIN)],
                        set: (value) => {
                            const mirror = value[0] !== undefined && MIRROR_IDS.includes(value[0]) ? value[0] : DOMAIN;
                            this.settings.set(BASE_URL_KEY, mirror);
                            this.settings.set(ACTIVE_BASE_URL_KEY, mirror);
                            this.homePage = undefined;
                        },
                    }),
                    switchRow("automatic_failover", {
                        label: "Automatic mirror failover",
                        get: () => this.settings.boolean(FAILOVER_KEY, true),
                        set: (value) => {
                            this.settings.set(FAILOVER_KEY, value);
                            this.settings.set(
                                ACTIVE_BASE_URL_KEY,
                                this.settings.choice(BASE_URL_KEY, MIRROR_IDS, DOMAIN),
                            );
                            this.homePage = undefined;
                        },
                    }),
                    labelRow("base_url_current", "Currently using", baseUrl()),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        // 0.9 also showed strips of links into the charts and the genre list.
        // 0.8 has no tile that can hold a link, so both moved to the filters.
        return [
            { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
            { id: SECTIONS.HOT, title: "Hot Updates", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
            { id: SECTIONS.NEWEST, title: "Newest", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.REVIEWS, title: "Top Reviewed", type: DiscoverSectionType.simpleCarousel },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        switch (section.id) {
            case SECTIONS.POPULAR:
                return { items: toFeaturedItems(parseCards(await fetchHtml(`${baseUrl()}/popular`))) };

            case SECTIONS.HOT:
                return { items: toRankedItems(parseHotCells(await this.getHomePage()), "chapter", false) };

            case SECTIONS.LATEST:
                return this.getLatest(metadata as PageMetadata | undefined);

            case SECTIONS.NEWEST:
                return { items: toRankedItems(parseCards(await fetchHtml(`${baseUrl()}/newest`)), "chapter") };

            case SECTIONS.REVIEWS:
                return {
                    items: toRankedItems(parseCards(await fetchHtml(`${baseUrl()}/top/reviews`)), "rating"),
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
                id: FILTERS.TOP,
                title: "Charts",
                tags: TOP_RANGES.map((range) => filterTag(FILTERS.TOP, range.id, range.title)),
            },
            {
                id: FILTERS.GENRE,
                title: "Genres",
                tags: GENRES.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.title)),
            },
            {
                id: FILTERS.GENRE_MODE,
                title: "Genre matching",
                tags: GENRE_MODE_OPTIONS.map((option) =>
                    filterTag(FILTERS.GENRE_MODE, option.id, option.title),
                ),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
        ];
    }

    /** The author filter is a name, so it gets a box rather than a tag. */
    override async getSearchFieldList(): Promise<SearchField[]> {
        return [{ id: AUTHOR_FIELD, name: "Author", placeholder: "Any author" }];
    }

    /** The catalogue takes an exclusion list of its own. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const included = groupTags(query.includedTags);

        // A chosen chart replaces the search query; it is the site's own
        // ranking for a window and takes no other filter.
        const range = included.get(FILTERS.TOP)?.[0];
        const url =
            range !== undefined
                ? `${baseUrl()}/top/${encodeURIComponent(range)}?page=${page}`
                : this.searchUrl(query, included, page);

        const html = await fetchHtml(url);

        return {
            items: toSearchResultItems(parseCards(html)),
            metadata: hasNextPage(html) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        const html = await fetchHtml(`${baseUrl()}/manga/${decodeSlugId(mangaId)}`);
        return parseMangaDetails(html, mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const numericId = /^\d+/.exec(decodeSlugId(sourceManga.mangaId))?.[0];
        if (numericId === undefined) {
            throw new Error(`Cannot work out a chapter list id from ${sourceManga.mangaId}.`);
        }

        // The trailing slash is required — without it the server answers with
        // the page shell instead of the chapter-list fragment.
        const html = await fetchHtml(`${baseUrl()}/service/backend/chaplist/?manga_id=${numericId}`);
        return parseChapterList(html, sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const slug = decodeSlugId(chapter.sourceManga.mangaId);
        const chapterSlug = decodeSlugId(chapter.chapterId);
        return parseChapterPages(await fetchHtml(`${baseUrl()}/manga/${slug}/${chapterSlug}`), chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private searchUrl(query: SearchQuery, included: Map<string, string[]>, page: number): string {
        const url = URL(baseUrl()).addPathComponent("search").setQueryItem("page", page);

        const term = (query.title ?? "").trim();
        if (term.length > 0) {
            url.setQueryItem("q", term);
        }

        url.setQueryItem("sort", included.get(FILTERS.SORT)?.[0]);
        url.setQueryItem("status", included.get(FILTERS.STATUS)?.[0]);

        const author = query.parameters[AUTHOR_FIELD];
        if (typeof author === "string" && author.trim().length > 0) {
            url.setQueryItem("author", author.trim());
        }

        const includedGenres = included.get(FILTERS.GENRE) ?? [];
        url.setQueryItem("include[]", includedGenres);
        url.setQueryItem("exclude[]", groupTags(query.excludedTags).get(FILTERS.GENRE) ?? []);

        if (includedGenres.length > 0) {
            url.setQueryItem("include_mode", included.get(FILTERS.GENRE_MODE)?.[0] ?? "and");
        }

        return url.build();
    }

    /**
     * The first page comes from the home page grid, whose embedded values
     * carry timestamps and ratings the listing page leaves out; deeper pages
     * come from the listing with the overlap filtered out.
     */
    private async getLatest(metadata: PageMetadata | undefined): Promise<PagedResults<DiscoverSectionItem>> {
        const page = metadata?.page ?? 1;

        if (page === 1) {
            const items = toLatestItems(parseCards(await this.getHomePage()));
            if (items.length > 0) {
                return { items, metadata: { page: 2, seen: items.map((item) => item.mangaId) } };
            }
        }

        const listingPage = Math.max(1, page - 1);
        const html = await fetchHtml(`${baseUrl()}/latest?page=${listingPage}`);
        const seen = new Set(metadata?.seen ?? []);

        return {
            items: toLatestItems(parseCards(html)).filter((item) => !seen.has(item.mangaId)),
            metadata: hasNextPage(html) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    private getHomePage(): Promise<string> {
        const base = baseUrl();

        // A mirror change invalidates the held page; it belongs to the old one.
        if (this.homePage?.base !== base) {
            this.homePage = undefined;
        }

        if (this.homePage === undefined) {
            const entry = { base, promise: fetchHtml(`${base}/home`) };
            entry.promise.catch(() => {
                if (this.homePage === entry) {
                    this.homePage = undefined;
                }
            });
            this.homePage = entry;
        }

        return this.homePage.promise;
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const query = (title ?? "").trim();
        if (!/^https?:\/\//i.test(query)) {
            return undefined;
        }

        const hosts = new Set(MIRROR_IDS.map((mirror) => mirror.replace(/^https?:\/\//, "")));
        const host = query.replace(/^https?:\/\/(?:www\.)?/i, "").split(/[/?#]/)[0] ?? "";
        if (!hosts.has(host)) {
            return undefined;
        }

        const slug = /\/manga\/([^/?#]+)/.exec(query)?.[1];
        if (slug === undefined) {
            return undefined;
        }

        try {
            const manga = await this.getMangaInfo(encodeSlugId(decodeSlugId(slug)));
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
        } catch {
            // A link to something that is not a series just falls through to
            // an ordinary search for the text.
            return undefined;
        }
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
