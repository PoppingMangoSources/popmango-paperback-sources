/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Generates the repository homepage.
 *
 * The toolchain writes its own page during bundling; this replaces it with
 * one that carries Popmango's styling and, below the 0.8 listing, a pointer
 * to the 0.9 repository for anyone running the newer app.
 *
 * Usage: node scripts/build-site.mjs [--folder=0.8]
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Where the 0.9 sources are published, shown in its own section. */
const NEXT_VERSION = {
    label: "0.9",
    name: "Popmango Sources (0.9)",
    url: "https://poppingmangosources.github.io/general-extensions-mangago/0.9",
    repository: "https://github.com/PoppingMangoSources/general-extensions-mangago",
};

async function main() {
    const folder = argument("folder") ?? "";
    const bundles = path.join(ROOT, "bundles", folder);
    const versioningPath = path.join(bundles, "versioning.json");

    if (!existsSync(versioningPath)) {
        console.error(`No versioning.json in ${bundles}. Run the bundler first.`);
        process.exitCode = 1;
        return;
    }

    const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
    const versioning = JSON.parse(await readFile(versioningPath, "utf8"));

    const sources = (versioning.sources ?? [])
        .filter((source) => source != null)
        .sort((left, right) => left.name.localeCompare(right.name));

    const baseUrl = resolveBaseUrl(pkg, folder);

    await writeFile(path.join(bundles, "index.html"), page({ pkg, sources, baseUrl, folder, versioning }), "utf8");
    console.log(`Wrote ${path.relative(ROOT, path.join(bundles, "index.html"))} with ${sources.length} source(s).`);

    // Keep GitHub Pages from running the published files through Jekyll,
    // which would otherwise hide any folder whose name begins with an
    // underscore.
    await writeFile(path.join(ROOT, "bundles", ".nojekyll"), "", "utf8");

    if (folder !== "") {
        await writeFile(path.join(ROOT, "bundles", "index.html"), rootRedirect(folder), "utf8");
    }
}

function argument(name) {
    const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
    return match?.slice(name.length + 3);
}

/**
 * Works out the URL the published repository will answer on.
 *
 * The workflow does not know it, so it is derived from the repository the
 * build is running in, falling back to whatever package.json declares.
 */
function resolveBaseUrl(pkg, folder) {
    const suffix = folder === "" ? "" : `/${folder}`;
    const repo = process.env.GITHUB_REPOSITORY;

    if (repo !== undefined) {
        const [owner, name] = repo.split("/");
        return `https://${owner.toLowerCase()}.github.io/${name}${suffix}`;
    }
    return pkg.homepage ?? `https://poppingmangosources.github.io/popmango-paperback-sources${suffix}`;
}

function addRepoLink(name, url) {
    return `paperback://addRepo?displayName=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Pastel accents, cycled so neighbouring cards never share one. */
const CARD_ACCENTS = ["peach", "pink", "mint", "lilac", "butter", "sky"];

const RATING_LABEL = {
    EVERYONE: "Everyone",
    MATURE: "Mature",
    ADULT: "Adult",
};

function sourceCard(source, index, folder) {
    const accent = CARD_ACCENTS[index % CARD_ACCENTS.length];
    const icon = `${encodeURIComponent(source.id)}/includes/${encodeURIComponent(source.icon)}`;
    const badges = [
        ...(source.tags ?? []).map((tag) => tag.text),
        RATING_LABEL[source.contentRating] ?? source.contentRating,
    ].filter(Boolean);

    return `
        <article class="card card--${accent}">
          <img class="card__icon" src="${escapeHtml(icon)}" alt="" width="64" height="64" loading="lazy">
          <div class="card__body">
            <h3 class="card__name">${escapeHtml(source.name)}</h3>
            <p class="card__desc">${escapeHtml(source.desc ?? "")}</p>
            <p class="card__badges">
              ${badges.map((badge) => `<span class="pill">${escapeHtml(badge)}</span>`).join("\n              ")}
              <span class="pill pill--version">v${escapeHtml(source.version)}</span>
            </p>
          </div>
        </article>`;
}

function page({ pkg, sources, baseUrl, folder, versioning }) {
    const title = pkg.repositoryName ?? "Popmango Sources";
    const built = versioning.buildTime ? new Date(versioning.buildTime) : undefined;
    const label = folder === "" ? "0.8" : folder;

    const cards = sources.map((source, index) => sourceCard(source, index, folder)).join("\n");
    const empty = `<p class="empty">No sources have been published to this branch yet. (｡•́︿•̀｡)</p>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(pkg.description ?? "")}">
<style>
${styles()}
</style>
</head>
<body>
<div class="sparkles" aria-hidden="true">
  <span>✿</span><span>♡</span><span>✧</span><span>❀</span><span>♡</span><span>✧</span>
</div>

