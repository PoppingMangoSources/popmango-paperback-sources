/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type { Response } from "@paperback/types";

import {
    Application,
    CloudflareError,
    PaperbackInterceptor,
    URL,
    headerValue,
    type InterceptedRequest,
    type ResponseBody,
} from "../../common";

import { CONTENT_RATING_OPTIONS, DOMAIN, TYPE_OPTIONS, type BrowseOptions, type Preferences } from "./models";

const IMAGE_PATH = /\/i\/[cp]\/|\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;

export class YaoiMeInterceptor extends PaperbackInterceptor {
    constructor(
        private readonly preferences: () => Preferences,
        private readonly homeRows: () => string[],
    ) {
        super();
    }

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const preferences = this.preferences();
        // The site reads its content filters from this cookie, so listings match the reader's settings.
        const settings = encodeURIComponent(
            JSON.stringify({
                chapterLangs: preferences.chapterLanguages,
                hiddenRatings: CONTENT_RATING_OPTIONS.map(({ id }) => id).filter((id) => !preferences.contentRatings.includes(id)),
                hiddenTags: preferences.hiddenTags,
                hiddenTypes: [...TYPE_OPTIONS.map(({ id }) => id), "novel"].filter((id) => !preferences.contentTypes.includes(id)),
                // The home page renders only the rows listed here
                home: this.homeRows(),
                officialOnly: preferences.officialOnly,
            }),
        );

        return {
            ...request,
            cookies: { ...request.cookies, "yf.adult": "1", "yf.settings": settings },
            headers: {
                ...request.headers,
                accept:
                    request.headers.accept ??
                    (IMAGE_PATH.test(request.url)
                        ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
                        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
                "accept-language": "en-US,en;q=0.8",
                referer: request.headers.referer ?? `${DOMAIN}/`,
                "user-agent": await userAgent(),
            },
        };
    }

    override async interceptResponse(
        request: InterceptedRequest,
        response: Response,
        body: ResponseBody,
    ): Promise<ResponseBody> {
        // Only challenge statuses are sniffed, so an ordinary page mentioning Turnstile cannot loop the bypass
        const challengeStatus = response.status === 403 || response.status === 503;
        const html = (headerValue(response.headers, "content-type") ?? "").includes("text/html");
        if (
            headerValue(response.headers, "cf-mitigated")?.toLowerCase() === "challenge" ||
            (challengeStatus && html && /Just a moment|cf-chl-|_cf_chl_opt|siteKey.{0,16}0x4/i.test(body.text))
        ) {
            throw new CloudflareError(
                Application.createRequest({
                    url: IMAGE_PATH.test(request.url) ? `${DOMAIN}/` : request.url,
                    method: "GET",
                    headers: { "user-agent": await userAgent() },
                }),
            );
        }
        return body;
    }
}

// Requests without a User-Agent are refused with 403; the app always has one, test runners may not.
export async function userAgent(): Promise<string> {
    return (
        (await Application.getDefaultUserAgent()) ||
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    );
}

export function fetchHtml(url: string): Promise<string> {
    return Application.fetchText({ url, method: "GET" });
}

export function browseUrl(options: BrowseOptions): string {
    const [sort = "update", dir = "desc"] = options.sort.split("-");
    const url = URL(DOMAIN).addPathComponent("browse").setQueryItem("page", options.page).setQueryItem("sort", sort).setQueryItem("dir", dir);
    const entries: Array<[string, string | string[] | undefined]> = [
        ["q", options.query?.trim() || undefined],
        ["anime", options.anime ? "1" : undefined],
        ["lang", options.languages],
        ["genre", options.genres],
        ["without", options.withoutGenres],
        ["tags", options.tags],
        ["withoutTags", options.withoutTags],
        ["author", options.author],
        ["artist", options.artist],
        ["publisher", options.publisher],
        ["type", options.types],
        ["status", options.statuses],
        ["content", options.ratings],
        ["demographic", options.demographics],
        ["yearFrom", options.yearFrom],
        ["yearTo", options.yearTo],
        ["minChapters", options.minChapters],
        ["maxChapters", options.maxChapters],
        ["minPages", options.minPages],
        ["minRating", options.minRating],
        ["maxRating", options.maxRating],
        ["updatedWithin", options.updatedWithin],
        ["licensed", options.licensed ? "1" : undefined],
    ];
    for (const [key, value] of entries) {
        if (value === undefined || (Array.isArray(value) && value.length === 0)) {
            continue;
        }
        url.setQueryItem(key, Array.isArray(value) ? value.join(",") : value);
    }
    return url.build();
}
