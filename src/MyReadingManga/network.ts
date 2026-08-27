/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";
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

import { DOMAIN, LANGUAGES, TAXONOMIES, type SearchRequest } from "./models";

/**
 * How long one challenge suppresses the next.
 *
 * The home page loads every section at once, so a challenge would otherwise
 * raise one bypass prompt per request in flight.
 */
const CHALLENGE_PROMPT_INTERVAL = 60_000;

export class MyReadingMangaInterceptor extends PaperbackInterceptor {
    private lastChallengeAt = 0;

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${DOMAIN}/`,
                "user-agent": await Application.getDefaultUserAgent(),
            },
        };
    }

    override async interceptResponse(
        request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        // A bare 403 is not proof of a challenge — the site sends one for a
        // hotlinked image too — so the body has to say so as well.
        const contentType = headerValue(response.headers, "content-type") ?? "";
        const text =
            request.url.startsWith(DOMAIN) && contentType.includes("text/html") ? body.text : "";

        if (isCloudflareChallenge(response.status, response.headers, text)) {
            const now = Date.now();
            if (now - this.lastChallengeAt < CHALLENGE_PROMPT_INTERVAL) {
                throw new Error("A Cloudflare challenge is already open. Solve it, then refresh.");
            }
            this.lastChallengeAt = now;

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

/** WordPress pages by inserting /page/N/ into the path, before any query. */
function pagedUrl(base: string, page: number): string {
    if (page <= 1) {
        return base;
    }

    const [path, query] = base.split("?");
    const pagedPath = `${(path ?? "").replace(/\/+$/, "")}/page/${page}/`;
    return query !== undefined ? `${pagedPath}?${query}` : pagedPath;
}

export function fetchListingPage(path: string, page: number): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: pagedUrl(`${DOMAIN}${path}`, page) });
}

export function fetchSearchPage(request: SearchRequest): Promise<CheerioAPI> {
    const params = [
        `s=${encodeURIComponent(request.query.trim())}`,
        `ep_sort=${request.sort ?? "date"}`,
    ];

    for (const taxonomy of TAXONOMIES) {
        const chosen = request.facets.get(taxonomy.key) ?? [];
        if (chosen.length > 0) {
            params.push(`${taxonomy.param}=${encodeURIComponent(chosen.join(","))}`);
        }
    }

    const language = LANGUAGES.find((entry) => entry.code === request.language);
    if (language !== undefined) {
        params.push(`ep_filter_lang=${language.name}`);
    }

    return Application.fetchDocument({
        url: `${pagedUrl(`${DOMAIN}/`, request.page)}?${params.join("&")}`,
    });
}

export function fetchMangaPage(mangaId: string, part?: number): Promise<CheerioAPI> {
    return Application.fetchDocument({
        url: `${DOMAIN}/${mangaId}/${part !== undefined && part > 1 ? `${part}/` : ""}`,
    });
}

export function mangaUrl(mangaId: string): string {
    return `${DOMAIN}/${mangaId}/`;
}
