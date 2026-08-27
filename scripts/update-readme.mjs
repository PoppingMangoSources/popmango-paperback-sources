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
        const version = source.version ? `<code>${source.version}</code>` : "—";
        const rating = ratingLabel(source.contentRating);
        const sourceLink =
            paperbackVersion === "0.8"
                ? source.websiteBaseURL
                : `https://github.com/PoppingMangoSources/general-extensions-mangago/tree/0.9/test/src/${source.id}`;
        const linkedName =
            sourceLink === undefined
                ? `**${source.name}**`
                : `[**${source.name}**](${sourceLink})`;
        return `| <img src="${icon}" width="24" align="top"/> ${linkedName} | ${version} | ${rating} |`;
    });

    return [
        "<details>",
        `<summary><b>Open the Paperback ${paperbackVersion} catalog · ${sources.length} ${sources.length === 1 ? "source" : "sources"}</b></summary>`,
        "",
        "",
        "| Source | Version | Rating |",
        "| :----- | :------ | :----- |",
        ...rows,
        "",
        "</details>",
    ].join("\n");
}

function ratingLabel(rating) {
    switch (String(rating ?? "").toUpperCase()) {
        case "SAFE":
        case "EVERYONE":
            return "Safe";
        case "MATURE":
            return "Mature";
        case "ADULT":
            return "Adult";
        default:
            return "—";
    }
}

function countBadge(current, next) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="410" height="60" viewBox="0 0 410 60" role="img" aria-label="${current} Paperback 0.8 sources and ${next} Paperback 0.9 sources">
  <defs>
    <linearGradient id="catalog-gradient" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffbbd5"/>
      <stop offset=".52" stop-color="#ffc98a"/>
      <stop offset="1" stop-color="#b7e2ce"/>
    </linearGradient>
  </defs>
  <rect x="1.5" y="1.5" width="407" height="57" rx="28.5" fill="#fff8ef" stroke="url(#catalog-gradient)" stroke-width="3"/>
  <text x="34" y="38" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="22" font-weight="800" fill="#33162a">SOURCES</text>
  <circle cx="194" cy="30" r="21" fill="#ffbbd5"/>
  <text x="194" y="38" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="20" font-weight="800" fill="#33162a">${current}</text>
  <text x="228" y="37" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="17" font-weight="700" fill="#6d4a5e">0.8</text>
  <circle cx="317" cy="30" r="21" fill="#b7e2ce"/>
  <text x="317" y="38" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="20" font-weight="800" fill="#33162a">${next}</text>
  <text x="351" y="37" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="17" font-weight="700" fill="#6d4a5e">0.9</text>
</svg>
`;
}

await main();
