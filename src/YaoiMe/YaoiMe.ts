/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

import {
    Application,
    Capability,
    CloudflareError,
    ContentRating,
    PopmangoSource,
    inputRow,
    plainQuotes,
    selectRow,
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
    type Tag,
    type TagSection,
} from "../../common";

import {
    CONTENT_RATING_OPTIONS,
    DEFAULT_LANGUAGES,
    DEMOGRAPHIC_OPTIONS,
    DISCOVER_SECTIONS,
    DOMAIN,
    FIELDS,
    FILTERS,
    LANGUAGE_OPTIONS,
    OTHER_OPTIONS,
    SEAL_KEY,
    SECTION_IDS,
    SECTION_OPTIONS,
    SETTINGS_KEYS,
    SORT_OPTIONS,
    STATE_KEYS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    filterTag,
    splitFilterTag,
    type BrowseOptions,
    type PageMetadata,
    type Preferences,
    type ReaderPage,
    type SealKey,
} from "./models";
import { YaoiMeInterceptor, browseUrl, fetchHtml, userAgent } from "./network";
import {
    TAG_SECTION,
    decryptPageList,
    fromTagId,
    hasNextPage,
    parseBrowseCards,
    parseChapters,
    parseGenres,
    parseHomeCards,
    parseMangaDetails,
    parseMangaId,
    parseReaderPage,
    parseSealKey,
    toDiscoverItem,
    toPageUrls,
    toSearchResult,
} from "./parsers";

export const YaoiMeInfo = sourceInfo({
    name: "YaoiMe",
    description: "Extension that pulls boys' love manga, manhwa and manhua from yaoi.me.",
    version: "1.0.0",
    icon: "icon.png",
    language: "Multi",
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.ADULT,
    capabilities: [Capability.CHAPTERS, Capability.HOME_PAGE, Capability.CLOUDFLARE, Capability.SETTINGS],
});

const ITEM_TYPES: Record<string, DiscoverSectionItem["type"]> = {
    featured: "featuredCarouselItem",
    prominentCarousel: "prominentCarouselItem",
    simpleCarousel: "simpleCarouselItem",
    chapterUpdates: "chapterUpdatesCarouselItem",
};

export class YaoiMe extends PopmangoSource {
    private home?: Promise<CheerioAPI>;
    private genres?: Promise<Tag[]>;

    constructor(cheerio: CheerioAPI) {
        super(cheerio, {
            domain: DOMAIN,
            settingsKeys: SETTINGS_KEYS,
            rateLimit: { numberOfRequests: 5, bufferInterval: 2 },
            interceptor: new YaoiMeInterceptor(
                () => this.preferences,
                () => this.visibleSections,
            ),
        });
    }

    private get preferences(): Preferences {
        const languages = this.settings.stringArray(STATE_KEYS.CHAPTER_LANGUAGES);
        const ratings = this.settings.stringArray(STATE_KEYS.CONTENT_RATINGS);
        const types = this.settings.stringArray(STATE_KEYS.CONTENT_TYPES);
        return {
            chapterLanguages: languages.length > 0 ? languages : DEFAULT_LANGUAGES,
            contentRatings: ratings.length > 0 ? ratings : CONTENT_RATING_OPTIONS.map(({ id }) => id),
            contentTypes: types.length > 0 ? types : TYPE_OPTIONS.map(({ id }) => id),
            hiddenTags: names(this.settings.string(STATE_KEYS.HIDDEN_TAGS, "")),
            officialOnly: this.settings.boolean(STATE_KEYS.OFFICIAL_ONLY, false),
        };
    }

    private get visibleSections(): string[] {
        const chosen = this.settings.stringArray(STATE_KEYS.VISIBLE_SECTIONS, new Set<string>(SECTION_IDS));
        return chosen.length > 0 ? SECTION_IDS.filter((id) => chosen.includes(id)) : SECTION_IDS;
    }