<header class="hero">
  <p class="hero__eyebrow">♡ paperback ${escapeHtml(label)} ♡</p>
  <h1 class="hero__title">${escapeHtml(title)}</h1>
  <p class="hero__tagline">${escapeHtml(pkg.description ?? "")}</p>

  <a class="button button--primary" href="${escapeHtml(addRepoLink(title, baseUrl))}">
    <span class="button__sparkle">✧</span> Add to Paperback
  </a>

  <p class="hero__url">
    or paste this in <b>Settings → Extensions → Add Repository</b><br>
    <code>${escapeHtml(baseUrl)}</code>
  </p>
</header>

<main>
  <section class="section">
    <div class="section__head">
      <h2 class="section__title">Sources for 0.8</h2>
      <span class="counter">${sources.length}</span>
    </div>
    <p class="section__note">Tap <b>Add to Paperback</b> above, then pick the ones you want inside the app.</p>
    ${sources.length === 0 ? empty : `<div class="grid">${cards}\n    </div>`}
  </section>

  <section class="section section--next">
    <div class="section__head">
      <h2 class="section__title">Running Paperback 0.9?</h2>
      <span class="counter counter--alt">${escapeHtml(NEXT_VERSION.label)}</span>
    </div>
    <p class="section__note">
      The sources above are built for 0.8 and will not load on 0.9. The 0.9 versions live in their
      own repository — add that one instead, or add both and let each app pick up the one it can use.
    </p>
    <div class="next">
      <a class="button button--secondary" href="${escapeHtml(addRepoLink(NEXT_VERSION.name, NEXT_VERSION.url))}">
        <span class="button__sparkle">✿</span> Add the 0.9 repository
      </a>
      <p class="next__url"><code>${escapeHtml(NEXT_VERSION.url)}</code></p>
      <p class="next__link"><a href="${escapeHtml(NEXT_VERSION.repository)}">Browse the 0.9 sources on GitHub →</a></p>
    </div>
  </section>
</main>

<footer class="footer">
  <p>Made with ♡ by Popmango</p>
  ${built ? `<p class="footer__built">Last built ${escapeHtml(built.toISOString().slice(0, 16).replace("T", " "))} UTC</p>` : ""}
</footer>
</body>
</html>
`;
}

function rootRedirect(folder) {
    const target = `./${folder}/`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
<title>Popmango Sources</title>
<link rel="canonical" href="${escapeHtml(target)}">
</head>
<body>
<p>Taking you to <a href="${escapeHtml(target)}">the Popmango sources</a>…</p>
</body>
</html>
`;
}

