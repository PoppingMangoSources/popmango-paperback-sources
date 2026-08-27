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

import { API_URL, DOMAIN } from "./models";

const FIRST_PARTY = /^https:\/\/(?:[a-z0-9-]+\.)*templetoons\.com\//i;

export class TempleScanInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        // Some covers live on third-party hosts whose hotlink protection swaps
        // in a placeholder when a foreign referer is attached; only claim the
        // site as referer on its own hosts.
        const firstParty = FIRST_PARTY.test(request.url);

        return {
            ...request,
            headers: {
                ...request.headers,
                ...(firstParty ? { referer: `${DOMAIN}/`, origin: DOMAIN } : {}),
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
 * Fetches a page as its data rather than its markup.
 *
 * The routes are Next.js pages; the `rsc` header returns the flight stream
 * carrying the page's data instead of the rendered shell, which is far smaller
 * and far easier to read values out of.
 */
function fetchRsc(url: string): Promise<string> {
    return Application.fetchText({ url, method: "GET", headers: { rsc: "1" } });
}

export function fetchDirectory(): Promise<string> {
    return fetchRsc(`${DOMAIN}/comics`);
}

export function fetchHomePage(): Promise<string> {
    return fetchRsc(`${DOMAIN}/`);
}

export function fetchSeriesPage(mangaId: string): Promise<string> {
    return fetchRsc(`${DOMAIN}/comic/${mangaId}`);
}

export function fetchChapterPage(mangaId: string, chapterId: string): Promise<string> {
    return fetchRsc(`${DOMAIN}/comic/${mangaId}/${chapterId}`);
}

function fetchApi(path: string): Promise<string> {
    return Application.fetchText({ url: `${API_URL}${path}`, method: "GET" });
}

export function fetchFeatured(): Promise<string> {
    return fetchApi("/banners");
}

export function fetchTrending(): Promise<string> {
    return fetchApi("/topSeries");
}

export function mangaUrl(mangaId: string): string {
    return `${DOMAIN}/comic/${mangaId}`;
}
