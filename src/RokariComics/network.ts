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

export class RokariComicsInterceptor extends PaperbackInterceptor {
    private readonly getDomain: () => string;

    constructor(getDomain: () => string) {
        super();
        this.getDomain = getDomain;
    }

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const domain = this.getDomain();

        return {
            ...request,
            headers: {
                ...request.headers,
                "user-agent": await Application.getDefaultUserAgent(),
                referer: `${domain}/`,
                // Covers are served by WordPress's own image host, which sends
                // a placeholder unless the request says it will take one.
                ...((request.url.includes("wordpress.com") || request.url.includes("wp.com")) && {
                    accept: "image/avif,image/webp,*/*",
                }),
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
            const domain = this.getDomain();
            throw new CloudflareError(
                Application.createRequest({
                    url: request.url,
                    method: request.method,
                    headers: {
                        referer: `${domain}/`,
                        origin: domain,
                        "user-agent": await Application.getDefaultUserAgent(),
                    },
                }),
            );
        }

        return body;
    }
}

export function fetchPage(url: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url, method: "GET" });
}

/**
 * Asks only for the headers of a page.
 *
 * WordPress advertises a page's numeric id in a Link header, which is far
 * cheaper to read than fetching the page and hunting for it.
 */
export function fetchHead(url: string): Promise<Response> {
    return Application.scheduleRequest({ url, method: "HEAD" }).then(([response]) => response);
}
