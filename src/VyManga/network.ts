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

import { SEARCH_PATH, type SearchRequest } from "./models";

const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif|bmp|svg)([?#]|$)/i;

/**
 * Fills in the browser tokens the app's own user agent leaves out.
 *
 * The app reports a bare iOS WebView string, which Cloudflare treats
 * differently from the full Safari one its challenge page runs under. Only the
 * missing pieces are added, so the reported OS version is left alone.
 */
function completeMobileSafariUserAgent(userAgent: string): string {
    if (!/\b(?:iPhone|iPad|iPod)\b/.test(userAgent) || /\bSafari\//.test(userAgent)) {
        return userAgent;
    }

    const os = /\bOS (\d+)[_.](\d+)/.exec(userAgent);
    const version = os !== null ? `${os[1]}.${os[2]}` : "18.0";

    const withVersion = /\bVersion\//.test(userAgent)
        ? userAgent
        : userAgent.replace(/\sMobile\//, ` Version/${version} Mobile/`);

    return /\bSafari\//.test(withVersion) ? withVersion : `${withVersion} Safari/604.1`;
}

let userAgent: Promise<string> | undefined;

function getUserAgent(): Promise<string> {
    return (userAgent ??= Application.getDefaultUserAgent().then(completeMobileSafariUserAgent));
}

export class VyMangaInterceptor extends PaperbackInterceptor {
    private readonly getBaseUrl: () => string;

    constructor(getBaseUrl: () => string) {
        super();
        this.getBaseUrl = getBaseUrl;
    }

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const baseUrl = this.getBaseUrl();

        if (IMAGE_URL.test(request.url)) {
            return {
                ...request,
                headers: {
                    ...request.headers,
                    referer: `${baseUrl}/`,
                    "user-agent": await getUserAgent(),
                    accept: "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8",
                },
            };
        }

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${baseUrl}/`,
                origin: baseUrl,
                "user-agent": await getUserAgent(),
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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
        const blocked = response.status === 403 || response.status === 503;
        const contentType = headerValue(response.headers, "content-type") ?? "";
        const text = blocked && contentType.includes("text/html") ? body.text : "";

        if (
            headerValue(response.headers, "cf-mitigated") === "challenge" ||
            /(?:Just a moment|cf-chl-|_cf_chl_opt)/i.test(text)
        ) {
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

/**
 * Fetches a page, recognising the host's own outage notice.
 *
 * It answers 200 with an error page rather than a status code, so without this
 * check the parsers would report the site as simply empty.
 */
export async function fetchPage(url: string): Promise<CheerioAPI> {
    const body = await Application.fetchText({ url });

    if (/<title>Site Unavailable<\/title>|Unable to access this site/i.test(body)) {
        throw new Error("The site is not reachable from this network at the moment.");
    }
    return Application.loadDocument(body);
}

export function buildBrowseUrl(baseUrl: string, sort: string, page: number): string {
    return URL(baseUrl)
        .addPathComponent(SEARCH_PATH)
        .setQueryItem("sort", sort)
        .setQueryItem("sort_type", "desc")
        .setQueryItem("page", page)
        .build();
}

export function buildSearchUrl(baseUrl: string, request: SearchRequest): string {
    const url = URL(baseUrl)
        .addPathComponent(SEARCH_PATH)
        .setQueryItem("q", request.title ?? "")
        .setQueryItem("page", request.page)
        .setQueryItem("search_po", request.searchType ?? "0")
        .setQueryItem("author_po", "0");

    if (request.status !== undefined) {
        url.setQueryItem("completed", request.status);
    }
    if (request.searchDescriptions === true) {
        url.setQueryItem("check_search_desc", "1");
    }
    if (request.sortBy !== undefined) {
        url.setQueryItem("sort", request.sortBy);
    }
    // Order is its own control on the site, so it applies with or without a sort.
    if (request.sortBy !== undefined || request.order !== undefined) {
        url.setQueryItem("sort_type", request.order ?? "desc");
    }
    if (request.includedGenres !== undefined && request.includedGenres.length > 0) {
        url.setQueryItem("genre[]", request.includedGenres);
    }
    if (request.excludedGenres !== undefined && request.excludedGenres.length > 0) {
        url.setQueryItem("exclude_genre[]", request.excludedGenres);
    }

    return url.build();
}