function styles() {
    return `
:root {
  color-scheme: light;
  --cream: #fff8f2;
  --cream-deep: #ffeee2;
  --ink: #5c4550;
  --ink-soft: #90717f;
  --peach: #ffc9a3;
  --pink: #ffc2dc;
  --mint: #b6ecd6;
  --lilac: #d8ccff;
  --butter: #ffe7a8;
  --sky: #bfe3ff;
  --card: #ffffff;
  --line: #ffdcc9;
  --shadow: 0 10px 0 -4px rgba(255, 176, 136, .35), 0 16px 30px -18px rgba(120, 70, 95, .5);
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --cream: #241d24;
    --cream-deep: #2e242f;
    --ink: #ffeef6;
    --ink-soft: #d3b3c5;
    --card: #322734;
    --line: #4a3a4c;
    --shadow: 0 10px 0 -4px rgba(255, 176, 136, .18), 0 16px 30px -18px rgba(0, 0, 0, .7);
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0 1.25rem 4rem;
  background:
    radial-gradient(circle at 12% 8%, var(--pink) 0, transparent 42%),
    radial-gradient(circle at 88% 4%, var(--sky) 0, transparent 38%),
    radial-gradient(circle at 50% 100%, var(--butter) 0, transparent 45%),
    var(--cream);
  background-attachment: fixed;
  color: var(--ink);
  font-family: ui-rounded, "SF Pro Rounded", "Quicksand", "Segoe UI", system-ui, sans-serif;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.sparkles {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: .5;
}
.sparkles span {
  position: absolute;
  font-size: 1.4rem;
  animation: drift 9s ease-in-out infinite;
}
.sparkles span:nth-child(1) { left: 6%;  top: 18%; color: var(--pink);  animation-delay: 0s; }
.sparkles span:nth-child(2) { left: 88%; top: 26%; color: var(--peach); animation-delay: 1.4s; }
.sparkles span:nth-child(3) { left: 18%; top: 62%; color: var(--lilac); animation-delay: 2.8s; }
.sparkles span:nth-child(4) { left: 78%; top: 72%; color: var(--mint);  animation-delay: 4.2s; }
.sparkles span:nth-child(5) { left: 46%; top: 12%; color: var(--pink);  animation-delay: 5.6s; }
.sparkles span:nth-child(6) { left: 62%; top: 48%; color: var(--sky);   animation-delay: 7s; }

@keyframes drift {
  0%, 100% { transform: translateY(0) rotate(0deg);   opacity: .35; }
  50%      { transform: translateY(-14px) rotate(12deg); opacity: .75; }
}

@media (prefers-reduced-motion: reduce) {
  .sparkles span { animation: none; }
}

main, .hero, .footer { position: relative; z-index: 1; max-width: 62rem; margin-inline: auto; }

.hero {
  text-align: center;
  padding: 3.5rem 1rem 2.5rem;
}
.hero__eyebrow {
  display: inline-block;
  margin: 0 0 .75rem;
  padding: .3rem 1rem;
  border-radius: 999px;
  background: var(--card);
  border: 2px solid var(--line);
  color: var(--ink-soft);
  font-size: .8rem;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.hero__title {
  margin: 0 0 .5rem;
  font-size: clamp(2.2rem, 7vw, 3.4rem);
  font-weight: 800;
  letter-spacing: -.02em;
  background: linear-gradient(100deg, #ff8fb8 0%, #ffab7d 45%, #8fd8ff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero__tagline { margin: 0 auto 1.75rem; max-width: 34rem; color: var(--ink-soft); }
.hero__url { margin-top: 1.25rem; font-size: .85rem; color: var(--ink-soft); }

code {
  display: inline-block;
  margin-top: .4rem;
  padding: .35rem .7rem;
  border-radius: .7rem;
  background: var(--card);
  border: 2px dashed var(--line);
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: .82rem;
  word-break: break-all;
}

.button {
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  padding: .85rem 1.9rem;
  border-radius: 999px;
  font-size: 1.05rem;
  font-weight: 700;
  text-decoration: none;
  transition: transform .15s ease, box-shadow .15s ease;
}
.button:hover, .button:focus-visible { transform: translateY(-3px); }
.button:active { transform: translateY(1px); }

.button--primary {
  color: #6b3a4e;
  background: linear-gradient(140deg, var(--pink), var(--peach));
  box-shadow: 0 8px 0 -2px #ffb3ce, 0 18px 26px -16px rgba(180, 90, 130, .8);
}
.button--secondary {
  color: #3f5a52;
  background: linear-gradient(140deg, var(--mint), var(--sky));
  box-shadow: 0 8px 0 -2px #9adcc4, 0 18px 26px -16px rgba(70, 130, 130, .7);
}
.button__sparkle { font-size: 1.1rem; }

.section { margin-top: 3rem; }
.section__head { display: flex; align-items: center; gap: .75rem; }
.section__title { margin: 0; font-size: 1.5rem; font-weight: 800; }
.section__note { margin: .5rem 0 1.5rem; color: var(--ink-soft); font-size: .95rem; }

.counter {
  min-width: 2rem;
  padding: .1rem .7rem;
  border-radius: 999px;
  background: var(--pink);
  color: #6b3a4e;
  font-size: .9rem;
  font-weight: 800;
  text-align: center;
}
.counter--alt { background: var(--mint); color: #3f5a52; }

.grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
}

.card {
  display: flex;
  gap: 1rem;
  padding: 1.1rem;
  border-radius: 1.4rem;
  background: var(--card);
  border: 2px solid var(--line);
  box-shadow: var(--shadow);
  transition: transform .15s ease;
}
.card:hover { transform: translateY(-4px) rotate(-.4deg); }

.card--peach  { border-color: var(--peach); }
.card--pink   { border-color: var(--pink); }
.card--mint   { border-color: var(--mint); }
.card--lilac  { border-color: var(--lilac); }
.card--butter { border-color: var(--butter); }
.card--sky    { border-color: var(--sky); }

.card__icon {
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  border-radius: 1rem;
  object-fit: cover;
  background: var(--cream-deep);
}
.card__body { min-width: 0; }
.card__name { margin: 0 0 .25rem; font-size: 1.1rem; font-weight: 800; }
.card__desc { margin: 0 0 .6rem; font-size: .85rem; color: var(--ink-soft); }
.card__badges { display: flex; flex-wrap: wrap; gap: .35rem; margin: 0; }

.pill {
  padding: .1rem .6rem;
  border-radius: 999px;
  background: var(--cream-deep);
  border: 1px solid var(--line);
  font-size: .72rem;
  font-weight: 700;
  color: var(--ink-soft);
}
.pill--version { background: var(--lilac); color: #4a3a6b; border-color: transparent; }

.empty {
  padding: 2.5rem;
  border-radius: 1.4rem;
  background: var(--card);
  border: 2px dashed var(--line);
  text-align: center;
  color: var(--ink-soft);
}

.section--next {
  padding: 1.75rem;
  border-radius: 1.6rem;
  background: var(--card);
  border: 2px solid var(--mint);
  box-shadow: var(--shadow);
}
.next { text-align: center; }
.next__url { margin: 1rem 0 .35rem; }
.next__link { margin: 0; font-size: .9rem; }
.next__link a { color: var(--ink-soft); }

.footer {
  margin-top: 3.5rem;
  text-align: center;
  color: var(--ink-soft);
  font-size: .85rem;
}
.footer__built { margin: .25rem 0 0; opacity: .75; }
`;
}

await main();
