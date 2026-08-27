/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Response } from "@paperback/types";

import {
    Application,
    CloudflareError,
    PaperbackInterceptor,
    headerValue,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import { PAGE_SIZE, type SearchRequest } from "./models";

const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif|bmp)([?#]|$)/i;

/** One lookup for the whole session rather than one per request. */
let userAgent: Promise<string> | undefined;

function getUserAgent(): Promise<string> {
    return (userAgent ??= Application.getDefaultUserAgent());
}

export class ReiMangaInterceptor extends PaperbackInterceptor {
    private readonly getBaseUrl: () => string;

    constructor(getBaseUrl: () => string) {
        super();
        this.getBaseUrl = getBaseUrl;
    }

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${this.getBaseUrl()}/`,
                "user-agent": await getUserAgent(),
                "accept-language": "en-US,en;q=0.5",
                accept: isImage
                    ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
                    : (request.headers.accept ?? "*/*"),
            },
            cookies: {
                ...request.cookies,
                // Without this the catalogue quietly drops adult entries, so a
                // search that should match comes back empty rather than gated.
                showAdultContent: "true",
            },
        };
    }

    override async interceptResponse(
        request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        if (headerValue(response.headers, "cf-mitigated") === "challenge") {
            throw new CloudflareError(
                Application.createRequest({
                    url: request.url,
                    method: request.method,
                    headers: { "user-agent": await getUserAgent() },
                }),
            );
        }
        return body;
    }
}

export function fetchJson<T>(url: string): Promise<T> {
    return Application.fetchJSON<T>({ url, headers: { accept: "application/json" } });
}

/**
 * Fetches a route's server payload.
 *
 * Chapter lists and reader pages live only in that payload, and this header
 * asks for it instead of the rendered page.
 */
export function fetchFlight(url: string): Promise<string> {
    return Application.fetchText({ url, headers: { rsc: "1", accept: "text/x-component,*/*" } });
}

export function buildSearchUrl(baseUrl: string, request: SearchRequest): string {
    const params: string[] = [`page=${request.page}`, `limit=${PAGE_SIZE}`];

    if (request.term !== undefined && request.term.length > 0) {
        params.push(`search=${encodeURIComponent(request.term)}`);
    }
    if (request.sortBy !== undefined) {
        params.push(`sort=${encodeURIComponent(request.sortBy)}`);
        // Title is the one order the site reads ascending.
        params.push(`order=${request.sortBy === "title" ? "asc" : "desc"}`);
    }
    if (request.status !== undefined) {
        params.push(`status=${encodeURIComponent(request.status)}`);
    }
    if (request.includedGenres !== undefined && request.includedGenres.length > 0) {
        params.push(`genre=${encodeURIComponent(request.includedGenres.join(","))}`);
    }
    if (request.excludedGenres !== undefined && request.excludedGenres.length > 0) {
        params.push(`excludeGenres=${encodeURIComponent(request.excludedGenres.join(","))}`);
    }

    return `${baseUrl}/api/manga?${params.join("&")}`;
}
