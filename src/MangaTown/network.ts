/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";
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

import { DOMAIN, type DirectoryFilters, type SearchRequest } from "./models";

const IMAGE_URL = /\.(avif|gif|jpe?g|jxl|png|svg|webp)([/?#]|$)/i;

export class MangaTownInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: request.headers.referer ?? `${DOMAIN}/`,
                "user-agent": await Application.getDefaultUserAgent(),
                accept:
                    request.headers.accept ??
                    (isImage
                        ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
                        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
                "accept-language": "en-US,en;q=0.5",
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
                    url: request.url,
                    method: request.method,
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }

        return body;
    }
}

/**
 * Appends a sort token.
 *
 * The site's listing tabs order results with a bare query key rather than a
 * key and value, so the token is appended verbatim.
 */
function sortedUrl(url: string, token?: string): string {
    return token !== undefined && token.length > 0 ? `${url}?${token}` : url;
}

/**
 * Builds a directory URL.
 *
 * The path is a fixed run of filter slots — demographic, genre, then status —
 * with `0` standing for "any".
 */
export function directoryUrl(page: number, filters: DirectoryFilters = {}): string {
    const path = `${filters.demographic ?? "0"}-${filters.genre ?? "0"}-0-${filters.status ?? "0"}-0-0`;
    return sortedUrl(`${DOMAIN}/directory/${path}/${page}.htm`, filters.sortToken);
}

export function hotUrl(page: number, demographic?: string, sortToken?: string): string {
    const segment = demographic !== undefined ? `${demographic}/` : "";
    return sortedUrl(`${DOMAIN}/hot/${segment}${page}.htm`, sortToken);
}

export function searchUrl(page: number, request: SearchRequest): string {
    const url = URL(DOMAIN).addPathComponent("search").setQueryItem("page", page);

    if (request.name !== undefined) {
        url.setQueryItem("name", request.name);
    }
    if (request.author !== undefined) {
        url.setQueryItem("author", request.author);
    }
    if (request.artist !== undefined) {
        url.setQueryItem("artist", request.artist);
    }

    // Genres are keyed individually: 1 to require, 2 to exclude.
    const included = [...(request.includedGenres ?? [])];
    if (request.demographic !== undefined) {
        included.push(request.demographic);
    }
    for (const genre of included) {
        url.setQueryItem(`genres[${genre}]`, "1");
    }
    for (const genre of request.excludedGenres ?? []) {
        url.setQueryItem(`genres[${genre}]`, "2");
    }

    if (request.isCompleted !== undefined) {
        url.setQueryItem("is_completed", request.isCompleted);
    }

    return url.build();
}

export function mangaUrl(mangaId: string): string {
    return `${DOMAIN}/manga/${mangaId}/`;
}

export function chapterUrl(mangaId: string, chapterId: string): string {
    return `${DOMAIN}/manga/${mangaId}/${chapterId}/`;
}

export function fetchListingPage(url: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url });
}

export function fetchFeaturedPage(): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: `${DOMAIN}/featured/` });
}

export function fetchMangaPage(mangaId: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: mangaUrl(mangaId) });
}

export function fetchChapterPage(url: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url });
}
