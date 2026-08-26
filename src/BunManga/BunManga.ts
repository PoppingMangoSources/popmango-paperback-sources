/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    ContentRating,
    DiscoverSectionType,
    PopmangoSource,
    sourceInfo,
    type Chapter,
    type ChapterDetails,
    type DiscoverSection,
    type DiscoverSectionItem,
    type PagedResults,
    type SearchQuery,
    type SearchResultItem,
    type SourceManga,
    type Tag,
    type TagSection,
} from "../../common";

import {
    ADULT_OPTIONS,
    DOMAIN,
    FILTERS,
    GENRE_MATCH_OPTIONS,
    PAGE_SIZE,
    SECTIONS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    filterTag,
    splitFilterTag,
    type MangaListItem,
    type PageMetadata,
    type SearchRequest,
} from "./models";
import {
    BunMangaInterceptor,
    buildSearchUrl,
    fetchChapterList,
    fetchHomePage,
    fetchLoadMorePage,
    fetchMangaPage,
    fetchReaderPage,
    fetchSearchPage,
} from "./network";
import {
    hasLoadMore,
    parseChapterDetails,
    parseChapters,
    parseGenreTags,
    parseLatestUpdates,
    parseLoadMoreQueryVars,
    parseMangaDetails,
    parseMangaId,
    parseMangaList,
    parsePopular,
    parseTopDaily,
    parseTotalResults,
    toChapterUpdateItem,
    toDiscoverItem,
    toSearchResultItem,
} from "./parsers";

export const BunMangaInfo = sourceInfo({
    name: "BunManga",
    description: "Extension that pulls content from bunmanga.com.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE],
});

/** Home page sections that are really a search under a fixed sort order. */
const SORTED_SECTIONS: Record<string, string> = {
    [SECTIONS.RELEVANCE]: "relevance",
    [SECTIONS.TOP_RATED]: "rating",
    [SECTIONS.TRENDING]: "trending",
};

export class BunManga extends PopmangoSource {
    /** The home page, reused across the widgets that all read from it. */
    private homePage?: Promise<CheerioAPI>;

