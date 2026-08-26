/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import type {
    Chapter as RuntimeChapter,
    ChapterDetails as RuntimeChapterDetails,
    HomeSection,
    PagedResults as RuntimePagedResults,
    PartialSourceManga,
    SourceManga as RuntimeSourceManga,
    TagSection as RuntimeTagSection,
} from "@paperback/types";

import {
    ContentRating,
    type Chapter,
    type ChapterDetails,
    type DiscoverSectionItem,
    type SearchResultItem,
    type SourceManga,
    type TagSection,
} from "./Types";
import { homeSectionType } from "./Discover";
import type { DiscoverSection } from "./Types";

/**
 * Turns a source's series model into the runtime's.
 *
 * 0.8 carries a single `titles` list rather than a primary title plus
 * alternates, and marks explicit content with a `hentai` flag instead of a
 * three-level rating, so both are folded down here.
 */
export function toSourceManga(manga: SourceManga): RuntimeSourceManga {
    const info = manga.mangaInfo;

    return App.createSourceManga({
        id: manga.mangaId,
        mangaInfo: App.createMangaInfo({
            image: info.thumbnailUrl,
            titles: [info.primaryTitle, ...info.secondaryTitles].filter(
                (title, index, all) => title.length > 0 && all.indexOf(title) === index,
            ),
            desc: info.synopsis,
            status: info.status,
            hentai: info.contentRating === ContentRating.ADULT,
            author: info.author,
            artist: info.artist,
            banner: info.bannerUrl,
            rating: info.rating,
            tags: (info.tagGroups ?? []).map(toTagSection),
            covers: [info.thumbnailUrl].filter((url) => url.length > 0),
            additionalInfo: info.additionalInfo,
        }),
    });
}

export function toTagSection(section: TagSection): RuntimeTagSection {
    return App.createTagSection({
        id: section.id,
        label: section.title,
        tags: section.tags.map((tag) => App.createTag({ id: tag.id, label: tag.title })),
    });
}

/**
 * Turns a source's chapter into the runtime's.
 *
 * 0.8 sorts purely on `chapNum` and `sortingIndex`, and has no place for the
 * owning series, so the parent reference is dropped.
 */
export function toChapter(chapter: Chapter): RuntimeChapter {
    return App.createChapter({
        id: chapter.chapterId,
        chapNum: chapter.chapNum,
        name: chapter.title,
        volume: chapter.volume,
        group: chapter.group,
        time: chapter.publishDate,
        langCode: chapter.langCode ?? "🇬🇧",
        sortingIndex: chapter.sortingIndex,
    });
}

export function toChapterDetails(details: ChapterDetails): RuntimeChapterDetails {
    return App.createChapterDetails({
        id: details.id,
        mangaId: details.mangaId,
        pages: details.pages,
    });
}

/** Turns a search result into the tile the app renders. */
export function toPartialFromSearch(item: SearchResultItem): PartialSourceManga {
    return App.createPartialSourceManga({
        mangaId: item.mangaId,
        title: item.title,
        image: item.imageUrl,
        subtitle: item.subtitle,
    });
}

/**
 * Turns a home page entry into the tile the app renders.
 *
 * Chapter-update entries carry their newest chapter separately; 0.8 has only
 * the one subtitle line, so that is what it gets.
 */
export function toPartialFromDiscover(item: DiscoverSectionItem): PartialSourceManga {
    return App.createPartialSourceManga({
        mangaId: item.mangaId,
        title: item.title,
        image: item.imageUrl,
        subtitle: item.subtitle ?? item.chapterId,
    });
}

export function toPagedResults(results: PartialSourceManga[], metadata: unknown): RuntimePagedResults {
    return App.createPagedResults({
        results,
        // A section with no follow-up page must report no metadata, otherwise
        // the app keeps asking for more and repeats the last page forever.
        metadata: metadata ?? undefined,
    });
}

export function toHomeSection(
    section: DiscoverSection,
    items: PartialSourceManga[],
    containsMoreItems: boolean,
): HomeSection {
    return App.createHomeSection({
        id: section.id,
        title: section.title,
        type: homeSectionType(section.type),
        items,
        containsMoreItems,
    });
}
