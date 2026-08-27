/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * The shared runtime every source in this repository is built on.
 *
 * Import from here rather than from the individual files, so a source's
 * imports stay stable if the layout underneath changes.
 */

export { CloudflareError, headerValue, isCloudflareChallenge } from "./Cloudflare";
export { parseChapterNumber, parseDate } from "./Dates";
export { DiscoverSectionType } from "./Types";
export { Capability, SourceKind, sourceInfo, type SourceDescription } from "./Info";
export {
    BasicRateLimiter,
    CookieStorageInterceptor,
    PaperbackInterceptor,
    type InterceptedRequest,
} from "./Interceptor";
export { Application, assertOk, type RequestInit, type ResponseBody } from "./Runtime";
export { PopmangoSource, type SourceOptions } from "./Source";
export { SettingsStore, normaliseUrlOverride } from "./Settings";
export { inputRow, labelRow, selectRow, settingsMenu, switchRow, type MenuSection } from "./Menu";
export { URL, UrlBuilder, hostOf, originOf, resolveUrl } from "./UrlBuilder";
export {
    ContentRating,
    MangaStatus,
    type Chapter,
    type ChapterDetails,
    type DiscoverSection,
    type DiscoverSectionItem,
    type MangaInfo,
    type PagedResults,
    type SearchField,
    type SearchQuery,
    type SearchResultItem,
    type SortingOption,
    type SourceManga,
    type Tag,
    type TagSection,
} from "./Types";
