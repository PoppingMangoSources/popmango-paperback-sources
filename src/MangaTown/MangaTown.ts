/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
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
    DEMOGRAPHICS,
    DOMAIN,
    FILTERS,
    GENRES,
    GENRE_TITLES,
    READER_CONCURRENCY,
    SECTIONS,
    SECTION_DEFINITIONS,
    SECTION_OPTIONS,
    SECTION_ORDER,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    SORT_TOKENS,
    STATUS_OPTIONS,
    VISIBLE_SECTIONS_KEY,
    filterTag,
    splitFilterTag,
    type MangaListItem,
    type PageMetadata,
    type SearchRequest,
    type SectionId,
} from "./models";
import {
    MangaTownInterceptor,
    chapterUrl,
    directoryUrl,
    fetchChapterPage,
    fetchFeaturedPage,
    fetchListingPage,
    fetchMangaPage,
    hotUrl,
    mangaUrl,
    searchUrl,
} from "./network";
import {
    buildSequentialImageUrls,
    parseChapterPageUrls,
    parseChapters,
    parseHasNextPage,
    parseMangaDetails,
    parseMangaId,
    parseMangaList,
    parseViewerImage,
    parseViewerImages,
    toChapterUpdateItem,
    toDiscoverItem,
    toSearchResultItem,
    toTopItem,
} from "./parsers";

