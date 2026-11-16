/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    CloudflareError,
    ContentRating,
    MangaStatus,
    PopmangoSource,
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
    COMPARE_OPTIONS,
    DOMAIN,
    FIELDS,
    FILTERS,
    GENRES,
    HOME_TITLES,
    MATCH_OPTIONS,
    RANKING_PERIODS,
    RELEASED_OPTIONS,
    SECTIONS,
    SECTION_LIST,
    SETTINGS_KEYS,
    SHOW_ADULT_KEY,
    SORT_OPTIONS,
    STARS_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    filterTag,
    splitFilterTag,
    type MangaListItem,
    type PageMetadata,
    type SearchRequest,
} from "./models";
import {
    MangaHereInterceptor,
    chapterUrl,
    fetchDocument,
    fetchPageScript,
    homeUrl,
    latestUrl,
    listingUrl,
    mangaUrl,
    mobileChapterUrl,
    mobileHomeUrl,
    rankingUrl,
    searchUrl,
    secureUrl,
} from "./network";
import {
    contentRatingForGenres,
    parseChapters,
    parseHasNextPage,
    parseHomeSection,
    parseMangaDetails,
    parseMangaId,
    parseMangaList,
    parseMobileChapterPages,
    parseMobileHomeSection,
    parseRankingList,
    parseReaderMetadata,
    toChapterUpdateItem,
    toDiscoverItem,
    toFeaturedItem,
    toRankingItem,
    toSearchResultItem,
    validateChapterPages,
} from "./parsers";
import { parsePageImage, unpack } from "./unpack";

