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
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import { AJAX_ENDPOINT, DOMAIN, type AjaxChapterResponse } from "./models";

const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif|bmp|svg)([?#]|$)/i;

export class RinkoComicsInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const accept = IMAGE_URL.test(request.url)
            ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${DOMAIN}/`,
                origin: DOMAIN,
                "user-agent": await Application.getDefaultUserAgent(),
                accept,
                "accept-language": "en-US,en;q=0.5",
            },
        };
    }

    override async interceptResponse(
        request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        if (headerValue(response.headers, "cf-mitigated") === "challenge") {
            throw new CloudflareError(
                Application.createRequest({
                    url: `${DOMAIN}/`,
                    method: request.method,
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }
        return body;
    }
}

export function fetchPage(url: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url });
}

/**
 * Fetches one page of the chapter list.
 *
 * Detail pages carry only the first batch; the rest come from an endpoint that
 * answers with the markup wrapped in JSON. An empty string means the endpoint
 * reported no further data.
 */
export async function fetchMoreChaptersHtml(comicId: string, offset: number, nonce: string): Promise<string> {
    const body = [
        "action=load_more_chapters",
        `nonce=${encodeURIComponent(nonce)}`,
        `comic_id=${encodeURIComponent(comicId)}`,
        `offset=${offset}`,
    ].join("&");

    const parsed = await Application.fetchJSON<AjaxChapterResponse>({
        url: AJAX_ENDPOINT,
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest",
        },
        body,
    });

    return parsed.success === true ? (parsed.data?.html ?? "") : "";
}