    override getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}${mangaId}`;
    }

    override getSettingsSections(): MenuSection[] {
        const forget = (): void => {
            this.home = undefined;
        };
        return [
            {
                id: "content",
                header: "What to show",
                footer: "Ticking nothing means all of them, except languages, which default to English.",
                rows: [
                    selectRow("chapter_languages", {
                        label: "Chapter languages",
                        options: LANGUAGE_OPTIONS,
                        multiple: true,
                        get: () => this.settings.stringArray(STATE_KEYS.CHAPTER_LANGUAGES),
                        set: (value) => {
                            this.settings.set(STATE_KEYS.CHAPTER_LANGUAGES, value);
                            forget();
                        },
                    }),
                    selectRow("content_ratings", {
                        label: "Content ratings",
                        options: CONTENT_RATING_OPTIONS,
                        multiple: true,
                        get: () => this.settings.stringArray(STATE_KEYS.CONTENT_RATINGS),
                        set: (value) => {
                            this.settings.set(STATE_KEYS.CONTENT_RATINGS, value);
                            forget();
                        },
                    }),
                    selectRow("content_types", {
                        label: "Types",
                        options: TYPE_OPTIONS,
                        multiple: true,
                        get: () => this.settings.stringArray(STATE_KEYS.CONTENT_TYPES),
                        set: (value) => {
                            this.settings.set(STATE_KEYS.CONTENT_TYPES, value);
                            forget();
                        },
                    }),
                    inputRow("hidden_tags", {
                        label: "Hidden tags (comma separated)",
                        get: () => this.settings.string(STATE_KEYS.HIDDEN_TAGS, ""),
                        set: (value) => {
                            this.settings.set(STATE_KEYS.HIDDEN_TAGS, value);
                            forget();
                        },
                    }),
                    switchRow("official_only", {
                        label: "Official uploads only",
                        get: () => this.settings.boolean(STATE_KEYS.OFFICIAL_ONLY, false),
                        set: (value) => {
                            this.settings.set(STATE_KEYS.OFFICIAL_ONLY, value);
                            forget();
                        },
                    }),
                ],
            },
            {
                id: "chapters",
                header: "Chapters",
                footer: "Shows each chapter once, from its first upload, like the site's deduplicate option. Extras and unnumbered chapters are hidden.",
                rows: [
                    switchRow("dedupe_chapters", {
                        label: "One entry per chapter",
                        get: () => this.settings.boolean(STATE_KEYS.DEDUPE, false),
                        set: (value) => this.settings.set(STATE_KEYS.DEDUPE, value),
                    }),
                ],
            },
            {
                id: "home",
                header: "Home page",
                footer: "Leave everything unticked to show every row.",
                rows: [
                    selectRow("visible_sections", {
                        label: "Rows shown",
                        options: SECTION_OPTIONS,
                        multiple: true,
                        get: () => this.settings.stringArray(STATE_KEYS.VISIBLE_SECTIONS),
                        set: (value) => this.settings.set(STATE_KEYS.VISIBLE_SECTIONS, value),
                    }),
                ],
            },
        ];
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        // Fetched fresh on each home page load; the rows below share it
        this.home = undefined;
        const visible = new Set<string>(this.visibleSections);
        return DISCOVER_SECTIONS.filter((section) => visible.has(section.id));
    }

    async getDiscoverSectionItems(section: DiscoverSection): Promise<PagedResults<DiscoverSectionItem>> {
        const spec = DISCOVER_SECTIONS.find((entry) => entry.id === section.id);
        const itemType = spec !== undefined ? ITEM_TYPES[spec.type] : undefined;
        if (spec === undefined || itemType === undefined) {
            return { items: [] };
        }
        const $ = await (this.home ??= Application.fetchDocument({ url: `${DOMAIN}/`, method: "GET" }).catch((error: unknown) => {
            this.home = undefined;
            throw error;
        }));
        return {
            items: parseHomeCards($, spec.heading).flatMap((card) => {
                const item = toDiscoverItem(card, itemType);
                return item !== undefined ? [item] : [];
            }),
        };
    }

    // 0.8 has no sort or single-choice control, so sort is a tag section; the first pick wins.
    override async getFilterSections(): Promise<TagSection[]> {
        const genres = await this.getGenres().catch((error: unknown) => {
            if (error instanceof CloudflareError) {
                throw error;
            }
            return [] as Tag[];
        });
        const section = (id: string, title: string, options: Tag[]): TagSection => ({
            id,
            title,
            tags: options.map((option) => filterTag(id, option.id, option.title)),
        });
        return [
            section(FILTERS.SORT, "Sort by", SORT_OPTIONS),
            ...(genres.length > 0 ? [section(FILTERS.GENRE, "Genres", genres)] : []),
            section(FILTERS.TYPE, "Type", TYPE_OPTIONS),
            section(FILTERS.STATUS, "Status", STATUS_OPTIONS),
            section(FILTERS.RATING, "Content rating", CONTENT_RATING_OPTIONS),
            section(FILTERS.DEMOGRAPHIC, "Demographic", DEMOGRAPHIC_OPTIONS),
            section(FILTERS.LANGUAGE, "Chapter language", LANGUAGE_OPTIONS),
            section(FILTERS.OTHER, "Other", OTHER_OPTIONS),
        ];
    }

    override async getSearchFieldList(): Promise<SearchField[]> {
        return [
            { id: FIELDS.TAGS, name: "Tags", placeholder: "e.g. Office, -Omegaverse" },
            { id: FIELDS.AUTHOR, name: "Author", placeholder: "Name" },
            { id: FIELDS.ARTIST, name: "Artist", placeholder: "Name" },
            { id: FIELDS.PUBLISHER, name: "Publisher", placeholder: "Name" },
            { id: FIELDS.YEAR_FROM, name: "Year from", placeholder: "e.g. 2015" },
            { id: FIELDS.YEAR_TO, name: "Year to", placeholder: "e.g. 2024" },
            { id: FIELDS.MIN_CHAPTERS, name: "Fewest chapters", placeholder: "e.g. 10" },
            { id: FIELDS.MAX_CHAPTERS, name: "Most chapters", placeholder: "e.g. 100" },
            { id: FIELDS.MIN_PAGES, name: "Fewest pages", placeholder: "e.g. 20" },
            { id: FIELDS.MIN_RATING, name: "Lowest score (0-10)", placeholder: "e.g. 7" },
            { id: FIELDS.MAX_RATING, name: "Highest score (0-10)", placeholder: "e.g. 9" },
            { id: FIELDS.UPDATED_WITHIN, name: "Updated within (days)", placeholder: "e.g. 30" },
        ];
    }

    override async supportsTagExclusion(): Promise<boolean> {
        return true;
    }

    async getSearchResultItems(query: SearchQuery, metadata: unknown): Promise<PagedResults<SearchResultItem>> {
        const pasted = await this.resolvePastedLink(query.title ?? "");
        if (pasted !== undefined) {
            return pasted;
        }

        const included = groupTags(query.includedTags);
        const excluded = groupTags(query.excludedTags);
        const typed = names(field(query, FIELDS.TAGS));
        const preferences = this.preferences;
        const page = (metadata as PageMetadata | undefined)?.page ?? 1;
        const chosen = (section: string): string[] | undefined => {
            const values = included.get(section);
            return values !== undefined && values.length > 0 ? values : undefined;
        };

        const options: BrowseOptions = {
            page,
            query: query.title,
            sort: chosen(FILTERS.SORT)?.[0] ?? SORT_OPTIONS[0]!.id,
            genres: chosen(FILTERS.GENRE)?.map(fromTagId),
            withoutGenres: excluded.get(FILTERS.GENRE)?.map(fromTagId),
            tags: [...(included.get(TAG_SECTION) ?? []).map(fromTagId), ...typed.filter((name) => !name.startsWith("-"))],
            withoutTags: [
                ...(excluded.get(TAG_SECTION) ?? []).map(fromTagId),
                ...typed.filter((name) => name.startsWith("-")).map((name) => name.slice(1).trim()),
                ...preferences.hiddenTags,
            ],
            types: chosen(FILTERS.TYPE) ?? preferences.contentTypes,
            statuses: chosen(FILTERS.STATUS),
            ratings: chosen(FILTERS.RATING) ?? preferences.contentRatings,
            demographics: chosen(FILTERS.DEMOGRAPHIC),
            languages: chosen(FILTERS.LANGUAGE) ?? preferences.chapterLanguages,
            author: field(query, FIELDS.AUTHOR),
            artist: field(query, FIELDS.ARTIST),
            publisher: field(query, FIELDS.PUBLISHER),
            yearFrom: field(query, FIELDS.YEAR_FROM),
            yearTo: field(query, FIELDS.YEAR_TO),
            minChapters: field(query, FIELDS.MIN_CHAPTERS),
            maxChapters: field(query, FIELDS.MAX_CHAPTERS),
            minPages: field(query, FIELDS.MIN_PAGES),
            minRating: field(query, FIELDS.MIN_RATING),
            maxRating: field(query, FIELDS.MAX_RATING),
            updatedWithin: field(query, FIELDS.UPDATED_WITHIN),
            anime: included.get(FILTERS.OTHER)?.includes("anime"),
            licensed: included.get(FILTERS.OTHER)?.includes("licensed"),
        };

        const $ = await Application.fetchDocument({ url: browseUrl(options), method: "GET" });
        return {
            items: parseBrowseCards($).map(toSearchResult),
            metadata: hasNextPage($, page) ? ({ page: page + 1 } satisfies PageMetadata) : undefined,
        };
    }

    async getMangaInfo(mangaId: string): Promise<SourceManga> {
        return parseMangaDetails(await this.fetchSeries(mangaId), mangaId);
    }

    async getChapterList(sourceManga: SourceManga): Promise<Chapter[]> {
        return parseChapters(
            await this.fetchSeries(sourceManga.mangaId),
            sourceManga,
            this.preferences.chapterLanguages,
            this.settings.boolean(STATE_KEYS.DEDUPE, false),
        );
    }

    async getPages(chapter: Chapter): Promise<ChapterDetails> {
        const reader = parseReaderPage(await fetchHtml(`${DOMAIN}${chapter.chapterId}`));
        let hashes = reader.hashes;
        if (reader.sealed !== undefined) {
            try {
                hashes = decryptPageList(reader.sealed, this.keptSealKey(reader));
            } catch {
                // The key changed with a deploy, so it is read again from the reader's scripts
                const key = await this.readSealKey(reader);
                try {
                    hashes = decryptPageList(reader.sealed, key);
                } catch {
                    throw new Error("Yaoi.me changed how it protects the page list; this chapter cannot be read yet.");
                }
            }
        }
        if (hashes.length > 0) {
            return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages: toPageUrls(hashes) };
        }
        // The page list is withheld until the reader's human check is passed, which only a browser can do
        throw new CloudflareError(
            Application.createRequest({
                url: `${DOMAIN}${chapter.chapterId}`,
                method: "GET",
                headers: { "user-agent": await userAgent() },
            }),
        );
    }

    // The reader needs only the ids, so a chapter opened from history skips refetching the list.
    protected override chapterFromIds(mangaId: string, chapterId: string): Chapter {
        return { chapterId, chapNum: 0, sourceManga: { mangaId } as SourceManga };
    }

    private fetchSeries(mangaId: string): Promise<CheerioAPI> {
        return Application.fetchDocument({ url: `${DOMAIN}${mangaId}`, method: "GET" });
    }

    private getGenres(): Promise<Tag[]> {
        this.genres ??= Application.fetchDocument({ url: browseUrl({ page: 1, sort: SORT_OPTIONS[0]!.id }), method: "GET" })
            .then(parseGenres)
            .catch((error: unknown) => {
                this.genres = undefined;
                throw error;
            });
        return this.genres;
    }

    private keptSealKey(reader: ReaderPage): string {
        const stored = this.settings.get(STATE_KEYS.SEAL_KEY) as SealKey | undefined;
        return stored !== undefined && stored.build === reader.build ? stored.key : SEAL_KEY;
    }

    // Kept per site build, so the scripts are read once per deploy rather than per chapter.
    private async readSealKey(reader: ReaderPage): Promise<string> {
        for (const script of reader.scripts) {
            const key = parseSealKey(await fetchHtml(script));
            if (key !== undefined) {
                if (reader.build !== undefined) {
                    this.settings.set(STATE_KEYS.SEAL_KEY, { build: reader.build, key } satisfies SealKey);
                }
                return key;
            }
        }
        throw new Error("Yaoi.me's reader script no longer carries the page-list key.");
    }

    private async resolvePastedLink(title: string): Promise<PagedResults<SearchResultItem> | undefined> {
        const url = title.trim().match(/^https?:\/\/(?:www\.)?yaoi\.me\/series\/\d+\/[a-zA-Z0-9._~-]+\/?$/i)?.[0];
        const mangaId = url !== undefined ? parseMangaId(url) : "";
        if (!mangaId) {
            return undefined;
        }
        try {
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
        } catch (error: unknown) {
            // Surface challenges; otherwise fall back to a normal text search
            if (error instanceof CloudflareError) {
                throw error;
            }
            return undefined;
        }
    }
}

function names(text: string | undefined): string[] {
    return plainQuotes(text ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
}

function field(query: SearchQuery, id: string): string | undefined {
    const value = query.parameters[id];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function groupTags(tags: Array<{ id: string }>): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const tag of tags) {
        const split = splitFilterTag(tag.id);
        if (split !== undefined) {
            grouped.set(split.section, [...(grouped.get(split.section) ?? []), split.value]);
        }
    }
    return grouped;
}
