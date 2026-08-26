/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";

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
import type { Response } from "@paperback/types";

import { DOMAIN, type SearchRequest } from "./models";

const IMAGE_URL = /\.(avif|gif|jpe?g|jxl|png|svg|webp)([/?#]|$)/i;

/**
 * Makes requests look like they came from the site's own pages.
 *
 * The theme serves placeholder art to clients that arrive without a referer,
 * and hides adult titles unless the age-gate cookie is present.
 */
export class CocomicInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: request.headers.referer ?? `${DOMAIN}/`,
                origin: DOMAIN,
                "user-agent": await Application.getDefaultUserAgent(),
                accept:
                    request.headers.accept ??
                    (isImage
                        ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
                        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
                "accept-language": "en-US,en;q=0.5",
            },
            cookies: {
                ...request.cookies,
                "wpmanga-adault": "1",
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

export function buildBrowseUrl(page: number, sortBy: string): string {
    const url = URL(DOMAIN).addPathComponent("manga");
    if (page > 1) {
        url.addPathComponent("page").addPathComponent(page);
    }
    if (sortBy !== "relevance") {
        url.setQueryItem("m_orderby", sortBy);
    }
    return url.build();
}

export function buildSearchUrl(page: number, request: SearchRequest): string {
    const url = URL(DOMAIN);
    if (page > 1) {
        url.addPathComponent("page").addPathComponent(page);
    }

    url.setQueryItem("s", request.title ?? "").setQueryItem("post_type", "wp-manga");

    if (request.sortBy !== undefined && request.sortBy !== "relevance") {
        url.setQueryItem("m_orderby", request.sortBy);
    }
    if (request.genres !== undefined && request.genres.length > 0) {
        url.setQueryItem("genre[]", request.genres);
    }
    if (request.genreMatch === "and") {
        url.setQueryItem("op", "1");
    }
    if (request.adult !== undefined) {
        url.setQueryItem("adult", request.adult);
    }
    if (request.statuses !== undefined && request.statuses.length > 0) {
        url.setQueryItem("status[]", request.statuses);
    }

    return url.build();
}

export function fetchHomePage(): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: `${DOMAIN}/` });
}

export function fetchBrowsePage(page: number, sortBy: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: buildBrowseUrl(page, sortBy) });
}

export function fetchSearchPage(page: number, request: SearchRequest): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: buildSearchUrl(page, request) });
}

export function fetchLatestPage(page: number): Promise<CheerioAPI> {
    const url = URL(DOMAIN).addPathComponent("new");
    if (page > 1) {
        url.addPathComponent("page").addPathComponent(page);
    }
    return Application.fetchDocument({ url: url.build() });
}

export function fetchMangaPage(mangaId: string): Promise<CheerioAPI> {
    return Application.fetchDocument({
        url: URL(DOMAIN).addPathComponent("manga").addPathComponent(mangaId).build(),
    });
}

/**
 * Fetches the chapter list.
 *
 * The details page ships only the first handful of chapters; the full list
 * comes from a companion endpoint that answers to an empty POST.
 */
export function fetchChapterList(mangaId: string): Promise<CheerioAPI> {
    const referer = `${DOMAIN}/manga/${mangaId}/`;

    return Application.fetchDocument({
        url: `${referer}ajax/chapters`,
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            referer,
            "x-requested-with": "XMLHttpRequest",
        },
        body: "",
    });
}

export function fetchReaderPage(mangaId: string, chapterId: string): Promise<CheerioAPI> {
    return Application.fetchDocument({
        url: URL(DOMAIN)
            .addPathComponent("manga")
            .addPathComponent(mangaId)
            .addPathComponent(chapterId)
            // The single-page reader lists every image in the markup, which
            // saves walking a paginated reader one image at a time.
            .setQueryItem("style", "list")
            .build(),
    });
}
