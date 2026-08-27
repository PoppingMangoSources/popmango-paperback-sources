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

const IMAGE_URL = /\.(avif|gif|jpe?g|jxl|png|webp)(\?|$)/i;

/**
 * The site serves a stripped page to clients it cannot place as a browser, so
 * requests claim a current mobile Safari rather than the app's own agent.
 */
const USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

/**
 * Applies overrides to a header set, case-insensitively.
 *
 * An override set to `undefined` removes the header, which is how the origin
 * is dropped from image requests — the CDN refuses a cross-origin fetch but
 * accepts a plain referer.
 */
function withHeaders(
    headers: Record<string, string> | undefined,
    overrides: Record<string, string | undefined>,
): Record<string, string> {
    const result: Record<string, string> = {};
    const overridden = new Set(Object.keys(overrides).map((key) => key.toLowerCase()));

    for (const [key, value] of Object.entries(headers ?? {})) {
        if (!overridden.has(key.toLowerCase())) {
            result[key] = value;
        }
    }
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }

    return result;
}

export class KingOfShojoInterceptor extends PaperbackInterceptor {
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
                headers: withHeaders(request.headers, {
                    origin: undefined,
                    referer: `${baseUrl}/`,
                    "user-agent": USER_AGENT,
                    accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
                    "accept-language": "en-US,en;q=0.5",
                    "sec-fetch-dest": "image",
                    "sec-fetch-mode": "no-cors",
                    "sec-fetch-site": "cross-site",
                }),
            };
        }

        return {
            ...request,
            headers: withHeaders(request.headers, {
                origin: undefined,
                referer: `${baseUrl}/`,
                "user-agent": USER_AGENT,
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "accept-language": "en-US,en;q=0.5",
            }),
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
                    headers: { "user-agent": USER_AGENT },
                }),
            );
        }

        return body;
    }
}

export function fetchPage(url: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url, method: "GET" });
}
