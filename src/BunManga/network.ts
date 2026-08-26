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

import { DOMAIN, type SearchRequest } from "./models";

const IMAGE_URL = /\.(avif|gif|jpe?g|jxl|png|svg|webp)([/?#]|$)/i;

/**
 * Makes requests look like they came from the site's own pages.
 *
 * The theme serves placeholder art to clients that arrive without a referer,
 * and hides adult titles unless the age-gate cookie is present.
 */
export class BunMangaInterceptor extends PaperbackInterceptor {
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

export function buildSearchUrl(request: SearchRequest): string {
    // Without a search term the theme wants a bare `?s`, which its own filter
    // form also submits; with one it behaves like an ordinary search.
    const url = URL(request.title !== undefined && request.title.length > 0 ? DOMAIN : `${DOMAIN}/?s`)
        .setQueryItem("post_type", "wp-manga");

    if (request.title !== undefined && request.title.length > 0) {
        url.setQueryItem("s", request.title);
    }
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

export function fetchSearchPage(request: SearchRequest): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: buildSearchUrl(request) });
}

/**
 * Fetches a later page of a listing.
 *
 * The theme paginates through an admin endpoint rather than a URL, replaying
 * the query blob the first page embedded. Values are form-encoded with the
 * bracket notation the endpoint expects for nested data.
 */
export function fetchLoadMorePage(page: number, queryVars: string, referer: string): Promise<CheerioAPI> {
    return Application.fetchDocument({
        url: `${DOMAIN}/wp-admin/admin-ajax.php`,
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            referer,
            "x-requested-with": "XMLHttpRequest",
        },
        body: loadMoreBody(page, queryVars),
    });
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
    return Application.fetchDocument({
        url: URL(DOMAIN)
            .addPathComponent("manga")
            .addPathComponent(mangaId)
            .addPathComponent("ajax")
            .addPathComponent("chapters")
            .build(),
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            referer: `${DOMAIN}/manga/${mangaId}/`,
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

/** Encodes one form value the way the endpoint expects. */
function formValue(value: string): string {
    return encodeURIComponent(value).replace(/%20/g, "+");
}

/** Flattens nested query data into `key[child][0]=value` form entries. */
function appendFormValues(entries: string[], key: string, value: unknown): void {
    if (value === null || value === undefined) {
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => appendFormValues(entries, `${key}[${index}]`, item));
        return;
    }

    if (typeof value === "object") {
        for (const [childKey, childValue] of Object.entries(value)) {
            appendFormValues(entries, `${key}[${childKey}]`, childValue);
        }
        return;
    }

    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        return;
    }

    entries.push(`${formValue(key)}=${formValue(String(value))}`);
}

function loadMoreBody(page: number, queryVars: string): string {
    let variables: unknown;
    try {
        variables = JSON.parse(queryVars);
    } catch {
        throw new Error("The pagination data on this listing could not be read.");
    }

    if (variables === null || typeof variables !== "object" || Array.isArray(variables)) {
        throw new Error("The pagination data on this listing was not in the expected form.");
    }

    const entries = [
        `action=${formValue("madara_load_more")}`,
        `page=${page}`,
        `template=${formValue("madara-core/content/content-search")}`,
    ];
    appendFormValues(entries, "vars", variables);
    return entries.join("&");
}
