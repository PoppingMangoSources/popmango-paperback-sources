/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { Request } from "@paperback/types";

/**
 * Thrown when a response turns out to be a Cloudflare interstitial rather than
 * the page that was asked for.
 *
 * The source's base class catches it, remembers the carried request and hands
 * it to the app when it asks how to open a bypass session.
 */
export class CloudflareError extends Error {
    readonly request: Request;

    constructor(request: Request) {
        super(`Cloudflare challenge encountered at ${request.url}`);
        this.name = "CloudflareError";
        this.request = request;
    }
}

/** Response headers Cloudflare sets when it has served a challenge instead of the page. */
const CHALLENGE_HEADER = "cf-mitigated";

/** Markers that appear in the body of a challenge page. */
const CHALLENGE_BODY = /Just a moment|cf-chl-|_cf_chl_opt|cf_chl_prog|g-recaptcha|challenge-platform/i;

/**
 * Decides whether a response is a Cloudflare challenge.
 *
 * A 403 or 503 on its own is not enough — plenty of sites return those for
 * ordinary reasons — so the body is checked for a challenge marker as well.
 */
export function isCloudflareChallenge(
    status: number,
    headers: Record<string, unknown> | undefined,
    body: string,
): boolean {
    const mitigated = headerValue(headers, CHALLENGE_HEADER);
    if (mitigated?.toLowerCase() === "challenge") {
        return true;
    }

    if (status !== 403 && status !== 503) {
        return false;
    }

    const server = headerValue(headers, "server")?.toLowerCase() ?? "";
    return CHALLENGE_BODY.test(body) || server.includes("cloudflare");
}

/** Reads a header case-insensitively; sites and the runtime disagree on casing. */
export function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
    if (headers === undefined) {
        return undefined;
    }

    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === wanted) {
            const value = headers[key];
            return typeof value === "string" ? value : undefined;
        }
    }
    return undefined;
}
