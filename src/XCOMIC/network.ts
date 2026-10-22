/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Response } from "@paperback/types";

import {
    Application,
    CloudflareError,
    PaperbackInterceptor,
    headerValue,
    originOf,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import {
    CHAPTERS_QUERY,
    CHAPTER_PAGES_QUERY,
    CHAPTER_PAGE_SIZE,
    COMIC_QUERY,
    HOME_ROW_SIZE,
    LATEST_UPLOADS_QUERY,
    MIRROR_IDS,
    RANDOM_AMOUNT,
    RECENTLY_ADDED_QUERY,
    TITLE_BROWSE_ITEMS_QUERY,
    TITLE_NODE_QUERY,
    TITLE_RANDOM_QUERY,
    type BrowseSelect,
    type ChapterListResponse,
    type ChapterPagesResponse,
    type ComicNodeResponse,
    type GraphQLResponse,
    type LatestUploadsResponse,
    type RecentlyAddedResponse,
    type TitleBrowseItemsResponse,
    type TitleBrowseResponse,
    type TitleNodeResponse,
    type TitleRandomResponse,
} from "./models";

/**
 * Statuses worth trying another mirror for.
 *
 * A 404 is not among them: every mirror serves the same catalogue, so a title
 * missing from one is missing from all.
 */
const RETRYABLE_STATUS = new Set([403, 408, 500, 502, 503, 504, 521, 522, 523, 524]);

/** What the client needs from the source's settings. */
export interface MirrorSettings {
    /** The mirror to try first: the last one that answered, else the chosen one. */
    baseUrl(): string;
    /** The mirror the reader picked. */
    selectedBaseUrl(): string;
    /** Remembers the mirror that just answered, so the next request starts there. */
    rememberWorkingMirror(origin: string): void;
    /** The languages the reader reads in, which the site keys some answers to. */
    translatedLanguages(): string[];
}

/** The mirror a URL points at, or nothing for any other host. */
function mirrorOrigin(url: string): string | undefined {
    const origin = originOf(url);
    return MIRROR_IDS.includes(origin) ? origin : undefined;
}

/**
 * The languages to ask for.
 *
 * "_t" is the site's own catch-all rather than a language, and the API writes
 * regional codes with an underscore where the header wants a hyphen.
 */
function acceptLanguage(languages: string[]): string {
    const tags = languages.filter((language) => language !== "_t").map((language) => language.replace(/_/g, "-"));
    return tags.join(",") || "en";
}

export class XComicInterceptor extends PaperbackInterceptor {
    constructor(private readonly settings: MirrorSettings) {
        super();
    }

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const origin = mirrorOrigin(request.url) ?? this.settings.baseUrl();

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${origin}/`,
                origin,
                "accept-language": acceptLanguage(this.settings.translatedLanguages()),
                "user-agent": await Application.getDefaultUserAgent(),
            },
        };
    }

    override async interceptResponse(
        request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        // Only an explicit challenge counts. A plain 403 from one mirror is a
        // reason to try the next, which a broader check would cut short.
        if (headerValue(response.headers, "cf-mitigated")?.toLowerCase() === "challenge") {
            const origin = mirrorOrigin(request.url) ?? this.settings.baseUrl();

            throw new CloudflareError(
                Application.createRequest({
                    // The data endpoint cannot render the challenge page, so the
                    // reader is sent to the site's front page to clear it.
                    url: /\/query\/(?:[?#]|$)/.test(request.url) ? `${origin}/` : request.url,
                    method: "GET",
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }

        return body;
    }
}

/** Talks to the site's API, moving to another mirror when one is down. */
export class XComicClient {
    constructor(private readonly settings: MirrorSettings) {}

    randomTitles(): Promise<TitleRandomResponse> {
        return this.query<TitleRandomResponse>(TITLE_RANDOM_QUERY, { select: { amount: RANDOM_AMOUNT } });
    }

    /**
     * One page of titles, and whether there is another.
     *
     * The site answers the second question with a query of its own and will
     * not take it alongside the items, so asking costs a request per page. A
     * full page stands in for it instead; at worst a list ending exactly on a
     * page boundary costs one empty request at the end.
     */
    async browse(select: BrowseSelect): Promise<TitleBrowseResponse> {
        const items = await this.query<TitleBrowseItemsResponse>(TITLE_BROWSE_ITEMS_QUERY, { select });
        const full = (items.get_title_browse_items?.length ?? 0) >= select.size;
        return { ...items, get_title_browse_pager: { next: full ? select.page + 1 : null } };
    }

    latestUploads(before?: number): Promise<LatestUploadsResponse> {
        return this.query<LatestUploadsResponse>(LATEST_UPLOADS_QUERY, {
            select: { first: 0, limit: HOME_ROW_SIZE, ...(before !== undefined ? { before } : {}) },
        });
    }

    recentlyAdded(before?: number): Promise<RecentlyAddedResponse> {
        return this.query<RecentlyAddedResponse>(RECENTLY_ADDED_QUERY, {
            select: { size: HOME_ROW_SIZE, ...(before !== undefined ? { before } : {}) },
        });
    }

    comic(id: string): Promise<ComicNodeResponse> {
        return this.query<ComicNodeResponse>(COMIC_QUERY, { id });
    }

    titleNode(id: string): Promise<TitleNodeResponse> {
        return this.query<TitleNodeResponse>(TITLE_NODE_QUERY, { id });
    }

    chapters(comicId: string, page: number): Promise<ChapterListResponse> {
        return this.query<ChapterListResponse>(CHAPTERS_QUERY, {
            select: { comic_id: comicId, page, size: CHAPTER_PAGE_SIZE, sortby: "chapter_desc" },
        });
    }

    chapterPages(id: string): Promise<ChapterPagesResponse> {
        return this.query<ChapterPagesResponse>(CHAPTER_PAGES_QUERY, { id });
    }

    /** Runs one query and unwraps its result. */
    private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
        const body = await this.post(JSON.stringify({ query: query.trim(), variables }));

        let parsed: GraphQLResponse<T>;
        try {
            parsed = JSON.parse(body) as GraphQLResponse<T>;
        } catch {
            throw new Error("XCOMIC's answer could not be read.");
        }

        if (parsed.errors !== null && parsed.errors !== undefined && parsed.errors.length > 0) {
            throw new Error(parsed.errors.map((error) => error.message ?? "Unknown error").join("\n"));
        }
        if (parsed.data === null || parsed.data === undefined) {
            throw new Error("XCOMIC returned an empty answer.");
        }

        return parsed.data;
    }

    /**
     * Sends a query, trying each mirror in turn until one answers.
     *
     * The order is the mirror that last worked, the one the reader chose, and
     * then the rest. A challenge is not a mirror being down — it has to reach
     * the app so the reader can clear it — so it ends the attempt at once.
     */
    private async post(body: string): Promise<string> {
        const origins = [this.settings.baseUrl(), this.settings.selectedBaseUrl(), ...MIRROR_IDS].filter(
            (origin, index, all) => origin.length > 0 && all.indexOf(origin) === index,
        );

        let lastError: unknown;

        for (let index = 0; index < origins.length; index += 1) {
            const origin = origins[index] ?? "";
            const url = `${origin}/query/`;
            const last = index === origins.length - 1;

            try {
                const [response, result] = await Application.scheduleRequest({
                    url,
                    method: "POST",
                    headers: { accept: "application/json", "content-type": "application/json" },
                    body,
                });

                if (response.status === 200) {
                    this.settings.rememberWorkingMirror(origin);
                    return result.text;
                }

                lastError = new Error(`XCOMIC answered ${response.status} on ${origin}.`);
                if (response.status === 404 || !RETRYABLE_STATUS.has(response.status) || last) {
                    break;
                }
            } catch (error: unknown) {
                if (error instanceof CloudflareError) {
                    throw error;
                }
                lastError = error;
                if (last) {
                    break;
                }
            }
        }

        throw lastError instanceof Error ? lastError : new Error("XCOMIC could not be reached on any mirror.");
    }
}