export const MangaHereInfo = sourceInfo({
    name: "MangaHere",
    description: "Extension that pulls content from mangahere.cc.",
    // Takes over the MangaHere 3.0.5 another repository ships, whose manga
    // and chapter ids are the same, so installs update in place.
    version: "3.0.6",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.MATURE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

/** Front page sections, keyed by the heading they carry there. */
const HOME_SECTIONS: Partial<Record<string, string>> = {
    [SECTIONS.RECOMMENDED]: HOME_TITLES.RECOMMENDED,
    [SECTIONS.NEW]: HOME_TITLES.NEW,
    [SECTIONS.READING_NOW]: HOME_TITLES.READING_NOW,
    [SECTIONS.HOT]: HOME_TITLES.HOT,
};

export class MangaHere extends PopmangoSource {
    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            // Pages come from the image host; the site's own pages are asked
            // for more gently, as the 0.9 source does.
            rateLimit: { numberOfRequests: 6, bufferInterval: 1 },
            apiRateLimit: { numberOfRequests: 3, bufferInterval: 1 },
            interceptor: new MangaHereInterceptor(),
        });
    }

    /** The site serves its adult catalogue to everyone, so this starts on. */
    private get showAdult(): boolean {
        return this.settings.boolean(SHOW_ADULT_KEY, true);
    }

    override getMangaShareUrl(mangaId: string): string {
        return mangaUrl(mangaId);
    }

    override getSettingsSections(): MenuSection[] {
        return [
            {
                id: "content",
                footer: "Turn this off to hide titles rated adult across the source.",
                rows: [
                    switchRow("show_adult", {
                        label: "Show adult titles",
                        get: () => this.showAdult,
                        set: (value) => this.settings.set(SHOW_ADULT_KEY, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return SECTION_LIST;
    }

    async getDiscoverSectionItems(section: DiscoverSection, metadata: unknown): Promise<PagedResults<DiscoverSectionItem>> {
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;

        switch (section.id) {
            case SECTIONS.POPULAR:
                return this.listing(listingUrl(page, "po"), "ul.manga-list-1-list > li", page, toFeaturedItem);
            case SECTIONS.LATEST:
                return this.listing(latestUrl(page), "ul.manga-list-4-list > li", page, toChapterUpdateItem);
            case SECTIONS.TRENDING:
                return { items: this.visible(await this.trending()).map(toDiscoverItem) };
        }

        const heading = HOME_SECTIONS[section.id];
        if (heading === undefined) {
            return { items: [] };
        }
        // Every one of these is on the front page, which is fetched once for all of them.
        return { items: this.visible(parseHomeSection(await fetchDocument(homeUrl()), heading)).map(toDiscoverItem) };
    }

    /**
     * Offers the site's filters as tag sections.
     *
     * 0.8 has no separate sort or ranking control, so both are sections of
     * tags too; where only one choice makes sense, the first picked is used.
     */
    override async getFilterSections(): Promise<TagSection[]> {
        const section = (id: string, title: string, options: ReadonlyArray<{ id: string; title: string }>): TagSection => ({
            id,
            title,
            tags: options.map((option) => filterTag(id, option.id, option.title)),
        });

        return [
            section(FILTERS.SORT, "Sort by (browsing only)", SORT_OPTIONS),
            section(FILTERS.RANKING, "Ranking (ignores other filters)", RANKING_PERIODS),
            section(FILTERS.GENRE, "Genres", GENRES),
            section(FILTERS.TYPE, "Type", TYPE_OPTIONS),
            section(FILTERS.STATUS, "Status", STATUS_OPTIONS),
            section(FILTERS.STARS, "Rating", STARS_OPTIONS),
            section(FILTERS.STARS_MATCH, "Rating is", COMPARE_OPTIONS),
            section(FILTERS.NAME_MATCH, "Title match", MATCH_OPTIONS),
            section(FILTERS.AUTHOR_MATCH, "Author match", MATCH_OPTIONS),
            section(FILTERS.ARTIST_MATCH, "Artist match", MATCH_OPTIONS),
            section(FILTERS.RELEASED_MATCH, "Released", RELEASED_OPTIONS),
        ];
    }

    override async getSearchFieldList(): Promise<SearchField[]> {
        return [
            { id: FIELDS.AUTHOR, name: "Author", placeholder: "Oda Eiichiro" },
            { id: FIELDS.ARTIST, name: "Artist", placeholder: "Oda Eiichiro" },
            { id: FIELDS.RELEASED, name: "Year of release", placeholder: "2015" },
        ];
    }

    /** The search endpoint takes a list of genres to leave out. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        // A pasted series URL should open that series rather than search for it.
        const pasted = await this.resolvePastedUrl(query.title);
        if (pasted !== undefined) {
            return pasted;
        }

        const included = groupTags(query.includedTags);
        const first = (filter: string): string | undefined => included.get(filter)?.[0];

        const period = RANKING_PERIODS.find((option) => option.id === first(FILTERS.RANKING));
        if (period !== undefined) {
            const items = parseRankingList(await fetchDocument(rankingUrl(period.path)), period.className);
            return { items: this.visibleResults(items.map(toRankingItem)) };
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const title = (query.title ?? "").trim();
        const text = (field: string): string | undefined => {
            const value = query.parameters[field];
            return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
        };
        const author = text(FIELDS.AUTHOR);
        const artist = text(FIELDS.ARTIST);
        const released = text(FIELDS.RELEASED);
        const type = first(FILTERS.TYPE);
        const stars = first(FILTERS.STARS);
        const completion = first(FILTERS.STATUS);
        const nameMethod = first(FILTERS.NAME_MATCH);
        const includedGenres = included.get(FILTERS.GENRE) ?? [];
        // Only genres can be left out; an excluded sort or type means nothing.
        const excludedGenres = groupTags(query.excludedTags).get(FILTERS.GENRE) ?? [];

        // The directory covers browsing by one genre and is the only listing
        // that can be ordered; everything else goes to the search endpoint.
        const browsing =
            title.length === 0 &&
            author === undefined &&
            artist === undefined &&
            type === undefined &&
            released === undefined &&
            stars === undefined &&
            includedGenres.length <= 1 &&
            excludedGenres.length === 0;

        const fallbackRating = contentRatingForGenres(
            includedGenres.flatMap((id) => GENRES.find((genre) => genre.id === id)?.title ?? []),
        );

        if (browsing) {
            const sort = SORT_OPTIONS.find((option) => option.id === first(FILTERS.SORT)) ?? SORT_OPTIONS[0]!;
            const genre = GENRES.find((option) => option.id === includedGenres[0])?.slug;
            const status = STATUS_OPTIONS.find((option) => option.id === completion)?.path;
            const results = await this.listing(listingUrl(page, sort.id, genre, status), "ul.manga-list-1-list > li", page, (item) =>
                toSearchResultItem(item, fallbackRating),
            );
            return { ...results, items: this.visibleResults(results.items) };
        }

        // The site's plain title search ignores every other field, so any
        // filter switches to its advanced form, which takes the title as `name`.
        const advanced =
            nameMethod !== undefined ||
            author !== undefined ||
            artist !== undefined ||
            type !== undefined ||
            released !== undefined ||
            stars !== undefined ||
            completion !== undefined ||
            includedGenres.length > 0 ||
            excludedGenres.length > 0;

        const request: SearchRequest = {
            title: !advanced && title.length > 0 ? title : undefined,
            name: advanced && title.length > 0 ? title : undefined,
            nameMethod,
            author,
            authorMethod: first(FILTERS.AUTHOR_MATCH),
            artist,
            artistMethod: first(FILTERS.ARTIST_MATCH),
            type,
            includedGenres,
            excludedGenres,
            released,
            releasedMethod: first(FILTERS.RELEASED_MATCH),
            rating: stars,
            ratingMethod: first(FILTERS.STARS_MATCH),
            completion,
        };

        const results = await this.listing(searchUrl(page, request), "ul.manga-list-4-list > li", page, (item) =>
            toSearchResultItem(item, fallbackRating),
        );
        return { ...results, items: this.visibleResults(sortExactFirst(results.items, title)) };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchDocument(mangaUrl(mangaId)), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(await fetchDocument(mangaUrl(sourceManga.mangaId)), sourceManga);
    }

    /** Pages need only the ids, so a chapter opened after a restart skips the list. */
    protected override chapterFromIds(mangaId: string, chapterId: string): Chapter {
        return {
            chapterId,
            chapNum: 0,
            sourceManga: {
                mangaId,
                mangaInfo: {
                    primaryTitle: mangaId,
                    secondaryTitles: [],
                    thumbnailUrl: "",
                    synopsis: "",
                    status: MangaStatus.UNKNOWN,
                    contentRating: ContentRating.EVERYONE,
                },
            },
        };
    }

    /**
     * Collects a chapter's page images.
     *
     * The mobile roll reader lists a whole chapter in one page. Some titles
     * show a licence notice there instead, while the desktop reader still has
     * them; that one is asked for each page separately.
     */
    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const mangaId = chapter.sourceManga.mangaId;

        try {
            const pages = parseMobileChapterPages(await fetchDocument(mobileChapterUrl(mangaId, chapter.chapterId)));
            if (pages.length > 0) {
                return { id: chapter.chapterId, mangaId, pages };
            }
        } catch (error: unknown) {
            if (error instanceof CloudflareError) {
                throw error;
            }
        }

        return { id: chapter.chapterId, mangaId, pages: await this.desktopPages(mangaId, chapter.chapterId) };
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private async desktopPages(mangaId: string, chapterId: string): Promise<string[]> {
        const readerUrl = chapterUrl(mangaId, chapterId);
        const reader = parseReaderMetadata(await fetchDocument(readerUrl));
        if (reader === undefined) {
            throw new Error(`No pages were found for chapter ${chapterId} of ${mangaId}.`);
        }
        if (reader.embeddedPages !== undefined) {
            return validateChapterPages(reader.embeddedPages, reader.imageCount);
        }

        const pageImage = async (page: number): Promise<string> => {
            const key = reader.secretKey ?? "";
            let script = await fetchPageScript(readerUrl, reader.chapterId, page, key);
            // The site answers nothing when the key has gone stale, and answers
            // without one. Asking the same thing again would only get the
            // runtime's copy of the empty answer.
            if (script.trim().length === 0 && key.length > 0) {
                script = await fetchPageScript(readerUrl, reader.chapterId, page, "");
            }
            if (script.trim().length === 0) {
                throw new Error(`The reader did not answer for page ${page}.`);
            }
            return secureUrl(parsePageImage(unpack(script)));
        };

        // The request manager paces these; asking together just fills its queue.
        const pages = await Promise.all(Array.from({ length: reader.imageCount }, (_, index) => pageImage(index + 1)));
        return validateChapterPages(pages, reader.imageCount);
    }

    /** The trending list is only on the newer mobile site; the front page adds each title's newest chapter. */
    private async trending(): Promise<MangaListItem[]> {
        const [desktop, mobile] = await Promise.all([fetchDocument(homeUrl()), fetchDocument(mobileHomeUrl())]);
        const chapters = new Map(parseHomeSection(desktop, HOME_TITLES.TRENDING).map((item) => [item.mangaId, item]));

        return parseMobileHomeSection(mobile, HOME_TITLES.TRENDING).map((item) => {
            const known = chapters.get(item.mangaId);
            return known === undefined ? item : { ...item, chapter: known.chapter, rank: known.rank };
        });
    }

    private async listing<T>(
        url: string,
        selector: string,
        page: number,
        map: (item: MangaListItem) => T | undefined,
    ): Promise<PagedResults<T>> {
        const document = await fetchDocument(url);
        return {
            items: this.visible(parseMangaList(document, selector)).flatMap((item) => {
                const mapped = map(item);
                return mapped === undefined ? [] : [mapped];
            }),
            metadata: parseHasNextPage(document) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    /** Listing cards, less those rated adult when the reader has hidden them. */
    private visible(items: MangaListItem[]): MangaListItem[] {
        return this.showAdult
            ? items
            : items.filter((item) => contentRatingForGenres(item.genres) !== ContentRating.ADULT);
    }

    /** Search results, which may be rated from the genres searched for. */
    private visibleResults(items: SearchResultItem[]): SearchResultItem[] {
        return this.showAdult ? items : items.filter((item) => item.contentRating !== ContentRating.ADULT);
    }

    /** Turns a pasted series URL into a single result. */
    private async resolvePastedUrl(title: string | undefined): Promise<PagedResults<SearchResultItem> | undefined> {
        const query = (title ?? "").trim();
        if (!/^https?:\/\/(?:www\.|newm\.|m\.)?mangahere\.cc\/manga\/[^/?#]+\/?$/i.test(query)) {
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
        if (split !== undefined) {
            chosen.set(split.section, [...(chosen.get(split.section) ?? []), split.value]);
        }
    }
    return chosen;
}

/** Puts an exact title match first, which makes migrating from another source easier. */
function sortExactFirst(items: SearchResultItem[], title: string): SearchResultItem[] {
    const wanted = title.toLowerCase();
    if (wanted.length === 0) {
        return items;
    }
    const exact = items.filter((item) => item.title.toLowerCase() === wanted);
    return exact.length === 0 ? items : [...exact, ...items.filter((item) => item.title.toLowerCase() !== wanted)];
}
