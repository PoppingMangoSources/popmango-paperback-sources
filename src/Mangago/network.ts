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

import { descrambleImage, imageContextFor, isScrambledImageUrl } from "./descramble";
import { DOMAIN, READER_USER_AGENT } from "./models";
import { isMangagoHost, isReaderPageUrl, readerOrigin } from "./urls";

/**
 * The headers a browser sends when it navigates to a reader page.
 *
 * With a matching referer they make a fetch look like a real navigation, which
 * is what the site answers with the full page. Reader pages only — an image
 * request is fetched in a different context and saying otherwise is a tell.
 */
export const READER_NAVIGATION_HEADERS: Record<string, string> = {
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    "sec-fetch-user": "?1",
};

/**
 * Chooses the agent and referer for a URL.
 *
 * A reader page is asked for as a desktop browser, so the whole chapter comes
 * back at once; everything else keeps the app's own agent, because the mobile
 * listing links chapters in the form this source can replay.
 */
async function headersFor(url: string): Promise<Record<string, string>> {
    const reader = isReaderPageUrl(url);
    const origin = reader ? readerOrigin(url) : DOMAIN;

    return {
        referer: `${origin}/`,
        origin,
        "user-agent": reader ? READER_USER_AGENT : await Application.getDefaultUserAgent(),
    };
}

export class MangagoInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        return {
            ...request,
            headers: {
                ...(await headersFor(request.url)),
                // Anything the caller set itself wins, so a reader fetch's
                // forced desktop agent cannot be undone by the URL alone.
                ...request.headers,
            },
            // The site's own hosts get the flag that unlocks the full reader;
            // the image hosts must not be sent it.
            cookies: isMangagoHost(request.url)
                ? { ...request.cookies, _m_superu: "1" }
                : request.cookies,
        };
    }

    override async interceptResponse(
        request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        const contentType = headerValue(response.headers, "content-type") ?? "";
        const text = contentType.includes("text/html") ? body.text : "";

        if (
            headerValue(response.headers, "cf-mitigated") === "challenge" ||
            isCloudflareChallenge(response.status, response.headers, text)
        ) {
            throw new CloudflareError(
                Application.createRequest({
                    url: request.url,
                    method: request.method,
                    headers: await headersFor(request.url),
                }),
            );
        }

        if (body.raw === undefined || !isScrambledImageUrl(request.url)) {
            return body;
        }

        const context = imageContextFor(request.url);
        if (context === undefined) {
            return body;
        }

        try {
            const rebuilt = descrambleImage(body.raw, context);
            if (rebuilt === undefined) {
                return body;
            }
            return { text: body.text, raw: rebuilt.data, contentType: rebuilt.contentType };
        } catch {
            // A page that is scrambled is still better than no page.
            return body;
        }
    }
}

/** Fetches a page, alongside the URL it was asked for. */
export async function fetchPage(
    url: string,
    headers: Record<string, string> = {},
): Promise<{ html: string; url: string }> {
    return {
        html: await Application.fetchText({
            url,
            headers: { ...(await headersFor(url)), ...headers },
        }),
        url,
    };
}
