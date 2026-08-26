/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Generates the repository homepage.
 *
 * The toolchain writes its own page during bundling; this replaces it with a
 * page that carries both Popmango repositories — the 0.8 one built here and
 * the 0.9 one published alongside it — as switchable tabs. Each list is pulled
 * from that repository's versioning.json, and every source can be installed on
 * its own or as part of the whole list.
 *
 * Usage: node scripts/build-site.mjs [--folder=0.8]
 */

import { cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const DISCORD = "https://discord.com/invite/inkdex";

/** The 0.9 repository, offered alongside this one. */
const NEXT_VERSION = {
    name: "PoppingMango Extensions",
    label: "0.9",
    url: "https://poppingmangosources.github.io/general-extensions-mangago/0.9/test",
    github: "https://github.com/PoppingMangoSources/general-extensions-mangago",
    note: "For Paperback 0.9. These will not load on 0.8.",
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

    await cp(path.join(ROOT, "media"), path.join(bundles, "media"), { recursive: true });

    const current = {
        name: pkg.repositoryName ?? "PoppingMango Sources",
        label: folder === "" ? "0.8" : folder,
        url: resolveBaseUrl(pkg, folder),
        github: pkg.repository ?? "https://github.com/PoppingMangoSources/popmango-paperback-sources",
        note: "For Paperback 0.8.",
        // This tab is served from the folder it describes, so its icons and
        // listing resolve against the page rather than an absolute URL. That
        // keeps it working on a branch preview, a custom domain, or off disk.
        local: true,
        // Inlined so the list is there before any request finishes.
        sources: sortSources(versioning.sources),
    };

    const repos = [current, NEXT_VERSION];
    await writeFile(path.join(bundles, "index.html"), page({ pkg, repos, versioning }), "utf8");
    console.log(`Wrote ${path.relative(ROOT, path.join(bundles, "index.html"))} with ${current.sources.length} source(s).`);

    // Keep Pages from running the published files through Jekyll, which would
    // hide any folder whose name begins with an underscore.
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
    const data = JSON.stringify(repos).replace(/</g, "\\u003c");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(pkg.description ?? "")}">
<meta name="theme-color" content="#ffd9e6">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(mangoMark(32))}">
<style>
${styles()}
</style>
</head>
<body>
<div class="glow" aria-hidden="true"></div>

<header class="masthead">
  <div class="brand">
    <span class="brand__mark" aria-hidden="true">${mangoMark(44)}</span>
    <span class="brand__text">
      <span class="brand__name">PoppingMango</span>
      <span class="brand__kind">Paperback sources</span>
    </span>
  </div>
  <h1 class="masthead__title">Novels, manga,<br>manhwa &amp; manhua.</h1>
  <p class="masthead__sub">Pick a version, then add the whole repository or just the sources you want.</p>
</header>

<main>
  <div class="tabs" role="tablist" id="tabs"></div>
  <section class="panel" id="panel"></section>
</main>

<footer class="footer">
  <a class="footer__link" href="${escapeHtml(DISCORD)}">Support on Discord</a>
  <p>Made with <span class="footer__heart">♡</span> by Popmango</p>
  ${built ? `<p class="footer__built">Last built ${escapeHtml(built.toISOString().slice(0, 16).replace("T", " "))} UTC</p>` : ""}
</footer>

<script id="repo-data" type="application/json">${data}</script>
<script>
${script()}
</script>
</body>
</html>
`;
}

/** The mango mark, drawn inline so it needs no network request. */
function mangoMark(size) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="PoppingMango"><defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc98a"/><stop offset="1" stop-color="#ffa45c"/></linearGradient></defs><circle cx="24" cy="24" r="23" fill="#fff2f7"/><ellipse cx="24" cy="26" rx="13" ry="15" fill="url(#mg)"/><ellipse cx="19" cy="20" rx="4" ry="6" fill="#fff" opacity=".45"/><ellipse cx="31" cy="10" rx="7" ry="3.4" fill="#a8d48c" transform="rotate(24 31 10)"/><circle cx="34" cy="16" r="2.6" fill="#fff" opacity=".9"/></svg>`;
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
<body><p>Taking you to <a href="${escapeHtml(target)}">the PoppingMango sources</a>…</p></body>
</html>
`;
}

function script() {
    return `
