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
    selectRow,
    sourceInfo,
    type Chapter,
    type ChapterDetails,
    type DiscoverSection,
    type DiscoverSectionItem,
    type MenuSection,
    type PagedResults,
    type SearchQuery,
    type SearchResultItem,
    type SourceManga,
    type TagSection,
} from "../../common";

import {
    CONTENT_TYPE_OPTIONS,
    DEFAULT_SECTION_IDS,
    DOMAIN,
    FILTERS,
    GENRE_OPTIONS,
    MANHWA_TOP_SECTION_IDS,
    SECTION_IDS,
    SECTION_OPTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATE_KEYS,
    STATUS_OPTIONS,
    filterTag,
    getGenreTitle,
    splitFilterTag,
    type MangagoListing,
    type PageMetadata,
} from "./models";
import { MangagoInterceptor, fetchPage } from "./network";
import {
    hasNextPage,
    parseChapters,
    parseLatestUpdates,
    parseListings,
    parseMangaDetails,
} from "./parsers";
import { getPageUrls } from "./reader";
import { absoluteUrl, canonicalReaderUrl } from "./urls";

export const MangagoInfo = sourceInfo({
    name: "Mangago",
    description: "Extension that pulls comics from mangago.me.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [
        Capability.CHAPTERS,
        Capability.HOME_PAGE,
        Capability.CLOUDFLARE,
        Capability.SETTINGS,
    ],
});

