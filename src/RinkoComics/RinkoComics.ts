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
    URL,
    sourceInfo,
    switchRow,
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
    CHAPTER_SELECTOR,
    DOMAIN,
    FILTERS,
    HIDE_LOCKED_KEY,
    LOCK_SUFFIX,
    SECTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    filterTag,
    splitFilterTag,
    type Genre,
    type PageMetadata,
} from "./models";
import { RinkoComicsInterceptor, fetchMoreChaptersHtml, fetchPage } from "./network";
import {
    extractNonce,
    finaliseChapters,
    hasNextPage,
    parseChapterDetails,
    parseChapterElements,
    parseComicCards,
    parseGenres,
    parseMangaDetails,
    parsePath,
    safeDecode,
    toHotItems,
    toLatestItems,
    toPinnedItems,
} from "./parsers";

export const RinkoComicsInfo = sourceInfo({
    name: "RinkoComics",
    description: "Extension that pulls comics from rinkocomics.com.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.EVERYONE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class RinkoComics extends PopmangoSource {
    /** The home page, shared by the three sections that read from it. */
    private homePage?: Promise<CheerioAPI>;

    /** Genres, remembered from whichever listing page last carried them. */
    private genres: Genre[] = [];

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 4, bufferInterval: 1, ignoreImages: true },
            interceptor: new RinkoComicsInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/${safeDecode(mangaId).replace(/^\/+/, "")}`;
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "chapters",
                header: "Chapters",
                footer: "Locked chapters need a purchase on the website, and cannot be read in the app.",
                rows: [
                    switchRow("hide_locked", {
                        label: "Hide locked chapters",
                        get: () => this.settings.boolean(HIDE_LOCKED_KEY, false),
                        set: (value) => this.settings.set(HIDE_LOCKED_KEY, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            { id: SECTIONS.HOT, title: "Hot This Week", type: DiscoverSectionType.featured },
            { id: SECTIONS.PINNED, title: "Editor's Choice", type: DiscoverSectionType.prominentCarousel },
            { id: SECTIONS.LATEST, title: "Latest Releases", type: DiscoverSectionType.chapterUpdates },
        ];
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        const document = await this.getHomePage();

        switch (section.id) {
            case SECTIONS.HOT:
                return { items: toHotItems(document) };
            case SECTIONS.PINNED:
                return { items: toPinnedItems(document) };
            case SECTIONS.LATEST:
                return { items: toLatestItems(document) };
            default:
                return { items: [] };
        }
    }

    /**
     * Offers the site's filters as tag sections.
     *
     * The genre list is only published on a listing page, so until one has been
     * fetched this offers the sort orders alone.
     */
    override async getFilterSections(): Promise<TagSection[]> {
        if (this.genres.length === 0) {
            this.genres = parseGenres(await fetchPage(this.comicsUrl(1).build()));
        }

        const sections: TagSection[] = [
            {
                id: FILTERS.SORT,
                title: "Sort by",
                tags: SORT_OPTIONS.map((option) => filterTag(FILTERS.SORT, option.id, option.title)),
            },
        ];

        if (this.genres.length > 0) {
            sections.push({
                id: FILTERS.GENRE,
                title: "Genres",
                tags: this.genres.map((genre) => filterTag(FILTERS.GENRE, genre.slug, genre.name)),
            });
        }

        return sections;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const term = (query.title ?? "").trim();

        const pasted = await this.resolvePastedUrl(term);
        if (pasted !== undefined) {
            return pasted;
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const chosen = groupTags(query.includedTags);

        // Novels share the site but not this extension, so the search is
        // pinned to the comic post type.
        const url = this.comicsUrl(page).setQueryItem("post_type", "comic");

        if (term.length > 0) {
            url.setQueryItem("s", term);
        }

        const genres = chosen.get(FILTERS.GENRE);
        if (genres !== undefined && genres.length > 0) {
            url.setQueryItem("genres[]", genres);
        }

        const sort = chosen.get(FILTERS.SORT)?.[0];
        if (sort !== undefined) {
            url.setQueryItem("sort", sort);
        }

        const document = await fetchPage(url.build());

        // Listing pages carry the genre list, so remember it while we are here.
        const genreList = parseGenres(document);
        if (genreList.length > 0) {
            this.genres = genreList;
        }

        return {
            items: parseComicCards(document).map((card) => ({
                mangaId: card.mangaId,
                title: card.title,
                imageUrl: card.imageUrl,
                contentRating: ContentRating.EVERYONE,
            })),
            metadata: hasNextPage(document) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchPage(this.mangaUrl(mangaId)), mangaId);
    }

    /**
     * Collects every chapter.
     *
     * The detail page carries the first batch and the rest arrive from an
     * endpoint, one page at a time. Locked chapters are gathered along with the
     * rest so that a page made entirely of them does not look like the end of
     * the list; hiding them, if the reader asked for that, happens once at the
     * end.
     */
    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        const document = await fetchPage(this.mangaUrl(sourceManga.mangaId));

        const chapters = new Map<string, Chapter>();
        const addAll = (items: Chapter[]): void => {
            for (const chapter of items) {
                if (!chapters.has(chapter.chapterId)) {
                    chapters.set(chapter.chapterId, chapter);
                }
            }
        };

        addAll(parseChapterElements(document, document(CHAPTER_SELECTOR), sourceManga));

        const button = document("#loadMoreChaptersBtn").first();
        const comicId = (button.attr("data-comic-id") ?? "").trim();
        const nonce = extractNonce(document) ?? "";

        let offset = Number.parseInt(button.attr("data-offset") ?? "", 10);
        if (!Number.isFinite(offset) || offset <= 0 || offset > chapters.size) {
            offset = chapters.size;
        }

        if (comicId.length > 0 && nonce.length > 0) {
            for (;;) {
                const before = chapters.size;
                const html = await fetchMoreChaptersHtml(comicId, offset, nonce);

                if (html.length === 0) {
                    break;
                }

                const fragment = Application.loadDocument(html);
                const items = parseChapterElements(fragment, fragment(CHAPTER_SELECTOR), sourceManga);

                if (items.length === 0) {
                    break;
                }
                addAll(items);
                offset += items.length;

                // A page that adds nothing new means the end has been reached.
                if (chapters.size === before) {
                    break;
                }
            }
        }

        let list = [...chapters.values()];
        if (this.settings.boolean(HIDE_LOCKED_KEY, false)) {
            list = list.filter((chapter) => !chapter.chapterId.endsWith(LOCK_SUFFIX));
        }

        return finaliseChapters(list);
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        if (chapter.chapterId.endsWith(LOCK_SUFFIX)) {
            throw new Error("This chapter is locked and has to be bought on the website.");
        }

        const url = `${DOMAIN}/${safeDecode(chapter.chapterId).replace(/^\/+/, "")}`;
        return parseChapterDetails(await fetchPage(url), chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private getHomePage(): Promise<CheerioAPI> {
        return (this.homePage ??= fetchPage(`${DOMAIN}/`));
    }

    private comicsUrl(page: number) {
        const url = URL(DOMAIN).addPathComponent("comics");
        if (page > 1) {
            url.setQueryItem("paged", page);
        }
        return url;
    }

    private mangaUrl(mangaId: string): string {
        return `${DOMAIN}/${safeDecode(mangaId).replace(/^\/+/, "")}`;
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(query: string): Promise<PagedResults<SearchResultItem> | undefined> {
        if (!/^https?:\/\/(?:www\.)?rinkocomics\.com\//i.test(query)) {
            return undefined;
        }

        const mangaId = parsePath(query);
        // Novel pages live on the same site; this extension does not carry them.
        if (mangaId.length === 0 || safeDecode(mangaId).startsWith("novel/")) {
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
