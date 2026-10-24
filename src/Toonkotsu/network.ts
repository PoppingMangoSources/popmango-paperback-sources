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
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import { decodeBase64Url, decryptPage } from "./crypto";
import { DOMAIN, PAGE_SIZE, type FacetsResponse, type LatestResponse, type SeriesListResponse, type SeriesResponse } from "./models";

// Encrypted page urls carry their key and nonce after "#" so the interceptor
// can decrypt the response; the fragment is never sent to the server.
const PAGE_KEY_MARKER = "#tk=";

/**
 * Page keys by the plain image URL, alongside the copy in the fragment.
 *
 * Nothing shows that 0.8 hands the interceptor a page's URL with its fragment
 * intact, so the key is also kept here, and whichever survives is used. A
 * chapter is listed again every time it is opened, so this only has to outlive
 * one read; the oldest entries make way once it is full.
 */
const pageKeys = new Map<string, string>();
const MAX_PAGE_KEYS = 3000;

export const encodePageUrl = (src: string, key: string, nonce: string): string => {
    if (pageKeys.size >= MAX_PAGE_KEYS) {
        const oldest = pageKeys.keys().next().value;
        if (oldest !== undefined) {
            pageKeys.delete(oldest);
        }
    }
    pageKeys.set(src, `${key}.${nonce}`);
    return `${src}${PAGE_KEY_MARKER}${key}.${nonce}`;
};

function pageKeyFor(url: string): { src: string; key: string; nonce: string } | undefined {
    const markerIndex = url.indexOf(PAGE_KEY_MARKER);
    const src = markerIndex < 0 ? url : url.slice(0, markerIndex);
    const value = markerIndex < 0 ? pageKeys.get(src) : url.slice(markerIndex + PAGE_KEY_MARKER.length);
    if (value === undefined) {
        return undefined;
    }
    const [key = "", nonce = ""] = value.split(".");
    return { src, key, nonce };
}

/** What a decrypted page actually is, from its leading bytes. */
function imageType(bytes: Uint8Array): string | undefined {
    const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        return "image/jpeg";
    }
    if (ascii(1, 4) === "PNG") {
        return "image/png";
    }
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
        return "image/webp";
    }
    if (ascii(4, 12).includes("ftypavi")) {
        return "image/avif";
    }
    return ascii(0, 3) === "GIF" ? "image/gif" : undefined;
}

const IMAGE_REGEX = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;
const isApi = (url: string): boolean => /\/(?:api|cdn\/v1)\//.test(url);

