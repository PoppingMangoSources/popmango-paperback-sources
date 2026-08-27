/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Capability,
    ContentRating,
    DiscoverSectionType,
    PopmangoSource,
    URL,
    headerValue,
    inputRow,
    labelRow,
    normaliseUrlOverride,
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
    BASE_URL_KEY,
    DOMAIN,
    FILTERS,
    MANGA_DIR,
    NEXT_PAGE_SELECTOR,
    RANKING_RANGES,
    SECTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    USE_POST_IDS_KEY,
    filterTag,
    splitFilterTag,
    type PageMetadata,
    type SearchCard,
} from "./models";
import { RokariComicsInterceptor, fetchHead, fetchPage } from "./network";
import {
    cleanText,
    getImageSrc,
    idCleaner,
    parseChapterList,
    parseChapterPages,
    parseMangaDetails,
    parseRankingList,
    parseRelativeDate,
    parseSearchResults,
    parseTags,
    pathOf,
} from "./parsers";

export const RokariComicsInfo = sourceInfo({
    name: "Rokari Comics",
    description: "Extension that pulls content from rokaricomics.com.",
    version: "1.0.0",
    icon: "icon.png",
    language: "English",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.EVERYONE,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

export class RokariComics extends PopmangoSource {
    /** The home page, which every section reads from. */
    private homePage?: { base: string; promise: Promise<CheerioAPI> };

    /** The filter lists, which the directory carries as its own dropdowns. */
    private tags?: { base: string; promise: Promise<TagSection[]> };

    /** Slugs already resolved to post ids, so each is looked up once. */
    private readonly postIds = new Map<string, string>();

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 10, bufferInterval: 1, ignoreImages: true },
            interceptor: new RokariComicsInterceptor(() => this.baseUrl),
        });
    }

    /** The site's address, which a reader can point elsewhere if it moves. */
    private get baseUrl(): string {
        return this.settings.string(BASE_URL_KEY, DOMAIN);
    }

    /**
     * Whether series are addressed by their numeric post id.
     *
     * The site renames slugs from time to time, which breaks a saved library.
     * Post ids survive a rename, at the cost of a lookup per series.
     */
    private get usePostIds(): boolean {
        return this.settings.boolean(USE_POST_IDS_KEY, false);
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
                    `default (${DOMAIN}). An address that does not look like a website is ignored.`,
                rows: [
                    inputRow("base_url", {
                        label: "Address",
                        get: () => this.settings.string(BASE_URL_KEY, ""),
                        set: (value) => {
                            const normalised = normaliseUrlOverride(value);
                            if (normalised !== undefined) {
                                this.settings.set(BASE_URL_KEY, normalised);
                                this.homePage = undefined;
                                this.tags = undefined;
                                this.postIds.clear();
                            }
                        },
                    }),
                    labelRow("base_url_current", "Currently using", this.baseUrl),
                ],
            },
            {
                id: "ids",
                header: "Series ids",
                footer:
                    "The site renames series from time to time, which loses them from a saved " +
                    "library. Post ids survive a rename, at the cost of one extra lookup per series.",
                rows: [
                    switchRow("use_post_ids", {
                        label: "Use post ids",
                        get: () => this.usePostIds,
                        set: (value) => {
                            this.settings.set(USE_POST_IDS_KEY, value);
                            this.postIds.clear();
                        },
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        // 0.9 also showed a strip of links into the popular charts. 0.8 has no
        // tile that can hold a link, so they moved to the search filters.
        return [
            { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
            { id: SECTIONS.LATEST_UPDATES, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
            { id: SECTIONS.POPULAR, title: "Popular Today", type: DiscoverSectionType.prominentCarousel },
            { id: SECTIONS.RECOMMENDATION, title: "Recommendation", type: DiscoverSectionType.simpleCarousel },
        ];
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        const $ = await this.getHomePage();

        switch (section.id) {
            case SECTIONS.FEATURED:
                return { items: await this.parseFeatured($) };

            case SECTIONS.LATEST_UPDATES:
                return { items: await this.parseLatest($) };

            case SECTIONS.POPULAR:
                return { items: await this.parseStrip($, "div.popularslider div.bsx", "prominentCarouselItem") };

            case SECTIONS.RECOMMENDATION:
                return {
                    items: await this.parseStrip($, "div.series-gen div.listupd div.bsx", "simpleCarouselItem"),
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
                id: FILTERS.RANKING,
                title: "Popular charts",
                tags: RANKING_RANGES.map((range) => filterTag(FILTERS.RANKING, range.id, range.title)),
            },
            ...(await this.getTags()),
        ];
    }

    /** The directory takes exclusions in the same parameter as inclusions. */
    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const included = groupTags(query.includedTags);

        // A chosen chart replaces the directory query; it is a fixed-size list
        // read off the home page with no paging of its own.
        const range = included.get(FILTERS.RANKING)?.[0];
        if (range !== undefined) {
            const cards = parseRankingList(await this.getHomePage(), range);
            return { items: await this.toSearchResults(cards) };
        }

        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        // Curly quotes in a query return nothing, so they are dropped.
        const title = (query.title ?? "").replace(/[’–][a-z]*/g, "").trim();

        const sort = included.get(FILTERS.SORT)?.[0];
        const genres = [
            ...(included.get(FILTERS.GENRE) ?? []),
            ...(groupTags(query.excludedTags).get(FILTERS.GENRE) ?? []).map((id) => encodeURI(`-${id}`)),
        ];
        const status = included.get(FILTERS.STATUS)?.[0];
        const type = included.get(FILTERS.TYPE)?.[0];

        const hasFilters = genres.length > 0 || status !== undefined || type !== undefined || sort !== undefined;
        const url = URL(this.baseUrl);

        // A plain text search uses the site-wide search route; anything with a
        // filter on it has to go through the directory, which is where the
        // filters are understood.
        if (title.length > 0 && !hasFilters) {
            if (page > 1) {
                url.addPathComponent("page").addPathComponent(page);
            }
            url.setQueryItem("s", title);
        } else {
            url.addPathComponent(MANGA_DIR);
            if (page > 1) {
                url.setQueryItem("page", page);
            }
            url.setQueryItem("s", title);
        }

        url.setQueryItem("status", status?.replace(" ", "+"));
        url.setQueryItem("type", type?.replace(" ", "+"));
        url.setQueryItem("order", sort);
        url.setQueryItem("genre[]", genres);

        const $ = await fetchPage(url.build());

        return {
            items: await this.toSearchResults(parseSearchResults($)),
            metadata: $(NEXT_PAGE_SELECTOR).length > 0 ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await fetchPage(this.mangaUrl(mangaId)), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapterList(await fetchPage(this.mangaUrl(sourceManga.mangaId)), sourceManga);
    }

    /**
     * The chapter list holds the reader link, not the chapter itself, so the
     * series page is read again to turn a chapter number into a URL.
     */
    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const $ = await fetchPage(this.mangaUrl(chapter.sourceManga.mangaId));

        const row = $("div#chapterlist")
            .find("li")
            .toArray()
            .find((element) => $(element).attr("data-num") === chapter.chapterId);

        if (row === undefined) {
            throw new Error(`Chapter ${chapter.chapterId} is no longer listed.`);
        }

        const href = $("a", row).attr("href") ?? "";
        if (href.length === 0) {
            throw new Error(`No reader link was found for chapter ${chapter.chapterId}.`);
        }

        return parseChapterPages(await fetchPage(href), chapter);
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    private mangaUrl(mangaId: string): string {
        return this.usePostIds
            ? `${this.baseUrl}/?p=${mangaId}/`
            : `${this.baseUrl}/${MANGA_DIR}/${mangaId}/`;
    }

    /** The id to store for a card, which depends on the ids setting. */
    private async mangaIdFor(card: { slug: string; path: string; postId?: string }): Promise<string> {
        if (!this.usePostIds) {
            return card.slug;
        }
        if (card.postId !== undefined && !isNaN(Number(card.postId))) {
            return card.postId;
        }
        return this.slugToPostId(card.slug, card.path);
    }

    /**
     * Finds the numeric id behind a slug.
     *
     * WordPress advertises it in a Link header, so a HEAD request usually
     * settles it; the page itself carries it in several places when it does not.
     */
    private async slugToPostId(slug: string, path: string): Promise<string> {
        const cached = this.postIds.get(slug);
        if (cached !== undefined) {
            return cached;
        }

        const url = `${this.baseUrl}/${path}/${slug}/`;

        const fromHeader = headerValue((await fetchHead(url)).headers, "link")?.match(/\?p=(\d+)/)?.[1];
        if (fromHeader !== undefined) {
            this.postIds.set(slug, fromHeader);
            return fromHeader;
        }

        const $ = await fetchPage(url);

        let postId = Number($('link[rel="shortlink"]').attr("href")?.split("/?p=")[1]);
        if (isNaN(postId)) {
            postId = Number($("div.bookmark").attr("data-id"));
        }
        if (isNaN(postId)) {
            const match = /postID.*\D(\d+)/.exec($.root().html() ?? "");
            if (match?.[1] !== undefined) {
                postId = Number(match[1].trim());
            }
        }

        if (isNaN(postId) || postId === 0) {
            throw new Error(`No post id was found for ${slug}.`);
        }

        const value = postId.toString();
        this.postIds.set(slug, value);
        return value;
    }

    private async toSearchResults(cards: SearchCard[]): Promise<SearchResultItem[]> {
        const items: SearchResultItem[] = [];

        for (const card of cards) {
            if (card.title.length === 0) {
                continue;
            }
            items.push({
                mangaId: await this.mangaIdFor(card),
                title: card.title,
                imageUrl: card.imageUrl,
                subtitle: card.subtitle,
            });
        }

        return items;
    }

    private async parseFeatured($: CheerioAPI): Promise<DiscoverSectionItem[]> {
        const items: DiscoverSectionItem[] = [];

        for (const slide of $("div.slider-wrapper div.swiper-slide").toArray()) {
            const anchor = $("a", slide).first();
            const href = anchor.attr("href") ?? "";
            const title = cleanText($("span.name", slide).first().text());
            const imageUrl = getImageSrc($("img", slide));

            if (href.length === 0 || title.length === 0 || imageUrl.length === 0) {
                continue;
            }

            // The slide names the newest chapter somewhere, but not always in
            // the same element, so the text is searched as a last resort.
            const chapterLabel = (
                $("span.chapter, div.chapter, span.fivchap, span.epxs, div.epxs", slide).first().text() ||
                ($(slide)
                    .text()
                    .match(/(?:Chapter|Ch\.?)\s*[\d.]+/i)?.[0] ?? "")
            )
                .replace(/\s+/g, " ")
                .trim();

            items.push({
                type: "featuredCarouselItem",
                mangaId: await this.mangaIdFor({
                    slug: idCleaner(href),
                    path: pathOf(href),
                    postId: anchor.attr("rel"),
                }),
                imageUrl,
                title,
                subtitle: chapterLabel.length > 0 ? chapterLabel : undefined,
            });
        }

        return items;
    }

    private async parseLatest($: CheerioAPI): Promise<DiscoverSectionItem[]> {
        const items: DiscoverSectionItem[] = [];

        for (const element of $(".bixbox:has(h2:contains(Latest)) .bs .bsx").toArray()) {
            const anchor = $("a[href*='/manga/']", element).first();
            const href = anchor.attr("href") ?? "";
            const title = cleanText(anchor.attr("title") ?? $("div.tt a, div.tt", element).first().text());

            if (href.length === 0 || title.length === 0) {
                continue;
            }

            const chapterAnchor = $("ul.chfiv li a", element).first();
            const chapterLabel = $("span.fivchap", chapterAnchor).first().text().replace(/\s+/g, " ").trim();

            // The chapter's number is its id here, taken from the label if it
            // is there and from the link if it is not.
            const chapterId =
                /([\d.]+)\s*$/.exec(chapterLabel)?.[1] ??
                /chapter-(\d+(?:-\d+)?)\/?$/
                    .exec(chapterAnchor.attr("href") ?? "")?.[1]
                    ?.replace(/-/g, ".") ??
                "";

            if (chapterId.length === 0) {
                continue;
            }

            const time = $("span.fivtime", chapterAnchor).first();
            const isNew = time.hasClass("new-chapter");
            const rawTime = time.clone().children().remove().end().text().replace(/\s+/g, " ").trim();
            const ageText = isNew ? "NEW" : rawTime.length > 0 ? `${rawTime} ago` : "";

            items.push({
                type: "chapterUpdatesCarouselItem",
                mangaId: await this.mangaIdFor({
                    slug: idCleaner(href),
                    path: pathOf(href),
                    postId: anchor.attr("rel"),
                }),
                chapterId,
                imageUrl: getImageSrc($("img", element)),
                title,
                subtitle: ageText.length > 0 ? `${chapterLabel} · ${ageText}` : chapterLabel || undefined,
                publishDate: isNew ? new Date() : parseRelativeDate(rawTime),
            });
        }

        return items;
    }

    /** The plainer home page strips, which all share one shape. */
    private async parseStrip(
        $: CheerioAPI,
        selector: string,
        type: "simpleCarouselItem" | "prominentCarouselItem",
    ): Promise<DiscoverSectionItem[]> {
        const items: DiscoverSectionItem[] = [];

        for (const element of $(selector).toArray()) {
            const anchor = $("a", element).first();
            const href = anchor.attr("href") ?? "";
            const title = cleanText(anchor.attr("title") ?? $("div.tt", element).first().text());

            if (href.length === 0 || title.length === 0) {
                continue;
            }

            items.push({
                type,
                mangaId: await this.mangaIdFor({
                    slug: idCleaner(href),
                    path: pathOf(href),
                    postId: anchor.attr("rel"),
                }),
                imageUrl: getImageSrc($("img", element)),
                title,
                subtitle: cleanText($("div.epxs", element).first().text()).replace(/\s+/g, " ") || undefined,
            });
        }

        return items;
    }

    private getHomePage(): Promise<CheerioAPI> {
        const base = this.baseUrl;

        if (this.homePage?.base !== base) {
            this.homePage = undefined;
        }

        if (this.homePage === undefined) {
            const entry = { base, promise: fetchPage(base) };
            entry.promise.catch(() => {
                if (this.homePage === entry) {
                    this.homePage = undefined;
                }
            });
            this.homePage = entry;
        }

        return this.homePage.promise;
    }

    private getTags(): Promise<TagSection[]> {
        const base = this.baseUrl;

        if (this.tags?.base !== base) {
            this.tags = undefined;
        }

        if (this.tags === undefined) {
            const entry = {
                base,
                promise: fetchPage(`${base}/${MANGA_DIR}/`)
                    .then(($) =>
                        parseTags($)
                            .filter((section) => section.tags.length > 0)
                            .map((section) => ({
                                id: section.id,
                                title: TAG_SECTION_TITLES[section.id] ?? section.id,
                                tags: section.tags.map((tag) => filterTag(section.id, tag.id, tag.title)),
                            })),
                    )
                    .catch((error: unknown) => {
                        if (this.tags === entry) {
                            this.tags = undefined;
                        }
                        throw error;
                    }),
            };
            this.tags = entry;
        }

        return this.tags.promise;
    }
}

const TAG_SECTION_TITLES: Record<string, string> = {
    [FILTERS.GENRE]: "Genres",
    [FILTERS.STATUS]: "Status",
    [FILTERS.TYPE]: "Type",
};

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
