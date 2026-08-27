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
    isCloudflareChallenge,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import {
    API_URL,
    DOMAIN,
    PAGE_SIZE,
    type LuaChapter,
    type LuaQueryResponse,
    type LuaTag,
    type LuaTrendingItem,
    type OptionItem,
    type QueryRequest,
} from "./models";

const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i;

export class LuaComicInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${DOMAIN}/`,
                origin: DOMAIN,
                "user-agent": await Application.getDefaultUserAgent(),
                accept: IMAGE_URL.test(request.url)
                    ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
                    : "application/json, text/html, */*",
                "accept-language": "en-US,en;q=0.5",
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

        if (isCloudflareChallenge(response.status, response.headers, text)) {
            throw new CloudflareError(
                Application.createRequest({
                    url: request.url,
                    method: request.method,
                    headers: { "user-agent": await Application.getDefaultUserAgent() },
                }),
            );
        }

        return body;
    }
}

export function fetchText(url: string): Promise<string> {
    return Application.fetchText({ url, method: "GET" });
}

/** The tags endpoint often answers with nothing; callers fall back to a list. */
export async function fetchTags(): Promise<OptionItem[]> {
    const raw = await Application.fetchJSON<LuaTag[] | { data?: LuaTag[] }>({
        url: URL(API_URL).addPathComponent("tags").build(),
    });

    const tags = Array.isArray(raw) ? raw : (raw.data ?? []);

    return tags
        .filter((tag): tag is LuaTag => Boolean(tag.name) && tag.id !== null && tag.id !== undefined)
        .map((tag) => ({ id: String(tag.id), value: String(tag.name).trim() }));
}

export function fetchQuery(request: QueryRequest): Promise<LuaQueryResponse> {
    const url = URL(API_URL)
        .addPathComponent("query")
        .setQueryItem("page", request.page)
        .setQueryItem("perPage", PAGE_SIZE)
        .setQueryItem("series_type", "Comic")
        .setQueryItem("adult", request.adult ? "true" : "false")
        .setQueryItem("orderBy", request.orderBy ?? "created_at")
        .setQueryItem("status", request.status)
        .setQueryItem("query_string", request.search);

    // The endpoint takes tag ids, so a genre it does not number is dropped.
    const numericIds = (request.genres ?? []).filter((id) => /^\d+$/.test(id));
    if (numericIds.length > 0) {
        url.setQueryItem("tags_ids", `[${numericIds.join(",")}]`);
    }

    return Application.fetchJSON<LuaQueryResponse>({ url: url.build() });
}

export function fetchTrending(range: string): Promise<LuaTrendingItem[]> {
    return Application.fetchJSON<LuaTrendingItem[]>({
        url: URL(API_URL).addPathComponent("trending").setQueryItem("type", range).build(),
    });
}

export function fetchAllChapters(slug: string): Promise<LuaChapter[]> {
    return Application.fetchJSON<LuaChapter[]>({
        url: URL(API_URL).addPathComponent("chapter").addPathComponent("all").addPathComponent(slug).build(),
    });
}

export function fetchHomePage(): Promise<string> {
    return fetchText(`${DOMAIN}/`);
}

export function fetchSeriesPage(slug: string): Promise<string> {
    return fetchText(`${DOMAIN}/series/${slug}`);
}

export function fetchChapterPage(seriesSlug: string, chapterSlug: string): Promise<string> {
    return fetchText(`${DOMAIN}/series/${seriesSlug}/${chapterSlug}`);
}

export function mangaUrl(slug: string): string {
    return `${DOMAIN}/series/${slug}`;
}
