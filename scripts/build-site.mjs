/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Generates the repository homepage.
 *
 * The toolchain writes its own page during bundling; this replaces it with a
 * card for each Popmango repository — the 0.8 one built here and the 0.9 one
 * published alongside it. Each card lists that repository's sources, which can
 * be added all at once or picked individually.
 *
 * Both repositories are served from the same host, so fetching the 0.9 list is
 * a same-origin request and needs no proxy or CORS handling. The 0.8 list is
 * also inlined at build time so the page still fills in when opened straight
 * off disk.
 *
 * Usage: node scripts/build-site.mjs [--folder=0.8]
 */

import { readFile, writeFile } from "node:fs/promises";
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
<style>
${styles()}
</style>
</head>
<body>
<header class="hero">
  <div class="hero__icon" aria-hidden="true">
    <svg viewBox="0 0 64 64" width="72" height="72">
      <rect x="12" y="8" width="34" height="48" rx="5" fill="#fff"/>
      <path d="M46 8h6v48l-6-5z" fill="#ff9ec4"/>
      <circle cx="24" cy="30" r="2.5" fill="#5c4550"/>
      <circle cx="36" cy="30" r="2.5" fill="#5c4550"/>
      <circle cx="19" cy="36" r="3" fill="#ffc2dc"/>
      <circle cx="41" cy="36" r="3" fill="#ffc2dc"/>
    </svg>
  </div>
  <p class="hero__emoji" aria-hidden="true">🌸 ✨ 🍡</p>
  <p class="hero__eyebrow">Paperback · Manga/Manhwa/Novels</p>
  <h1 class="hero__title">${escapeHtml(title)}</h1>
  <p class="hero__tagline">${escapeHtml(pkg.description ?? "")}</p>
</header>

<main id="repos">
  <p class="status">Loading repositories…</p>
</main>

