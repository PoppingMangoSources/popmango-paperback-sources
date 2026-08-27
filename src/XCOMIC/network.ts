/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Response } from "@paperback/types";

import {
    Application,
    CloudflareError,
    PaperbackInterceptor,
    headerValue,
    isCloudflareChallenge,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import {
    API_URL,
    BROWSE_QUERY,
    CHAPTERS_QUERY,
    CHAPTER_PAGES_QUERY,
    CHAPTER_PAGE_SIZE,
    COMIC_QUERY,
    DOMAIN,
    LATEST_UPLOADS_QUERY,
    PAGE_SIZE,
    RECENTLY_ADDED_QUERY,
    RECENTLY_ADDED_SIZE,
    type BrowseResponse,
    type BrowseSelect,
    type ChapterListResponse,
    type ChapterPagesResponse,
    type ComicNodeResponse,
    type GraphQLResponse,
    type LatestUploadsResponse,
    type RecentlyAddedResponse,
} from "./models";

export class XComicInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${DOMAIN}/`,
                origin: DOMAIN,
                "user-agent": await Application.getDefaultUserAgent(),
            },
        };
    }

    override async interceptResponse(
        request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        const contentType = headerValue(response.headers, "content-type") ?? "";
        const text = contentType.includes("text/html") ? body.text : "";

        if (isCloudflareChallenge(response.status, response.headers, text)) {
            throw new CloudflareError(
                Application.createRequest({
                    // The data endpoint cannot render the challenge, so it is
                    // sent to the site root where the reader can clear it.
                    url: request.url.startsWith(API_URL) ? `${DOMAIN}/` : request.url,
                    method: "GET",
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }

        return body;
    }
}

/** Runs one query against the site's API and unwraps its result. */
async function fetchGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const body = await Application.fetchText({
        url: API_URL,
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ query: query.trim(), variables }),
    });

    let parsed: GraphQLResponse<T>;
    try {
        parsed = JSON.parse(body) as GraphQLResponse<T>;
    } catch {
        throw new Error("The site's answer could not be read.");
    }

    if (parsed.errors !== null && parsed.errors !== undefined && parsed.errors.length > 0) {
        throw new Error(parsed.errors.map((error) => error.message ?? "Unknown error").join("\n"));
    }
    if (parsed.data === null || parsed.data === undefined) {
        throw new Error("The site returned an empty answer.");
    }

    return parsed.data;
}

export function fetchBrowse(select: BrowseSelect): Promise<BrowseResponse> {
    return fetchGraphQL<BrowseResponse>(BROWSE_QUERY, { select });
}

export function fetchLatestUploads(before?: number): Promise<LatestUploadsResponse> {
    return fetchGraphQL<LatestUploadsResponse>(LATEST_UPLOADS_QUERY, {
        select: { size: PAGE_SIZE, ...(before !== undefined ? { before } : {}) },
    });
}

export function fetchRecentlyAdded(): Promise<RecentlyAddedResponse> {
    return fetchGraphQL<RecentlyAddedResponse>(RECENTLY_ADDED_QUERY, {
        select: { size: RECENTLY_ADDED_SIZE },
    });
}

export function fetchComic(id: string): Promise<ComicNodeResponse> {
    return fetchGraphQL<ComicNodeResponse>(COMIC_QUERY, { id });
}

export function fetchChapters(comicId: string, page: number): Promise<ChapterListResponse> {
    return fetchGraphQL<ChapterListResponse>(CHAPTERS_QUERY, {
        select: { comic_id: comicId, page, size: CHAPTER_PAGE_SIZE, sortby: "chapter_desc" },
    });
}

export function fetchChapterPages(id: string): Promise<ChapterPagesResponse> {
    return fetchGraphQL<ChapterPagesResponse>(CHAPTER_PAGES_QUERY, { id });
}

/** The search page, which is where the site publishes its filter lists. */
export function fetchSearchPage(): Promise<string> {
    return Application.fetchText({
        url: `${DOMAIN}/search`,
        method: "GET",
        headers: { accept: "text/html,application/xhtml+xml" },
    });
}
