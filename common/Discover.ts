/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

import { HomeSectionType } from "@paperback/types";

import { DiscoverSectionType } from "./Types";

/**
 * Picks the closest 0.8 layout for a section style.
 *
 * 0.8 offers four layouts, so some styles collapse onto the same one. The
 * mapping keeps the visual weight the source asked for: a "look at this"
 * section stays large, an ordinary strip stays small.
 */
export function homeSectionType(type: DiscoverSectionType): HomeSectionType {
    switch (type) {
        case DiscoverSectionType.featured:
            return HomeSectionType.featured;

        case DiscoverSectionType.prominentCarousel:
            return HomeSectionType.singleRowLarge;

        case DiscoverSectionType.simpleCarousel:
        case DiscoverSectionType.chapterUpdates:
        case DiscoverSectionType.genres:
            return HomeSectionType.singleRowNormal;
    }
}

/**
 * Whether a section can be shown at all.
 *
 * A genre strip is a list of links rather than titles, and 0.8 has no tile
 * that can carry one — every entry would open a series that does not exist.
 * Sources declaring one have it dropped from the home page rather than
 * rendered into something broken; the genres remain reachable through search
 * filters.
 */
export function isRenderableSection(type: DiscoverSectionType): boolean {
    return type !== DiscoverSectionType.genres;
}
