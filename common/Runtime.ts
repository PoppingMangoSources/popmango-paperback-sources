/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";
import { decode as decodeEntities } from "html-entities";
import type { RawData, Request, RequestManager, Response } from "@paperback/types";

import { CloudflareError, isCloudflareChallenge } from "./Cloudflare";

/**
 * How a source describes a request it wants made.
 *
 * `body` is accepted as an alias for 0.8's `data`, and cookies may be given as
 * a plain record; the interceptor chain turns them into the runtime's shapes.
 */
export interface RequestInit {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    /** Form or JSON payload. Objects are form-encoded unless already a string. */
    body?: string | Record<string, unknown>;
    /** Appended to the URL verbatim, without escaping. */
    param?: string;
    cookies?: Record<string, string>;
}

/**
 * A fetched response body.
 *
 * The 0.8 runtime decodes text for us, so the string is always present; `raw`
 * is only populated when the runtime hands back binary data.
 */
export interface ResponseBody {
    readonly text: string;
    readonly raw?: RawData;
}

/**
 * Number of times a failed request is retried before the error is surfaced.
 *
 * One. A site that has started refusing requests refuses the retries too, and
 * each extra attempt is another hit against a rate limit the reader then has
 * to wait out.
 */
const DEFAULT_RETRIES = 1;

/** How long a fetched page is reused before it is asked for again. */
const RESPONSE_CACHE_MS = 5000;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Turns UTF-8 bytes into a string.
 *
 * Titles routinely carry accents and CJK, so decoding byte-by-byte would
 * mangle them; multi-byte sequences are assembled properly and anything
 * malformed becomes a replacement character rather than throwing.
 */
function utf8Decode(bytes: number[]): string {
    let result = "";

    for (let index = 0; index < bytes.length; ) {
        const byte = bytes[index] ?? 0;
        let codePoint: number;
        let length: number;

        if (byte < 0x80) {
            codePoint = byte;
            length = 1;
        } else if ((byte & 0xe0) === 0xc0) {
            codePoint = byte & 0x1f;
            length = 2;
        } else if ((byte & 0xf0) === 0xe0) {
            codePoint = byte & 0x0f;
            length = 3;
        } else if ((byte & 0xf8) === 0xf0) {
            codePoint = byte & 0x07;
            length = 4;
        } else {
            result += "�";
            index += 1;
            continue;
        }

        if (index + length > bytes.length) {
            result += "�";
            break;
        }

        for (let offset = 1; offset < length; offset += 1) {
            codePoint = (codePoint << 6) | ((bytes[index + offset] ?? 0) & 0x3f);
        }

        result += String.fromCodePoint(codePoint);
        index += length;
    }

    return result;
}

/**
 * The source-wide entry point for making requests.
 *
 * Each bundled source is its own isolated script, so a module-level instance
 * is per-source rather than shared. The extension binds its request manager
 * during construction and everything else in the source can then reach the
 * network without threading the manager through every function.
 */
class ApplicationRuntime {
    private requestManager?: RequestManager;
    private cheerio?: CheerioAPI;
    private userAgent?: string;

    /**
     * Responses fetched a moment ago, so the same page is not asked for twice.
     *
     * 0.8 asks for a series and then for its chapters as two separate calls
     * that each identify the series by id alone, and on most sites both
     * answers live on the same page. Without this, opening a series costs two
     * identical requests. Entries are held only for a few seconds — long
     * enough to cover one screen opening, short enough that a reader who pulls
     * to refresh gets a fresh page.
     */
    private readonly inFlight = new Map<string, { at: number; response: Promise<[Response, ResponseBody]> }>();

    /**
     * Called once by the source's base class.
     *
     * The app hands each source its own cheerio instance at construction
     * rather than exposing a global one, so it is captured here and reused by
     * every parser in the source.
     */
    bind(requestManager: RequestManager, cheerio: CheerioAPI): void {
        this.requestManager = requestManager;
        this.cheerio = cheerio;
    }

    private manager(): RequestManager {
        if (this.requestManager === undefined) {
            throw new Error("No request manager is bound; the source was used before it finished initialising.");
        }
        return this.requestManager;
    }

    /**
     * Performs a request and returns the response alongside its body.
     *
     * The tuple shape keeps the response metadata and the decoded body
     * separate, which is what the parsers expect.
     */
    async scheduleRequest(init: RequestInit, retries = DEFAULT_RETRIES): Promise<[Response, ResponseBody]> {
        const key = cacheKey(init);

        // Only plain reads are shared. Anything carrying a payload is a
        // request for the site to do something, and doing it once because it
        // looked like an earlier one would be wrong.
        if (key === undefined) {
            return this.perform(init, retries);
        }

        const now = Date.now();
        const cached = this.inFlight.get(key);
        if (cached !== undefined && now - cached.at < RESPONSE_CACHE_MS) {
            return cached.response;
        }

        const response = this.perform(init, retries);
        this.inFlight.set(key, { at: now, response });
        // A failure must not be remembered, or one bad moment sticks for the
        // whole window and a retry cannot get past it.
        void response.catch(() => this.inFlight.delete(key));
        this.prune(now);

        return response;
    }

    private async perform(init: RequestInit, retries: number): Promise<[Response, ResponseBody]> {
        const response = await this.manager().schedule(this.createRequest(init), retries);
        return [response, { text: response.data ?? "", raw: response.rawData }];
    }

