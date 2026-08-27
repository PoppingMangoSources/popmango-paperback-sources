/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Applies small presentation changes to the generated dual-version catalog.
 * Keep these changes separate from source bundling so they can be iterated on
 * without affecting the Paperback runtime output.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

function argument(name) {
    const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
    return match?.slice(name.length + 3);
}

const folder = argument("folder") ?? "";
const outputPath = path.join(ROOT, "bundles", folder, "index.html");
let html = await readFile(outputPath, "utf8");

const heroDescription =
    "Novels, manga, manhwa and manhua in one Popmango catalog. Choose the repository that matches your Paperback version, since 0.9 sources won’t work on 0.8.";

html = html
    .replace(
        `<div class="topbar__links">\n      <a href="#paperback-0-8">0.8</a>\n      <a href="#paperback-0-9">0.9</a>`,
        `<div class="topbar__links">\n      <a href="#paperback-0-9">0.9</a>\n      <a href="#paperback-0-8">0.8</a>`,
    )
    .replace(
        `<p class="hero__lede">Kawaii Paperback sources for novels, manga, manhwa and manhua—both repositories together, with the right build for your app.</p>`,
        `<p class="hero__lede">${heroDescription}</p>`,
    )
    .replace(
        `<div class="hero__actions">\n      <a class="button button--mango" href="#paperback-0-8">Browse Paperback 0.8</a>\n      <a class="button button--berry" href="#paperback-0-9">Browse Paperback 0.9</a>\n    </div>`,
        `<div class="hero__actions">\n      <a class="button button--berry" href="#paperback-0-9">Browse Paperback 0.9</a>\n      <a class="button button--mango" href="#paperback-0-8">Browse Paperback 0.8</a>\n    </div>`,
    );

html = html.replace(
    /(<script id="repo-data" type="application\/json">)([\s\S]*?)(<\/script>)/,
    (_match, open, json, close) => {
        const repos = JSON.parse(json);
        repos.sort((left, right) => Number.parseFloat(right.label) - Number.parseFloat(left.label));
        return `${open}${JSON.stringify(repos).replace(/</g, "\\u003c")}${close}`;
    },
);

const presentationStyles = `
/* Version presentation and contained catalog scrolling. */
.button--berry {
  background: linear-gradient(120deg, #b8f0dc, #9edfe9);
  color: #315a59;
}

.repository--mango { border-top-color: var(--sea); }
.repository--mango .repository__kicker { color: #4eaaa4; }
.repository--mango .repository__head h3 span {
  background: #e7f9f3;
  color: #3e8f8a;
}
.repository--mango .source-card__add {
  background: #e7f9f3;
  color: #3e8f8a;
}
.repository--mango .button--mango {
  background: linear-gradient(120deg, #b8f0dc, #9edfe9);
  color: #315a59;
}

.repository--berry { border-top-color: var(--mango); }
.repository--berry .repository__kicker { color: var(--mango-deep); }
.repository--berry .repository__head h3 span {
  background: #fff2dc;
  color: var(--mango-deep);
}
.repository--berry .source-card__add {
  background: #fff3dd;
  color: var(--mango-deep);
}
.repository--berry .button--berry {
  background: linear-gradient(120deg, var(--sun), var(--mango));
  color: #5d352d;
}

.source-scroll {
  position: relative;
  max-height: min(36rem, 68vh);
}

.source-grid {
  max-height: inherit;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding-right: .65rem;
  touch-action: pan-y;
}
.source-grid::-webkit-scrollbar { width: 0; height: 0; }

.source-scroll__rail {
  position: absolute;
  top: .45rem;
  right: .08rem;
  bottom: .45rem;
  width: .28rem;
  border-radius: 999px;
  background: #fff;
  pointer-events: none;
}
.source-scroll__rail[hidden] { display: none; }
.source-scroll__thumb {
  display: block;
  width: 100%;
  min-height: 2.6rem;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(247, 137, 193, .72), rgba(225, 105, 171, .56));
  box-shadow: 0 1px 5px rgba(210, 88, 155, .14);
  will-change: transform;
}

@media (max-width: 34rem) {
  .source-scroll { max-height: min(32rem, 62vh); }
}
`;

html = html.replace("</style>", `${presentationStyles}\n</style>`);

await writeFile(outputPath, html, "utf8");
console.log(`Applied site presentation to ${path.relative(ROOT, outputPath)}.`);
