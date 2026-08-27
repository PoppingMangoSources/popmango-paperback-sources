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
    await writeFile(
        path.join(ROOT, "media", "badge-count.svg"),
        countBadge(current.length, next.length),
        "utf8",
    );

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

function countBadge(current, next) {
    const total = current + next;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="245" height="60" viewBox="0 0 245 60" role="img" aria-label="${total} sources">
  <defs>
    <linearGradient id="catalog" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#dff3cb"/>
      <stop offset="1" stop-color="#b9e6df"/>
    </linearGradient>
  </defs>
  <rect x="1.5" y="1.5" width="242" height="57" rx="28.5" fill="url(#catalog)" stroke="#9fd4c9" stroke-width="3"/>
  <text x="92" y="38" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="21" font-weight="800" letter-spacing="2" fill="#33162a">SOURCES</text>
  <circle cx="199" cy="30" r="21" fill="#f3acd0"/>
  <text x="199" y="38" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="20" font-weight="850" fill="#33162a">${total}</text>
</svg>
`;
}

await main();
