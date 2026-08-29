/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Copyright © 2026 Popmango */

/**
 * Putting a scrambled page image back together.
 *
 * Some of the site's images arrive cut into a square grid of tiles that have
 * been shuffled. The reader page carries the order they belong in, and the
 * image itself is reassembled here before the app ever sees it.
 */

import type { RawData } from "@paperback/types";

import type { ImageContext } from "./models";

/** What each image needs, remembered when its chapter's pages were built. */
const contexts = new Map<string, ImageContext>();

/**
 * How many images are remembered at once.
 *
 * A chapter is a few dozen pages and a reader moves through several in a
 * sitting, so this is generous; the oldest are dropped once it is reached.
 */
const CONTEXT_LIMIT = 2000;

/** Only these images are scrambled; everything else is served as it is. */
export function isScrambledImageUrl(url: string): boolean {
    return url.includes("cspiclink");
}

function withoutFragment(url: string): string {
    const hash = url.indexOf("#");
    return hash >= 0 ? url.slice(0, hash) : url;
}

/**
 * Notes what an image will need, before the app asks for it.
 *
 * The app fetches page images itself, so by the time the interceptor sees one
 * there is nothing left to work out the tile order from. It is recorded here
 * while the chapter's page list is being built, keyed by the URL the app will
 * request.
 */
export function rememberImageContext(url: string, context: ImageContext): void {
    if (contexts.size >= CONTEXT_LIMIT) {
        const oldest = contexts.keys().next();
        if (oldest.done !== true) {
            contexts.delete(oldest.value);
        }
    }
    contexts.set(withoutFragment(url), context);
}

export function imageContextFor(url: string): ImageContext | undefined {
    return contexts.get(withoutFragment(url));
}

/**
 * Reassembles one image.
 *
 * The key names, for each tile in the order it arrives, where that tile
 * belongs. The whole image is laid down first so the strip left over by a
 * width that does not divide evenly survives, and the tiles are then moved
 * over the top of it.
 *
 * Returns the rebuilt image and what it now is, or nothing when the image
 * cannot be read or rebuilt — in which case the original bytes are better
 * than no page at all.
 */
export function descrambleImage(
    data: RawData,
    context: ImageContext,
): { data: RawData; contentType: string } | undefined {
    const source = App.createPBImage({ data });
    const { width, height } = source;
    const { cols } = context;

    if (width <= 0 || height <= 0 || cols <= 0) {
        return undefined;
    }

    const tileWidth = Math.floor(width / cols);
    const tileHeight = Math.floor(height / cols);
    if (tileWidth <= 0 || tileHeight <= 0) {
        return undefined;
    }

    const order = context.desckey.split("a").map((part) => {
        const value = Number(part.length > 0 ? part : "0");
        return Number.isFinite(value) ? value : 0;
    });

    if (order.length < cols * cols) {
        return undefined;
    }

    const canvas = App.createPBCanvas();
    canvas.setSize(width, height);

    // Laid down whole first: the tiles cover a `cols` by `cols` grid, and any
    // pixels past it are not part of the shuffle and would otherwise be lost.
    canvas.drawImage(source, 0, 0, width, height, 0, 0);

    for (let index = 0; index < cols * cols; index += 1) {
        const destination = order[index] ?? 0;

        const sourceRow = Math.floor(index / cols);
        const sourceColumn = index - sourceRow * cols;
        const destinationRow = Math.floor(destination / cols);
        const destinationColumn = destination - destinationRow * cols;

        canvas.drawImage(
            source,
            sourceColumn * tileWidth,
            sourceRow * tileHeight,
            tileWidth,
            tileHeight,
            destinationColumn * tileWidth,
            destinationRow * tileHeight,
        );
    }

    // WebP first because a page of line art is a fraction of the size, with
    // PNG behind it for a runtime that cannot write WebP.
    for (const contentType of ["image/webp", "image/png"]) {
        const encoded = canvas.encode(contentType);
        if (encoded !== undefined) {
            return { data: encoded, contentType };
        }
    }

    return undefined;
}
