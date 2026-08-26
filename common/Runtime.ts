/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";
import { decode as decodeEntities } from "html-entities";
import type { RawData, Request, RequestManager, Response } from "@paperback/types";

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

/** Number of times a failed request is retried before the error is surfaced. */
const DEFAULT_RETRIES = 2;

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
        const response = await this.manager().schedule(this.createRequest(init), retries);
        return [response, { text: response.data ?? "", raw: response.rawData }];
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

/** Throws a readable error for any non-2xx response. */
export function assertOk(response: Response, url: string): void {
    if (response.status === 404) {
        throw new Error(`Not found: ${url}`);
    }
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Request failed with status ${response.status}: ${url}`);
    }
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
