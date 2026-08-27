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
    DISCOVER_SECTIONS,
    DOMAIN,
    FILTERS,
    HIDDEN_GENRES_KEY,
    HIDDEN_TAGS_KEY,
    LANGUAGES,
    LANGUAGES_KEY,
    LISTING_PATHS,
    SECTIONS,
    SECTION_IDS,
    SECTION_OPTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    TAXONOMIES,
    VISIBLE_SECTIONS_KEY,
    filterTag,
    splitFilterTag,
    type FilterTaxonomies,
    type PageMetadata,
} from "./models";
import { MyReadingMangaInterceptor, fetchListingPage, fetchMangaPage, fetchSearchPage, mangaUrl } from "./network";
import {
    hasNextPage,
    parseChapters,
    parseFilterTaxonomies,
    parseListing,
    parseMangaDetails,
    parsePages,
} from "./parsers";

export const MyReadingMangaInfo = sourceInfo({
    name: "MyReadingManga",
    description: "Extension that pulls content from myreadingmanga.info.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class MyReadingManga extends PopmangoSource {
    /** The filter lists, which the search sidebar publishes. */
    private taxonomies?: Promise<FilterTaxonomies>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 1, bufferInterval: 1, ignoreImages: true },
            interceptor: new MyReadingMangaInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return mangaUrl(mangaId);
    }

    override async getSettingsSections(): Promise<MenuSection[]> {
        // The genre and tag lists are the site's own, so the settings screen
        // waits for them rather than offering lists that do not match.
        const taxonomies = await this.getTaxonomies().catch((error: unknown) => {
            // A challenge still has to reach the app so the reader can clear it.
            if (error instanceof CloudflareError) {
                throw error;
            }
            return {} as FilterTaxonomies;
        });

        const sections: MenuSection[] = [
            {
                id: "languages",
                header: "Languages",
                footer:
                    "Only entries in these languages appear on the home page. Leave everything " +
                    "unticked to show them all.",
                rows: [
                    selectRow("languages", {
                        label: "Languages shown",
                        options: LANGUAGES.map((language) => ({ id: language.class, title: language.name })),
                        multiple: true,
                        get: () => this.preferredLanguages,
                        set: (value) => this.settings.set(LANGUAGES_KEY, value),
                    }),
                ],
            },
            {
                id: "sections",
                header: "Home page",
                footer: "Choose which sections appear. Leave everything unticked to show them all.",
                rows: [
                    selectRow("visible_sections", {
                        label: "Sections shown",
                        options: SECTION_OPTIONS,
                        multiple: true,
                        get: () => this.visibleSections,
                        set: (value) => this.settings.set(VISIBLE_SECTIONS_KEY, value),
                    }),
                ],
            },
        ];

        const hidden: MenuSection = {
            id: "hidden",
            header: "Never show",
            footer: "An entry carrying any of these is left out of every list.",
            rows: [],
        };

        const genres = taxonomies.genre ?? [];
        if (genres.length > 0) {
            hidden.rows.push(
                selectRow("hidden_genres", {
                    label: "Hidden genres",
                    options: genres,
                    multiple: true,
                    get: () => this.settings.stringArray(HIDDEN_GENRES_KEY),
                    set: (value) => this.settings.set(HIDDEN_GENRES_KEY, value),
                }),
            );
        }

        const tags = taxonomies.tag ?? [];
        if (tags.length > 0) {
            hidden.rows.push(
                selectRow("hidden_tags", {
                    label: "Hidden tags",
                    options: tags,
                    multiple: true,
                    get: () => this.settings.stringArray(HIDDEN_TAGS_KEY),
                    set: (value) => this.settings.set(HIDDEN_TAGS_KEY, value),
                }),
            );
        }

        if (hidden.rows.length > 0) {
            sections.push(hidden);
        }

        return sections;
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const chosen = this.visibleSections;
        const wanted = chosen.length > 0 ? new Set(chosen) : undefined;

        // 0.9 also showed a strip of links into the genre list. 0.8 has no
        // tile that can hold a link, so the genres moved to the filters.
        return DISCOVER_SECTIONS.filter((section) => wanted === undefined || wanted.has(section.id));
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const path = LISTING_PATHS[section.id];
        if (path === undefined) {
            return { items: [] };
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const $ = await fetchListingPage(path, page);

        const cards = parseListing($, {
            languages: this.preferredLanguages,
            excludeClasses: this.hiddenClasses(),
        });

        const type = section.id === SECTIONS.POPULAR ? "featuredCarouselItem" : "simpleCarouselItem";

        return {
            items: cards.map((card) => ({
                type: type as "featuredCarouselItem" | "simpleCarouselItem",
                mangaId: card.mangaId,
                title: card.title,
                imageUrl: card.imageUrl,
            })),
            // Paged off the site's own next link: a page can filter down to
            // nothing and still be followed by pages that do not.
            metadata: hasNextPage($) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    /**
     * Offers the site's filters as tag sections.
     *
     * 0.8 has no separate sort control, so the sort order is a section of tags
     * as well; picking more than one leaves the first in effect.
     */
    override async getFilterSections(): Promise<TagSection[]> {
        const taxonomies = await this.getTaxonomies().catch(() => ({}) as FilterTaxonomies);

        const sections: TagSection[] = [
            {
                id: FILTERS.SORT,
                title: "Sort by",
                tags: SORT_OPTIONS.map((option) => filterTag(FILTERS.SORT, option.id, option.title)),
            },
            {
                id: FILTERS.LANGUAGE,
                title: "Language",
                tags: LANGUAGES.map((language) => filterTag(FILTERS.LANGUAGE, language.code, language.name)),
            },
        ];

        for (const taxonomy of TAXONOMIES) {
            const options = taxonomies[taxonomy.id] ?? [];
            if (options.length === 0) {
                continue;
            }
            sections.push({
                id: taxonomy.key,
                title: taxonomy.title,
                tags: options.map((option) => filterTag(taxonomy.key, option.id, option.title)),
            });
        }

        return sections;
    }

    /** The search takes inclusions only, so exclusions are applied here. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);

        const facets = new Map<string, string[]>();
        for (const taxonomy of TAXONOMIES) {
            const chosen = included.get(taxonomy.key);
            if (chosen !== undefined && chosen.length > 0) {
                facets.set(taxonomy.key, chosen);
            }
        }

        const $ = await fetchSearchPage({
            page,
            query: query.title ?? "",
            sort: included.get(FILTERS.SORT)?.[0],
            facets,
            language: included.get(FILTERS.LANGUAGE)?.[0],
        });

        // The site's facets only include, so an excluded term is dropped by
        // the class WordPress stamps on the card.
        const excludeClasses = this.hiddenClasses();
        for (const taxonomy of TAXONOMIES) {
            for (const slug of excluded.get(taxonomy.key) ?? []) {
                excludeClasses.push(`${taxonomy.classPrefix}-${slug}`);
            }
        }

        return {
            items: parseListing($, { excludeClasses }).map((card) => ({
                mangaId: card.mangaId,
                title: card.title,
                imageUrl: card.imageUrl,
                contentRating: ContentRating.ADULT,
            })),
            metadata: hasNextPage($) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(await fetchMangaPage(sourceManga.mangaId), sourceManga);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        // A chapter is one of the post's numbered pages, so its id is that number.
        const part = parseInt(chapter.chapterId, 10);
        if (isNaN(part) || part < 1) {
            throw new Error("Refresh the chapter list to reload the chapters.");
        }
        return parsePages(await fetchMangaPage(chapter.sourceManga.mangaId, part), chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private get preferredLanguages(): string[] {
        const chosen = this.settings.stringArray(
            LANGUAGES_KEY,
            new Set(LANGUAGES.map((language) => language.class)),
        );
        return chosen.length > 0 ? chosen : ["english"];
    }

    private get visibleSections(): string[] {
        return this.settings.stringArray(VISIBLE_SECTIONS_KEY, new Set(SECTION_IDS));
    }

    /** The reader's hidden genres and tags, as the classes a card carries. */
    private hiddenClasses(): string[] {
        return [
            ...this.settings.stringArray(HIDDEN_GENRES_KEY).map((slug) => `genre-${slug}`),
            ...this.settings.stringArray(HIDDEN_TAGS_KEY).map((slug) => `tag-${slug}`),
        ];
    }

    private getTaxonomies(): Promise<FilterTaxonomies> {
        this.taxonomies ??= fetchSearchPage({ page: 1, query: "", sort: "rand", facets: new Map() })
            .then(parseFilterTaxonomies)
            .catch((error: unknown) => {
                // Drop the failed attempt so the next open tries again.
                this.taxonomies = undefined;
                throw error;
            });
        return this.taxonomies;
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
