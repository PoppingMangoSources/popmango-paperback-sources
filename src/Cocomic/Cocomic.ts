/* SPDX-License-Identifier: GPL-3.0-or-later */
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
    CocomicInterceptor,
    fetchBrowsePage,
    fetchChapterList,
    fetchHomePage,
    fetchLatestPage,
    fetchMangaPage,
    fetchReaderPage,
    fetchSearchPage,
} from "./network";
import {
    hasNextPage,
    parseChapterDetails,
    parseChapters,
    parseGenreTags,
    parseHomepageRail,
    parseMangaDetails,
    parseMangaId,
    parseMangaList,
    toChapterUpdateItem,
    toDiscoverItem,
    toSearchResultItem,
} from "./parsers";

export const CocomicInfo = sourceInfo({
    name: "Cocomic",
    description: "Extension that pulls content from cocomic.co.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE],
});

/** Rails on the home page, keyed by the heading they sit under. */
const RAILS: Record<string, string> = {
    [SECTIONS.ONLY_COCOMIC]: "Only Cocomic",
    [SECTIONS.NEW_RELEASES]: "New Releases",
    [SECTIONS.TODAYS_OFFICIAL]: "Today's Official",
    [SECTIONS.YAOI]: "Yaoi",
    [SECTIONS.MANHWA]: "Manhwa",
    [SECTIONS.SMUT]: "Smut",
};

export class Cocomic extends PopmangoSource {
    /** The home page, reused across the rails that all read from it. */
    private homePage?: Promise<CheerioAPI>;

    /** The genre list, which only changes when the site adds one. */
    private genres?: Promise<Tag[]>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            // The host throttles aggressively; one request every two seconds
            // keeps a long chapter list from being cut off part way through.
            rateLimit: { numberOfRequests: 1, bufferInterval: 2, ignoreImages: true },
            interceptor: new CocomicInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/manga/${mangaId}/`;
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            { id: SECTIONS.TOP_RATED, title: "Top Rated", type: DiscoverSectionType.featured },
            { id: SECTIONS.ONLY_COCOMIC, title: "Only Cocomic", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.NEW_RELEASES, title: "New Releases", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.LATEST_UPDATES, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
            { id: SECTIONS.TODAYS_OFFICIAL, title: "Today's Official", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.YAOI, title: "Yaoi", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.MANHWA, title: "Manhwa", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.SMUT, title: "Smut", type: DiscoverSectionType.simpleCarousel },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const rail = RAILS[section.id];
        if (rail !== undefined) {
            return { items: parseHomepageRail(await this.getHomePage(), rail).map(toDiscoverItem) };
        }

        switch (section.id) {
            case SECTIONS.TOP_RATED:
                return this.paged(metadata, (page) => fetchBrowsePage(page, "rating"), toDiscoverItem);

            case SECTIONS.LATEST_UPDATES:
                return this.paged(metadata, fetchLatestPage, toChapterUpdateItem);

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

    async getSearchResultItems(
        query: SearchQuery,
        metadata: unknown,
    ): Promise<PagedResults<SearchResultItem>> {
        // A pasted series URL should open that series rather than search for it.
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const request = this.toSearchRequest(query);
        return this.paged(metadata, (page) => fetchSearchPage(page, request), toSearchResultItem);
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(await fetchChapterList(sourceManga.mangaId), sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        return parseChapterDetails(
            await fetchReaderPage(chapter.sourceManga.mangaId, chapter.chapterId),
            chapter,
        );
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private getHomePage(): Promise<CheerioAPI> {
        return (this.homePage ??= fetchHomePage());
    }

    private getGenres(): Promise<Tag[]> {
        return (this.genres ??= fetchSearchPage(1, {}).then(parseGenreTags));
    }

    /**
     * Fetches one page of a listing and works out whether another follows.
     *
     * `map` may drop an entry by returning `undefined`, which is how the
     * chapter-update rail skips titles that have no chapter yet.
     */
    private async paged<T>(
        metadata: unknown,
        fetch: (page: number) => Promise<CheerioAPI>,
        map: (item: MangaListItem) => T | undefined,
    ): Promise<PagedResults<T>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const document = await fetch(page);

        const items = parseMangaList(document).flatMap((item) => {
            const mapped = map(item);
            return mapped === undefined ? [] : [mapped];
        });

        return {
            items,
            metadata: hasNextPage(document) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
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
        const url = (title ?? "").trim().match(/^https?:\/\/(?:www\.)?cocomic\.co\/manga\/[^/?#]+\/?$/i)?.[0];
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