    /** The genre list, which only changes when the site adds one. */
    private genres?: Promise<Tag[]>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            rateLimit: { numberOfRequests: 3, bufferInterval: 1, ignoreImages: true },
            interceptor: new BunMangaInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/manga/${mangaId}/`;
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
            { id: SECTIONS.TOP_DAILY, title: "Top Daily", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.LATEST_UPDATES, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
            { id: SECTIONS.RELEVANCE, title: "Relevance", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.TOP_RATED, title: "Top Rated", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.simpleCarousel },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const sortBy = SORTED_SECTIONS[section.id];
        if (sortBy !== undefined) {
            const page = await this.searchPage({ sortBy }, metadata);
            return { items: page.items.map(toDiscoverItem), metadata: page.metadata };
        }

        switch (section.id) {
            case SECTIONS.POPULAR:
                return { items: parsePopular(await this.getHomePage()).map(toDiscoverItem) };

            case SECTIONS.TOP_DAILY:
                return { items: parseTopDaily(await this.getHomePage()).map(toDiscoverItem) };

            case SECTIONS.LATEST_UPDATES:
                return {
                    items: parseLatestUpdates(await this.getHomePage()).flatMap((item) => {
                        const mapped = toChapterUpdateItem(item);
                        return mapped === undefined ? [] : [mapped];
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
        return [
            {
                id: FILTERS.SORT,
                title: "Sort by",
                tags: SORT_OPTIONS.map((option) => filterTag(FILTERS.SORT, option.id, option.title)),
            },
            {
                id: FILTERS.GENRE,
                title: "Genres",
                tags: (await this.getGenres()).map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.title)),
            },
            {
                id: FILTERS.GENRE_MATCH,
                title: "Genre matching",
                tags: GENRE_MATCH_OPTIONS.map((option) => filterTag(FILTERS.GENRE_MATCH, option.id, option.title)),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
            {
                id: FILTERS.ADULT,
                title: "Adult content",
                tags: ADULT_OPTIONS.map((option) => filterTag(FILTERS.ADULT, option.id, option.title)),
            },
        ];
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        // A pasted series URL should open that series rather than search for it.
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const page = await this.searchPage(this.toSearchRequest(query), metadata);
        return { items: page.items.map(toSearchResultItem), metadata: page.metadata };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(await fetchChapterList(sourceManga.mangaId), sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        return parseChapterDetails(await fetchReaderPage(chapter.sourceManga.mangaId, chapter.chapterId), chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private getHomePage(): Promise<CheerioAPI> {
        return (this.homePage ??= fetchHomePage());
    }

    private getGenres(): Promise<Tag[]> {
        return (this.genres ??= fetchSearchPage({ sortBy: "relevance" }).then(parseGenreTags));
    }

    /**
     * Fetches one page of a listing.
     *
     * The first page is an ordinary request; later ones go through the
     * load-more endpoint, replaying the query blob that page embedded. Without
     * that blob there is no way to ask for more, so the listing simply ends.
     */
    private async searchPage(request: SearchRequest, metadata: unknown): Promise<PagedResults<MangaListItem>> {
        const previous = metadata as PageMetadata | undefined;
        const page = previous?.page ?? 1;

        let document: CheerioAPI;
        if (page === 1) {
            document = await fetchSearchPage(request);
        } else if (previous?.queryVars !== undefined) {
            document = await fetchLoadMorePage(page - 1, previous.queryVars, buildSearchUrl(request));
        } else {
            return { items: [] };
        }

        const items = parseMangaList(document);
        const queryVars = previous?.queryVars ?? parseLoadMoreQueryVars(document);
        const total = previous?.total ?? parseTotalResults(document);

        // A reported total settles it outright; otherwise the first page is
        // trusted to say whether more exist, and later pages are assumed to
        // continue only while they come back full.
        const hasMore =
            queryVars !== undefined &&
            items.length > 0 &&
            (total !== undefined
                ? page * PAGE_SIZE < total
                : page === 1
                  ? hasLoadMore(document)
                  : items.length === PAGE_SIZE);

        return {
            items,
            metadata: hasMore ? ({ page: page + 1, queryVars, total } satisfies PageMetadata) : undefined,
        };
    }

    /** Turns the chosen filter tags into the site's own search parameters. */
    private toSearchRequest(query: SearchQuery): SearchRequest {
        const chosen = new Map<string, string[]>();

        for (const tag of query.includedTags) {
            const split = splitFilterTag(tag.id);
            if (split === undefined) {
                continue;
            }
            chosen.set(split.section, [...(chosen.get(split.section) ?? []), split.value]);
        }

        return {
            title: query.title,
            sortBy: chosen.get(FILTERS.SORT)?.[0] ?? SORT_OPTIONS[0]?.id,
            genres: chosen.get(FILTERS.GENRE),
            genreMatch: chosen.get(FILTERS.GENRE_MATCH)?.[0] === "and" ? "and" : "or",
            statuses: chosen.get(FILTERS.STATUS),
            adult: chosen.get(FILTERS.ADULT)?.[0],
        };
    }

    /**
     * Turns a pasted series URL into a single result.
     *
     * A Cloudflare challenge is allowed to propagate so the app can prompt for
     * a session; anything else means the URL simply is not a series here, and
     * the ordinary search should go ahead instead.
     */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const url = (title ?? "").trim().match(/^https?:\/\/(?:www\.)?bunmanga\.com\/manga\/[^/?#]+\/?$/i)?.[0];
        const mangaId = parseMangaId(url);

        if (mangaId.length === 0) {
            return undefined;
        }

        const manga = await this.getMangaInfo(mangaId);
        return {
            items: [
                {
                    mangaId,
                    title: manga.mangaInfo.primaryTitle,
                    imageUrl: manga.mangaInfo.thumbnailUrl,
                    contentRating: manga.mangaInfo.contentRating,
                },
            ],
        };
    }
}
