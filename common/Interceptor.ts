/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { Cookie, RawData, Request, Response, SourceInterceptor, SourceStateManager } from "@paperback/types";

import { headerValue } from "./Cloudflare";
import { hostOf } from "./UrlBuilder";
import type { ResponseBody } from "./Runtime";

/** Matches URLs that point at an image, so they can skip throttling. */
const IMAGE_URL = /\.(avif|bmp|gif|jpe?g|jxl|png|svg|webp)(?:[/?#]|$)/i;

/**
 * A request on its way out, in the shape sources work with.
 *
 * Cookies are a record rather than a list because sources almost always want
 * to set one by name; the chain converts them back for the runtime.
 */
export interface InterceptedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    cookies: Record<string, string>;
    data?: unknown;
    param?: string;
}

/**
 * Base class for a source's own interceptor.
 *
 * Override either method; the defaults pass everything through untouched.
 */
export abstract class PaperbackInterceptor {
    /** Adjusts a request before it leaves — headers, cookies, rewritten URLs. */
    async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        return request;
    }

    /**
     * Inspects or rewrites a response before the source sees it.
     *
     * This is where a source detects a bot challenge and throws, or unpacks a
     * body the site has obfuscated.
     */
    async interceptResponse(
        _request: InterceptedRequest,
        _response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        return body;
    }
}

/**
 * Spaces requests out so a source does not hammer a site.
 *
 * Allows `numberOfRequests` per `bufferInterval` seconds. Because the queue is
 * a single promise chain, requests are also serialised in the order they were
 * made, which keeps a burst from arriving out of sequence.
 */
export class BasicRateLimiter {
    private readonly numberOfRequests: number;
    private readonly bufferInterval: number;
    private readonly ignoreImages: boolean;

    /** Timestamps of the requests still inside the current window. */
    private recent: number[] = [];
    /** Serialises callers so two of them cannot claim the same slot. */
    private queue: Promise<void> = Promise.resolve();

    constructor(options: { numberOfRequests: number; bufferInterval: number; ignoreImages?: boolean }) {
        this.numberOfRequests = Math.max(1, options.numberOfRequests);
        this.bufferInterval = Math.max(0, options.bufferInterval);
        this.ignoreImages = options.ignoreImages ?? false;
    }

    /** Resolves once the caller is allowed to send its request. */
    async wait(url: string): Promise<void> {
        if (this.bufferInterval === 0 || (this.ignoreImages && IMAGE_URL.test(url))) {
            return;
        }

        const turn = this.queue.then(() => this.claimSlot());
        // Swallow the result so one rejected caller cannot poison the queue.
        this.queue = turn.catch(() => undefined);
        return turn;
    }

    private async claimSlot(): Promise<void> {
        const windowMs = this.bufferInterval * 1000;
        const now = Date.now();
        this.recent = this.recent.filter((at) => now - at < windowMs);

        if (this.recent.length >= this.numberOfRequests) {
            const oldest = this.recent[0] ?? now;
            const waitFor = windowMs - (now - oldest);
            if (waitFor > 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, waitFor));
            }
            this.recent = this.recent.filter((at) => Date.now() - at < windowMs);
        }

        this.recent.push(Date.now());
    }
}

/**
 * Keeps cookies across app launches.
 *
 * Cloudflare clearance cookies are the reason this exists: without persisting
 * them, every launch would send the user back through a challenge. Cookies are
 * held in memory for the session and written to source state so they survive
 * a restart.
 */
export class CookieStorageInterceptor {
    private readonly stateManager: SourceStateManager;
    private readonly key: string;
    private cookies: Record<string, string> = {};
    private hydration?: Promise<void>;

    constructor(stateManager: SourceStateManager, key = "stored_cookies") {
        this.stateManager = stateManager;
        this.key = key;
    }

    /** Stores a cookie, dropping it instead if it has already expired. */
    setCookie(cookie: { name: string; value: string; expires?: Date }): void {
        if (cookie.expires !== undefined && cookie.expires.getTime() <= Date.now()) {
            delete this.cookies[cookie.name];
        } else {
            this.cookies[cookie.name] = cookie.value;
        }
        void this.persist();
    }

    /** Forgets every stored cookie. */
    clear(): void {
        this.cookies = {};
        void this.persist();
    }

    /**
     * Returns the stored cookies, loading them from state on first use.
     *
     * The load is shared rather than merely flagged. The home page fires every
     * section at once on a cold start, so without this each of them would race
     * past a half-set flag and go out with no cookies — one request would
     * carry the saved clearance and the rest would come back challenged.
     */
    async all(): Promise<Record<string, string>> {
        this.hydration ??= this.hydrate();
        await this.hydration;
        return this.cookies;
    }

    private async hydrate(): Promise<void> {
        try {
            const stored = (await this.stateManager.retrieve(this.key)) as Record<string, string> | undefined;
            // Anything already set this session wins over what was on disk.
            this.cookies = { ...(stored ?? {}), ...this.cookies };
        } catch {
            // Unreadable state just means starting from an empty jar.
        }
    }

    private async persist(): Promise<void> {
        try {
            await this.stateManager.store(this.key, this.cookies);
        } catch {
            // Losing persistence only costs the user a challenge on next launch.
        }
    }
}

