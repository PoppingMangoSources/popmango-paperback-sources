/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Regenerates the source tables in README.md and the count badge.
 *
 * Both are derived from the bundle's versioning.json so they cannot drift out
 * of step with what the repository actually ships. Run `npm run bundle` first.
 *
 * Usage: node scripts/update-readme.mjs [--folder=0.8]
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Where the icons referenced by the tables are served from. */
const ICON_BASE = "https://cdn.jsdelivr.net/gh/PoppingMangoSources/popmango-paperback-sources@main/media/sources";

const START = "<!-- sources:start -->";
const END = "<!-- sources:end -->";

async function main() {
    const folder = argument("folder") ?? "";
    const versioningPath = path.join(ROOT, "bundles", folder, "versioning.json");

    if (!existsSync(versioningPath)) {
        console.error(`No versioning.json in bundles/${folder}. Run the bundler first.`);
        process.exitCode = 1;
        return;
    }

    const versioning = JSON.parse(await readFile(versioningPath, "utf8"));
    const sources = (versioning.sources ?? [])
        .filter((source) => source != null)
        .sort((left, right) => left.name.localeCompare(right.name));

    const novels = sources.filter(isNovel);
    const comics = sources.filter((source) => !isNovel(source));

    await writeFile(path.join(ROOT, "README.md"), await renderReadme(sources, comics, novels), "utf8");
    await writeFile(path.join(ROOT, "media", "badge-count.svg"), countBadge(sources.length), "utf8");

    console.log(`README updated: ${comics.length} comic source(s), ${novels.length} novel source(s).`);
}

function argument(name) {
    const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
    return match?.slice(name.length + 3);
}

function isNovel(source) {
    return (source.tags ?? []).some((tag) => tag.text === "Novels");
}

function table(sources) {
    const host = (url) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");

    const rows = sources.map((source) => {
        const icon = `${ICON_BASE}/${source.id.toLowerCase()}.png`;
        const site = host(source.websiteBaseURL);
        return `| <img src="${icon}" width="22" align="top"/> **${source.name}** | [${site}](${source.websiteBaseURL}) |`;
    });

    return ["| Source | Site |", "| :----- | :--- |", ...rows].join("\n");
}

async function renderReadme(all, comics, novels) {
    const readme = await readFile(path.join(ROOT, "README.md"), "utf8");

    const parts = [];
    parts.push(
        `**${all.length} ${all.length === 1 ? "source" : "sources"}:** ` +
            `${comics.length} manga, manhwa & manhua` +
            (novels.length > 0 ? `, and ${novels.length} ${novels.length === 1 ? "novel" : "novels"}` : "") +
            `, all available from \`0.8\`.`,
    );

    if (comics.length > 0) {
        parts.push("", "### Manga, Manhwa & Manhua", "", table(comics));
    }
    if (novels.length > 0) {
        parts.push("", "### Novels", "", table(novels));
    }

    const start = readme.indexOf(START);
    const end = readme.indexOf(END);

    if (start === -1 || end === -1) {
        throw new Error(`README.md is missing the ${START} / ${END} markers.`);
    }

    return readme.slice(0, start + START.length) + "\n\n" + parts.join("\n") + "\n\n" + readme.slice(end);
}

/** Rebuilds the count badge so it always matches the table above it. */
function countBadge(count) {
    const digits = String(count);
    const width = 282 + Math.max(0, digits.length - 2) * 14;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="60" viewBox="0 0 ${width} 60" role="img" aria-label="${count} sources">
  <rect x="1.5" y="1.5" width="${width - 3}" height="57" rx="28.5" fill="#ffe6f0" stroke="#ffbbd5" stroke-width="3"/>
  <text x="154" y="38" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="3" fill="#33162a">SOURCES</text>
  <circle cx="${width - 42}" cy="30" r="21" fill="#ffbbd5"/>
  <text x="${width - 42}" y="39" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="24" font-weight="800" fill="#33162a">${digits}</text>
</svg>
`;
}

await main();