export const MangaTownInfo = sourceInfo({
    name: "MangaTown",
    description: "Extension that pulls content from mangatown.com.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

/** Sections backed by the hot chart, keyed by the demographic they cover. */
const HOT_SECTIONS: Partial<Record<SectionId, string | undefined>> = {
    [SECTIONS.HOT]: undefined,
    [SECTIONS.TOP_SHOUNEN]: "shounen",
    [SECTIONS.TOP_SEINEN]: "seinen",
    [SECTIONS.TOP_SHOUJO]: "shoujo",
    [SECTIONS.TOP_YAOI]: "yaoi",
};

/** Sections backed by a slice of the directory. */
const DIRECTORY_SECTIONS: Partial<Record<SectionId, { demographic?: string; genre?: string; status?: string }>> = {
    [SECTIONS.LATEST]: {},
    [SECTIONS.NEW]: { status: "new" },
    [SECTIONS.ROMANCE]: { genre: "romance" },
    [SECTIONS.SHOUNEN]: { demographic: "shounen" },
    [SECTIONS.SEINEN]: { demographic: "seinen" },
    [SECTIONS.SHOUJO]: { demographic: "shoujo" },
    [SECTIONS.YAOI]: { demographic: "yaoi" },
    [SECTIONS.SHOUNEN_AI]: { demographic: "shounen_ai" },
    [SECTIONS.JOSEI]: { demographic: "josei" },
};

export class MangaTown extends PopmangoSource {
    /** Page images already resolved this session, keyed by manga and chapter. */
    private readonly readerCache = new Map<string, string[]>();

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 4, bufferInterval: 1, ignoreImages: true },
            interceptor: new MangaTownInterceptor(),
        });
    }

    override getMangaShareUrl(mangaId: string): string {
        return mangaUrl(mangaId);
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "sections",
                header: "Home page",
                footer: "Choose which sections appear. Leave everything unticked to show them all.",
                rows: [
                    selectRow("visible_sections", {
                        label: "Sections shown",
                        options: SECTION_OPTIONS,
                        multiple: true,
                        get: () => this.settings.stringArray(VISIBLE_SECTIONS_KEY, new Set(SECTION_ORDER)),
                        set: (value) => this.settings.set(VISIBLE_SECTIONS_KEY, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        const chosen = this.settings.stringArray(VISIBLE_SECTIONS_KEY, new Set(SECTION_ORDER));
        const wanted = chosen.length > 0 ? new Set(chosen) : undefined;

        return SECTION_ORDER.filter((id) => wanted === undefined || wanted.has(id)).map(
            (id) => SECTION_DEFINITIONS[id],
        );
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: unknown,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const id = section.id as SectionId;

        if (id === SECTIONS.FEATURED) {
            // The featured page is a single curated set with no pagination.
            return { items: parseMangaList(await fetchFeaturedPage()).map(toDiscoverItem) };
        }

        if (id in HOT_SECTIONS) {
            return this.listing(hotUrl(page, HOT_SECTIONS[id]), page, toTopItem);
        }

        const directory = DIRECTORY_SECTIONS[id];
        if (directory !== undefined) {
            const url = directoryUrl(page, { ...directory, sortToken: SORT_TOKENS.latest });
            return this.listing(url, page, id === SECTIONS.LATEST ? toChapterUpdateItem : toDiscoverItem);
        }

        return { items: [] };
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
                tags: GENRES.map((genre) => filterTag(FILTERS.GENRE, genre.id, genre.title)),
            },
            {
                id: FILTERS.DEMOGRAPHIC,
                title: "Demographic",
                tags: DEMOGRAPHICS.map((entry) => filterTag(FILTERS.DEMOGRAPHIC, entry.id, entry.title)),
            },
            {
                id: FILTERS.STATUS,
                title: "Status",
                tags: STATUS_OPTIONS.map((option) => filterTag(FILTERS.STATUS, option.id, option.title)),
            },
        ];
    }

    /** The search endpoint takes an explicit exclusion list of its own. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        // A pasted series URL should open that series rather than search for it.
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);

        const title = (query.title ?? "").trim();
        const genres = included.get(FILTERS.GENRE) ?? [];
        const excludedGenres = excluded.get(FILTERS.GENRE) ?? [];
        const demographic = included.get(FILTERS.DEMOGRAPHIC)?.[0];
        const status = included.get(FILTERS.STATUS)?.[0];

        // The directory covers every single-genre browse and is the only
        // listing with ordering controls; the search endpoint handles the rest.
        if (title.length === 0 && genres.length <= 1 && excludedGenres.length === 0) {
            const url = directoryUrl(page, {
                demographic,
                genre: genres[0],
                status,
                sortToken: SORT_TOKENS[included.get(FILTERS.SORT)?.[0] ?? SORT_OPTIONS[0]!.id],
            });
            return this.listing(url, page, toSearchResultItem);
        }

        const request: SearchRequest = {
            name: title.length > 0 ? title : undefined,
            // The search endpoint matches genres by name, not by slug.
            includedGenres: genres.map((slug) => GENRE_TITLES.get(slug) ?? slug),
            excludedGenres: excludedGenres.map((slug) => GENRE_TITLES.get(slug) ?? slug),
            demographic: demographic === undefined ? undefined : GENRE_TITLES.get(demographic),
            isCompleted: status === "completed" ? "1" : status === "ongoing" ? "0" : undefined,
        };

        return this.listing(searchUrl(page, request), page, toSearchResultItem);
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(await fetchMangaPage(sourceManga.mangaId), sourceManga);
    }

    /**
     * Collects a chapter's page images.
     *
     * A paged chapter shows one image per reader page, so the rest have to be
     * worked out; a long-strip chapter lists them all at once. The result is
     * kept for the session because rebuilding it is expensive.
     */
    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const mangaId = chapter.sourceManga.mangaId;
        const cacheKey = `${mangaId}/${chapter.chapterId}`;

        const cached = this.readerCache.get(cacheKey);
        if (cached !== undefined) {
            return { id: chapter.chapterId, mangaId, pages: cached };
        }

        const document = await fetchChapterPage(chapterUrl(mangaId, chapter.chapterId));
        const pageUrls = parseChapterPageUrls(document);

        const pages =
            pageUrls.length > 0 ? await this.readPagedChapter(document, pageUrls) : parseViewerImages(document);

        const valid = pages.filter((url) => url.length > 0);
        if (valid.length === 0) {
            throw new Error(`No pages were found for chapter ${chapter.chapterId} of ${mangaId}.`);
        }

        // Only a complete result is worth keeping; a partial one should be
        // retried when the chapter is reopened.
        if (valid.length === pages.length) {
            this.readerCache.set(cacheKey, valid);
        }

        return { id: chapter.chapterId, mangaId, pages: valid };
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private async listing<T>(
        url: string,
        page: number,
        map: (item: MangaListItem) => T | undefined,
    ): Promise<PagedResults<T>> {
        const document = await fetchListingPage(url);

        return {
            items: parseMangaList(document).flatMap((item) => {
                const mapped = map(item);
                return mapped === undefined ? [] : [mapped];
            }),
            metadata: parseHasNextPage(document) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    /**
     * Works out every page image of a paged chapter.
     *
     * Fetching one reader page per image is slow, and the images are almost
     * always consecutively numbered in one directory — so the set is derived
     * from the first image and spot-checked at a few positions. If any check
     * disagrees the guess is thrown away and the pages are fetched properly.
     */
    private async readPagedChapter(firstPage: CheerioAPI, pageUrls: string[]): Promise<string[]> {
        const firstImage = parseViewerImage(firstPage);
        if (pageUrls.length === 1) {
            return [firstImage];
        }

        const derived = firstImage.length > 0 ? buildSequentialImageUrls(firstImage, 1, pageUrls.length) : undefined;

        if (derived !== undefined) {
            const lastIndex = pageUrls.length - 1;
            const checkpoints = [...new Set([
                Math.floor(lastIndex / 4),
                Math.floor(lastIndex / 2),
                Math.floor((lastIndex * 3) / 4),
                lastIndex,
            ])].filter((index) => index > 0);

            const images = await Promise.all(checkpoints.map((index) => this.fetchPageImage(pageUrls[index]!)));

            // Hosts vary, so compare paths rather than whole URLs.
            const imagePath = (url: string): string => url.replace(/^https?:\/\/[^/]+/i, "");

            let matchedInterior = false;
            let lastImage = "";

            for (let position = 0; position < checkpoints.length; position += 1) {
                const index = checkpoints[position]!;
                const image = images[position];

                if (image === undefined || image.length === 0) {
                    continue;
                }
                if (index === lastIndex) {
                    lastImage = image;
                    continue;
                }
                if (imagePath(image) !== imagePath(derived[index]!)) {
                    return this.fetchPageImages(firstPage, pageUrls);
                }
                matchedInterior = true;
            }

            const lastMatches = lastImage.length > 0 && imagePath(lastImage) === imagePath(derived[lastIndex]!);
            if (matchedInterior || lastMatches) {
                // The final page sometimes breaks the pattern; use the real one.
                if (lastImage.length > 0) {
                    derived[lastIndex] = lastImage;
                }
                return derived;
            }
        }

        return this.fetchPageImages(firstPage, pageUrls);
    }

    /** Fetches one reader page and returns the image on it. */
    private async fetchPageImage(url: string): Promise<string> {
        try {
            return parseViewerImage(await fetchChapterPage(url));
        } catch {
            return "";
        }
    }

    /**
     * Fetches every reader page for its image.
     *
     * Run in small batches so a long chapter does not open dozens of
     * connections at once.
     */
    private async fetchPageImages(firstPage: CheerioAPI, pageUrls: string[]): Promise<string[]> {
        const images: string[] = [parseViewerImage(firstPage)];
        const remaining = pageUrls.slice(1);

        for (let start = 0; start < remaining.length; start += READER_CONCURRENCY) {
            const batch = remaining.slice(start, start + READER_CONCURRENCY);
            images.push(...(await Promise.all(batch.map((url) => this.fetchPageImage(url)))));
        }

        return images;
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const query = (title ?? "").trim();
        if (!/^https?:\/\/(?:www\.)?mangatown\.com\/manga\//i.test(query)) {
            return undefined;
        }

        const mangaId = parseMangaId(query);
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
