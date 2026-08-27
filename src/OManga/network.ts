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

import type { CatalogQuery, CatalogResponse } from "./models";
import { getDomain } from "./site";

const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

export class OMangaInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${getDomain()}/`,
                "user-agent": await Application.getDefaultUserAgent(),
                accept:
                    request.headers.accept ??
                    (isImage
                        ? "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
                        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
                "accept-language": "en-US,en;q=0.9",
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
        const challenged =
            isCloudflareChallenge(response.status, response.headers, text) ||
            (response.status === 403 && request.url.startsWith(getDomain()));

        if (challenged) {
            // Solved at the site root: the API and data routes cannot render
            // the challenge, and clearing it there frees the whole domain.
            throw new CloudflareError(
                Application.createRequest({
                    url: `${getDomain()}/`,
                    method: "GET",
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }

        return body;
    }
}

function buildCatalogUrl(query: CatalogQuery): string {
    const url = URL(getDomain()).addPathComponent("api").addPathComponent("catalog");

    for (const [key, value] of Object.entries(query)) {
        if (value === undefined) {
            continue;
        }
        const values = (Array.isArray(value) ? value : [value]).filter((entry) => entry.length > 0);
        if (values.length > 0) {
            url.setQueryItem(key, values);
        }
    }

    return url.build();
}

export async function fetchCatalog(query: CatalogQuery): Promise<CatalogResponse> {
    const result = await Application.fetchJSON<CatalogResponse>({ url: buildCatalogUrl(query) });
    if (!Array.isArray(result.items)) {
        throw new Error("The catalogue answer carried no results.");
    }
    return result;
}

export function fetchHtmlPage(url: string): Promise<string> {
    return Application.fetchText({ url, method: "GET" });
}

/**
 * Fetches a page as its data rather than its markup.
 *
 * The site is a Next.js app; the `rsc` header returns the page's data stream
 * instead of the rendered shell, which is smaller and easier to read values
 * out of.
 */
export function fetchFlightPayload(url: string, headers: Record<string, string> = {}): Promise<string> {
    return Application.fetchText({
        url,
        method: "GET",
        headers: { accept: "text/x-component", ...headers, rsc: "1" },
    });
}

/**
 * Tells the site which part of the page is being asked for.
 *
 * Without this the series route answers with the shell it would send a fresh
 * visitor, which carries none of the chapter data.
 */
export function buildSeriesNavigationHeaders(slug: string): Record<string, string> {
    const page = ["__PAGE__", {}, null, "refetch"];
    const tab = [["tab", "", "oc", null], { children: page }, null, null, 4];
    const series = [["slug", slug, "d", null], { children: tab }, null, null, 8];
    const manga = ["manga", { children: series }, null, null, 8];
    const routerState = ["", { children: manga }, null, null, 28];

    return {
        "next-router-state-tree": encodeURIComponent(JSON.stringify(routerState)),
        "next-url": `/manga/${slug}`,
    };
}

/**
 * Fetches a page's data, falling back to its markup.
 *
 * The data stream is preferred, but the site sometimes answers with a stream
 * that is missing the part being looked for; the rendered page always carries
 * it, so a missing marker sends the request round again as ordinary HTML.
 */
export async function fetchPagePayload(
    url: string,
    requiredMarker: string,
    headers?: Record<string, string>,
): Promise<string> {
    try {
        const payload = await fetchFlightPayload(url, headers);
        if (payload.includes(requiredMarker)) {
            return payload;
        }
    } catch (error: unknown) {
        if (error instanceof CloudflareError) {
            throw error;
        }
    }

    return fetchHtmlPage(url);
}
