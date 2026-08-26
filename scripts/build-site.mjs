/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Generates the repository homepage.
 *
 * The toolchain writes its own page during bundling; this replaces it with a
 * card for each Popmango repository — the 0.8 one built here and the 0.9 one
 * published alongside it. Each card pulls that repository's source list from
 * its versioning.json, and every source in the list installs on its own.
 *
 * Both repositories are served from the same host, so fetching the 0.9 list is
 * a same-origin request and needs no proxy or CORS handling. The 0.8 list is
 * also inlined at build time so the page still fills in when opened straight
 * off disk.
 *
 * Usage: node scripts/build-site.mjs [--folder=0.8]
 */

import { cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const DISCORD = "https://discord.com/invite/inkdex";

/** The 0.9 repository, listed below this one. */
const NEXT_VERSION = {
    name: "PoppingMango Extensions",
    label: "0.9",
    url: "https://poppingmangosources.github.io/general-extensions-mangago/0.9/test",
    github: "https://github.com/PoppingMangoSources/general-extensions-mangago",
    note: "Built for Paperback 0.9. These will not load on 0.8.",
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
    const baseUrl = resolveBaseUrl(pkg, folder);

    // The brand artwork is shared with the README, so the page uses the same
    // files rather than a second copy that could fall out of step.
    await cp(path.join(ROOT, "media"), path.join(bundles, "media"), { recursive: true });

    const current = {
        name: pkg.repositoryName ?? "PoppingMango Sources",
        label: folder === "" ? "0.8" : folder,
        url: baseUrl,
        github: pkg.repository ?? "https://github.com/PoppingMangoSources/popmango-paperback-sources",
        note: "Built for Paperback 0.8.",
        // This card is served from the folder it describes, so its icons and
        // its listing resolve against the page rather than an absolute URL.
        // That keeps the page working on a branch preview, behind a custom
        // domain, or opened straight off disk.
        local: true,
        // Inlined so the list is there before any request finishes.
        sources: sortSources(versioning.sources),
    };

    const repos = [current, NEXT_VERSION];
    await writeFile(path.join(bundles, "index.html"), page({ pkg, repos, versioning }), "utf8");
    console.log(`Wrote ${path.relative(ROOT, path.join(bundles, "index.html"))} with ${current.sources.length} source(s).`);

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

function sortSources(sources) {
    return (sources ?? [])
        .filter((source) => source != null)
        .sort((left, right) => left.name.localeCompare(right.name));
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

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function page({ pkg, repos, versioning }) {
    const title = pkg.repositoryName ?? "PoppingMango Sources";
    const built = versioning.buildTime ? new Date(versioning.buildTime) : undefined;

    // The cards are rendered by the same code that later refreshes them, so
    // the two can never drift apart.
    const data = JSON.stringify(repos).replace(/</g, "\\u003c");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(pkg.description ?? "")}">
<meta name="theme-color" content="#ffbbd5">
<style>
${styles()}
</style>
</head>
<body>
<div class="bubbles" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>

<header class="hero">
  <img class="hero__banner" src="./media/header.svg" alt="${escapeHtml(title)} — novels, manga, manhwa and manhua for Paperback 0.8">
  <p class="hero__badges">
    <img src="./media/badge-ios.svg" alt="iOS / iPadOS" height="26">
    <img src="./media/badge-version.svg" alt="Paperback 0.8" height="26">
    <img src="./media/badge-count.svg" alt="Source count" height="26">
  </p>
  <p class="hero__tagline">${escapeHtml(pkg.description ?? "")}</p>
</header>

<main id="repos">
  <p class="status">Loading repositories…</p>
</main>

<footer class="footer">
  <p>Made with <span class="footer__heart">♡</span> by Popmango</p>
  ${built ? `<p class="footer__built">Last built ${escapeHtml(built.toISOString().slice(0, 16).replace("T", " "))} UTC</p>` : ""}
</footer>

<script id="repo-data" type="application/json">${data}</script>
<script>
${script(DISCORD)}
</script>
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
<title>PoppingMango Sources</title>
<link rel="canonical" href="${escapeHtml(target)}">
</head>
<body>
<p>Taking you to <a href="${escapeHtml(target)}">the PoppingMango sources</a>…</p>
</body>
</html>
`;
}

function script(discord) {
    return `
(function () {
  "use strict";

  var DISCORD = ${JSON.stringify(discord)};

  var RATING = {
    EVERYONE: { label: "Safe", tone: "safe" },
    MATURE: { label: "16+", tone: "mature" },
    ADULT: { label: "18+", tone: "adult" }
  };

  var GITHUB_PATH = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 " +
    "0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53." +
    "63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 " +
    "0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 " +
    "2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 " +
    "3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z";

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function sortSources(sources) {
    return (sources || []).filter(Boolean).slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
  }

  // A repository served from this very folder is addressed relatively, so the
  // page keeps working on a branch preview, a custom domain, or off disk.
  function base(repo) {
    return repo.local ? "." : repo.url.replace(/\\/+$/, "");
  }

  function iconUrl(repo, source) {
    return base(repo) + "/" + encodeURIComponent(source.id) +
      "/includes/" + encodeURIComponent(source.icon || "icon.png");
  }

  function plural(count, word) {
    return count + " " + word + (count === 1 ? "" : "s");
  }

  function addRepoLink(repo) {
    return "paperback://addRepo?displayName=" + encodeURIComponent(repo.name) +
      "&url=" + encodeURIComponent(repo.url);
  }

  /**
   * Deep link that installs specific sources rather than the whole list.
   *
   * The payload is a base64 list of [sourceId, repositoryUrl] pairs. Note it
   * carries the repository's real URL, never the relative one used for
   * artwork — the app resolves it on its own and has no page to resolve
   * against.
   */
  function installLink(repo, ids) {
    var pairs = ids.map(function (id) { return [id, repo.url]; });
    return "paperback://installExtensions?data=" + btoa(JSON.stringify(pairs));
  }

  /** One source, as its own install link. */
  function sourceRow(repo, source) {
    var badge = RATING[source.contentRating] || { label: source.contentRating || "", tone: "safe" };

    return '<a class="source" href="' + esc(installLink(repo, [source.id])) + '" ' +
      'title="Install ' + esc(source.name) + '">' +
      '<img class="source__icon" src="' + esc(iconUrl(repo, source)) + '" alt="" ' +
      'width="40" height="40" loading="lazy" onerror="this.style.visibility=&quot;hidden&quot;">' +
      '<span class="source__text">' +
      '<span class="source__name">' + esc(source.name) + '</span>' +
      '<span class="source__meta">v' + esc(source.version) +
      '<span class="badge badge--' + badge.tone + '">' + esc(badge.label) + '</span></span>' +
      '</span>' +
      '<span class="source__install">Install</span>' +
      '</a>';
  }

  function repoCard(repo) {
    var card = document.createElement("article");
    card.className = "repo";

    var sources = sortSources(repo.sources);
    var known = repo.sources != null;

    card.innerHTML =
      '<div class="repo__head">' +
        '<h2 class="repo__name">' + esc(repo.name) + '</h2>' +
        '<div class="repo__meta">' +
          '<span class="tag">' + esc(repo.label) + '</span>' +
          '<span class="repo__url">' + esc(repo.url.replace(/^https?:\\/\\//, "")) + '</span>' +
        '</div>' +
        '<div class="repo__actions">' +
          '<a class="button button--add" href="' + esc(addRepoLink(repo)) + '">Add whole repository</a>' +
          '<a class="iconbutton" href="' + esc(repo.github) + '" title="View on GitHub" aria-label="View on GitHub">' +
            '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="' + GITHUB_PATH + '"/></svg>' +
          '</a>' +
        '</div>' +
        '<a class="button button--discord" href="' + esc(DISCORD) + '">💬 Discord support</a>' +
        '<p class="repo__note">' + esc(repo.note) + '</p>' +
      '</div>' +
      '<details class="drawer" open>' +
        '<summary class="drawer__toggle">' +
          '<span class="drawer__count"><span class="drawer__emoji">🧁</span>' +
            '<b data-count>' + (known ? plural(sources.length, "source") : "… sources") + '</b></span>' +
          '<span class="drawer__hint"><span class="drawer__hide">tap to hide</span>' +
            '<span class="drawer__show">tap to show</span></span>' +
        '</summary>' +
        '<p class="drawer__lead">Tap any source to install just that one.</p>' +
        '<div class="sources" data-sources>' +
          (known ? sources.map(function (s) { return sourceRow(repo, s); }).join("")
                 : '<p class="status">Loading sources…</p>') +
        '</div>' +
      '</details>';

    load(card, repo);
    return card;
  }

  function load(card, repo) {
    var list = card.querySelector("[data-sources]");
    var count = card.querySelector("[data-count]");

    // Both repositories are on the same host, so this is same-origin.
    fetch(base(repo) + "/versioning.json", { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(function (data) {
        var sources = sortSources(data.sources);
        count.textContent = plural(sources.length, "source");
        list.innerHTML = sources.length === 0
          ? '<p class="status">Nothing published here yet. (｡•́︿•̀｡)</p>'
          : sources.map(function (s) { return sourceRow(repo, s); }).join("");
      })
      .catch(function () {
        // Leave whatever was inlined at build time in place; only an empty
        // list needs to say something went wrong.
        if (!list.querySelector(".source")) {
          list.innerHTML = '<p class="status">Could not reach this repository just now.</p>';
          count.textContent = "— sources";
        }
      });
  }

  var host = document.getElementById("repos");
  var repos = JSON.parse(document.getElementById("repo-data").textContent);

  host.innerHTML = "";
  for (var i = 0; i < repos.length; i++) host.appendChild(repoCard(repos[i]));
})();
`;
}

function styles() {
    return `
/*
 * The palette is taken straight from the brand artwork: the blush-to-mango
 * sweep of the header, its mango and mint accents, and the deep plum the
 * lettering is set in.
 */
:root {
  color-scheme: light;

  --blush: #ffdcea;
  --pink: #ffbbd5;
  --apricot: #ffcda8;
  --mango: #ffc17e;
  --mango-deep: #ffa45c;
  --mint: #cfebb4;
  --mint-pale: #e6f6d8;
  --leaf: #a8d48c;

  --ink: #33162a;
  --ink-soft: #8d6579;
  --card: #ffffff;
  --page: #fff6fa;
  --page-2: #fff3ea;
  --line: #ffe2ee;
  --soft: #fff2f7;

  --brand: linear-gradient(100deg, var(--blush) 0%, var(--pink) 34%, var(--apricot) 68%, var(--mango) 100%);
  --shadow: 0 18px 34px -20px rgba(120, 45, 85, .45);
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --ink: #ffeaf4;
    --ink-soft: #d2a8bf;
    --card: #34212f;
    --page: #241626;
    --page-2: #2b1b26;
    --line: #4b3143;
    --soft: #3f2937;
    --shadow: 0 18px 34px -20px rgba(0, 0, 0, .85);
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0 1rem 3rem;
  background: linear-gradient(168deg, var(--page) 0%, var(--page-2) 100%);
  background-attachment: fixed;
  color: var(--ink);
  font-family: ui-rounded, "SF Pro Rounded", "Quicksand", "Segoe UI", system-ui, sans-serif;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

/* Soft drifting bubbles, echoing the ones in the header artwork. */
.bubbles { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
.bubbles span {
  position: absolute;
  border-radius: 50%;
  opacity: .5;
  animation: float 14s ease-in-out infinite;
}
.bubbles span:nth-child(1) { width: 130px; height: 130px; left: -40px;  top: 12%; background: var(--blush); }
.bubbles span:nth-child(2) { width:  84px; height:  84px; right: -20px; top: 26%; background: var(--mint-pale); animation-delay: 2.5s; }
.bubbles span:nth-child(3) { width: 160px; height: 160px; right: -60px; top: 58%; background: var(--apricot); animation-delay: 5s; }
.bubbles span:nth-child(4) { width:  62px; height:  62px; left: 8%;     top: 74%; background: var(--pink); animation-delay: 7.5s; }
.bubbles span:nth-child(5) { width: 100px; height: 100px; left: -30px;  top: 90%; background: var(--mango); animation-delay: 10s; }

@keyframes float {
  0%, 100% { transform: translateY(0) scale(1); }
  50%      { transform: translateY(-26px) scale(1.06); }
}

main, .hero, .footer { position: relative; z-index: 1; max-width: 44rem; margin-inline: auto; }

/* ---------- hero ---------- */

.hero { text-align: center; padding: 1.75rem 0 1.5rem; }

.hero__banner {
  width: 100%;
  height: auto;
  border-radius: 1.6rem;
  box-shadow: var(--shadow);
}
.hero__badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: .5rem;
  margin: 1.1rem 0 .8rem;
}
.hero__badges img { height: 26px; width: auto; }
.hero__tagline { margin: 0 auto; max-width: 27rem; color: var(--ink-soft); }

/* ---------- repository card ---------- */

.repo {
  margin-bottom: 1.5rem;
  border-radius: 1.6rem;
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  overflow: hidden;
}

/* A ribbon of the brand gradient across the top of every card. */
.repo::before { content: ""; display: block; height: 6px; background: var(--brand); }

.repo__head { padding: 1.3rem 1.4rem 1.2rem; }
.repo__name { margin: 0 0 .6rem; font-size: 1.45rem; font-weight: 800; line-height: 1.15; }

.repo__meta { display: flex; align-items: center; gap: .6rem; margin-bottom: 1rem; }
.repo__url { min-width: 0; color: var(--ink-soft); font-size: .85rem; word-break: break-all; }

.tag {
  flex: 0 0 auto;
  padding: .1rem .8rem;
  border-radius: 999px;
  background: linear-gradient(120deg, var(--mint-pale), var(--mint));
  color: #3f5f2c;
  font-size: .85rem;
  font-weight: 800;
}

.repo__actions { display: flex; align-items: center; gap: .6rem; }

.button {
  display: block;
  padding: .8rem 1.4rem;
  border-radius: 999px;
  font-size: 1rem;
  font-weight: 800;
  text-align: center;
  text-decoration: none;
  color: var(--ink);
  transition: transform .15s ease, filter .15s ease;
}
.button--add { flex: 1 1 auto; background: var(--brand); }
.button--discord {
  margin-top: .6rem;
  background: linear-gradient(100deg, var(--mint-pale), var(--mint));
  color: #3f5f2c;
}
.button:hover, .button:focus-visible { transform: translateY(-2px); filter: brightness(1.04); }
.button:active { transform: translateY(1px); }

.iconbutton {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.9rem;
  height: 2.9rem;
  border-radius: 50%;
  background: var(--soft);
  color: var(--mango-deep);
  text-decoration: none;
  transition: transform .15s ease;
}
.iconbutton:hover, .iconbutton:focus-visible { transform: translateY(-2px); }

.repo__note { margin: .9rem 0 0; color: var(--ink-soft); font-size: .85rem; }

/* ---------- collapsible source list ---------- */

.drawer { border-top: 1px dashed var(--line); }

.drawer__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: .9rem 1.4rem;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.drawer__toggle::-webkit-details-marker { display: none; }
.drawer__toggle:hover { background: var(--soft); }

.drawer__count { display: flex; align-items: center; gap: .45rem; color: var(--mango-deep); font-weight: 800; }
.drawer__emoji { font-size: 1.1rem; }
.drawer__hint { color: var(--ink-soft); font-size: .85rem; }

/* Swap the hint text with the drawer's own state. */
.drawer__show { display: inline; }
.drawer__hide { display: none; }
.drawer[open] .drawer__show { display: none; }
.drawer[open] .drawer__hide { display: inline; }

.drawer__lead { margin: 0 1.4rem .7rem; color: var(--ink-soft); font-size: .82rem; }

.sources {
  max-height: 22rem;
  overflow-y: auto;
  padding: 0 1.4rem 1.2rem;
  scrollbar-width: thin;
  scrollbar-color: var(--pink) transparent;
  overscroll-behavior: contain;
}
.sources::-webkit-scrollbar { width: 8px; }
.sources::-webkit-scrollbar-thumb { background: var(--pink); border-radius: 999px; }

/* Each row is its own install link. */
.source {
  display: flex;
  align-items: center;
  gap: .8rem;
  padding: .6rem .75rem;
  margin-bottom: .5rem;
  border-radius: 1.1rem;
  border: 1px solid var(--line);
  color: inherit;
  text-decoration: none;
  transition: transform .15s ease, border-color .15s ease, background .15s ease;
}
.source:last-child { margin-bottom: 0; }
.source:hover, .source:focus-visible {
  transform: translateX(3px);
  border-color: var(--pink);
  background: var(--soft);
}

.source__icon {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: .65rem;
  object-fit: cover;
  background: var(--soft);
}
.source__text { min-width: 0; flex: 1 1 auto; }
.source__name { display: block; font-weight: 800; }
.source__meta { display: flex; align-items: center; gap: .45rem; color: var(--ink-soft); font-size: .8rem; }

.source__install {
  flex: 0 0 auto;
  padding: .3rem .85rem;
  border-radius: 999px;
  background: var(--brand);
  color: var(--ink);
  font-size: .78rem;
  font-weight: 800;
}

.badge { padding: .05rem .55rem; border-radius: 999px; font-size: .72rem; font-weight: 800; }
.badge--safe   { background: var(--mint-pale); color: #43682f; }
.badge--mature { background: #ffeccd; color: #8a5a14; }
.badge--adult  { background: var(--pink); color: #7d2247; }

.status { margin: .5rem 0 1rem; color: var(--ink-soft); font-size: .9rem; text-align: center; }

.footer { margin-top: 2.5rem; text-align: center; color: var(--ink-soft); font-size: .85rem; }
.footer__heart { color: var(--pink); }
.footer__built { margin: .25rem 0 0; opacity: .75; }

@media (prefers-reduced-motion: reduce) {
  .bubbles span { animation: none; }
  .button, .iconbutton, .source { transition: none; }
}
`;
}

await main();
