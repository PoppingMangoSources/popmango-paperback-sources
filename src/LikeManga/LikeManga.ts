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
    DOMAIN,
    FILTERS,
    MIN_CHAPTER_OPTIONS,
    SECTIONS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TOP_SERIES_SORT,
    filterTag,
    splitFilterTag,
    type MangaListItem,
    type PageMetadata,
    type SearchRequest,
} from "./models";
import {
    LikeMangaInterceptor,
    fetchAdvancedSearchPage,
    fetchChapterListPage,
    fetchContentPage,
    fetchHomePage,
    fetchHotPage,
    fetchSearchPage,
} from "./network";
import {
    encodePathId,
    hasNextPage,
    parseChapterPageInfo,
    parseChapterPages,
    parseChapters,
    parseGenreTags,
    parseMangaDetails,
    parseMangaList,
    parseNewManga,
    toFollowedItem,
    toHotItem,
    toLatestReleaseItem,
    toNewMangaItem,
    toSearchResultItem,
} from "./parsers";

export const LikeMangaInfo = sourceInfo({
    name: "LikeManga",
    description: "Extension that pulls content from likemanga.ink.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE],
});

export class LikeManga extends PopmangoSource {
    /** The home page, reused across the rails that all read from it. */
    private homePage?: Promise<CheerioAPI>;

