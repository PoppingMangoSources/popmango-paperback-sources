/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Application,
    Capability,
    ContentRating,
    DiscoverSectionType,
    PopmangoSource,
    inputRow,
    labelRow,
    normaliseUrlOverride,
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
    BASE_URL_KEY,
    DOMAIN,
    FILTERS,
    GENRES,
    HOME_TITLES,
    RANKED_GENRES,
    SECTIONS,
    SETTINGS_KEYS,
    filterTag,
    splitFilterTag,
    type PageMetadata,
} from "./models";
import { MangaBerriInterceptor, fetchHtml, genreUrl } from "./network";
import {
    parseCarouselSection,
    parseChapterList,
    parseLatestSection,
    parseListingCards,
    parseMangaDetails,
    parseReaderPages,
    toDiscoverItem,
    toLatestItem,
    toRankedItem,
    toSearchResultItem,
} from "./parsers";

export const MangaBerriInfo = sourceInfo({
    name: "MangaBerri",
    description: "Extension that pulls content from mangaberri.com.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.SETTINGS],
});

export class MangaBerri extends PopmangoSource {
    /** The home page, shared by the sections that all read from it. */
    private homePage?: Promise<CheerioAPI>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 5, bufferInterval: 2, ignoreImages: true },
            interceptor: new MangaBerriInterceptor(() => this.baseUrl),
        });
    }

    /** The site's address, which a reader can point elsewhere if it moves. */
    private get baseUrl(): string {
        return this.settings.string(BASE_URL_KEY, DOMAIN);
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${this.baseUrl}/${mangaId}`;
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "domain",
                header: "Website address",
                footer:
                    `Point the extension somewhere else if the site moves. Leave this empty for the ` +
                    `default (${DOMAIN}). An address that does not look like a website is ignored.`,
                rows: [
                    inputRow("base_url", {
                        label: "Address",
                        get: () => this.settings.string(BASE_URL_KEY, ""),
                        set: (value) => {
                            const normalised = normaliseUrlOverride(value);
                            if (normalised === undefined) {
                                return;
                            }
                            this.settings.set(BASE_URL_KEY, normalised);
                            this.homePage = undefined;
                        },
                    }),
                    labelRow("base_url_current", "Currently using", this.baseUrl),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            { id: SECTIONS.MOST_VIEWED, title: "Most Viewed", type: DiscoverSectionType.featured },
            { id: SECTIONS.WEEKLY, title: "Top Weekly", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.SHOUNEN, title: "Top Shounen", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.LATEST, title: "Latest Update", type: DiscoverSectionType.chapterUpdates },
            { id: SECTIONS.SEINEN, title: "Top Seinen", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.POPULAR_TODAY, title: "Popular Today", type: DiscoverSectionType.simpleCarousel },
            { id: SECTIONS.MANHWA_MANHUA, title: "Top Manhwa/Manhua", type: DiscoverSectionType.simpleCarousel },
        ];
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        switch (section.id) {
            case SECTIONS.MOST_VIEWED:
                return {
                    items: parseCarouselSection(await this.getHomePage(), this.baseUrl, HOME_TITLES.MOST_VIEWED).map(
                        toDiscoverItem,
                    ),
                };

            case SECTIONS.POPULAR_TODAY:
                return {
                    items: parseCarouselSection(await this.getHomePage(), this.baseUrl, HOME_TITLES.POPULAR_TODAY).map(
                        toDiscoverItem,
                    ),
                };

            case SECTIONS.LATEST:
                return {
                    items: parseLatestSection(await this.getHomePage(), this.baseUrl).flatMap((card) => {
                        const item = toLatestItem(card);
                        return item === undefined ? [] : [item];
                    }),
                };

            case SECTIONS.WEEKLY:
                return this.ranked(`${this.baseUrl}/weekly-manga.php`);

            case SECTIONS.SHOUNEN:
                return this.ranked(genreUrl(this.baseUrl, RANKED_GENRES.SHOUNEN));

            case SECTIONS.SEINEN:
                return this.ranked(genreUrl(this.baseUrl, RANKED_GENRES.SEINEN));

            case SECTIONS.MANHWA_MANHUA:
                return this.ranked(genreUrl(this.baseUrl, RANKED_GENRES.MANHWA_MANHUA));

            default:
                return { items: [] };
        }
    }

    /** The site browses one genre at a time, so genres are the only filter. */
    override async getFilterSections(): Promise<TagSection[]> {
        return [
            {
                id: FILTERS.GENRE,
                title: "Genre",
                tags: GENRES.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.value)),
            },
        ];
    }

    /**
     * Searches by keyword, or browses one genre when no keyword is given.
     *
     * The pagination markup is not consistent across these pages, so rather
     * than trusting a page parameter the listing ends once a page stops adding
     * anything new.
     */
    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const term = (query.title ?? "").trim();
        const genreId = groupTags(query.includedTags).get(FILTERS.GENRE)?.[0];

        const url =
            term.length > 0
                ? `${this.baseUrl}/search.php?keyword=${encodeURIComponent(term)}`
                : genreId !== undefined
                  ? genreUrl(this.baseUrl, genreName(genreId))
                  : `${this.baseUrl}/home.php`;

        const previous = metadata as PageMetadata | undefined;
        const page = previous?.page ?? 1;
        const seen = new Set(previous?.seen ?? []);

        const cards = parseListingCards(await fetchHtml(page > 1 ? `${url}&page=${page}` : url), this.baseUrl);
        const fresh = cards.filter((card) => !seen.has(card.slug));
        for (const card of fresh) {
            seen.add(card.slug);
        }

        return {
            items: fresh.map(toSearchResultItem),
            metadata: fresh.length > 0 ? ({ page: page + 1, seen: [...seen] } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchHtml(`${this.baseUrl}/${mangaId}`), this.baseUrl, mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapterList(await fetchHtml(`${this.baseUrl}/${sourceManga.mangaId}`), sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const html = await fetchHtml(`${this.baseUrl}/${chapter.sourceManga.mangaId}/${chapter.chapterId}`);
        return parseReaderPages(html, this.baseUrl, chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private async ranked(url: string): Promise<PagedResults<DiscoverSectionItem>> {
        return { items: parseListingCards(await fetchHtml(url), this.baseUrl).map(toRankedItem) };
    }

    private getHomePage(): Promise<CheerioAPI> {
        return (this.homePage ??= fetchHtml(`${this.baseUrl}/home.php`).then((html) =>
            Application.loadDocument(html),
        ));
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const host = this.baseUrl.replace(/^https?:\/\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const slug = new RegExp(`^https?://(?:www\\.)?${host}/([^/?#]+)/?$`, "i").exec((title ?? "").trim())?.[1];

        // The site's own pages live at the same depth as a series slug.
        if (slug === undefined || slug.endsWith(".php")) {
            return undefined;
        }

        const mangaId = decodeURIComponent(slug);
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

function genreName(id: string): string {
    return GENRES.find((genre) => genre.id === id)?.value ?? id;
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