(function () {
  "use strict";

  var RATING = {
    EVERYONE: { label: "Safe", tone: "safe" },
    MATURE: { label: "16+", tone: "mature" },
    ADULT: { label: "18+", tone: "adult" }
  };

  var repos = JSON.parse(document.getElementById("repo-data").textContent);
  var tabsEl = document.getElementById("tabs");
  var panelEl = document.getElementById("panel");
  var active = 0;
  var filter = "";

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function sortSources(list) {
    return (list || []).filter(Boolean).slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
  }

  // A repository served from this very folder is addressed relatively, so the
  // page keeps working on a branch preview, a custom domain, or off disk.
  function base(repo) { return repo.local ? "." : repo.url.replace(/\\/+$/, ""); }

  function iconUrl(repo, s) {
    return base(repo) + "/" + encodeURIComponent(s.id) +
      "/includes/" + encodeURIComponent(s.icon || "icon.png");
  }

  function addRepoLink(repo) {
    return "paperback://addRepo?displayName=" + encodeURIComponent(repo.name) +
      "&url=" + encodeURIComponent(repo.url);
  }

  /**
   * Deep link that installs specific sources rather than the whole list.
   *
   * The payload is a base64 list of [sourceId, repositoryUrl] pairs. It always
   * carries the repository's real URL, never the relative one used for
   * artwork — the app has no page to resolve a relative one against.
   */
  function installLink(repo, ids) {
    return "paperback://installExtensions?data=" +
      btoa(JSON.stringify(ids.map(function (id) { return [id, repo.url]; })));
  }

  function renderTabs() {
    tabsEl.innerHTML = repos.map(function (repo, index) {
      var count = repo.sources == null ? "" : '<b>' + repo.sources.length + '</b>';
      return '<button class="tab' + (index === active ? " is-active" : "") + '" role="tab" ' +
        'aria-selected="' + (index === active) + '" data-tab="' + index + '">' +
        '<span class="tab__ver">' + esc(repo.label) + '</span>' + count + '</button>';
    }).join("");

    Array.prototype.forEach.call(tabsEl.querySelectorAll("[data-tab]"), function (button) {
      button.addEventListener("click", function () {
        active = Number(button.getAttribute("data-tab"));
        filter = "";
        render();
      });
    });
  }

  function sourceCard(repo, s) {
    var badge = RATING[s.contentRating] || { label: s.contentRating || "", tone: "safe" };

    return '<a class="src" href="' + esc(installLink(repo, [s.id])) + '" title="Install ' + esc(s.name) + '">' +
      '<img class="src__icon" src="' + esc(iconUrl(repo, s)) + '" alt="" width="48" height="48" ' +
      'loading="lazy" onerror="this.style.visibility=&quot;hidden&quot;">' +
      '<span class="src__body">' +
        '<span class="src__name">' + esc(s.name) + '</span>' +
        '<span class="src__meta"><span class="src__ver">v' + esc(s.version) + '</span>' +
        '<span class="chip chip--' + badge.tone + '">' + esc(badge.label) + '</span></span>' +
      '</span>' +
      '<span class="src__go" aria-hidden="true">+</span>' +
    '</a>';
  }

  function render() {
    var repo = repos[active];
    var known = repo.sources != null;
    var list = known ? sortSources(repo.sources) : [];
    var needle = filter.trim().toLowerCase();
    var shown = needle ? list.filter(function (s) {
      return String(s.name).toLowerCase().indexOf(needle) !== -1;
    }) : list;

    renderTabs();

    var body;
    if (!known) {
      body = '<p class="note">Loading sources…</p>';
    } else if (list.length === 0) {
      body = '<p class="note">Nothing published here yet. (｡•́︿•̀｡)</p>';
    } else if (shown.length === 0) {
      body = '<p class="note">No source matches “' + esc(filter) + '”.</p>';
    } else {
      body = '<div class="grid">' + shown.map(function (s) { return sourceCard(repo, s); }).join("") + '</div>';
    }

    panelEl.innerHTML =
      '<div class="repo">' +
        '<div class="repo__info">' +
          '<p class="repo__note">' + esc(repo.note) + '</p>' +
          '<p class="repo__url">' + esc(repo.url.replace(/^https?:\\/\\//, "")) + '</p>' +
        '</div>' +
        '<div class="repo__acts">' +
          '<a class="btn btn--primary" href="' + esc(addRepoLink(repo)) + '">Add whole repository</a>' +
          '<a class="btn btn--ghost" href="' + esc(repo.github) + '">GitHub</a>' +
        '</div>' +
      '</div>' +
      (known && list.length > 6
        ? '<label class="search"><span class="search__icon" aria-hidden="true">⌕</span>' +
          '<input id="filter" type="search" placeholder="Filter ' + list.length + ' sources" ' +
          'value="' + esc(filter) + '" autocomplete="off"></label>'
        : "") +
      body;

    var input = document.getElementById("filter");
    if (input) {
      input.addEventListener("input", function () {
        filter = input.value;
        var caret = input.selectionStart;
        render();
        var next = document.getElementById("filter");
        if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch (e) {} }
      });
    }
  }

  /**
   * Pulls a repository's list from the versioning.json it publishes.
   *
   * Both repositories sit on the same host, so this is same-origin; a repo
   * elsewhere would rely on Pages sending permissive CORS headers, which it
   * does.
   */
  function load(repo, index) {
    fetch(base(repo) + "/versioning.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (data) {
        repo.sources = sortSources(data.sources);
        if (index === active || repo.sources.length) render();
      })
      .catch(function () {
        // Whatever was inlined at build time stands; an unknown list becomes
        // an empty one so the tab can say so rather than spin forever.
        if (repo.sources == null) { repo.failed = true; repo.sources = []; render(); }
      });
  }

  render();
  repos.forEach(load);
})();
`;
}

function styles() {
    return `
