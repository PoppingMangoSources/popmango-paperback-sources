/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { Response } from "@paperback/types";

import {
    Application,
    CloudflareError,
    PaperbackInterceptor,
    URL,
    headerValue,
    hostOf,
    isCloudflareChallenge,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import {
    MAX_IDS,
    MIRRORS,
    SOURCE_TYPES,
    isTrustedHost,
    type ContentRatingId,
    type SearchOptions,
    type BookIndexResponse,
    type GenreEntry,
    type IntegrityResponse,
    type JsonObject,
    type ReaderSession,
    type SearchResponse,
    type SeriesDetails,
    type TagEntry,
    type TrendingResponse,
    type UploadSource,
} from "./models";

/**
 * Statuses that mean the integrity token has gone stale, not that the
 * chapter is refused. The status alone decides: a good session's body
 * contains the word "token", so the body cannot be sniffed for it.
 */
const STALE_TOKEN_STATUSES = new Set([401, 403, 507]);

/** Integrity tokens live five minutes; one is replaced this long before it ends. */
const TOKEN_MARGIN_MS = 30_000;

/** The mirror a URL is on, or nothing for the image CDN and anything else. */
function mirrorOf(url: string): string | undefined {
    const host = hostOf(url).toLowerCase().replace(/^www\./, "");
    return MIRRORS.includes(host) ? host : undefined;
}

export class KaganeInterceptor extends PaperbackInterceptor {
    constructor(private readonly mirror: () => string) {
        super();
    }

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        // Page images live on the CDN but are requested on the site's behalf,
        // so they carry the site as origin too.
        const site = `https://${mirrorOf(request.url) ?? this.mirror()}`;

        return {
            ...request,
            headers: {
                ...request.headers,
                origin: site,
                referer: `${site}/`,
                "user-agent": await Application.getDefaultUserAgent(),
            },
        };
    }

    override async interceptResponse(
        request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        // A JSON 403 or 503 is a stale token or a rate limit, never a
        // challenge; treating it as one would prompt for a bypass that cannot
        // help. Only an HTML page can be the interstitial.
        const contentType = headerValue(response.headers, "content-type")?.toLowerCase() ?? "";
        const html = contentType.includes("text/html") || /^\s*<(?:!doctype html|html)/i.test(body.text);
        const mitigated = headerValue(response.headers, "cf-mitigated")?.toLowerCase() === "challenge";

        if (mitigated || (html && isCloudflareChallenge(response.status, response.headers, body.text))) {
            // The clearance a challenge mints covers the whole domain, so the
            // reader is sent to the front page rather than an API address.
            throw new CloudflareError(
                Application.createRequest({
                    url: `https://${mirrorOf(request.url) ?? this.mirror()}/`,
                    method: "GET",
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }

        return body;
    }
}

/**
 * Sends a request and reads its JSON, reporting the site's own error.
 *
 * Every status comes back here rather than being turned into a generic
 * failure, so the stale-token retry can see it and the reader is told what
 * the site said. The URL is left out of the message: it can carry a token.
 */
async function requestJson<T>(
    url: string,
    init: { method?: string; body?: JsonObject; headers?: Record<string, string> } = {},
): Promise<{ status: number; value?: T; error?: string }> {
    const [response, result] = await Application.scheduleRequest({
        url,
        method: init.method ?? "GET",
        headers: {
            accept: "application/json",
            ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
            ...init.headers,
        },
        // A string is sent as it is; an object would be form-encoded.
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (response.status >= 400) {
        return { status: response.status, error: `${errorMessage(result.text)} (HTTP ${response.status})` };
    }

    try {
        return { status: response.status, value: JSON.parse(result.text) as T };
    } catch {
        return { status: response.status, error: "Kagane returned a response that could not be read." };
    }
}

async function getJson<T>(url: string, body?: JsonObject): Promise<T> {
    const result = await requestJson<T>(url, body !== undefined ? { method: "POST", body } : {});
    if (result.value === undefined) {
        throw new Error(result.error ?? "Kagane returned an empty response.");
    }
    return result.value;
}

function errorMessage(body: string): string {
    try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed === "object" && parsed !== null) {
            const record = parsed as Record<string, unknown>;
            if (record["error"] === "too_many_values") {
                return `Kagane accepts at most 50 of each filter at once`;
            }
            for (const key of ["message", "error"]) {
                if (typeof record[key] === "string") {
                    return record[key] as string;
                }
            }
        }
    } catch {
        // Not JSON; fall through to the generic wording.
    }
    return "Kagane rejected the request";
}

/** The age band the site files a rating under; Erotica and Pornographic share 18+. */
export function ageBandOf(rating: ContentRatingId): string {
    return rating === "Safe" ? "Safe" : rating === "Suggestive" ? "FifteenPlus" : "EighteenPlus";
}

/**
 * The flag that separates Pornographic from Erotica inside the 18+ band.
 *
 * It applies to every band at once, so it can only ask for explicit titles
 * alone (`true`), leave them out (`false`), or say nothing.
 */
export function pornographicFlag(ratings: readonly ContentRatingId[]): boolean | undefined {
    if (!ratings.includes("Pornographic")) {
        return false;
    }
    return ratings.length === 1 ? true : undefined;
}

function checkedIds(values: string[], label: string): string[] {
    const unique = values.filter((value, index) => values.indexOf(value) === index);
    if (unique.length > MAX_IDS) {
        throw new Error(`Kagane accepts at most ${MAX_IDS} ${label} at once, and ${unique.length} are chosen.`);
    }
    return unique;
}

/** An include/exclude list in the shape the API takes, or nothing when both are empty. */
function idFilter(included: string[], excluded: string[], matchAll: boolean, label: string): JsonObject | undefined {
    const values = checkedIds(included, `included ${label}`);
    // Something asked for here outranks the same thing on a hide-list; sending
    // it as both a value and an exclusion finds nothing.
    const exclusions = checkedIds(
        excluded.filter((id) => !values.includes(id)),
        `excluded ${label}`,
    );
    if (values.length === 0 && exclusions.length === 0) {
        return undefined;
    }
    return {
        values,
        ...(values.length > 0 ? { match_all: matchAll } : {}),
        ...(exclusions.length > 0 ? { exclude: exclusions } : {}),
    };
}

/** The search request body. Everything left out of it is unrestricted. */
export function buildSearchBody(options: SearchOptions): JsonObject {
    const body: JsonObject = {};

    if (options.query) {
        body["title"] = options.query;
    }
    if (options.languages.length > 0) {
        body["content_lang"] = checkedIds(options.languages, "languages");
    }

    // Picked upload sources stand in for the upload-source setting: asking for
    // an official upload from a scanlation group finds nothing.
    if (options.sourceIds.length > 0) {
        body["source_id"] = checkedIds(options.sourceIds, "upload sources");
    } else {
        const types = SOURCE_TYPES[options.uploadSource];
        if (types !== undefined) {
            body["source_type"] = types;
        }
    }

    body["age_rating"] = options.contentRatings.map(ageBandOf).filter((band, index, all) => all.indexOf(band) === index);
    const pornographic = pornographicFlag(options.contentRatings);
    if (pornographic !== undefined) {
        body["is_pornographic"] = pornographic;
    }
    if (options.disturbing !== "show") {
        body["is_disturbing"] = options.disturbing === "only";
    }

    for (const [field, values] of [
        ["format", options.formats],
        ["upload_status", options.statuses],
        ["publication_status", options.publicationStatuses],
    ] as const) {
        if (values.length > 0) {
            body[field] = values;
        }
    }

    const genres = idFilter(options.genres.included, options.genres.excluded, options.genres.matchAll, "genres");
    if (genres !== undefined) {
        body["genres"] = genres;
    }
    // A typed tag can stand for several site ids, which are sent together.
    const tags = idFilter(options.tags.included.flat(), options.tags.excluded, options.tags.matchAll, "tags");
    if (tags !== undefined) {
        body["tags"] = tags;
    }

    if (options.staffId !== undefined) {
        body["staff"] = { values: [options.staffId] };
    }
    if (options.groupId !== undefined) {
        body["groups"] = { values: [options.groupId] };
    }
    for (const [field, range] of [
        ["current_books", options.chapters],
        ["start_year", options.startYear],
    ] as const) {
        if (range !== undefined && (range.min !== undefined || range.max !== undefined)) {
            body[field] = {
                ...(range.min !== undefined ? { min: range.min } : {}),
                ...(range.max !== undefined ? { max: range.max } : {}),
            };
        }
    }

    return body;
}

const api = (site: string): string => `${site}/api/v2`;

export function searchSeries(
    site: string,
    body: JsonObject,
    options: { page: number; size: number; sort: string; exactMatch: boolean },
): Promise<SearchResponse> {
    const url = URL(api(site))
        .addPathComponent("search")
        .addPathComponent("series")
        // The API pages from zero.
        .setQueryItem("page", Math.max(0, options.page - 1))
        .setQueryItem("size", options.size);

    if (options.exactMatch) {
        url.setQueryItem("exact_match", "true");
    }
    // Relevance is asked for by leaving the order off entirely.
    if (options.sort.length > 0) {
        url.setQueryItem("sort", `${options.sort},desc`);
    }

    return getJson<SearchResponse>(url.build(), body);
}

/** The weekly chart, which has its own endpoint and takes its filters as query items. */
export function fetchTrending(
    site: string,
    options: { limit: number; ageRatings: string[]; languages: string[]; pornographic?: boolean; disturbing?: boolean },
): Promise<TrendingResponse> {
    const url = URL(api(site))
        .addPathComponent("series")
        .addPathComponent("trending")
        .setQueryItem("limit", options.limit)
        .setQueryItem("age_rating", options.ageRatings.join(","));

    // The chart takes at most five languages; a longer choice is checked on
    // the rows that come back instead.
    if (options.languages.length > 0 && options.languages.length <= 5) {
        url.setQueryItem("lang", options.languages.join(","));
    }
    if (options.pornographic !== undefined) {
        url.setQueryItem("is_pornographic", String(options.pornographic));
    }
    if (options.disturbing !== undefined) {
        url.setQueryItem("is_disturbing", String(options.disturbing));
    }

    return getJson<TrendingResponse>(url.build());
}

export function fetchSeries(site: string, seriesId: string): Promise<SeriesDetails> {
    return getJson<SeriesDetails>(URL(api(site)).addPathComponent("series").addPathComponent(seriesId).build());
}

export function fetchBookIndex(site: string, seriesId: string): Promise<BookIndexResponse> {
    return getJson<BookIndexResponse>(
        URL(api(site))
            .addPathComponent("series")
            .addPathComponent(seriesId)
            .addPathComponent("books")
            .addPathComponent("index")
            .setQueryItem("fields", "List")
            .build(),
    );
}

/**
 * A cover's address.
 *
 * Tiles take the compressed copy: the full image runs to over a megabyte,
 * twenty times the size, and a home page shows well over a hundred covers.
 */
export function coverUrl(site: string, imageId: string, full = false): string {
    const url = URL(api(site)).addPathComponent("image").addPathComponent(imageId);
    if (!full) {
        url.addPathComponent("compressed");
    }
    return url.build();
}

// ---------------------------------------------------------------------------
// Lists that change slowly, held for the session
// ---------------------------------------------------------------------------

/**
 * Shares one fetch of a list between every caller in a session.
 *
 * A failed fetch is forgotten rather than kept, so the next caller tries
 * again instead of inheriting the failure.
 */
function sessionList<T>(load: (site: string) => Promise<T>): (site: string) => Promise<T> {
    const held = new Map<string, Promise<T>>();
    return (site) => {
        let entry = held.get(site);
        if (entry === undefined) {
            entry = load(site).catch((error: unknown) => {
                held.delete(site);
                throw error;
            });
            held.set(site, entry);
        }
        return entry;
    };
}

export const fetchGenres = sessionList(async (site) => {
    const genres = await getJson<GenreEntry[]>(`${api(site)}/genres/list`);
    // An empty list is a bad answer, not a site with no genres.
    if (genres.length === 0) {
        throw new Error("Kagane returned no genres.");
    }
    return genres;
});

/** Nearly ten thousand tags; fetched only when a tag name is typed or hidden. */
export const fetchTags = sessionList(async (site) => {
    const tags = await getJson<TagEntry[]>(`${api(site)}/tags/list`);
    if (tags.length === 0) {
        throw new Error("Kagane returned no tags.");
    }
    return tags;
});

export const fetchSources = sessionList(async (site) => {
    const sources = (await getJson<{ sources?: UploadSource[] }>(`${api(site)}/sources/list`, { source_types: null }))
        .sources;
    if (sources === undefined || sources.length === 0) {
        throw new Error("Kagane returned no upload sources.");
    }
    return sources;
});

/** The one staff member or group a name names, preferring an exact match. */
export async function resolveName(site: string, kind: "staff" | "groups", name: string): Promise<string> {
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name)) {
        return name;
    }

    const candidates =
        kind === "staff"
            ? (
                  await getJson<{ content?: Array<{ staff_id: string; name: string }> }>(
                      `${api(site)}/search/staff?size=8`,
                      { name },
                  )
              ).content?.map((entry) => ({ id: entry.staff_id, name: entry.name })) ?? []
            : (
                  await getJson<{ items?: Array<{ group_id: string; title: string }> }>(
                      URL(api(site))
                          .addPathComponent("groups")
                          .addPathComponent("search")
                          .setQueryItem("q", name)
                          .setQueryItem("limit", 8)
                          .build(),
                  )
              ).items?.map((entry) => ({ id: entry.group_id, name: entry.title })) ?? [];

    const exact = candidates.filter((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    const chosen = exact.length > 0 ? exact : candidates;

    if (chosen.length === 1 && chosen[0] !== undefined) {
        return chosen[0].id;
    }
    const label = kind === "staff" ? "author or artist" : "group";
    throw new Error(
        chosen.length === 0
            ? `Kagane has no ${label} named ${name}.`
            : `Kagane has several matches for ${name}; enter the full name.`,
    );
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

let integrity: { token: string; expiresAt: number; site: string } | undefined;
let pendingIntegrity: Promise<string> | undefined;

/**
 * A token proving the request comes from the site's own reader.
 *
 * Minted against the session's cookies, so the front page is loaded first
 * to warm them — including the clearance a challenge just wrote.
 */
async function integrityToken(site: string, force: boolean): Promise<string> {
    if (!force && integrity !== undefined && integrity.site === site && Date.now() < integrity.expiresAt) {
        return integrity.token;
    }
    if (pendingIntegrity !== undefined) {
        return pendingIntegrity;
    }

    pendingIntegrity = (async () => {
        try {
            await Application.scheduleRequest({ url: `${site}/`, method: "GET" }).catch(() => undefined);
            const minted = await getJson<IntegrityResponse>(`${site}/api/integrity`, {});
            integrity = { token: minted.token, expiresAt: minted.exp * 1000 - TOKEN_MARGIN_MS, site };
            return minted.token;
        } catch (error: unknown) {
            // A token minted before a challenge belongs to the session the
            // challenge replaced, so it is dropped rather than replayed.
            integrity = undefined;
            throw error;
        } finally {
            pendingIntegrity = undefined;
        }
    })();

    return pendingIntegrity;
}

/**
 * Opens a chapter: an access token, the CDN to fetch from, and the page list.
 *
 * A stale integrity token is replaced and the request made once more; a
 * second refusal is reported rather than retried again.
 */
export async function openReader(site: string, chapterId: string): Promise<ReaderSession & { cache_url: string }> {
    const url = URL(api(site)).addPathComponent("books").addPathComponent(chapterId).setQueryItem("is_datasaver", "false").build();

    for (const force of [false, true]) {
        let token: string;
        try {
            token = await integrityToken(site, force);
        } catch (error: unknown) {
            if (error instanceof CloudflareError) {
                integrity = undefined;
            }
            throw error;
        }

        const result = await requestJson<ReaderSession>(url, {
            method: "POST",
            body: {},
            headers: { "x-integrity-token": token },
        });

        if (STALE_TOKEN_STATUSES.has(result.status)) {
            integrity = undefined;
            if (!force) {
                continue;
            }
            throw new Error("Kagane rejected the reader token. Try again in a moment.");
        }

        if (result.value === undefined) {
            throw new Error(result.error ?? "Kagane could not open this chapter.");
        }

        const session = result.value;
        if (!session.access_token || !session.manifest?.pages?.length) {
            throw new Error("Kagane returned an incomplete reader session. Reopen the chapter.");
        }
        return { ...session, cache_url: trustedCacheUrl(session.cache_url, site) };
    }

    throw new Error("Kagane could not open this chapter.");
}

/** The CDN a session names, or the site itself when the CDN is not one it may trust. */
function trustedCacheUrl(value: string | null | undefined, site: string): string {
    const candidate = (value ?? "").replace(/\/+$/, "");
    // A control character can pass the host check and be normalised away by
    // the network stack afterwards, so a URL carrying one is not trusted.
    if (candidate.length === 0 || /[\u0000-\u001f\u007f]/.test(candidate)) {
        return site;
    }

    const host = /^https:\/\/([^/?#:]+)(?::443)?(?:[/?#]|$)/i.exec(candidate)?.[1];
    return host !== undefined && isTrustedHost(host) ? candidate : site;
}

export function pageUrl(cacheUrl: string, chapterId: string, fileName: string, token: string): string {
    return URL(cacheUrl)
        .addPathComponent("api")
        .addPathComponent("v2")
        .addPathComponent("books")
        .addPathComponent("page")
        .addPathComponent(chapterId)
        .addPathComponent(fileName)
        .setQueryItem("token", token)
        .setQueryItem("is_datasaver", "false")
        .build();
}
