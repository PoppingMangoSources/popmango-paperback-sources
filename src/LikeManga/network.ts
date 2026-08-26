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
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import { DOMAIN, type ChapterAjaxResponse, type SearchRequest } from "./models";

const IMAGE_URL = /\.(avif|gif|jpe?g|jxl|png|svg|webp)([/?#]|$)/i;

/** Ids travel percent-encoded; the site's own URLs want them decoded again. */
function decodePathId(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export class LikeMangaInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${DOMAIN}/`,
                origin: DOMAIN,
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
        // Only read the interstitial markers out of a blocked response; a
        // synopsis can contain "Just a moment" of its own.
        const blocked = request.url.startsWith(DOMAIN) && (response.status === 403 || response.status === 503);
        const contentType = headerValue(response.headers, "content-type") ?? "";
        const text = blocked && contentType.includes("text/html") ? body.text : "";

        if (
            headerValue(response.headers, "cf-mitigated") === "challenge" ||
            (blocked && /(?:Just a moment|cf-chl-|_cf_chl_opt)/i.test(text))
        ) {
            throw new CloudflareError(
                Application.createRequest({
                    url: `${DOMAIN}/`,
                    method: "GET",
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }

        return body;
    }
}

export function buildSearchUrl(request: SearchRequest): string {
    const url = URL(DOMAIN).setQueryItem("act", "searchadvance");

    if (request.keyword !== undefined && request.keyword.length > 0) {
        url.setQueryItem("f[keyword]", request.keyword);
    }
    if (request.sortBy !== undefined) {
        url.setQueryItem("f[sortby]", request.sortBy);
    }
    if (request.status !== undefined) {
        url.setQueryItem("f[status]", decodePathId(request.status));
    }
    if (request.genres !== undefined && request.genres.length > 0) {
        url.setQueryItem("f[genres][]", request.genres.map(decodePathId));
    }
    if (request.minChapters !== undefined && request.minChapters !== "1") {
        url.setQueryItem("f[min_num_chapter]", request.minChapters);
    }
    if (request.page > 1) {
        url.setQueryItem("pageNum", request.page);
    }

    return url.build();
}

export function fetchHomePage(): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: `${DOMAIN}/` });
}

/** The first page of the hot chart has its own path; later pages go through search. */
export function fetchHotPage(page = 1): Promise<CheerioAPI> {
    const url =
        page === 1
            ? `${DOMAIN}/hot/`
            : URL(DOMAIN)
                  .setQueryItem("act", "search")
                  .setQueryItem("f[status]", "all")
                  .setQueryItem("f[sortby]", "hot")
                  .setQueryItem("pageNum", page)
                  .build();

    return Application.fetchDocument({ url });
}

export function fetchAdvancedSearchPage(): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: `${DOMAIN}/searchadvance/` });
}

export function fetchSearchPage(request: SearchRequest): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: buildSearchUrl(request) });
}

export function fetchContentPage(id: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: URL(DOMAIN).setPath(decodePathId(id)).build() });
}

/**
 * Fetches one page of the chapter list.
 *
 * The details page carries only the first page; the rest come from an endpoint
 * that answers with the markup wrapped in JSON.
 */
export async function fetchChapterListPage(mangaNumericId: string, page: number): Promise<string> {
    const response = await Application.fetchJSON<ChapterAjaxResponse>({
        url: URL(DOMAIN)
            .setQueryItem("act", "ajax")
            .setQueryItem("code", "load_list_chapter")
            .setQueryItem("manga_id", mangaNumericId)
            .setQueryItem("page_num", page)
            .setQueryItem("chap_id", "0")
            .setQueryItem("keyword", "")
            .build(),
    });

    if (typeof response.list_chap !== "string") {
        throw new Error(`The chapter list for ${mangaNumericId} came back in an unexpected form.`);
    }
    return response.list_chap;
}
