/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Regenerates both source catalogs in README.md.
 *
 * Usage:
 *   node scripts/update-readme.mjs [--folder=all]
 *   node scripts/update-readme.mjs [--folder=all] [--next-manifest=path/to/versioning.json]
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ICON_BASE = "media/sources";
const NEXT_MANIFEST =
    "https://poppingmangosources.github.io/general-extensions-mangago/0.9/test/versioning.json";

const MARKERS = {
    current: {
        start: "<!-- sources-08:start -->",
        end: "<!-- sources-08:end -->",
    },
    next: {
        start: "<!-- sources-09:start -->",
        end: "<!-- sources-09:end -->",
    },
};

async function main() {
    const folder = argument("folder") ?? "";
    const currentPath = path.join(ROOT, "bundles", folder, "versioning.json");

    if (!existsSync(currentPath)) {
        console.error(`No versioning.json in bundles/${folder}. Run the bundler first.`);
        process.exitCode = 1;
        return;
    }

    const current = sortSources(JSON.parse(await readFile(currentPath, "utf8")).sources);
    const next = sortSources((await loadNextManifest()).sources);
    let readme = await readFile(path.join(ROOT, "README.md"), "utf8");

    readme = replaceSection(readme, MARKERS.current, catalog(current, "0.8"));
    readme = replaceSection(readme, MARKERS.next, catalog(next, "0.9"));

    await writeFile(path.join(ROOT, "README.md"), readme, "utf8");
    await Promise.all([
        writeFile(
            path.join(ROOT, "media", "badge-count-08.svg"),
            countBadge(current.length, "0.8", "mint"),
            "utf8",
        ),
        writeFile(
            path.join(ROOT, "media", "badge-count-09.svg"),
            countBadge(next.length, "0.9", "peach"),
            "utf8",
        ),
    ]);

    console.log(`README updated with ${current.length} Paperback 0.8 and ${next.length} Paperback 0.9 sources.`);
}

function argument(name) {
    const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
    return match?.slice(name.length + 3);
}

async function loadNextManifest() {
    const localPath = argument("next-manifest");
    if (localPath !== undefined) {
        return JSON.parse(await readFile(path.resolve(ROOT, localPath), "utf8"));
    }

    const response = await fetch(NEXT_MANIFEST, { headers: { accept: "application/json" } });
    if (!response.ok) {
        throw new Error(`Could not load the Paperback 0.9 catalog (HTTP ${response.status}).`);
    }
    return response.json();
}

function sortSources(sources) {
    return (sources ?? [])
        .filter((source) => source != null)
        .sort((left, right) => left.name.localeCompare(right.name));
}

function replaceSection(readme, markers, content) {
    const start = readme.indexOf(markers.start);
    const end = readme.indexOf(markers.end);
    if (start === -1 || end === -1 || end < start) {
        throw new Error(`README.md is missing the ${markers.start} / ${markers.end} markers.`);
    }
    return (
        readme.slice(0, start + markers.start.length) +
        "\n\n" +
        content +
        "\n\n" +
        readme.slice(end)
    );
}

function catalog(sources, paperbackVersion) {
    const rows = sources.map((source) => {
        const icon = `${ICON_BASE}/${source.id.toLowerCase()}.png`;
        const website = sourceWebsite(source, paperbackVersion);
        return `| <img src="${icon}" width="22" align="top"/> **${source.name}** | [${website.label}](${website.url}) |`;
    });

    return [
        `**${sources.length} ${sources.length === 1 ? "source" : "sources"} available for Paperback ${paperbackVersion}.**`,
        "",
        "| Source | Site |",
        "| :----- | :--- |",
        ...rows,
    ].join("\n");
}

function sourceWebsite(source, paperbackVersion) {
    if (source.websiteBaseURL !== undefined) {
        return {
            label: new URL(source.websiteBaseURL).hostname.replace(/^www\./, ""),
            url: source.websiteBaseURL,
        };
    }

    const description = source.description ?? source.desc ?? "";
    const domain = description.match(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i)?.[0];
    if (domain !== undefined) {
        return { label: domain.replace(/^www\./, ""), url: `https://${domain}` };
    }

    return {
        label: "Source code",
        url:
            paperbackVersion === "0.8"
                ? `https://github.com/PoppingMangoSources/popmango-paperback-sources/tree/main/src/${source.id}`
                : `https://github.com/PoppingMangoSources/general-extensions-mangago/tree/0.9/test/src/${source.id}`,
    };
}

function countBadge(count, version, palette) {
    const colors = palette === "mint"
        ? { start: "#dff3cb", end: "#b9e6df", bubble: "#ffd0a8" }
        : { start: "#f6b7d6", end: "#ffd0a8", bubble: "#c9eadf" };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="56" viewBox="0 0 270 56" role="img" aria-label="${count} Paperback ${version} sources">
  <defs>
    <linearGradient id="catalog-${version.replace(".", "")}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${colors.start}"/>
      <stop offset="1" stop-color="${colors.end}"/>
    </linearGradient>
  </defs>
  <rect width="270" height="56" rx="20" fill="url(#catalog-${version.replace(".", "")})"/>
  <text x="95" y="35" text-anchor="middle" font-family="'Quicksand', 'Nunito', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="20" font-weight="800" letter-spacing="1.5" fill="#33162a">${version} SOURCES</text>
  <circle cx="229" cy="28" r="20" fill="${colors.bubble}"/>
  <text x="229" y="35" text-anchor="middle" font-family="'Quicksand', 'Nunito', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="20" font-weight="850" fill="#33162a">${count}</text>
</svg>
`;
}

await main();