export class Mangago extends PopmangoSource {
    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 3, bufferInterval: 1, ignoreImages: true },
            interceptor: new MangagoInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return absoluteUrl(mangaId);
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "sections",
                header: "Home page",
                footer: "Choose which rows appear. Leave everything unticked for the usual set.",
                rows: [
                    selectRow("visible_sections", {
                        label: "Rows shown",
                        options: SECTION_OPTIONS.map((section) => ({
                            id: section.id,
                            title: section.title,
                        })),
                        multiple: true,
                        get: () => this.visibleSections,
                        set: (value) => this.settings.set(STATE_KEYS.VISIBLE_SECTIONS, value),
                    }),
                ],
            },
            {
                id: "filters",
                header: "What to show",
                footer:
                    "Hidden genres are left out of the home page and of genre browsing. A title " +
                    "searched for by name is still found, because the site cannot filter that.",
                rows: [
                    selectRow("hidden_genres", {
                        label: "Hidden genres",
                        options: GENRE_OPTIONS,
                        multiple: true,
                        get: () => this.settings.stringArray(STATE_KEYS.HIDDEN_GENRES),
                        set: (value) => this.settings.set(STATE_KEYS.HIDDEN_GENRES, value),
                    }),
                    selectRow("content_type", {
                        label: "Type",
                        options: CONTENT_TYPE_OPTIONS,
                        multiple: false,
                        get: () => [this.contentType],
                        set: (value) => this.settings.set(STATE_KEYS.CONTENT_TYPE, value[0] ?? "all"),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const wanted = new Set(this.visibleSections);

        return SECTION_OPTIONS.filter((section) => wanted.has(section.id)).map((section) => ({
            id: section.id,
            title: section.title,
            type: section.type,
        }));
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const option = SECTION_OPTIONS.find((candidate) => candidate.id === section.id);
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        const { html } = await fetchPage(this.discoverUrl(section.id, page));

        const listings = (
            section.id === "new_chapters"
                ? this.filterByGenre(parseLatestUpdates(html))
                : parseListings(html)
        ).slice(0, option?.limit);

        return {
            items: listings.map((listing) => this.toItem(listing, section.type)),
            // Capped rows stop after one page; the rest follow the site's pager.
            metadata:
                option?.limit === undefined && hasNextPage(html)
                    ? ({ page: page + 1 } satisfies PageMetadata)
                    : undefined,
        };
    }

    /**
     * Offers the site's filters as tag sections.
     *
     * 0.8 has no sort control of its own, so the sort order is a section of
     * tags as well; picking more than one leaves the first in effect.
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
                tags: GENRE_OPTIONS.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.title)),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) =>
                    filterTag(FILTERS.STATUS, option.id, option.title),
                ),
            },
        ];
    }

    /** Browsing by genre takes a list of genres to leave out. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(
        query: SearchQuery,
        metadata: unknown,
    ): Promise<PagedResults<SearchResultItem>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const title = (query.title ?? "").trim();

        const pasted = await this.resolvePastedUrl(title);
        if (pasted !== undefined) {
            return { items: [pasted] };
        }

        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);

        // The site cannot combine a name with its genre filter, so the filters
        // only apply when nothing was typed.
        const url =
            title.length > 0
                ? URL(DOMAIN)
                      .addPathComponent("r")
                      .addPathComponent("l_search")
                      .setQueryItem("name", title)
                      .setQueryItem("page", page)
                      .build()
                : this.browseUrl({
                      included: (included.get(FILTERS.GENRE) ?? []).map(getGenreTitle),
                      excluded: (excluded.get(FILTERS.GENRE) ?? []).map(getGenreTitle),
                      statuses: included.get(FILTERS.STATUS) ?? [],
                      sort: sortValue(included.get(FILTERS.SORT)?.[0]),
                      page,
                  });

        const { html } = await fetchPage(url);

        return {
            items: parseListings(html),
            metadata: hasNextPage(html) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        const { html } = await fetchPage(absoluteUrl(mangaId));
        return parseMangaDetails(html, mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const { html } = await fetchPage(absoluteUrl(sourceManga.mangaId));
        return parseChapters(html, sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        // The id stands on its own, whether it is a path or a mirror's URL.
        const pages = await getPageUrls(canonicalReaderUrl(absoluteUrl(chapter.chapterId)));

        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private get visibleSections(): string[] {
        const stored = this.settings.stringArray(STATE_KEYS.VISIBLE_SECTIONS, new Set(SECTION_IDS));
        return stored.length > 0 ? stored : DEFAULT_SECTION_IDS;
    }

    private get contentType(): string {
        const stored = this.settings.string(STATE_KEYS.CONTENT_TYPE, "all");
        return CONTENT_TYPE_OPTIONS.some((option) => option.id === stored) ? stored : "all";
    }

    /** Genres the reader has hidden, plus the one the type setting implies. */
    private get hiddenGenres(): string[] {
        const hidden = this.settings
            .stringArray(STATE_KEYS.HIDDEN_GENRES)
            .map((id) => getGenreTitle(id));

        if (this.contentType === "manga") {
            hidden.push("Webtoons");
        }
        return hidden;
    }

    /**
     * Builds a browse URL, folding the reader's own settings in.
     *
     * The site matches a genre by its display name, comma-joined in the path
     * for the ones wanted and in a query item for the ones not. Both statuses
     * or neither means "any", so a status is only sent when the reader has
     * narrowed to one.
     */
    private browseUrl(options: {
        included: string[];
        excluded: string[];
        statuses: string[];
        sort: string;
        page: number;
    }): string {
        const included = [...options.included];
        if (this.contentType === "webtoons" && !included.includes("Webtoons")) {
            included.push("Webtoons");
        }

        // A genre cannot be both wanted and not — asking for it here is the
        // more specific instruction, so it wins over the hidden list.
        const excluded = [...new Set([...options.excluded, ...this.hiddenGenres])].filter(
            (genre) => !included.includes(genre),
        );

        const url = URL(DOMAIN)
            .addPathComponent("genre")
            .addPathComponent(
                included.length > 0 ? included.map(encodeURIComponent).join(",") : "all",
            )
            .addPathComponent(options.page);

        if (excluded.length > 0) {
            url.setQueryItem("e", excluded.join(","));
        }
        if (options.statuses.length === 1) {
            url.setQueryItem("f", options.statuses.includes("f") ? "1" : "0");
            url.setQueryItem("o", options.statuses.includes("o") ? "1" : "0");
        }
        if (options.sort.length > 0) {
            url.setQueryItem("sortby", options.sort);
        }

        return url.build();
    }

    private discoverUrl(sectionId: string, page: number): string {
        // Update times and genres are only on the latest list, not the grid.
        if (sectionId === "new_chapters") {
            return URL(DOMAIN)
                .addPathComponent("list")
                .addPathComponent("latest")
                .addPathComponent("all")
                .addPathComponent(page)
                .build();
        }

        const isTop = sectionId.startsWith("top_");
        const included: string[] = [];

        if (isTop) {
            included.push(getGenreTitle(sectionId.slice("top_".length)));
            if (MANHWA_TOP_SECTION_IDS.has(sectionId)) {
                included.push("Webtoons");
            }
        }

        return this.browseUrl({
            included,
            excluded: [],
            statuses: [],
            // The popular and genre rows rank by comments; the rest by views.
            sort: sectionId === "popular_manga" || isTop ? "comment_count" : "view",
            page,
        });
    }

    /**
     * Leaves out titles the reader does not want to see.
     *
     * The latest list takes no exclusions of its own, so the rows it hands
     * back are filtered here against the genres each one names.
     */
    private filterByGenre(items: MangagoListing[]): MangagoListing[] {
        const hidden = new Set(this.hiddenGenres.map((genre) => genre.toLowerCase()));
        const webtoonsOnly = this.contentType === "webtoons";

        if (hidden.size === 0 && !webtoonsOnly) {
            return items;
        }

        return items.filter((item) => {
            const genres = (item.genres ?? []).map((genre) => genre.trim().toLowerCase());

            if (genres.some((genre) => hidden.has(genre))) {
                return false;
            }
            return !webtoonsOnly || genres.includes("webtoons");
        });
    }

    /**
     * Turns a listing into a home page tile.
     *
     * 0.8 tiles carry no rating of their own — the source declares one for
     * everything it lists — so a genre-locked row cannot say it is tamer or
     * more explicit than the rest.
     */
    private toItem(listing: MangagoListing, type: DiscoverSectionType): DiscoverSectionItem {
        const base = {
            mangaId: listing.mangaId,
            title: listing.title,
            imageUrl: listing.imageUrl,
        };

        if (type === DiscoverSectionType.chapterUpdates && listing.chapterId !== undefined) {
            return {
                ...base,
                type: "chapterUpdatesCarouselItem",
                chapterId: listing.chapterId,
                subtitle: listing.subtitle,
                publishDate: listing.publishDate,
            };
        }

        return {
            ...base,
            type:
                type === DiscoverSectionType.featured
                    ? "featuredCarouselItem"
                    : type === DiscoverSectionType.prominentCarousel
                      ? "prominentCarouselItem"
                      : "simpleCarouselItem",
            subtitle: listing.subtitle,
        };
    }

    /**
     * Turns a pasted series link into the one result it names.
     *
     * 0.8 has no other way to open a title by address, and the site's own
     * search is poor at finding one by name, so a link is worth recognising.
     */
    private async resolvePastedUrl(title: string): Promise<SearchResultItem | undefined> {
        const match = /^https?:\/\/(?:www\.)?mangago\.(?:me|zone)(\/read-manga\/[^/?#]+\/?)$/i.exec(
            title,
        );
        const path = match?.[1];

        if (path === undefined) {
            return undefined;
        }

        try {
            const manga = await this.getMangaInfo(path.endsWith("/") ? path : `${path}/`);
            return {
                mangaId: manga.mangaId,
                title: manga.mangaInfo.primaryTitle,
                imageUrl: manga.mangaInfo.thumbnailUrl,
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

/** The value the site expects for a chosen sort order. */
function sortValue(id: string | undefined): string {
    return SORT_OPTIONS.find((option) => option.id === id)?.value ?? "";
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