    /** Drops entries that have aged out, so the map cannot grow without bound. */
    private prune(now: number): void {
        for (const [key, entry] of this.inFlight) {
            if (now - entry.at >= RESPONSE_CACHE_MS) {
                this.inFlight.delete(key);
            }
        }
    }

    /** Performs a request and returns the body as text, checking the status first. */
    async fetchText(init: RequestInit, retries = DEFAULT_RETRIES): Promise<string> {
        const [response, body] = await this.scheduleRequest(init, retries);
        assertOk(response, init.url);
        return body.text;
    }

    /** Parses an HTML string into a queryable document. */
    loadDocument(html: string): CheerioAPI {
        if (this.cheerio === undefined) {
            throw new Error("No HTML parser is bound; the source was used before it finished initialising.");
        }
        return this.cheerio.load(html);
    }

    /** Performs a request and parses the response as an HTML document. */
    async fetchDocument(init: RequestInit, retries = DEFAULT_RETRIES): Promise<CheerioAPI> {
        return this.loadDocument(await this.fetchText(init, retries));
    }

    /**
     * Turns `&amp;` and friends back into the characters they stand for.
     *
     * Titles and descriptions routinely arrive double-encoded, so this is
     * applied to any text taken from an attribute rather than a text node.
     */
    decodeHTMLEntities(value: string): string {
        return decodeEntities(value);
    }

    /**
     * Decodes standard or URL-safe base64 into a string.
     *
     * The runtime has no `atob`, and several sites hide their page manifests
     * behind a base64 payload, so sources get their own decoder. Padding is
     * optional and whitespace is ignored, which is how these payloads tend to
     * arrive.
     */
    base64Decode(value: string): string {
        const clean = value.replace(/[\r\n\s]/g, "").replace(/-/g, "+").replace(/_/g, "/");
        let bits = 0;
        let accumulator = 0;
        const bytes: number[] = [];

        for (const character of clean) {
            if (character === "=") {
                break;
            }

            const index = BASE64_ALPHABET.indexOf(character);
            if (index === -1) {
                throw new Error("The value is not valid base64.");
            }

            accumulator = (accumulator << 6) | index;
            bits += 6;

            if (bits >= 8) {
                bits -= 8;
                bytes.push((accumulator >> bits) & 0xff);
            }
        }

        return utf8Decode(bytes);
    }

    /** Performs a request and parses the body as JSON. */
    async fetchJSON<T>(init: RequestInit, retries = DEFAULT_RETRIES): Promise<T> {
        const text = await this.fetchText(init, retries);
        try {
            return JSON.parse(text) as T;
        } catch {
            throw new Error(`Expected JSON but the response could not be parsed: ${init.url}`);
        }
    }

    /** Builds a runtime request from a source's description of one. */
    createRequest(init: RequestInit): Request {
        return App.createRequest({
            url: init.url,
            method: init.method ?? "GET",
            headers: init.headers ?? {},
            param: init.param,
            data: encodeBody(init.body),
            cookies: [],
        });
    }

    /** Returns the body text of a response. */
    arrayBufferToUTF8String(body: ResponseBody): string {
        return body.text;
    }

    /**
     * Asks the app to rebuild the home page.
     *
     * 0.8 has no way to invalidate it — the app decides when to rebuild — so
     * this does nothing. Sources call it after a setting changes, and the new
     * sections appear the next time the reader opens the page.
     */
    invalidateDiscoverSections(): void {
        // Intentionally empty; see above.
    }

    /** Waits for a number of seconds. */
    async sleep(seconds: number): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
    }

    /**
     * The user agent the app uses for its own requests.
     *
     * Matching it matters on sites that fingerprint clients, and it is cached
     * because the lookup crosses into the host app.
     */
    async getDefaultUserAgent(): Promise<string> {
        this.userAgent ??= await this.manager().getDefaultUserAgent();
        return this.userAgent;
    }
}

/**
 * Throws a readable error for any non-2xx response.
 *
 * A blocked request is told apart from an ordinary failure, because the two
 * need different things from the reader: a challenge is cleared by opening the
 * site once, and saying so is the difference between a source that looks
 * broken and one that just needs a tap. Sources with an interceptor of their
 * own will have raised this already; this catches the rest.
 */
export function assertOk(response: Response, url: string): void {
    if (response.status === 404) {
        throw new Error(`Not found: ${url}`);
    }
    if (response.status >= 200 && response.status < 300) {
        return;
    }

    if (isCloudflareChallenge(response.status, response.headers, response.data ?? "")) {
        throw new CloudflareError(response.request);
    }

    throw new Error(`Request failed with status ${response.status}: ${url}`);
}

/**
 * The key a response is shared under, or nothing when it must not be shared.
 *
 * Only bodyless reads qualify. Cookies are part of the key because a source
 * that sets one is asking for a different answer than it would get without.
 */
function cacheKey(init: RequestInit): string | undefined {
    if (init.body !== undefined) {
        return undefined;
    }

    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") {
        return undefined;
    }

    const cookies = Object.entries(init.cookies ?? {})
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([name, value]) => `${name}=${value}`)
        .join(";");

    return `${init.url} ${init.param ?? ""} ${cookies}`;
}

/** Form-encodes an object body; strings are sent through untouched. */
function encodeBody(body: RequestInit["body"]): string | undefined {
    if (body === undefined || typeof body === "string") {
        return body;
    }

    return Object.entries(body)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join("&");
}

export const Application = new ApplicationRuntime();