export class ToonkotsuInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const api = isApi(request.url);
        const image = IMAGE_REGEX.test(request.url) || pageKeyFor(request.url) !== undefined;

        return {
            ...request,
            // The site's session lives in the app's own cookie jar, the one the
            // cloud button's web view writes to. The reader's human check is
            // passed in that session, so a cookie sent alongside it would only
            // shadow the session that was verified; none are sent from here.
            cookies: {},
            headers: {
                ...request.headers,
                accept: api
                    ? "application/json"
                    : image
                      ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
                      : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                ...(api ? { origin: DOMAIN } : {}),
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
        if (headerValue(response.headers, "cf-mitigated")?.toLowerCase() === "challenge") {
            // The API answers in JSON and cannot display the challenge; solving
            // it on the site clears the whole domain.
            throw new CloudflareError(
                Application.createRequest({
                    url: `${DOMAIN}/`,
                    method: "GET",
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }

        const page = pageKeyFor(request.url);
        if (page === undefined) {
            return body;
        }
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Could not load Toonkotsu page (status ${response.status}): ${page.src}`);
        }
        if (body.raw === undefined) {
            throw new Error("Toonkotsu returned an empty page image.");
        }

        const bytes = App.createByteArray(body.raw);
        if (bytes.length === 0) {
            throw new Error("Toonkotsu returned an empty page image.");
        }

        // createByteArray is a view over the response's own buffer, so decrypting into it
        // rewrites the page. createRawData returns null on 0.8 and the app rejects the page.
        try {
            bytes.set(decryptPage(bytes, decodeBase64Url(page.key), decodeBase64Url(page.nonce).subarray(0, 8)));
        } catch (error: unknown) {
            throw new Error(
                `Could not decrypt page ${page.src}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        // The server labels the ciphertext, so the type is the image's own.
        return { text: body.text, raw: body.raw, contentType: imageType(bytes) ?? body.contentType };
    }
}

interface JsonInit {
    body?: unknown;
    headers?: Record<string, string>;
}

const requestJson = async (url: string, init?: JsonInit): Promise<{ status: number; data: unknown }> => {
    const [response, body] = await Application.scheduleRequest({
        url,
        method: init?.body === undefined ? "GET" : "POST",
        headers: {
            ...init?.headers,
            ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

    try {
        return { status: response.status, data: JSON.parse(body.text) as unknown };
    } catch {
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Request failed with status ${response.status}: ${url}`);
        }
        throw new Error(`Invalid response from ${url}`);
    }
};

const fetchJson = async <T>(url: string, init?: JsonInit): Promise<T> => {
    const { status, data } = await requestJson(url, init);
    if (status === 404) {
        throw new Error(`Not found: ${url}`);
    }
    if (status < 200 || status >= 300) {
        throw new Error(`Request failed with status ${status}: ${url}`);
    }
    return data as T;
};

export type CatalogueParams = Record<string, string | number | boolean | undefined>;

// The site skips empty and false parameters and sends true as "1".
const siteUrl = (path: string, params: CatalogueParams): string => {
    const url = URL(DOMAIN);
    for (const segment of path.split("/")) {
        url.addPathComponent(segment);
    }
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === "" || value === false) {
            continue;
        }
        url.setQueryItem(key, value === true ? "1" : String(value));
    }
    return url.build();
};

// A refresh has to reach the site: the runtime reuses a read made in the last
// few seconds, and this header keeps the refresh from matching the read it
// replaces.
const FRESH: JsonInit = { headers: { "cache-control": "no-cache" } };

export const fetchBrowse = (params: CatalogueParams): Promise<SeriesListResponse> =>
    fetchJson(siteUrl("cdn/v1/browse", { limit: PAGE_SIZE, ...params }));

export const fetchLatest = (page: number, params: CatalogueParams): Promise<LatestResponse> =>
    fetchJson(siteUrl("cdn/v1/latest", { ...params, page, limit: PAGE_SIZE }));

// Rankings built from this site's own readers are served by the site, not the
// catalogue. Discovery rankings are posted as the browse parameters; reading
// counts are read with a query string.
export const fetchDiscoveryRanking = (metric: string, params: CatalogueParams): Promise<SeriesListResponse> =>
    fetchJson(`${DOMAIN}/api/v1/rankings`, {
        body: { params: { limit: PAGE_SIZE, ...params, discovery: metric, metric } },
    });

export const fetchReadingRanking = (metric: string, params: CatalogueParams): Promise<SeriesListResponse> =>
    fetchJson(siteUrl("api/v1/rankings", { limit: PAGE_SIZE, ...params, metric }));

export const fetchFacets = (): Promise<FacetsResponse> => fetchJson(siteUrl("cdn/v1/facets", { sfw: false }));

export const fetchSeries = (mangaId: string): Promise<SeriesResponse> => fetchJson(siteUrl(`cdn/v1/series/${mangaId}`, {}));

// The site issues its guest cookie here, into the app's cookie jar.
export const fetchSiteSession = (fresh = false): Promise<unknown> =>
    fetchJson(`${DOMAIN}/api/auth/me`, fresh ? FRESH : undefined);

// The reader answers its reading limit with a 429 whose body says how to
// recover, so these return the status alongside the body.
export const requestReaderKey = (fresh = false) => requestJson(`${DOMAIN}/api/manga/key`, fresh ? FRESH : undefined);

// The site serves unmasked page keys to an unsigned read, so the signature is
// only the fallback.
export const requestChapter = (path: string, signature?: string) =>
    requestJson(`${DOMAIN}${path}`, signature ? { headers: { "x-sig": signature } } : undefined);
