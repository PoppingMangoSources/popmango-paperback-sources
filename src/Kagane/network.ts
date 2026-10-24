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

// Decided by status alone: a valid session body also contains "token".
const STALE_TOKEN_STATUSES = new Set([401, 403, 507]);

const TOKEN_MARGIN_MS = 30_000; // Integrity tokens live 5 minutes

function mirrorOf(url: string): string | undefined {
    const host = hostOf(url).toLowerCase().replace(/^www\./, "");
    return MIRRORS.includes(host) ? host : undefined;
}

export class KaganeInterceptor extends PaperbackInterceptor {
    constructor(private readonly mirror: () => string) {
        super();
    }

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        // CDN page requests still need the site as origin
        const site = `https://${mirrorOf(request.url) ?? this.mirror()}`;

        // Re-sign expiring page tokens; if that fails, send the original unchanged
        const url = isTrustedHost(hostOf(request.url).toLowerCase())
            ? await freshPageUrl(`https://${this.mirror()}`, request.url).catch(() => request.url)
            : request.url;

        return {
            ...request,
            url,
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
        // JSON 403/503 means a stale token or rate limit; only HTML can be a challenge
        const contentType = headerValue(response.headers, "content-type")?.toLowerCase() ?? "";
        const html = contentType.includes("text/html") || /^\s*<(?:!doctype html|html)/i.test(body.text);
        const mitigated = headerValue(response.headers, "cf-mitigated")?.toLowerCase() === "challenge";

        if (mitigated || (html && isCloudflareChallenge(response.status, response.headers, body.text))) {
            // Clearance covers the whole domain, so solve on the front page
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

// Returns the status so callers can retry stale tokens. Errors omit the URL: it may carry a token.
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
        // An object body would be form-encoded
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
        // Not JSON
    }
    return "Kagane rejected the request";
}

// Erotica and Pornographic share the 18+ band.
export function ageBandOf(rating: ContentRatingId): string {
    return rating === "Safe" ? "Safe" : rating === "Suggestive" ? "FifteenPlus" : "EighteenPlus";
}

// Applies across all bands, so it can only mean "only explicit", "no explicit" or unset.
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

function idFilter(included: string[], excluded: string[], matchAll: boolean, label: string): JsonObject | undefined {
    const values = checkedIds(included, `included ${label}`);
    // An explicit pick beats a hide-list entry; sending both matches nothing
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

export function buildSearchBody(options: SearchOptions): JsonObject {
    const body: JsonObject = {};

    if (options.query) {
        body["title"] = options.query;
    }
    if (options.languages.length > 0) {
        body["content_lang"] = checkedIds(options.languages, "languages");
    }

    // Picked sources override the upload-type setting, which could otherwise exclude them
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
        // API pages are 0-based
        .setQueryItem("page", Math.max(0, options.page - 1))
        .setQueryItem("size", options.size);

    if (options.exactMatch) {
        url.setQueryItem("exact_match", "true");
    }
    if (options.sort.length > 0) {
        url.setQueryItem("sort", `${options.sort},desc`);
    }

    return getJson<SearchResponse>(url.build(), body);
}

export function fetchTrending(
    site: string,
    options: { limit: number; ageRatings: string[]; languages: string[]; pornographic?: boolean; disturbing?: boolean },
): Promise<TrendingResponse> {
    const url = URL(api(site))
        .addPathComponent("series")
        .addPathComponent("trending")
        .setQueryItem("limit", options.limit)
        .setQueryItem("age_rating", options.ageRatings.join(","));

    // Max five languages; longer selections are filtered locally by the caller
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

// Tiles use the compressed copy (~20x smaller). A missing cover gets a URL that 404s:
// the app then draws its placeholder, whereas an empty URL blanks the whole row.
export function coverUrl(site: string, imageId: string | undefined, full = false): string {
    if (!imageId) {
        return URL(site).addPathComponent("image").addPathComponent("none.webp").build();
    }
    const url = URL(api(site)).addPathComponent("image").addPathComponent(imageId);
    if (!full) {
        url.addPathComponent("compressed");
    }
    return url.build();
}

// One shared fetch per session; failures are dropped so the next caller retries.
function sessionList<T>(load: (site: string) => Promise<T>): (site: string) => Promise<T> {
    const cache = new Map<string, Promise<T>>();
    return (site) => {
        let entry = cache.get(site);
        if (entry === undefined) {
            entry = load(site).catch((error: unknown) => {
                cache.delete(site);
                throw error;
            });
            cache.set(site, entry);
        }
        return entry;
    };
}

export const fetchGenres = sessionList(async (site) => {
    const genres = await getJson<GenreEntry[]>(`${api(site)}/genres/list`);
    if (genres.length === 0) {
        throw new Error("Kagane returned no genres.");
    }
    return genres;
});

// ~1.8 MB; only fetched when a tag name is typed or hidden.
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

let integrity: { token: string; expiresAt: number; site: string } | undefined;
let pendingIntegrity: Promise<string> | undefined;

// Minted against session cookies, so the front page is loaded first to warm them.
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
            // A token from before a challenge belongs to the replaced session
            integrity = undefined;
            throw error;
        } finally {
            pendingIntegrity = undefined;
        }
    })();

    return pendingIntegrity;
}