    /** The genre list, which only changes when the site adds one. */
    private genres?: Promise<Tag[]>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            rateLimit: { numberOfRequests: 3, bufferInterval: 1, ignoreImages: true },
            interceptor: new LikeMangaInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/${decodeURIComponent(mangaId)}`;
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            { id: SECTIONS.MOST_FOLLOWED, title: "Most Followed", type: DiscoverSectionType.featured },
            { id: SECTIONS.NEW_MANGA, title: "New Manga", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.LATEST_RELEASES, title: "Latest Releases", type: DiscoverSectionType.chapterUpdates },
            // 0.9 let the reader switch this rail between day, week and month.
            // 0.8 sections carry no controls, so it shows the monthly chart and
            // the other windows stay reachable through the sort filter.
            { id: SECTIONS.TOP_SERIES, title: "Top Series This Month", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.HOT, title: "Hot", type: DiscoverSectionType.prominentCarousel },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        switch (section.id) {
            case SECTIONS.MOST_FOLLOWED:
                // A featured tile looks bare without a synopsis to show.
                return this.listingSection("follow", metadata, (item) =>
                    item.description === undefined ? undefined : toFollowedItem(item),
                );

            case SECTIONS.TOP_SERIES:
                return this.listingSection(TOP_SERIES_SORT, metadata, toFollowedItem);

            case SECTIONS.NEW_MANGA:
                return { items: parseNewManga(await this.getHomePage()).map(toNewMangaItem) };

            case SECTIONS.LATEST_RELEASES:
                return {
                    items: parseMangaList(await this.getHomePage()).flatMap((item) => {
                        const mapped = toLatestReleaseItem(item);
                        return mapped === undefined ? [] : [mapped];
                    }),
                };

            case SECTIONS.HOT: {
                const page = (metadata as PageMetadata | undefined)?.page ?? 1;
                const document = await fetchHotPage(page);
                return {
                    items: parseMangaList(document).map(toHotItem),
                    metadata: hasNextPage(document) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
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
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
            {
                id: FILTERS.MIN_CHAPTERS,
                title: "Minimum chapters",
                tags: MIN_CHAPTER_OPTIONS.map((option) => filterTag(FILTERS.MIN_CHAPTERS, option.id, option.title)),
            },
        ];
    }

    /** The site can narrow to one status, and exclusions are applied locally. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        // A pasted series URL should open that series rather than search for it.
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const included = this.chosenTags(query.includedTags);
        const excluded = this.chosenTags(query.excludedTags);
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        const includedStatuses = excluded.get(FILTERS.STATUS) ?? [];
        const request: SearchRequest = {
            page,
            keyword: query.title,
            sortBy: included.get(FILTERS.SORT)?.[0] ?? SORT_OPTIONS[0]?.id,
            // The site accepts only one status, so a single choice is pushed
            // to the server and anything more is settled locally below.
            status:
                (included.get(FILTERS.STATUS) ?? []).length === 1 && includedStatuses.length === 0
                    ? included.get(FILTERS.STATUS)?.[0]
                    : undefined,
            genres: included.get(FILTERS.GENRE),
            minChapters: included.get(FILTERS.MIN_CHAPTERS)?.[0],
        };

        const document = await fetchSearchPage(request);
        const items = parseMangaList(document).filter((item) => this.matchesFilters(item, included, excluded));

        return {
            items: items.map(toSearchResultItem),
            metadata: hasNextPage(document) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchContentPage(mangaId), mangaId);
    }

    /**
     * Collects every chapter.
     *
     * The details page carries the first page of the list and says how many
     * follow; the rest are fetched together rather than one after another.
     */
    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const document = await fetchContentPage(sourceManga.mangaId);
        const pageInfo = parseChapterPageInfo(document);
        const numericId = pageInfo.mangaNumericId;

        const fragments =
            numericId !== undefined && pageInfo.lastPage > 1
                ? await Promise.all(
                      Array.from({ length: pageInfo.lastPage - 1 }, (_, index) =>
                          fetchChapterListPage(numericId, index + 2),
                      ),
                  )
                : [];

        return parseChapters(document, fragments, sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        return parseChapterPages(await fetchContentPage(chapter.chapterId), chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private getHomePage(): Promise<CheerioAPI> {
        return (this.homePage ??= fetchHomePage());
    }

    private getGenres(): Promise<Tag[]> {
        return (this.genres ??= fetchAdvancedSearchPage().then(parseGenreTags));
    }

    private async listingSection(
        sortBy: string,
        metadata: unknown,
        map: (item: MangaListItem) => DiscoverSectionItem | undefined,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const document = await fetchSearchPage({ page, sortBy });

        return {
            items: parseMangaList(document).flatMap((item) => {
                const mapped = map(item);
                return mapped === undefined ? [] : [mapped];
            }),
            metadata: hasNextPage(document) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    /** Groups chosen tags by the filter section they came from. */
    private chosenTags(tags: Array<{ id: string }>): Map<string, string[]> {
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

    /**
     * Applies the filters the site cannot express itself.
     *
     * It accepts one status and treats multiple genres as "any of", so
     * "all of" and every exclusion are settled here instead.
     */
    private matchesFilters(
        item: MangaListItem,
        included: Map<string, string[]>,
        excluded: Map<string, string[]>,
    ): boolean {
        const genres = new Set(item.genres.map(normaliseFilterValue));
        const includedGenres = included.get(FILTERS.GENRE) ?? [];
        const excludedGenres = excluded.get(FILTERS.GENRE) ?? [];

        // A card with no genres listed is kept; the tooltip simply had none.
        if (genres.size > 0 && includedGenres.some((genre) => !genres.has(normaliseFilterValue(genre)))) {
            return false;
        }
        if (excludedGenres.some((genre) => genres.has(normaliseFilterValue(genre)))) {
            return false;
        }

        if (item.status === undefined) {
            return true;
        }

        const status = statusFilterId(item.status);
        const includedStatuses = included.get(FILTERS.STATUS) ?? [];
        const excludedStatuses = excluded.get(FILTERS.STATUS) ?? [];

        if (includedStatuses.length > 0 && !includedStatuses.includes(status)) {
            return false;
        }
        return !excludedStatuses.includes(status);
    }

    /**
     * Turns a pasted series URL into a single result.
     *
     * A Cloudflare challenge is allowed to propagate so the app can prompt for
     * a session; anything else means the URL simply is not a series here, and
     * the ordinary search should go ahead instead.
     */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const path = (title ?? "").trim().match(/^https?:\/\/(?:www\.)?likemanga\.ink\/([^/?#]+-\d+)\/?$/i)?.[1];
        if (path === undefined) {
            return undefined;
        }

        const mangaId = encodePathId(path);
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

/** Genres are compared loosely, since casing and spacing vary across pages. */
function normaliseFilterValue(value: string): string {
    return value
        .replace(/%20/gi, " ")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-");
}

/** Maps a card's status wording onto the id the filter uses. */
function statusFilterId(status: string): string {
    const normalised = status.toLowerCase();

    if (normalised.includes("complete")) {
        return "Complete";
    }
    if (normalised.includes("pause") || normalised.includes("hiatus")) {
        return "Pause";
    }
    return "In process";
}