/**
 * Ties the pieces together into the single interceptor the runtime accepts.
 *
 * On the way out: throttle, apply stored cookies, then let the source have its
 * turn. On the way back: hand the body to the source, which may rewrite it or
 * throw.
 */
export class InterceptorChain implements SourceInterceptor {
    private readonly rateLimiter?: BasicRateLimiter;
    private readonly cookieStorage?: CookieStorageInterceptor;
    private readonly interceptor?: PaperbackInterceptor;

    constructor(options: {
        rateLimiter?: BasicRateLimiter;
        cookieStorage?: CookieStorageInterceptor;
        interceptor?: PaperbackInterceptor;
    }) {
        this.rateLimiter = options.rateLimiter;
        this.cookieStorage = options.cookieStorage;
        this.interceptor = options.interceptor;
    }

    async interceptRequest(request: Request): Promise<Request> {
        await this.rateLimiter?.wait(request.url);

        let intercepted: InterceptedRequest = {
            url: request.url,
            method: request.method,
            headers: { ...request.headers },
            cookies: {
                ...(await this.cookieStorage?.all()),
                ...cookiesToRecord(request.cookies),
            },
            data: request.data,
            param: request.param,
        };

        if (this.interceptor !== undefined) {
            intercepted = await this.interceptor.interceptRequest(intercepted);
        }

        return App.createRequest({
            url: intercepted.url,
            method: intercepted.method,
            headers: intercepted.headers,
            param: intercepted.param,
            data: intercepted.data,
            cookies: recordToCookies(intercepted.cookies, hostOf(intercepted.url)),
        });
    }

    async interceptResponse(response: Response): Promise<Response> {
        if (this.interceptor === undefined) {
            return response;
        }

        const request: InterceptedRequest = {
            url: response.request.url,
            method: response.request.method,
            headers: { ...response.request.headers },
            cookies: cookiesToRecord(response.request.cookies),
            data: response.request.data,
            param: response.request.param,
        };

        const body = await this.interceptor.interceptResponse(request, response, {
            text: response.data ?? "",
            raw: response.rawData,
            contentType: headerValue(response.headers, "content-type"),
        });

        // Only rebuild the response when the source actually changed the body.
        // A rewritten `raw` counts: an interceptor that rebuilds an image or
        // unpacks an obfuscated payload leaves the text alone and hands back
        // bytes, and may hand back a different format with them.
        const contentTypeChanged =
            body.contentType !== undefined &&
            body.contentType !== headerValue(response.headers, "content-type");

        if (body.text === (response.data ?? "") && body.raw === response.rawData && !contentTypeChanged) {
            return response;
        }

        // Written onto the response the app handed over, not onto a copy of
        // it. Every 0.8 source that rebuilds an image assigns back to this
        // object and returns it unchanged, so that is the path known to work;
        // nothing shows the runtime reads the object that comes back instead.
        // A host that will not be written to falls through to the copy below.
        try {
            const mutable = response as { data?: string; rawData?: RawData; mimeType?: string };

            mutable.data = body.text;
            mutable.rawData = body.raw;

            if (contentTypeChanged) {
                mutable.mimeType = body.contentType;
                // The headers object is edited in place for the same reason.
                setContentType(response.headers, body.contentType ?? "");
            }

            return response;
        } catch {
            // Frozen, or the fields are accessors that refuse a write.
        }

        // Rebuilt field by field rather than spread, so nothing is lost if the
        // host hands these back on a prototype instead of as own properties.
        const rebuilt: Response = {
            data: body.text,
            rawData: body.raw,
            status: response.status,
            headers: contentTypeChanged
                ? withContentType(response.headers, body.contentType ?? "")
                : response.headers,
            request: response.request,
        };

        if (contentTypeChanged) {
            (rebuilt as { mimeType?: string }).mimeType = body.contentType;
        }

        return rebuilt;
    }
}

/**
 * Sets the content type on a headers object, in place.
 *
 * Every existing spelling is removed first, then the type is set under both
 * the lower-cased and the capitalised name, because the app has been seen to
 * read it under either.
 */
function setContentType(headers: Record<string, unknown>, contentType: string): void {
    for (const key of Object.keys(headers ?? {})) {
        if (key.toLowerCase() === "content-type") {
            delete headers[key];
        }
    }

    headers["content-type"] = contentType;
    headers["Content-Type"] = contentType;
}

/** The same, as a copy, for a headers object that cannot be written to. */
function withContentType(headers: Record<string, unknown>, contentType: string): Record<string, unknown> {
    const next: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(headers ?? {})) {
        if (key.toLowerCase() !== "content-type") {
            next[key] = value;
        }
    }

    next["content-type"] = contentType;
    next["Content-Type"] = contentType;
    return next;
}

function cookiesToRecord(cookies: Cookie[] | undefined): Record<string, string> {
    const record: Record<string, string> = {};
    for (const cookie of cookies ?? []) {
        record[cookie.name] = cookie.value;
    }
    return record;
}

function recordToCookies(record: Record<string, string>, domain: string): Cookie[] {
    return Object.entries(record).map(([name, value]) =>
        App.createCookie({ name, value, domain, path: "/" }),
    );
}
