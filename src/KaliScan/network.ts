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

import { MIRROR_IDS } from "./models";
import { automaticFailover, baseUrl, mirrorOrigin, selectedBaseUrl, setActiveBaseUrl } from "./site";

const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i;

/** Statuses that mean "try another mirror" rather than "give up". */
const RETRYABLE = new Set([403, 408, 500, 502, 503, 504, 521, 522, 523, 524]);

/**
 * Completes a mobile Safari user agent the app hands over half-finished.
 *
 * The site serves a stripped page to anything it cannot place as a real
 * browser, and an agent naming an iPhone without a Safari token is exactly
 * that. Filling in the missing version and token gets the full page back.
 */
export function completeMobileSafariUserAgent(userAgent: string): string {
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

// One native lookup for the whole session instead of one per request.
let userAgent: Promise<string> | undefined;

function getUserAgent(): Promise<string> {
    return (userAgent ??= Application.getDefaultUserAgent().then(completeMobileSafariUserAgent));
}

export class KaliScanInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);
        const headers = { ...request.headers };

        // The image CDN rejects a cross-origin request outright; a referer is
        // enough for it, an origin is not.
        if (isImage) {
            delete headers.origin;
            delete headers.Origin;
        }

        return {
            ...request,
            headers: {
                ...headers,
                referer: `${mirrorOrigin(request.url) ?? baseUrl()}/`,
                "user-agent": await getUserAgent(),
                "accept-language": "en-US,en;q=0.5",
                accept: isImage
                    ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
                    : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
                    headers: { "user-agent": await getUserAgent() },
                }),
            );
        }

        return body;
    }
}

/**
 * Fetches a page, moving to another mirror when the first one will not answer.
 *
 * The mirrors serve one catalogue, so the same path works on any of them. A
 * mirror that answers is remembered, so the next request starts there rather
 * than working down the list again. A challenge is never retried — another
 * mirror would only serve another one, and the reader has to clear it.
 */
export async function fetchHtml(url: string): Promise<string> {
    const requested = mirrorOrigin(url);

    const origins = automaticFailover()
        ? [requested, selectedBaseUrl(), ...MIRROR_IDS].filter(
              (origin, index, values): origin is string =>
                  origin !== undefined && origin.length > 0 && values.indexOf(origin) === index,
          )
        : requested !== undefined
          ? [requested]
          : [];

    const candidates =
        origins.length > 0 && requested !== undefined
            ? origins.map((origin) => url.replace(requested, origin))
            : [url];

    let lastError: unknown;

    for (const [index, candidate] of candidates.entries()) {
        try {
            const [response, body] = await Application.scheduleRequest({ url: candidate, method: "GET" });

            if (response.status === 200) {
                const answered = mirrorOrigin(candidate);
                if (answered !== undefined) {
                    setActiveBaseUrl(answered);
                }
                return body.text;
            }

            if (response.status === 404) {
                lastError = new Error(`Not found: ${candidate}`);
                break;
            }

            lastError = new Error(`Request failed with status ${response.status}: ${candidate}`);
            if (!RETRYABLE.has(response.status) || index === candidates.length - 1) {
                break;
            }
        } catch (error: unknown) {
            if (error instanceof CloudflareError) {
                throw error;
            }
            lastError = error;
            if (index === candidates.length - 1) {
                break;
            }
        }
    }

    throw lastError ?? new Error(`Request failed: ${url}`);
}
