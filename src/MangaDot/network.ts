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
    DOMAIN,
    type ChapterEntry,
    type ChapterImagesResponse,
    type MangaDataResponse,
    type MangaSection,
    type PeopleResponse,
    type SearchResponse,
    type SectionId,
} from "./models";

/**
 * The page a challenge is cleared on.
 *
 * Every request goes to the JSON API, which cannot show the challenge, and
 * passing it on the site clears the whole domain.
 */
const challenge = async (): Promise<CloudflareError> =>
    new CloudflareError(
        Application.createRequest({
            url: `${DOMAIN}/`,
            method: "GET",
            headers: { "user-agent": await Application.getDefaultUserAgent() },
        }),
    );

export class MangaDotInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        return {
            ...request,
            headers: {
                "user-agent": await Application.getDefaultUserAgent(),
                ...request.headers,
            },
        };
    }

    override async interceptResponse(
        _request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        if (headerValue(response.headers, "cf-mitigated")?.toLowerCase() === "challenge") {
            throw await challenge();
        }
        return body;
    }
}

type Query = Record<string, string | number | undefined>;

const apiUrl = (path: Array<string | number>, query: Query = {}): string => {
    const url = URL(DOMAIN).addPathComponent("api");
    for (const segment of path) {
        url.addPathComponent(segment);
    }
    for (const [key, value] of Object.entries(query)) {
        url.setQueryItem(key, value);
    }
    return url.build();
};

const fetchJson = async <T>(url: string, headers: Record<string, string> = {}): Promise<T> => {
    const [response, body] = await Application.scheduleRequest({
        url,
        method: "GET",
        headers: { accept: "application/json", ...headers },
    });

    if (isCloudflareChallenge(response.status, response.headers, body.text)) {
        throw await challenge();
    }
    if (response.status === 404) {
        throw new Error(`Not found on MangaDot: ${url}`);
    }
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`MangaDot answered ${response.status}: ${url}`);
    }

    try {
        return JSON.parse(body.text) as T;
    } catch {
        // A challenge page that arrived without its usual status is still one.
        if (/^\s*<(?:!doctype|html)/i.test(body.text)) {
            throw await challenge();
        }
        throw new Error(`MangaDot's answer could not be read: ${url}`);
    }
};

export const fetchSearch = (query: Query): Promise<SearchResponse> => fetchJson(apiUrl(["search"], query));

/** A ranked row over all time, paged like a search. */
export const fetchRankedSection = (section: SectionId, query: Query): Promise<SearchResponse> =>
    fetchJson(apiUrl(["manga", "section", section.replace(/_/g, "-")], query));

/** A row the site serves as a single list: the latest updates, or a ranking over a day, week or month. */
export const fetchSectionList = (id: string, query: Query): Promise<MangaSection> =>
    fetchJson(apiUrl(["manga", "section"], { id, ...query }));

export const fetchManga = (mangaId: string): Promise<MangaDataResponse> => fetchJson(apiUrl(["manga", mangaId]));

export const fetchChapterList = (mangaId: string): Promise<ChapterEntry[]> =>
    fetchJson(apiUrl(["manga", mangaId, "chapters", "list"]));

export const fetchChapterImages = (
    chapterId: string,
    mangaId: string,
    trusted: boolean,
): Promise<ChapterImagesResponse> =>
    fetchJson(apiUrl([trusted ? "uploads" : "chapters", chapterId, "images"]), {
        referer: `${DOMAIN}/manga/${mangaId}`,
    });

export const fetchGenres = (): Promise<string[]> => fetchJson(apiUrl(["manga", "genres"]));

export const fetchPeople = (kind: "author" | "artist", name: string): Promise<PeopleResponse> =>
    fetchJson(apiUrl(["manga", "people-suggest"], { kind, q: name }));
