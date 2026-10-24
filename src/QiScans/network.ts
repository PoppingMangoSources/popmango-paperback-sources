/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { Response } from "@paperback/types";

import {
    Application,
    CloudflareError,
    PaperbackInterceptor,
    URL,
    type UrlBuilder,
    headerValue,
    isCloudflareChallenge,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import {
    API,
    DOMAIN,
    LATEST_PAGE_SIZE,
    PAGE_SIZE,
    type ChapterContent,
    type ChapterItem,
    type ChapterPage,
    type Genre,
    type HomeResponse,
    type SeriesDetails,
    type SeriesPage,
} from "./models";

export class QiScansInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        return {
            ...request,
            headers: {
                ...request.headers,
                origin: DOMAIN,
                referer: `${DOMAIN}/`,
                "user-agent": await Application.getDefaultUserAgent(),
            },
        };
    }

    override async interceptResponse(
        _request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        // The API answers errors in JSON; only an HTML page can be the interstitial
        const html = (headerValue(response.headers, "content-type") ?? "").toLowerCase().includes("text/html");
        const mitigated = headerValue(response.headers, "cf-mitigated")?.toLowerCase() === "challenge";
        if (mitigated || (html && isCloudflareChallenge(response.status, response.headers, body.text))) {
            throw new CloudflareError(
                Application.createRequest({
                    url: `${DOMAIN}/`,
                    method: "GET",
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }
        return body;
    }
}

async function getJson<T>(url: string): Promise<T> {
    const [response, body] = await Application.scheduleRequest({
        url,
        method: "GET",
        headers: { accept: "application/json" },
    });

    let parsed: unknown;
    try {
        parsed = JSON.parse(body.text);
    } catch {
        throw new Error(`Qi Scans returned a response that could not be read (HTTP ${response.status}).`);
    }

    if (response.status >= 400) {
        // Validation errors arrive as { message: string[] }
        const message = (parsed as { message?: unknown }).message;
        const reason = Array.isArray(message) ? message.join("; ") : typeof message === "string" ? message : "";
        throw new Error(
            response.status === 404
                ? "Qi Scans no longer lists this title."
                : `Qi Scans rejected the request (HTTP ${response.status})${reason ? `: ${reason}` : "."}`,
        );
    }
    return parsed as T;
}

const series = (): UrlBuilder => URL(API).addPathComponent("series");

export function fetchHome(): Promise<HomeResponse> {
    return getJson<HomeResponse>(URL(API).addPathComponent("home").build());
}

export function fetchGenres(): Promise<Genre[]> {
    return getJson<Genre[]>(series().addPathComponent("genres").build());
}

export function fetchLatest(page: number): Promise<SeriesPage> {
    return getJson<SeriesPage>(
        URL(API).addPathComponent("home").addPathComponent("latest").setQueryItem("page", page).setQueryItem("perPage", LATEST_PAGE_SIZE).build(),
    );
}

export interface SeriesFilters {
    sort: string;
    type?: string;
    status?: string;
    genres: string[];
}

export function fetchSeriesList(page: number, filters: SeriesFilters): Promise<SeriesPage> {
    const url = series().setQueryItem("page", page).setQueryItem("perPage", PAGE_SIZE).setQueryItem("sort", filters.sort);
    if (filters.type) url.setQueryItem("type", filters.type);
    if (filters.status) url.setQueryItem("status", filters.status);
    // `genre` takes one slug; `genres` takes several and matches all of them
    if (filters.genres.length === 1) url.setQueryItem("genre", filters.genres[0]);
    if (filters.genres.length > 1) url.setQueryItem("genres", filters.genres.join(","));
    return getJson<SeriesPage>(url.build());
}

// The search endpoint takes no filters; it rejects any it is sent.
export function searchSeries(query: string, page: number): Promise<SeriesPage> {
    return getJson<SeriesPage>(
        series()
            .addPathComponent("search")
            .setQueryItem("q", query)
            .setQueryItem("page", page)
            .setQueryItem("perPage", PAGE_SIZE)
            .build(),
    );
}

export function fetchSeries(slug: string): Promise<SeriesDetails> {
    return getJson<SeriesDetails>(series().addPathComponent(slug).build());
}

// One page at a time: a burst of parallel pages trips the site's rate limit.
export async function fetchAllChapters(slug: string): Promise<ChapterItem[]> {
    const chapters: ChapterItem[] = [];
    let page = 1;
    for (;;) {
        const result = await getJson<ChapterPage>(
            series()
                .addPathComponent(slug)
                .addPathComponent("chapters")
                .setQueryItem("page", page)
                .setQueryItem("perPage", PAGE_SIZE)
                .setQueryItem("sort", "desc")
                .build(),
        );
        chapters.push(...(result.data ?? []));
        if (result.next === null || result.next <= page || page >= result.totalPages) {
            return chapters;
        }
        page = result.next;
    }
}

export function fetchChapter(slug: string, chapterSlug: string): Promise<ChapterContent> {
    return getJson<ChapterContent>(
        series().addPathComponent(slug).addPathComponent("chapters").addPathComponent(chapterSlug).build(),
    );
}

export const seriesUrl = (slug: string): string => URL(DOMAIN).addPathComponent("series").addPathComponent(slug).build();
