/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import type { CheerioAPI } from "cheerio";
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

import { DOMAIN, MANGA_DIR, type DirectoryRequest } from "./models";

const IMAGE_URL = /\.(avif|gif|jpe?g|jxl|png|svg|webp)([/?#]|$)/i;

export class GalaxyMangaInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: request.headers.referer ?? `${DOMAIN}/`,
                "user-agent": await Application.getDefaultUserAgent(),
                accept:
                    request.headers.accept ??
                    (isImage
                        ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
                        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
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

/**
 * Builds a directory URL.
 *
 * Genres share one parameter for both sides of the filter: an excluded genre
 * is sent as its slug prefixed with a minus.
 */
export function directoryUrl(page: number, request: DirectoryRequest = {}): string {
    const url = URL(DOMAIN).addPathComponent(`${MANGA_DIR}/`).setQueryItem("page", page);

    if (request.title !== undefined && request.title.length > 0) {
        url.setQueryItem("title", request.title);
    }
    if (request.order !== undefined) {
        url.setQueryItem("order", request.order);
    }
    if (request.status !== undefined) {
        url.setQueryItem("status", request.status);
    }
    if (request.type !== undefined) {
        url.setQueryItem("type", request.type);
    }

    const genres = [
        ...(request.includedGenres ?? []),
        ...(request.excludedGenres ?? []).map((slug) => `-${slug}`),
    ];
    if (genres.length > 0) {
        url.setQueryItem("genre[]", genres);
    }

    return url.build();
}

export function mangaUrl(mangaId: string): string {
    return `${DOMAIN}/${MANGA_DIR}/${mangaId}/`;
}

export function chapterUrl(chapterId: string): string {
    return `${DOMAIN}/${chapterId}/`;
}

export function fetchHomePage(): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: `${DOMAIN}/` });
}

export function fetchDirectoryPage(page: number, request: DirectoryRequest = {}): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: directoryUrl(page, request) });
}

export function fetchMangaPage(mangaId: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: mangaUrl(mangaId) });
}

export function fetchChapterPage(chapterId: string): Promise<CheerioAPI> {
    return Application.fetchDocument({ url: chapterUrl(chapterId) });
}
