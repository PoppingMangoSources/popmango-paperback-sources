/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Response } from "@paperback/types";

import {
    Application,
    CloudflareError,
    PaperbackInterceptor,
    URL,
    headerValue,
    isCloudflareChallenge,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import { NOVEL_TYPE, type BrowseRequest } from "./models";
import { baseUrl } from "./site";

/**
 * How long one challenge suppresses the next.
 *
 * The home page loads several sections at once, so a challenge would otherwise
 * raise one bypass prompt per request in flight. Only the first in a window
 * asks the reader to solve anything; the rest fail with a plain error.
 */
const CHALLENGE_PROMPT_INTERVAL = 60_000;

export class ValirScansInterceptor extends PaperbackInterceptor {
    private lastChallengeAt = 0;

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${baseUrl()}/`,
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
            const now = Date.now();
            if (now - this.lastChallengeAt < CHALLENGE_PROMPT_INTERVAL) {
                throw new Error("A Cloudflare challenge is already open. Solve it, then reload.");
            }
            this.lastChallengeAt = now;

            throw new CloudflareError(
                Application.createRequest({
                    url: request.url,
                    method: request.method,
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }

        return body;
    }
}

function fetchPage(url: string, rsc = false): Promise<string> {
    return Application.fetchText({ url, method: "GET", headers: rsc ? { rsc: "1" } : undefined });
}

export function fetchHomePage(): Promise<string> {
    return fetchPage(`${baseUrl()}/`);
}

export function fetchBrowsePage(request: BrowseRequest): Promise<string> {
    const url = URL(`${baseUrl()}/series`).setQueryItem("page", request.page);

    const query = (request.query ?? "").trim();
    if (query.length > 0) {
        url.setQueryItem("q", query);
    }
    if (request.sort !== undefined) {
        url.setQueryItem("sort", request.sort).setQueryItem("order", "desc");
    }

    url.setQueryItem("genre", request.includedGenres ?? []);
    url.setQueryItem("excludeGenre", request.excludedGenres ?? []);
    url.setQueryItem("tag", request.includedTags ?? []);
    url.setQueryItem("excludeTag", request.excludedTags ?? []);
    url.setQueryItem("type", request.types ?? []);
    url.setQueryItem("status", request.statuses ?? []);
    url.setQueryItem("origin", request.origins ?? []);

    // Novels are not carried here, so the listing is asked not to return them.
    url.setQueryItem("excludeType", NOVEL_TYPE);

    url.setQueryItem("minChapters", request.minChapters);
    url.setQueryItem("maxChapters", request.maxChapters);

    return fetchPage(url.build());
}

export function fetchSeriesPage(mangaId: string, page = 1): Promise<string> {
    return fetchPage(`${baseUrl()}/series/${mangaId}${page > 1 ? `?page=${page}` : ""}`);
}

// The reader route serves its data as a Next.js flight stream; the `rsc`
// header returns that stream directly instead of the full HTML shell.
export function fetchChapterPage(mangaId: string, chapterId: string): Promise<string> {
    return fetchPage(`${baseUrl()}/series/${mangaId}/chapter/${chapterId}`, true);
}

export function mangaUrl(mangaId: string): string {
    return `${baseUrl()}/series/${mangaId}`;
}