/*
 * Palette taken from the brand artwork: the blush-to-mango sweep, its mango
 * and leaf accents, and the deep plum the lettering is set in. Surfaces stay
 * near-white so the covers and artwork carry the colour.
 */
:root {
  color-scheme: light;

  --blush: #ffdcea;
  --pink: #ffbbd5;
  --apricot: #ffcda8;
  --mango: #ffc17e;
  --mango-deep: #f08b3c;
  --leaf: #a8d48c;
  --mint: #e6f6d8;

  --ink: #33162a;
  --ink-2: #6d4a5e;
  --ink-3: #9d7b8c;

  --surface: #ffffff;
  --page: #fdf7f9;
  --line: #f2e2ea;
  --hover: #fff6fa;

  --radius: 16px;
  --shadow-sm: 0 1px 2px rgba(80, 30, 55, .06), 0 2px 8px -4px rgba(80, 30, 55, .10);
  --shadow-md: 0 2px 4px rgba(80, 30, 55, .05), 0 12px 28px -14px rgba(80, 30, 55, .28);
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --ink: #ffeaf4;
    --ink-2: #d8b6c8;
    --ink-3: #a98598;
    --surface: #2c2130;
    --page: #201826;
    --line: #402e3f;
    --hover: #362839;
    --shadow-sm: 0 1px 2px rgba(0,0,0,.3), 0 2px 8px -4px rgba(0,0,0,.5);
    --shadow-md: 0 2px 4px rgba(0,0,0,.3), 0 12px 28px -14px rgba(0,0,0,.7);
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0 1.25rem 4rem;
  background: var(--page);
  color: var(--ink);
  font-family: ui-rounded, "SF Pro Rounded", "Quicksand", "Segoe UI", system-ui, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* One soft wash of brand colour behind the header, nothing more. */
.glow {
  position: absolute;
  inset: 0 0 auto;
  height: 340px;
  background:
    radial-gradient(60% 120% at 15% 0%, var(--blush) 0%, transparent 60%),
    radial-gradient(50% 110% at 88% 8%, var(--apricot) 0%, transparent 62%);
  opacity: .85;
  pointer-events: none;
  z-index: 0;
}
@media (prefers-color-scheme: dark) { .glow { opacity: .16; } }

.masthead, main, .footer { position: relative; z-index: 1; max-width: 52rem; margin-inline: auto; }

/* ---------- masthead ---------- */

.masthead { padding: 2.5rem 0 1.75rem; }

.brand { display: flex; align-items: center; gap: .7rem; margin-bottom: 1.5rem; }
.brand__mark { display: flex; filter: drop-shadow(0 4px 10px rgba(240, 139, 60, .3)); }
.brand__text { display: flex; flex-direction: column; line-height: 1.15; }
.brand__name { font-weight: 800; font-size: 1.05rem; letter-spacing: -.01em; }
.brand__kind { color: var(--ink-3); font-size: .8rem; font-weight: 600; }

.masthead__title {
  margin: 0 0 .6rem;
  font-size: clamp(2rem, 6.5vw, 2.9rem);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -.025em;
}
.masthead__sub { margin: 0; max-width: 30rem; color: var(--ink-2); }

/* ---------- tabs ---------- */

.tabs {
  display: inline-flex;
  gap: .25rem;
  padding: .25rem;
  margin-bottom: 1.1rem;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  padding: .5rem 1.05rem;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--ink-2);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.tab:hover { color: var(--ink); }
.tab.is-active {
  background: linear-gradient(100deg, var(--pink), var(--mango));
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}
.tab__ver::before { content: "Paperback "; font-weight: 600; opacity: .75; }
.tab b {
  min-width: 1.35rem;
  padding: 0 .35rem;
  border-radius: 999px;
  background: rgba(51, 22, 42, .1);
  font-size: .78rem;
  text-align: center;
}
.tab.is-active b { background: rgba(255, 255, 255, .55); }
@media (prefers-color-scheme: dark) {
  .tab b { background: rgba(255,255,255,.1); }
  .tab.is-active { color: #33162a; }
}

/* ---------- repository strip ---------- */

.repo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.15rem 1.25rem;
  margin-bottom: 1.1rem;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}
.repo__info { min-width: 0; }
.repo__note { margin: 0; font-weight: 700; }
.repo__url { margin: .15rem 0 0; color: var(--ink-3); font-size: .82rem; word-break: break-all; }
.repo__acts { display: flex; gap: .5rem; flex: 1 1 auto; justify-content: flex-end; }

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: .62rem 1.15rem;
  border-radius: 999px;
  font-weight: 700;
  font-size: .92rem;
  text-decoration: none;
  white-space: nowrap;
  transition: transform .14s ease, filter .14s ease, background .14s ease;
}
.btn--primary {
  color: #33162a;
  background: linear-gradient(100deg, var(--pink), var(--mango));
  box-shadow: var(--shadow-sm);
}
.btn--ghost { color: var(--ink-2); background: var(--hover); border: 1px solid var(--line); }
.btn:hover, .btn:focus-visible { transform: translateY(-1px); filter: brightness(1.03); }
.btn:active { transform: translateY(0); }