<footer class="footer">
  <p>Made with ♡ by Popmango</p>
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
   * Deep link for installing individual sources.
   *
   * The payload is a base64 list of [sourceId, repositoryUrl] pairs, which is
   * what the app expects for a partial install.
   */
  function installLink(repo, ids) {
    var pairs = ids.map(function (id) { return [id, repo.url]; });
    return "paperback://installExtensions?data=" + btoa(JSON.stringify(pairs));
  }

  function sourceRow(repo, source) {
    var badge = RATING[source.contentRating] || { label: source.contentRating || "", tone: "safe" };

    return '<label class="source">' +
      '<input class="source__check" type="checkbox" value="' + esc(source.id) + '">' +
      '<span class="source__box" aria-hidden="true"></span>' +
      '<img class="source__icon" src="' + esc(iconUrl(repo, source)) + '" alt="" width="40" height="40" loading="lazy">' +
      '<span class="source__text">' +
      '<span class="source__name">' + esc(source.name) + '</span>' +
      '<span class="source__meta">v' + esc(source.version) +
      '<span class="badge badge--' + badge.tone + '">' + esc(badge.label) + '</span></span>' +
      '</span></label>';
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
          '<a class="button button--add" href="' + esc(addRepoLink(repo)) + '">Add to Paperback</a>' +
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
        '<div class="picker">' +
          '<button class="link" type="button" data-all>Select all</button>' +
          '<button class="link" type="button" data-none>Clear</button>' +
        '</div>' +
        '<div class="sources" data-sources>' +
          (known ? sources.map(function (s) { return sourceRow(repo, s); }).join("")
                 : '<p class="status">Loading sources…</p>') +
        '</div>' +
        '<div class="install" data-install hidden>' +
          '<a class="button button--install" data-install-link href="#">Install selected</a>' +
        '</div>' +
      '</details>';

    wire(card, repo);
    return card;
  }

  function wire(card, repo) {
    var list = card.querySelector("[data-sources]");
    var count = card.querySelector("[data-count]");
    var installBar = card.querySelector("[data-install]");
    var installLinkEl = card.querySelector("[data-install-link]");

    function selected() {
      return Array.prototype.slice
        .call(list.querySelectorAll(".source__check:checked"))
        .map(function (input) { return input.value; });
    }

    function refresh() {
      var ids = selected();
      if (ids.length === 0) {
        installBar.hidden = true;
        return;
      }
      installBar.hidden = false;
      installLinkEl.textContent = "Install " + ids.length + " selected";
      installLinkEl.setAttribute("href", installLink(repo, ids));
    }

    list.addEventListener("change", refresh);

    card.querySelector("[data-all]").addEventListener("click", function () {
      var boxes = list.querySelectorAll(".source__check");
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = true;
      refresh();
    });

    card.querySelector("[data-none]").addEventListener("click", function () {
      var boxes = list.querySelectorAll(".source__check");
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
      refresh();
    });

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
        refresh();
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
:root {
  color-scheme: light;
  --bg: #fdf2f6;
  --bg-2: #f4f7ff;
  --card: #ffffff;
  --ink: #4a3b45;
  --ink-soft: #967d8c;
  --line: #f6dce7;
  --pink: #ff9ec4;
  --lilac: #b6a8ff;
  --sky: #8fd0ff;
  --mint: #9fe6c9;
  --soft: #fff0f6;
  --shadow: 0 18px 34px -22px rgba(140, 80, 110, .55);
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #241c26;
    --bg-2: #1e1c2c;
    --card: #302633;
    --ink: #ffeef6;
    --ink-soft: #c9a9bd;
    --line: #443347;
    --soft: #3d2f41;
    --shadow: 0 18px 34px -22px rgba(0, 0, 0, .8);
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0 1rem 3rem;
  background: linear-gradient(170deg, var(--bg) 0%, var(--bg-2) 100%);
  background-attachment: fixed;
  color: var(--ink);
  font-family: ui-rounded, "SF Pro Rounded", "Quicksand", "Segoe UI", system-ui, sans-serif;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

main, .hero, .footer { max-width: 44rem; margin-inline: auto; }

/* ---------- hero ---------- */

.hero { text-align: center; padding: 2.5rem 0 2rem; }

.hero__icon {
  display: inline-flex;
  padding: .6rem;
  border-radius: 1.6rem;
  background: linear-gradient(150deg, #ffe3ef, #e7f0ff);
  box-shadow: var(--shadow);
}
.hero__emoji { margin: 1rem 0 .5rem; font-size: 1.4rem; letter-spacing: .5rem; }
.hero__eyebrow { margin: 0 0 .35rem; color: var(--ink-soft); font-weight: 600; }

.hero__title {
  margin: 0 0 .75rem;
  font-size: clamp(2.4rem, 9vw, 3.6rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -.02em;
  background: linear-gradient(100deg, var(--pink) 0%, var(--lilac) 55%, var(--sky) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero__tagline { margin: 0 auto; max-width: 26rem; color: var(--ink-soft); }

/* ---------- repository card ---------- */

.repo {
  margin-bottom: 1.5rem;
  border-radius: 1.5rem;
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.repo__head { padding: 1.4rem 1.4rem 1.2rem; }
.repo__name { margin: 0 0 .6rem; font-size: 1.5rem; font-weight: 800; line-height: 1.15; }

.repo__meta { display: flex; align-items: center; gap: .6rem; margin-bottom: 1rem; }
.repo__url { min-width: 0; color: var(--ink-soft); font-size: .85rem; word-break: break-all; }

.tag {
  flex: 0 0 auto;
  padding: .1rem .8rem;
  border-radius: 999px;
  background: var(--mint);
  color: #2f5a4a;
  font-size: .85rem;
  font-weight: 700;
}

.repo__actions { display: flex; align-items: center; gap: .6rem; }

.button {
  display: block;
  padding: .8rem 1.4rem;
  border-radius: 999px;
  font-size: 1rem;
  font-weight: 700;
  text-align: center;
  text-decoration: none;
  transition: transform .15s ease, filter .15s ease;
}
.button--add {
  flex: 1 1 auto;
  color: #fff;
  background: linear-gradient(100deg, var(--pink), var(--lilac));
}
.button--discord {
  margin-top: .6rem;
  color: #4b4478;
  background: linear-gradient(100deg, #d9d4ff, #c3dcff);
}
.button--install {
  color: #fff;
  background: linear-gradient(100deg, var(--lilac), var(--sky));
}
.button:hover, .button:focus-visible { transform: translateY(-2px); filter: brightness(1.05); }
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
  color: var(--pink);
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
.drawer__toggle:hover { background: rgba(255, 158, 196, .07); }

.drawer__count { display: flex; align-items: center; gap: .45rem; color: var(--pink); font-weight: 700; }
.drawer__emoji { font-size: 1.1rem; }
.drawer__hint { color: var(--ink-soft); font-size: .85rem; }

/* Swap the hint text with the drawer's own state. */
.drawer__show { display: inline; }
.drawer__hide { display: none; }
.drawer[open] .drawer__show { display: none; }
.drawer[open] .drawer__hide { display: inline; }

.picker { display: flex; gap: 1rem; padding: 0 1.4rem .6rem; }
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--pink);
  font: inherit;
  font-size: .85rem;
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
}

.sources {
  max-height: 21rem;
  overflow-y: auto;
  padding: 0 1.4rem;
  scrollbar-width: thin;
  scrollbar-color: var(--pink) transparent;
  overscroll-behavior: contain;
}
.sources::-webkit-scrollbar { width: 8px; }
.sources::-webkit-scrollbar-thumb { background: var(--pink); border-radius: 999px; }

.source {
  display: flex;
  align-items: center;
  gap: .8rem;
  padding: .65rem .8rem;
  margin-bottom: .5rem;
  border-radius: 1rem;
  border: 1px solid var(--line);
  cursor: pointer;
}
.source:last-child { margin-bottom: .2rem; }
.source:hover { background: rgba(255, 158, 196, .06); }

/* The native control stays focusable but the painted box is what shows. */
.source__check { position: absolute; opacity: 0; width: 0; height: 0; }

.source__box {
  flex: 0 0 auto;
  width: 1.3rem;
  height: 1.3rem;
  border-radius: .45rem;
  border: 2px solid var(--line);
  background: var(--card);
  transition: background .15s ease, border-color .15s ease;
}
.source__check:checked + .source__box {
  border-color: transparent;
  background: linear-gradient(100deg, var(--pink), var(--lilac))
    no-repeat center/.8rem
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round' d='M3 8.5 6.5 12 13 4'/%3E%3C/svg%3E");
}
.source__check:focus-visible + .source__box { outline: 2px solid var(--lilac); outline-offset: 2px; }

.source__icon {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: .6rem;
  object-fit: cover;
  background: var(--bg);
}
.source__text { min-width: 0; display: block; }
.source__name { display: block; font-weight: 700; }
.source__meta {
  display: flex;
  align-items: center;
  gap: .45rem;
  color: var(--ink-soft);
  font-size: .82rem;
}

.badge { padding: .05rem .55rem; border-radius: 999px; font-size: .72rem; font-weight: 700; }
.badge--safe   { background: #d8f6e8; color: #2f6b52; }
.badge--mature { background: #fff0cf; color: #8a6414; }
.badge--adult  { background: #ffd9e6; color: #a63a68; }

.install { padding: .9rem 1.4rem 1.2rem; }

.status { margin: .5rem 0 1rem; color: var(--ink-soft); font-size: .9rem; text-align: center; }

.footer { margin-top: 2.5rem; text-align: center; color: var(--ink-soft); font-size: .85rem; }
.footer__built { margin: .25rem 0 0; opacity: .75; }

@media (prefers-reduced-motion: reduce) {
  .button, .iconbutton, .source__box { transition: none; }
}
`;
}

await main();
