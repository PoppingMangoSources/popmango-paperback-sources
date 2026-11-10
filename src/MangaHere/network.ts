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
    assertOk,
    headerValue,
    isCloudflareChallenge,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import { DOMAIN, MOBILE_DOMAIN, NEW_MOBILE_DOMAIN, SITE_RETRIES, type SearchRequest } from "./models";

const IMAGE_URL = /\.(avif|gif|jpe?g|jxl|png|svg|webp)([/?#]|$)/i;

/** iOS refuses plain-http images, and the site still links some, so every request goes out as https. */
export function secureUrl(url: string): string {
    return url.replace(/^\/\//, "https://").replace(/^http:/i, "https:");
}

export class MangaHereInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);

        return {
            ...request,
            // Older saved titles may still carry http cover addresses.
            url: secureUrl(request.url),
            headers: {
                ...request.headers,
                // Images want the site root; a page request names its own chapter.
                referer: isImage ? `${DOMAIN}/` : (request.headers.referer ?? `${DOMAIN}/`),
                "user-agent": await Application.getDefaultUserAgent(),
                accept:
                    request.headers.accept ??
                    (isImage
                        ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
                        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
                "accept-language": "en-US,en;q=0.5",
            },
            // Adult titles are behind an age prompt without these.
            cookies: { ...request.cookies, isAdult: "1", MHNMM: "1" },
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

export function fetchDocument(url: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url }, SITE_RETRIES);
}

export const homeUrl = (): string => `${DOMAIN}/`;

export const mobileHomeUrl = (): string => `${NEW_MOBILE_DOMAIN}/`;

/**
 * Builds a directory URL.
 *
 * A genre and a completion state are path segments; the ordering is a bare
 * query key.
 */
export function listingUrl(page: number, sortToken: string, genre?: string, status?: string): string {
    const path = [genre, status].filter((value): value is string => value !== undefined && value.length > 0).join("/");
    const base = path.length > 0 ? `${DOMAIN}/${path}/` : `${DOMAIN}/directory/`;
    return `${base}${page > 1 ? `${page}.htm` : ""}?${sortToken}`;
}

export const latestUrl = (page: number): string => (page > 1 ? `${DOMAIN}/latest/${page}/` : `${DOMAIN}/latest/`);

export const rankingUrl = (path: string): string => `${DOMAIN}/${path}/`;

/** `/search/` is a directory listing, so the path stays slashless. */
export function searchUrl(page: number, request: SearchRequest): string {
    const url = URL(DOMAIN).addPathComponent("search");

    if (page > 1) {
        url.setQueryItem("page", page);
    }
    if (request.title !== undefined) {
        url.setQueryItem("title", request.title);
    }
    if (request.name !== undefined) {
        url.setQueryItem("name", request.name);
        url.setQueryItem("name_method", request.nameMethod ?? "cw");
    }
    if (request.author !== undefined) {
        url.setQueryItem("author", request.author);
        url.setQueryItem("author_method", request.authorMethod ?? "cw");
    }
    if (request.artist !== undefined) {
        url.setQueryItem("artist", request.artist);
        url.setQueryItem("artist_method", request.artistMethod ?? "cw");
    }
    if (request.type !== undefined) {
        url.setQueryItem("type", request.type);
    }
    if (request.includedGenres.length > 0) {
        url.setQueryItem("genres", request.includedGenres.join(","));
    }
    if (request.excludedGenres.length > 0) {
        url.setQueryItem("nogenres", request.excludedGenres.join(","));
    }
    if (request.rating !== undefined) {
        url.setQueryItem("rating", request.rating);
        url.setQueryItem("rating_method", request.ratingMethod ?? "eq");
    }
    if (request.released !== undefined) {
        url.setQueryItem("released", request.released);
        url.setQueryItem("released_method", request.releasedMethod ?? "eq");
    }
    if (request.completion !== undefined) {
        url.setQueryItem("st", request.completion);
    }
    // The site's own advanced search marks itself this way.
    if (request.title === undefined) {
        url.setQueryItem("stype", "1");
    }

    return url.build();
}

/** The details page keeps its trailing slash. */
export const mangaUrl = (mangaId: string): string => `${DOMAIN}/manga/${mangaId}/`;

export const chapterUrl = (mangaId: string, chapterId: string): string =>
    `${DOMAIN}/manga/${mangaId}/${chapterId}/1.html`;

export const mobileChapterUrl = (mangaId: string, chapterId: string): string =>
    `${MOBILE_DOMAIN}/roll_manga/${mangaId}/${chapterId}/1.html`;

/**
 * Asks the desktop reader for one page's packed answer.
 *
 * An empty answer is returned as is, so the caller can ask again.
 */
export async function fetchPageScript(readerUrl: string, chapterId: string, page: number, key: string): Promise<string> {
    const base = readerUrl.slice(0, readerUrl.lastIndexOf("/") + 1);
    // Written out rather than built: the site's own script sends `key=` even
    // when it has no key, and the URL builder drops empty values.
    const url = `${base}chapterfun.ashx?cid=${encodeURIComponent(chapterId)}&page=${page}&key=${encodeURIComponent(key)}`;

    const [response, body] = await Application.scheduleRequest(
        {
            url,
            headers: { referer: readerUrl, accept: "*/*", "x-requested-with": "XMLHttpRequest" },
        },
        SITE_RETRIES,
    );
    assertOk(response, url);
    return body.text;
}