@media (max-width: 32rem) {
  .repo__acts { justify-content: stretch; }
  .btn--primary { flex: 1 1 auto; }
}

/* ---------- filter ---------- */

.search {
  display: flex;
  align-items: center;
  gap: .55rem;
  padding: 0 1rem;
  margin-bottom: 1rem;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}
.search__icon { color: var(--ink-3); font-size: 1.1rem; }
.search input {
  flex: 1 1 auto;
  padding: .68rem 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  outline: none;
}
.search input::placeholder { color: var(--ink-3); }

/* ---------- source grid ---------- */

.grid {
  display: grid;
  gap: .6rem;
  grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr));
}

.src {
  display: flex;
  align-items: center;
  gap: .8rem;
  padding: .7rem .85rem;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
  color: inherit;
  text-decoration: none;
  transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease;
}
.src:hover, .src:focus-visible {
  transform: translateY(-2px);
  border-color: var(--pink);
  box-shadow: var(--shadow-md);
}

.src__icon {
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  object-fit: cover;
  background: var(--hover);
}
.src__body { min-width: 0; flex: 1 1 auto; display: block; }
.src__name {
  display: block;
  font-weight: 800;
  letter-spacing: -.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.src__meta { display: flex; align-items: center; gap: .4rem; margin-top: .1rem; }
.src__ver { color: var(--ink-3); font-size: .8rem; font-variant-numeric: tabular-nums; }

.src__go {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 50%;
  background: var(--hover);
  color: var(--mango-deep);
  font-size: 1.15rem;
  font-weight: 800;
  line-height: 1;
  transition: background .14s ease, color .14s ease;
}
.src:hover .src__go {
  background: linear-gradient(100deg, var(--pink), var(--mango));
  color: #33162a;
}

.chip { padding: .04rem .5rem; border-radius: 999px; font-size: .7rem; font-weight: 800; }
.chip--safe   { background: var(--mint); color: #45692f; }
.chip--mature { background: #ffeccd; color: #8a5a14; }
.chip--adult  { background: var(--blush); color: #96305e; }
@media (prefers-color-scheme: dark) {
  .chip--safe { background: #33472a; color: #cdeeb4; }
  .chip--mature { background: #4d3a1c; color: #ffdca4; }
  .chip--adult { background: #4e2439; color: #ffc3dd; }
}

.note {
  padding: 2.25rem 1rem;
  margin: 0;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px dashed var(--line);
  color: var(--ink-3);
  text-align: center;
}

/* ---------- footer ---------- */

.footer { margin-top: 3rem; text-align: center; color: var(--ink-3); font-size: .85rem; }
.footer__link { display: inline-block; margin-bottom: .6rem; color: var(--mango-deep); font-weight: 700; }
.footer p { margin: .15rem 0; }
.footer__heart { color: var(--pink); }
.footer__built { opacity: .7; }

@media (prefers-reduced-motion: reduce) {
  .btn, .src, .src__go, .tab { transition: none; }
}
`;
}

await main();
