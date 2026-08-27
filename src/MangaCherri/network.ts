/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

import {
    Application,
    PaperbackInterceptor,
    type InterceptedRequest,
} from "../../common";

const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif)([?#]|$)/i;

/** One lookup for the whole session rather than one per request. */
let userAgent: Promise<string> | undefined;

function getUserAgent(): Promise<string> {
    return (userAgent ??= Application.getDefaultUserAgent());
}

/** The theme serves placeholder art to clients arriving without a referer. */
export class MangaCherriInterceptor extends PaperbackInterceptor {
    private readonly getBaseUrl: () => string;

    constructor(getBaseUrl: () => string) {
        super();
        this.getBaseUrl = getBaseUrl;
    }

    override async interceptRequest(request: InterceptedRequest): Promise<InterceptedRequest> {
        const isImage = IMAGE_URL.test(request.url);

        return {
            ...request,
            headers: {
                ...request.headers,
                referer: `${this.getBaseUrl()}/`,
                "user-agent": await getUserAgent(),
                "accept-language": "en-US,en;q=0.9",
                accept: isImage
                    ? "image/avif,image/webp,image/apng,image/png,image/*,*/*;q=0.8"
                    : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        };
    }
}

export function fetchHtml(url: string): Promise<string> {
    return Application.fetchText({ url });
}
