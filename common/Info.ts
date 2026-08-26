import { BadgeColor, ContentRating as RuntimeContentRating, SourceIntents, type Badge, type SourceInfo } from "@paperback/types";

import { ContentRating } from "./Types";

/** The things a source can do, named rather than expressed as bit flags. */
export enum Capability {
    /** Provides chapters and pages. Every source here does. */
    CHAPTERS = "chapters",
    /** Fills the home page with sections. */
    HOME_PAGE = "homePage",
    /** Needs a Cloudflare session before it can read anything. */
    CLOUDFLARE = "cloudflare",
    /** Has a settings screen. */
    SETTINGS = "settings",
    /** Reports reading progress back to the site. */
    TRACKING = "tracking",
}

const INTENT_FOR: Record<Capability, SourceIntents> = {
    [Capability.CHAPTERS]: SourceIntents.MANGA_CHAPTERS,
    [Capability.HOME_PAGE]: SourceIntents.HOMEPAGE_SECTIONS,
    [Capability.CLOUDFLARE]: SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
    [Capability.SETTINGS]: SourceIntents.SETTINGS_UI,
    [Capability.TRACKING]: SourceIntents.MANGA_TRACKING,
};

/** Everything a source declares about itself. */
export interface SourceDescription {
    name: string;
    description: string;
    version: string;
    icon: string;
    websiteBaseURL: string;
    contentRating: ContentRating;
    capabilities: Capability[];
    language?: string;
    badges?: Badge[];
}

/**
 * Builds the info object the app reads when listing sources.
 *
 * Capabilities are folded into the single bit field 0.8 expects, and a
 * language badge is added so the repository listing shows one without every
 * source having to spell it out.
 */
export function sourceInfo(description: SourceDescription): SourceInfo {
    const intents = description.capabilities.reduce<number>(
        (mask, capability) => mask | INTENT_FOR[capability],
        0,
    );

    const badges: Badge[] = [...(description.badges ?? [])];
    if (description.language !== undefined) {
        badges.unshift({ text: description.language, type: BadgeColor.GREY });
    }

    return {
        name: description.name,
        description: description.description,
        version: description.version,
        icon: description.icon,
        author: "Popmango",
        authorWebsite: "https://github.com/PoppingMangoSources",
        websiteBaseURL: description.websiteBaseURL,
        contentRating: runtimeRating(description.contentRating),
        language: description.language,
        sourceTags: badges,
        intents,
    };
}

function runtimeRating(rating: ContentRating): RuntimeContentRating {
    switch (rating) {
        case ContentRating.ADULT:
            return RuntimeContentRating.ADULT;
        case ContentRating.MATURE:
            return RuntimeContentRating.MATURE;
        case ContentRating.EVERYONE:
            return RuntimeContentRating.EVERYONE;
    }
}
