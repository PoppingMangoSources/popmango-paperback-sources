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
    URL,
    inputRow,
    labelRow,
    normaliseUrlOverride,
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
    type TagSection,
} from "../../common";

import {
    AUTHOR_FIELD,
    BASE_URL_KEY,
    DEFAULT_DOMAIN,
    FILTERS,
    HOME_HEADINGS,
    IMAGE_MODES,
    IMAGE_MODE_DEFAULT,
    IMAGE_MODE_KEY,
    IMAGE_MODE_OPTIONS,
    MANGA_DIR,
    NEXT_PAGE_SELECTOR,
    POPULAR_RANGE_OPTIONS,
    SECTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    YEAR_FIELD,
    filterTag,
    splitFilterTag,
    type ImageMode,
    type OptionItem,
    type PageMetadata,
} from "./models";
import { KingOfShojoInterceptor, fetchPage } from "./network";
import {
    parseCards,
    parseChapterPages,
    parseChapters,
    parseGenreFilter,
    parseLatestUpdate,
    parseMangaDetails,
    parseMangaId,
    parsePopularSeries,
    parseWidgetCards,
    proxyImage,
} from "./parsers";

export const KingOfShojoInfo = sourceInfo({
    name: "King of Shojo",
    description: "Extension that pulls content from kingofshojo.com.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DEFAULT_DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class KingOfShojo extends PopmangoSource {
    /** The home page, which every section but the featured one reads from. */
    private homePage?: { base: string; promise: Promise<CheerioAPI> };

    /** The genre list, which the directory publishes as its own filter. */
    private genres?: { base: string; promise: Promise<OptionItem[]> };

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DEFAULT_DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 5, bufferInterval: 2, ignoreImages: true },
            interceptor: new KingOfShojoInterceptor(() => this.baseUrl),
        });
    }

    /** The site's address, which a reader can point elsewhere if it moves. */
    private get baseUrl(): string {
        return this.settings.string(BASE_URL_KEY, DEFAULT_DOMAIN);
    }

    private get imageMode(): ImageMode {
        return this.settings.choice(IMAGE_MODE_KEY, IMAGE_MODES, IMAGE_MODE_DEFAULT);
    }

    override getMangaShareUrl(mangaId: string): string {
        return this.mangaUrl(mangaId);
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "domain",
                header: "Website address",
                footer:
                    `Point the extension somewhere else if the site moves. Leave this empty for the ` +
                    `default (${DEFAULT_DOMAIN}). An address that does not look like a website is ignored.`,
                rows: [
                    inputRow("base_url", {
                        label: "Address",
                        get: () => this.settings.string(BASE_URL_KEY, ""),
                        set: (value) => {
                            const normalised = normaliseUrlOverride(value);
                            if (normalised !== undefined) {
                                this.settings.set(BASE_URL_KEY, normalised);
                                this.homePage = undefined;
                                this.genres = undefined;
                            }
                        },
                    }),
                    labelRow("base_url_current", "Currently using", this.baseUrl),
                ],
            },
            {
                id: "images",
                header: "Images",
                footer:
                    "Reader pages are served full size, at well over a megabyte each. The two " +
                    "compressed settings pass them through an image proxy so chapters open quickly; " +
                    "Original fetches them straight from the site, which can be slow.",
                rows: [
                    selectRow("image_mode", {
                        label: "Image loading",
                        options: IMAGE_MODE_OPTIONS,
                        get: () => [this.imageMode],
                        set: (value) => this.settings.set(IMAGE_MODE_KEY, value[0] ?? IMAGE_MODE_DEFAULT),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        // 0.9 also showed strips of links into the popular charts and the
        // genre list. 0.8 has no tile that can hold a link, so both moved to
        // the search filters.
        return [
            { id: SECTIONS.POPULAR_TODAY, title: "Popular Today", type: DiscoverSectionType.featured },
            { id: SECTIONS.RECOMMENDATION, title: "Recommendation", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.LATEST_UPDATE, title: "Latest Update", type: DiscoverSectionType.chapterUpdates },
        ];
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        const $ = await this.getHomePage();

        switch (section.id) {
            case SECTIONS.POPULAR_TODAY:
                return {
                    items: parseWidgetCards($, this.baseUrl, HOME_HEADINGS.POPULAR_TODAY).map((card) => ({
                        type: "featuredCarouselItem" as const,
                        mangaId: card.mangaId,
                        title: card.title,
                        imageUrl: card.imageUrl,
                        subtitle: card.rating !== undefined ? `★ ${card.rating}` : undefined,
                    })),
                };

            case SECTIONS.RECOMMENDATION:
                return {
                    items: parseWidgetCards($, this.baseUrl, HOME_HEADINGS.RECOMMENDATION).map((card) => ({
                        type: "simpleCarouselItem" as const,
                        mangaId: card.mangaId,
                        title: card.title,
                        imageUrl: card.imageUrl,
                        subtitle: card.subtitle,
                    })),
                };

            case SECTIONS.LATEST_UPDATE:
                return {
                    items: parseLatestUpdate($, this.baseUrl).flatMap((card) =>
                        card.chapterId === undefined
                            ? []
                            : [
                                  {
                                      type: "chapterUpdatesCarouselItem" as const,
                                      mangaId: card.mangaId,
                                      chapterId: card.chapterId,
                                      title: card.title,
                                      imageUrl: card.imageUrl,
                                      subtitle: card.chapterName,
                                      publishDate: card.publishDate,
                                  },
                              ],
                    ),
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
                id: FILTERS.POPULAR,
                title: "Popular charts",
                tags: POPULAR_RANGE_OPTIONS.map((range) => filterTag(FILTERS.POPULAR, range.id, range.title)),
            },
            {
                id: FILTERS.GENRE,
                title: "Genres",
                tags: (await this.getGenres()).map((genre) =>
                    filterTag(FILTERS.GENRE, genre.id, genre.value),
                ),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
            {
                id: FILTERS.TYPE,
                title: "Type",
                tags: TYPE_OPTIONS.map((option) => filterTag(FILTERS.TYPE, option.id, option.title)),
            },
        ];
    }

    /** The author and year filters are typed in rather than picked from a list. */
    override async getSearchFieldList(): Promise<SearchField[]> {
        return [
            { id: AUTHOR_FIELD, name: "Author", placeholder: "Any author" },
            { id: YEAR_FIELD, name: "Year", placeholder: "Any year" },
        ];
    }

    /** The directory takes exclusions in the same parameter as inclusions. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const title = (query.title ?? "").trim();
        const included = groupTags(query.includedTags);

        // A chosen chart replaces the directory query; it is a fixed-size list
        // read off the home page with no paging of its own.
        const range = included.get(FILTERS.POPULAR)?.[0];
        if (range !== undefined && title.length === 0) {
            return {
                items: parsePopularSeries(await this.getHomePage(), this.baseUrl, range).map((card) => ({
                    mangaId: card.mangaId,
                    title: card.title,
                    imageUrl: card.imageUrl,
                    subtitle: card.subtitle,
                    contentRating: card.isAdult === true ? ContentRating.ADULT : ContentRating.MATURE,
                })),
            };
        }

        const pasted = await this.resolvePastedUrl(title);
        if (pasted !== undefined) {
            return pasted;
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        const url = URL(this.baseUrl)
            .addPathComponent(`${MANGA_DIR}/`)
            .setQueryItem("title", title)
            .setQueryItem("page", page)
            .setQueryItem("order", included.get(FILTERS.SORT)?.[0])
            .setQueryItem("status", included.get(FILTERS.STATUS)?.[0])
            .setQueryItem("type", included.get(FILTERS.TYPE)?.[0]);

        const author = query.parameters[AUTHOR_FIELD];
        if (typeof author === "string" && author.trim().length > 0) {
            url.setQueryItem("author", author.trim());
        }

        const year = query.parameters[YEAR_FIELD];
        if (typeof year === "string" && year.trim().length > 0) {
            url.setQueryItem("yearx", year.trim());
        }

        // Genres share one parameter for both sides: an excluded genre is sent
        // as its slug prefixed with a minus.
        const genres = [
            ...(included.get(FILTERS.GENRE) ?? []),
            ...(groupTags(query.excludedTags).get(FILTERS.GENRE) ?? []).map((slug) => `-${slug}`),
        ];
        url.setQueryItem("genre[]", genres);

        const $ = await fetchPage(url.build());

        return {
            items: parseCards($, this.baseUrl).map((card) => ({
                mangaId: card.mangaId,
                title: card.title,
                imageUrl: card.imageUrl,
                subtitle: card.subtitle,
                contentRating: ContentRating.MATURE,
            })),
            metadata: $(NEXT_PAGE_SELECTOR).length > 0 ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        const $ = await fetchPage(this.mangaUrl(mangaId));
        return parseMangaDetails($, this.baseUrl, mangaId, ContentRating.MATURE);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(await fetchPage(this.mangaUrl(sourceManga.mangaId)), sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const url = withTrailingSlash(URL(this.baseUrl).addPathComponent(chapter.chapterId).build());
        const mode = this.imageMode;
        const pages = parseChapterPages(await fetchPage(url), this.baseUrl).map((page) =>
            proxyImage(page, mode),
        );

        if (pages.length === 0) {
            throw new Error(`No pages were found for chapter ${chapter.chapterId}.`);
        }

        return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private mangaUrl(mangaId: string): string {
        return withTrailingSlash(
            URL(this.baseUrl).addPathComponent(MANGA_DIR).addPathComponent(mangaId).build(),
        );
    }

    private getHomePage(): Promise<CheerioAPI> {
        const base = this.baseUrl;

        // A changed address invalidates the held page; it belongs to the old one.
        if (this.homePage?.base !== base) {
            this.homePage = undefined;
        }

        if (this.homePage === undefined) {
            const entry = { base, promise: fetchPage(`${base}/`) };
            entry.promise.catch(() => {
                if (this.homePage === entry) {
                    this.homePage = undefined;
                }
            });
            this.homePage = entry;
        }

        return this.homePage.promise;
    }

    private getGenres(): Promise<OptionItem[]> {
        const base = this.baseUrl;

        if (this.genres?.base !== base) {
            this.genres = undefined;
        }

        if (this.genres === undefined) {
            const entry = {
                base,
                promise: fetchPage(URL(base).addPathComponent(`${MANGA_DIR}/`).build()).then(
                    ($) => {
                        const options = parseGenreFilter($);
                        // An empty list means the page did not carry the filter;
                        // forget it so the next search tries again.
                        if (options.length === 0 && this.genres === entry) {
                            this.genres = undefined;
                        }
                        return options;
                    },
                    (error: unknown) => {
                        if (this.genres === entry) {
                            this.genres = undefined;
                        }
                        throw error;
                    },
                ),
            };
            this.genres = entry;
        }

        return this.genres.promise;
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(query: string): Promise<PagedResults<SearchResultItem> | undefined> {
        if (!/^https?:\/\//i.test(query)) {
            return undefined;
        }

        const host = /^https?:\/\/([^/]+)/i.exec(query)?.[1]?.toLowerCase();
        const baseHost = this.baseUrl.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase();

        if (host === undefined || host !== baseHost) {
            return undefined;
        }
        if (!new RegExp(`/${MANGA_DIR}/[^/?#]+`, "i").test(query)) {
            return undefined;
        }

        try {
            const manga = await this.getMangaInfo(parseMangaId(query));
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
            // A challenge has to reach the app, but a link to something that is
            // not a series just falls through to an ordinary search.
            if (error instanceof CloudflareError) {
                throw error;
            }
            return undefined;
        }
    }
}

function withTrailingSlash(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
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
