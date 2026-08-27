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
    CONTENT_TYPE,
    DOMAIN,
    type BannerResponse,
    type ChapterListResponse,
    type ChapterPagesResponse,
    type GenreResponse,
    type PopularPeriod,
    type PopularSeriesResponse,
    type Series,
    type SeriesQuery,
    type SeriesResponse,
} from "./models";

const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif|svg)(\/|\?|#|$)/i;

export class StoneScapeInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${DOMAIN}/`,
                origin: DOMAIN,
                "user-agent": await Application.getDefaultUserAgent(),
                accept:
                    request.headers.accept ??
                    (isImage
                        ? "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
                        : "application/json, text/plain, */*"),
                "accept-language": "en-US,en;q=0.9",
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
        const challenged =
            isCloudflareChallenge(response.status, response.headers, text) ||
            (response.status === 403 && request.url.startsWith(DOMAIN));

        if (challenged) {
            // An API route cannot render the challenge, so it is sent to the
            // site root where the reader can actually clear it.
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

function apiUrl(...segments: string[]): UrlBuilder {
    const url = URL(API_URL);
    for (const segment of segments) {
        url.addPathComponent(segment);
    }
    return url;
}

export function buildSeriesUrl(query: SeriesQuery): string {
    return apiUrl("series")
        .setQueryItem("page", query.page)
        .setQueryItem("limit", query.limit ?? 20)
        .setQueryItem("contentType", CONTENT_TYPE)
        .setQueryItem("genres", query.genres !== undefined ? query.genres.join(",") : undefined)
        .setQueryItem("status", query.status)
        .setQueryItem("search", query.search)
        // "latest" is the endpoint's own default and it rejects it as a value.
        .setQueryItem("sort", query.sort === "latest" ? undefined : query.sort)
        .build();
}

export function fetchSeries(query: SeriesQuery): Promise<SeriesResponse> {
    return Application.fetchJSON<SeriesResponse>({ url: buildSeriesUrl(query) });
}

export function fetchBanner(): Promise<BannerResponse> {
    return Application.fetchJSON<BannerResponse>({ url: apiUrl("banner-config").build() });
}

export function fetchPopular(period: PopularPeriod, limit: number): Promise<PopularSeriesResponse> {
    return Application.fetchJSON<PopularSeriesResponse>({
        url: apiUrl("series", "popular")
            .setQueryItem("period", period)
            .setQueryItem("contentType", CONTENT_TYPE)
            .setQueryItem("limit", limit)
            .build(),
    });
}

export function fetchGenres(): Promise<GenreResponse> {
    return Application.fetchJSON<GenreResponse>({ url: apiUrl("genres").build() });
}

export function fetchSeriesDetails(slug: string): Promise<Series> {
    return Application.fetchJSON<Series>({ url: apiUrl("series", "by-slug", slug).build() });
}

export function fetchChapters(slug: string): Promise<ChapterListResponse> {
    return Application.fetchJSON<ChapterListResponse>({
        url: apiUrl("series", "by-slug", slug, "chapters").build(),
    });
}

export function fetchChapterPages(chapterId: string): Promise<ChapterPagesResponse> {
    return Application.fetchJSON<ChapterPagesResponse>({
        url: apiUrl("chapters", chapterId, "pages").build(),
    });
}

export function mangaUrl(slug: string): string {
    return `${DOMAIN}/series/${slug}`;
}