// Retries once with a fresh integrity token; a second refusal is reported.
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

function trustedCacheUrl(value: string | null | undefined, site: string): string {
    const candidate = (value ?? "").replace(/\/+$/, "");
    // Control characters could pass the host check and be normalised away later
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

const PAGE_PATH = /\/api\/v2\/books\/page\/([0-9a-f-]{36})\/([^/?#]+)\?(?:[^#]*&)?token=([^&#]+)/i;

const PAGE_TOKEN_MARGIN_MS = 30_000; // Leaves time for the download itself

// Keyed by chapter so concurrent pages share one renewal.
const renewals = new Map<string, Promise<{ cacheUrl: string; token: string; expiresAt: number; files: Set<string> }>>();
const RENEWAL_LIMIT = 8;

export function tokenExpiry(token: string): number | undefined {
    try {
        const claims: unknown = JSON.parse(Application.base64Decode(token.split(".")[1] ?? ""));
        const exp = typeof claims === "object" && claims !== null ? (claims as { exp?: unknown }).exp : undefined;
        return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
    } catch {
        return undefined;
    }
}

// Access tokens last 20 minutes and pages load lazily, so a chapter left open would stop
// loading. Expiring pages get a renewed session, matched by file name since the CDN may change.
export async function freshPageUrl(site: string, url: string, now = Date.now()): Promise<string> {
    const match = PAGE_PATH.exec(url);
    const [, chapterId, fileName, token] = match ?? [];
    if (chapterId === undefined || fileName === undefined || token === undefined) {
        return url;
    }

    const expiresAt = tokenExpiry(decodeURIComponent(token));
    if (expiresAt === undefined || expiresAt - PAGE_TOKEN_MARGIN_MS > now) {
        return url;
    }

    // Read before any await, so a concurrent page cannot start a second renewal
    const pending = renewals.get(chapterId);
    let session = pending !== undefined ? await pending.catch(() => undefined) : undefined;
    const newer = renewals.get(chapterId);
    if (newer !== undefined && newer !== pending) {
        session = await newer.catch(() => undefined);
    }
    if (session === undefined || session.expiresAt - PAGE_TOKEN_MARGIN_MS <= now) {
        const renewal = openReader(site, chapterId).then((opened) => ({
            cacheUrl: opened.cache_url,
            token: opened.access_token,
            // Unreadable expiry: renew again in a minute rather than never
            expiresAt: tokenExpiry(opened.access_token) ?? now + 2 * PAGE_TOKEN_MARGIN_MS,
            files: new Set((opened.manifest?.pages ?? []).map((page) => `${page.page_id}.${page.ext ?? "jxl"}`)),
        }));
        renewals.delete(chapterId);
        renewals.set(chapterId, renewal);
        for (const key of renewals.keys()) {
            if (renewals.size <= RENEWAL_LIMIT) break;
            renewals.delete(key);
        }
        // Drop failures so the next page retries
        renewal.catch(() => {
            if (renewals.get(chapterId) === renewal) renewals.delete(chapterId);
        });
        session = await renewal;
    }

    if (!session.files.has(fileName)) {
        throw new Error("Kagane changed this chapter's pages. Reopen the chapter.");
    }
    return pageUrl(session.cacheUrl, chapterId, fileName, session.token);
}
