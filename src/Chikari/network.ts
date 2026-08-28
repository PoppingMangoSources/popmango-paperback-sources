/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { Response } from "@paperback/types";

import {
    Application,
    CloudflareError,
    PaperbackInterceptor,
    URL,
    UrlBuilder,
    headerValue,
    isCloudflareChallenge,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import {
    API_URL,
    DOMAIN,
    PAGE_SIZE,
    type ChapterDetailsResponse,
    type ChapterListResponse,
    type ChikariPreferences,
    type GenreOption,
    type HomeResponse,
    type SeriesDetails,
    type SeriesListResponse,
    type SeriesQueryOptions,
    type TagOption,
} from "./models";

/**
 * Completes a mobile Safari user agent the app hands over half-finished.
 *
 * The site serves a stripped page to anything it cannot place as a real
 * browser, and an agent naming an iPhone without a Safari token is exactly
 * that.
 */
function completeMobileSafariUserAgent(userAgent: string): string {
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

let userAgent: Promise<string> | undefined;

function getUserAgent(): Promise<string> {
    return (userAgent ??= Application.getDefaultUserAgent().then(completeMobileSafariUserAgent));
}

export class ChikariInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        return {
            ...request,
            headers: {
                ...request.headers,
                accept: request.url.startsWith(API_URL)
                    ? "application/json, text/plain, */*"
                    : (request.headers.accept ?? "*/*"),
                origin: DOMAIN,
                referer: `${DOMAIN}/`,
                "user-agent": await getUserAgent(),
            },
        };
    }

    override async interceptResponse(
        _request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        const contentType = headerValue(response.headers, "content-type") ?? "";
        const text = contentType.includes("text/html") ? body.text : "";

        if (isCloudflareChallenge(response.status, response.headers, text)) {
            // The API cannot render the challenge, so it is sent to the site
            // root where the reader can actually clear it.
            throw new CloudflareError(
                Application.createRequest({
                    url: `${DOMAIN}/`,
                    method: "GET",
                    headers: { "user-agent": await getUserAgent() },
                }),
            );
        }

        return body;
    }
}

function apiUrl(...segments: string[]): UrlBuilder {
    const url = URL(API_URL);
    for (const segment of segments) {
        url.addPathComponent(segment);
    }
    return url;
}

/** Applies the reader's settings, which narrow every listing the same way. */
function addPreferences(url: UrlBuilder, preferences: ChikariPreferences): UrlBuilder {
    url.setQueryItem("adult", String(preferences.adult))
        .setQueryItem("content_rating", preferences.contentRatings.join(","))
        .setQueryItem("type", preferences.types);

    if (preferences.excludedGenres.length > 0) {
        url.setQueryItem("genre_exclude", preferences.excludedGenres);
    }
    if (preferences.excludedTags.length > 0) {
        url.setQueryItem("tag_exclude", preferences.excludedTags);
    }

    return url;
}

export function fetchHome(preferences: ChikariPreferences): Promise<HomeResponse> {
    return Application.fetchJSON<HomeResponse>({ url: addPreferences(apiUrl("home"), preferences).build() });
}

export function fetchGenres(adult: boolean): Promise<GenreOption[]> {
    return Application.fetchJSON<GenreOption[]>({
        url: apiUrl("genres").setQueryItem("adult", String(adult)).build(),
    });
}

export function fetchTags(adult: boolean): Promise<TagOption[]> {
    return Application.fetchJSON<TagOption[]>({
        url: apiUrl("tags").setQueryItem("adult", String(adult)).build(),
    });
}

function buildSeriesUrl(options: SeriesQueryOptions): string {
    // Trending is ranked over a window, which the site expresses in the sort.
    const sort = options.sort === "trending" && options.period ? `trending-${options.period}` : options.sort;

    const url = apiUrl("series")
        .setQueryItem("sort", sort)
        .setQueryItem("adult", String(options.adult))
        .setQueryItem("content_rating", options.contentRatings.join(","))
        .setQueryItem("limit", options.limit ?? PAGE_SIZE)
        .setQueryItem("offset", options.offset)
        .setQueryItem("q", options.query)
        .setQueryItem("type", options.types)
        .setQueryItem("genre", options.genres)
        .setQueryItem("genre_exclude", options.excludedGenres)
        .setQueryItem("tag", options.tags)
        .setQueryItem("tag_exclude", options.excludedTags)
        .setQueryItem("status", options.statuses)
        .setQueryItem("year", options.years)
        .setQueryItem("period", options.period);

    if (options.minChapters !== undefined) {
        url.setQueryItem("min_chapters", options.minChapters);
    }

    return url.build();
}

export function fetchSeries(options: SeriesQueryOptions): Promise<SeriesListResponse> {
    return Application.fetchJSON<SeriesListResponse>({ url: buildSeriesUrl(options) });
}

export function fetchSeriesDetails(slug: string): Promise<SeriesDetails> {
    return Application.fetchJSON<SeriesDetails>({ url: apiUrl("series", slug).build() });
}

export function fetchChapters(slug: string): Promise<ChapterListResponse> {
    return Application.fetchJSON<ChapterListResponse>({
        url: apiUrl("series", slug, "chapters")
            .setQueryItem("order", "asc")
            .setQueryItem("limit", 100000)
            .setQueryItem("offset", 0)
            .build(),
    });
}

export function fetchChapterDetails(slug: string, chapterId: string): Promise<ChapterDetailsResponse> {
    return Application.fetchJSON<ChapterDetailsResponse>({
        url: apiUrl("series", slug, "chapters", chapterId).build(),
    });
}

export function mangaUrl(slug: string): string {
    return `${DOMAIN}/series/${slug}`;
}
