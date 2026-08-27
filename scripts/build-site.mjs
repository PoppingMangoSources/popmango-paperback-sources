/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Popmango */

/**
 * Builds one repository page for both Paperback generations.
 *
 * The 0.8 catalog is read from the bundle produced in this repository. The
 * 0.9 catalog is inlined from its published manifest when available and
 * refreshed in the browser, so both source lists remain useful if either
 * network request is temporarily unavailable.
 *
 * Usage:
 *   node scripts/build-site.mjs [--folder=all]
 *   node scripts/build-site.mjs [--folder=all] [--next-manifest=path/to/versioning.json]
 */

import { existsSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DISCORD = "https://discord.com/invite/inkdex";

const NEXT_VERSION = {
    name: "PoppingMango Extensions",
    label: "0.9",
    url: "https://poppingmangosources.github.io/general-extensions-mangago/0.9/test",
    github: "https://github.com/PoppingMangoSources/general-extensions-mangago",
    note: "The newest PoppingMango catalog for Paperback 0.9.",
    iconFolder: "static",
};

async function main() {
    const folder = argument("folder") ?? "";
    const bundleFolder = path.join(ROOT, "bundles", folder);
    const versioningPath = path.join(bundleFolder, "versioning.json");

    if (!existsSync(versioningPath)) {
        console.error(`No versioning.json in ${bundleFolder}. Run the bundler first.`);
        process.exitCode = 1;
        return;
    }

    const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
    const versioning = JSON.parse(await readFile(versioningPath, "utf8"));
    const nextManifest = await loadNextManifest();

    await cp(path.join(ROOT, "media"), path.join(bundleFolder, "media"), { recursive: true });

    const current = {
        name: pkg.repositoryName ?? "PoppingMango Sources",
        label: "0.8",
        url: resolveBaseUrl(pkg, folder),
        github: pkg.repository ?? "https://github.com/PoppingMangoSources/popmango-paperback-sources",
        note: "Sources rebuilt for the Paperback 0.8 runtime.",
        iconFolder: "includes",
        local: true,
        sources: sortSources(versioning.sources),
    };
    const next = {
        ...NEXT_VERSION,
        sources: nextManifest === undefined ? undefined : sortSources(nextManifest.sources),
    };

    await writeFile(
        path.join(bundleFolder, "index.html"),
        page({ pkg, repos: [current, next], versioning }),
        "utf8",
    );
    console.log(
        `Wrote ${path.relative(ROOT, path.join(bundleFolder, "index.html"))} with ${current.sources.length} 0.8 source(s) and ${next.sources?.length ?? 0} inlined 0.9 source(s).`,
    );

    await writeFile(path.join(ROOT, "bundles", ".nojekyll"), "", "utf8");

    if (folder !== "") {
        await writeFile(path.join(ROOT, "bundles", "index.html"), rootRedirect(folder), "utf8");
    }
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

    try {
        const response = await fetch(`${NEXT_VERSION.url}/versioning.json`, {
            headers: { accept: "application/json" },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.warn(`Could not inline the 0.9 manifest: ${String(error)}`);
        return undefined;
    }
}

function sortSources(sources) {
    return (sources ?? [])
        .filter((source) => source != null)
        .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveBaseUrl(pkg, folder) {
    const suffix = folder === "" ? "" : `/${folder}`;
    const repository = process.env.GITHUB_REPOSITORY;

    if (repository !== undefined) {
        const [owner, name] = repository.split("/");
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
    const built = versioning.buildTime ? new Date(versioning.buildTime) : undefined;
    const data = JSON.stringify(repos).replace(/</g, "\\u003c");
    const description =
        "PoppingMango manga, manhwa, manhua and novel sources for Paperback 0.8 and 0.9.";

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#ffca8f">
<meta name="color-scheme" content="light">
<title>${escapeHtml(pkg.repositoryName ?? "PoppingMango Sources")}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(mangoMark(32))}">
<style>
${styles()}
</style>
</head>
<body>
<div class="summer-sky" aria-hidden="true">
  <span class="sun"></span>
  <span class="cloud cloud--one"></span>
  <span class="cloud cloud--two"></span>
</div>

<header class="hero" id="top">
  <nav class="topbar" aria-label="Site links">
    <a class="brand" href="#top">
      <span class="brand__mark" aria-hidden="true">${mangoMark(46)}</span>
      <span><b>PoppingMango</b><small>Paperback sources</small></span>
    </a>
    <div class="topbar__links">
      <a href="#paperback-0-8">0.8</a>
      <a href="#paperback-0-9">0.9</a>
      <a href="${escapeHtml(DISCORD)}">Support</a>
    </div>
  </nav>

  <div class="hero__copy">
    <p class="eyebrow">A little pocket of summer</p>
    <h1>Manga days,<br><span>mango skies.</span></h1>
    <p class="hero__lede">Kawaii Paperback sources for novels, manga, manhwa and manhua—both repositories together, with the right build for your app.</p>
    <div class="hero__actions">
      <a class="button button--mango" href="#paperback-0-8">Browse Paperback 0.8</a>
      <a class="button button--berry" href="#paperback-0-9">Browse Paperback 0.9</a>
    </div>
  </div>

  <div class="hero__card" aria-hidden="true">
    <span class="hero__sparkle">✦</span>
    <span class="hero__mango">${mangoMark(126)}</span>
    <span class="hero__caption">fresh sources<br>for sunny reads</span>
  </div>
</header>

<section class="ticker" aria-label="Available sources">
  <div class="ticker__fade ticker__fade--left"></div>
  <div class="ticker__track" id="ticker-track"></div>
  <div class="ticker__fade ticker__fade--right"></div>
</section>

<main>
  <section class="compat">
    <span class="compat__flower" aria-hidden="true">✿</span>
    <p><b>Choose the version that matches Paperback.</b> A 0.9 extension cannot load in 0.8, and every 0.8 source here is implemented against the 0.8 API.</p>
  </section>

  <div class="catalog-tools">
    <div>
      <p class="eyebrow">Pick your favourites</p>
      <h2>Both source gardens</h2>
    </div>
    <label class="search">
      <span aria-hidden="true">⌕</span>
      <input id="source-filter" type="search" placeholder="Search every source" autocomplete="off">
    </label>
  </div>

  <div id="repo-sections"></div>
</main>

<footer class="footer">
  <span aria-hidden="true">${mangoMark(42)}</span>
  <p><b>PoppingMango Paperback Sources</b><br>Made with mango sunshine and a little bit of pink.</p>
  <p class="footer__links"><a href="${escapeHtml(DISCORD)}">Support Discord</a> · <a href="${escapeHtml(repos[0].github)}">GitHub</a></p>
  ${built ? `<p class="footer__built">Catalog built ${escapeHtml(built.toISOString().slice(0, 10))}</p>` : ""}
</footer>

<script id="repo-data" type="application/json">${data}</script>
<script>
${browserScript()}
</script>
</body>
</html>
`;
}

function mangoMark(size) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="PoppingMango"><defs><linearGradient id="mango-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd087"/><stop offset="1" stop-color="#ff9a61"/></linearGradient></defs><circle cx="24" cy="24" r="23" fill="#fff7dc"/><ellipse cx="23" cy="27" rx="13" ry="15" fill="url(#mango-gradient)"/><ellipse cx="18" cy="20" rx="3.5" ry="6" fill="#fff" opacity=".42"/><ellipse cx="31" cy="10" rx="7" ry="3.4" fill="#8fce8b" transform="rotate(24 31 10)"/><circle cx="34" cy="17" r="2.4" fill="#fff" opacity=".9"/></svg>`;
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
<body><p>Taking you to <a href="${escapeHtml(target)}">PoppingMango Sources</a>…</p></body>
</html>
`;
}

function browserScript() {
    return `
(function () {
  "use strict";

  var RATING = {
    SAFE: { label: "Safe", tone: "safe" },
    EVERYONE: { label: "Safe", tone: "safe" },
    MATURE: { label: "16+", tone: "mature" },
    ADULT: { label: "18+", tone: "adult" }
  };

  var repos = JSON.parse(document.getElementById("repo-data").textContent);
  var sections = document.getElementById("repo-sections");
  var ticker = document.getElementById("ticker-track");
  var filterInput = document.getElementById("source-filter");

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function sortSources(list) {
    return (list || []).filter(Boolean).slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function base(repo) {
    return repo.local ? "." : repo.url.replace(/\\/+$/, "");
  }

  function iconUrl(repo, source) {
    return base(repo) + "/" + encodeURIComponent(source.id) + "/" +
      encodeURIComponent(repo.iconFolder) + "/" + encodeURIComponent(source.icon || "icon.png");
  }

  function addRepoLink(repo) {
    return "paperback://addRepo?displayName=" + encodeURIComponent(repo.name) +
      "&url=" + encodeURIComponent(repo.url);
  }

  function installLink(repo, ids) {
    return "paperback://installExtensions?data=" +
      btoa(JSON.stringify(ids.map(function (id) { return [id, repo.url]; })));
  }

  function ratingFor(source) {
    return RATING[String(source.contentRating || "").toUpperCase()] ||
      { label: String(source.contentRating || ""), tone: "safe" };
  }

  function sourceCard(repo, source) {
    var rating = ratingFor(source);
    return '<a class="source-card" href="' + esc(installLink(repo, [source.id])) +
      '" title="Install ' + esc(source.name) + '">' +
      '<img src="' + esc(iconUrl(repo, source)) + '" alt="" width="54" height="54" loading="lazy">' +
      '<span class="source-card__copy"><b>' + esc(source.name) + '</b>' +
      '<span><span>v' + esc(source.version) + '</span>' +
      (rating.label ? '<i class="rating rating--' + rating.tone + '">' + esc(rating.label) + '</i>' : "") +
      '</span></span><span class="source-card__add" aria-hidden="true">+</span></a>';
  }

  function repositorySection(repo, index, query) {
    var known = Array.isArray(repo.sources);
    var list = known ? sortSources(repo.sources) : [];
    var shown = query ? list.filter(function (source) {
      return String(source.name).toLowerCase().indexOf(query) !== -1;
    }) : list;
    var id = "paperback-" + repo.label.replace(".", "-");
    var count = known ? String(list.length) : "…";
    var body;

    if (!known) {
      body = '<p class="empty">Loading this source garden…</p>';
    } else if (shown.length === 0) {
      body = '<p class="empty">No sources here match your search.</p>';
    } else {
      body = '<div class="source-scroll"><div class="source-grid">' +
        shown.map(function (source) { return sourceCard(repo, source); }).join("") +
        '</div><span class="source-scroll__rail" aria-hidden="true">' +
        '<span class="source-scroll__thumb"></span></span></div>';
    }

    return '<section class="repository repository--' + (index === 0 ? "mango" : "berry") +
      '" id="' + id + '">' +
      '<div class="repository__head"><div>' +
      '<p class="repository__kicker">Paperback ' + esc(repo.label) + '</p>' +
      '<h3>' + esc(repo.name) + ' <span>' + count + ' sources</span></h3>' +
      '<p>' + esc(repo.note) + '</p></div>' +
      '<div class="repository__actions">' +
      '<a class="button button--' + (index === 0 ? "mango" : "berry") +
      '" href="' + esc(addRepoLink(repo)) + '">Add repository</a>' +
      '<a class="button button--paper" href="' + esc(repo.github) + '">View on GitHub</a>' +
      '</div></div>' + body + '</section>';
  }

  function renderSections() {
    var query = filterInput.value.trim().toLowerCase();
    sections.innerHTML = repos.map(function (repo, index) {
      return repositorySection(repo, index, query);
    }).join("");
    updateScrollbars();
  }

  function updateScrollbar(container) {
    var viewport = container.querySelector(".source-grid");
    var rail = container.querySelector(".source-scroll__rail");
    var thumb = container.querySelector(".source-scroll__thumb");
    var scrollable = viewport.scrollHeight > viewport.clientHeight + 1;

    rail.hidden = !scrollable;
    if (!scrollable) return;

    var railHeight = rail.clientHeight;
    var thumbHeight = Math.max(42, railHeight * viewport.clientHeight / viewport.scrollHeight);
    var available = Math.max(0, railHeight - thumbHeight);
    var progress = viewport.scrollTop / Math.max(1, viewport.scrollHeight - viewport.clientHeight);
    thumb.style.height = thumbHeight + "px";
    thumb.style.transform = "translateY(" + (available * progress) + "px)";
  }

  function updateScrollbars() {
    Array.prototype.forEach.call(document.querySelectorAll(".source-scroll"), function (container) {
      var viewport = container.querySelector(".source-grid");
      updateScrollbar(container);
      if (viewport.dataset.scrollbarReady !== "true") {
        viewport.dataset.scrollbarReady = "true";
        viewport.addEventListener("scroll", function () { updateScrollbar(container); }, { passive: true });
      }
    });
  }

  function tickerItem(repo, source) {
    return '<a class="ticker__item" href="' + esc(installLink(repo, [source.id])) + '">' +
      '<img src="' + esc(iconUrl(repo, source)) + '" alt="" width="38" height="38">' +
      '<span><b>' + esc(source.name) + '</b><small>Paperback ' + esc(repo.label) + '</small></span></a>';
  }

  function renderTicker() {
    var items = [];
    repos.forEach(function (repo) {
      sortSources(repo.sources).forEach(function (source) {
        items.push(tickerItem(repo, source));
      });
    });
    if (!items.length) {
      ticker.hidden = true;
      return;
    }
    var set = '<div class="ticker__set">' + items.join("") + '</div>';
    var duplicate = set
      .replace('<div class="ticker__set">', '<div class="ticker__set" aria-hidden="true">')
      .replace(/<a class=/g, '<a tabindex="-1" class=');
    ticker.innerHTML = set + duplicate;
  }

  function refresh(repo) {
    fetch(base(repo) + "/versioning.json", { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(function (manifest) {
        repo.sources = sortSources(manifest.sources);
        renderSections();
        renderTicker();
      })
      .catch(function () {
        if (!Array.isArray(repo.sources)) {
          repo.sources = [];
          renderSections();
          renderTicker();
        }
      });
  }

  filterInput.addEventListener("input", renderSections);
  window.addEventListener("resize", updateScrollbars);
  renderSections();
  renderTicker();
  repos.forEach(refresh);
})();
`;
}

function styles() {
    return `
:root {
  color-scheme: light;
  --cream: #fffaf0;
  --paper: #fffefa;
  --sun: #ffd78a;
  --mango: #ffae69;
  --mango-deep: #ef7e55;
  --pink: #ffabc7;
  --berry: #c99be8;
  --sky: #cceef0;
  --sea: #91d8d1;
  --leaf: #8fcf8c;
  --mint: #e5f5d8;
  --ink: #493042;
  --ink-soft: #7e6677;
  --line: #f0ddd9;
  --shadow: 0 12px 35px rgba(124, 75, 91, .12);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; background: var(--cream); }
body {
  margin: 0;
  min-width: 300px;
  overflow-x: hidden;
  background:
    radial-gradient(circle at 12% 26%, rgba(255, 171, 199, .24), transparent 22rem),
    linear-gradient(180deg, #effcfa 0, var(--cream) 35rem);
  color: var(--ink);
  font-family: ui-rounded, "SF Pro Rounded", "Avenir Next", "Quicksand", system-ui, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }

.summer-sky { position: absolute; inset: 0 0 auto; height: 33rem; overflow: hidden; pointer-events: none; }
.sun {
  position: absolute;
  top: 5rem;
  right: max(3vw, calc(50% - 36rem));
  width: 11rem;
  height: 11rem;
  border-radius: 50%;
  background: rgba(255, 215, 138, .72);
  box-shadow: 0 0 0 2.5rem rgba(255, 215, 138, .13), 0 0 0 5rem rgba(255, 215, 138, .08);
}
.cloud {
  position: absolute;
  width: 12rem;
  height: 3rem;
  border-radius: 999px;
  background: rgba(255,255,255,.7);
  filter: blur(.2px);
}
.cloud::before, .cloud::after { content: ""; position: absolute; border-radius: 50%; background: inherit; }
.cloud::before { width: 5rem; height: 5rem; left: 2rem; bottom: 0; }
.cloud::after { width: 6.5rem; height: 6.5rem; right: 1rem; bottom: 0; }
.cloud--one { top: 7rem; left: -4rem; transform: scale(.62); }
.cloud--two { top: 20rem; right: -4rem; transform: scale(.48); }

.hero, main, .footer { position: relative; z-index: 1; width: min(70rem, calc(100% - 2rem)); margin-inline: auto; }
.hero { min-height: 31rem; padding: 1.5rem 0 4rem; display: grid; grid-template-columns: 1.45fr .75fr; gap: 3rem; align-items: center; }
.topbar { grid-column: 1 / -1; align-self: start; display: flex; align-items: center; justify-content: space-between; }
.brand { display: inline-flex; align-items: center; gap: .65rem; text-decoration: none; }
.brand__mark { display: flex; filter: drop-shadow(0 5px 9px rgba(239,126,85,.2)); }
.brand span:last-child { display: flex; flex-direction: column; line-height: 1.18; }
.brand b { font-size: 1.02rem; }
.brand small { color: var(--ink-soft); font-size: .74rem; }
.topbar__links { display: flex; gap: .3rem; }
.topbar__links a { padding: .45rem .8rem; border-radius: 999px; text-decoration: none; font-size: .86rem; font-weight: 750; color: var(--ink-soft); }
.topbar__links a:hover, .topbar__links a:focus-visible { background: rgba(255,255,255,.72); color: var(--ink); }

.eyebrow { margin: 0 0 .4rem; color: var(--mango-deep); font-size: .76rem; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
.hero h1 { margin: 0; font-size: clamp(3.15rem, 8vw, 5.8rem); line-height: .91; letter-spacing: -.07em; }
.hero h1 span { color: var(--mango-deep); }
.hero__lede { max-width: 38rem; margin: 1.35rem 0 1.5rem; color: var(--ink-soft); font-size: 1.08rem; }
.hero__actions, .repository__actions { display: flex; flex-wrap: wrap; gap: .65rem; }
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.75rem;
  padding: .65rem 1.1rem;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: .9rem;
  font-weight: 800;
  text-decoration: none;
  box-shadow: 0 7px 18px rgba(113,69,83,.09);
  transition: transform .16s ease, box-shadow .16s ease;
}
.button:hover, .button:focus-visible { transform: translateY(-2px); box-shadow: 0 11px 24px rgba(113,69,83,.14); }
.button--mango { background: linear-gradient(120deg, var(--sun), var(--mango)); color: #5d352d; }
.button--berry { background: linear-gradient(120deg, var(--pink), var(--berry)); color: #52334f; }
.button--paper { border-color: var(--line); background: var(--paper); color: var(--ink-soft); }

.hero__card {
  justify-self: end;
  position: relative;
  width: min(18rem, 100%);
  aspect-ratio: .82;
  padding: 2rem;
  border: 2px solid rgba(255,255,255,.78);
  border-radius: 44% 44% 35% 35% / 34% 34% 27% 27%;
  background: linear-gradient(160deg, rgba(255,255,255,.87), rgba(255,239,213,.72));
  box-shadow: var(--shadow);
  transform: rotate(2deg);
}
.hero__mango { display: grid; place-items: center; height: 72%; filter: drop-shadow(0 15px 14px rgba(239,126,85,.18)); }
.hero__caption { display: block; text-align: center; color: var(--ink-soft); font-size: .82rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.hero__sparkle { position: absolute; top: 1.3rem; right: 1.7rem; color: var(--pink); font-size: 1.8rem; animation: twinkle 2.6s ease-in-out infinite; }
@keyframes twinkle { 50% { transform: rotate(18deg) scale(1.18); opacity: .6; } }

.ticker { position: relative; z-index: 2; width: 100%; overflow: hidden; padding: .8rem 0 1.2rem; }
.ticker__track { display: flex; width: max-content; animation: drift 72s linear infinite; }
.ticker:hover .ticker__track, .ticker:focus-within .ticker__track { animation-play-state: paused; }
.ticker__set { display: flex; gap: .75rem; padding-right: .75rem; }
.ticker__item {
  display: flex;
  align-items: center;
  gap: .55rem;
  width: 13.5rem;
  padding: .55rem .72rem;
  border: 1px solid rgba(240,221,217,.9);
  border-radius: 1rem;
  background: rgba(255,254,250,.82);
  box-shadow: 0 5px 18px rgba(124,75,91,.07);
  text-decoration: none;
}
.ticker__item img { width: 38px; height: 38px; border-radius: 10px; object-fit: cover; background: #fff4e5; }
.ticker__item span { min-width: 0; display: flex; flex-direction: column; }
.ticker__item b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .83rem; }
.ticker__item small { color: var(--ink-soft); font-size: .67rem; }
.ticker__fade { position: absolute; z-index: 2; inset-block: 0; width: 5rem; pointer-events: none; }
.ticker__fade--left { left: 0; background: linear-gradient(90deg, var(--cream), transparent); }
.ticker__fade--right { right: 0; background: linear-gradient(-90deg, var(--cream), transparent); }
@keyframes drift { to { transform: translateX(calc(-50% - .375rem)); } }

main { padding: 2rem 0 1rem; }
.compat {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.2rem;
  border: 1px solid #f2d9b1;
  border-radius: 1.25rem;
  background: linear-gradient(105deg, #fff8e5, #fff1f6);
  box-shadow: 0 8px 25px rgba(124,75,91,.07);
}
.compat p { margin: 0; }
.compat__flower { flex: 0 0 auto; display: grid; place-items: center; width: 2.8rem; height: 2.8rem; border-radius: 50%; background: var(--pink); color: #fff; font-size: 1.35rem; }

.catalog-tools { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin: 3.5rem 0 1.3rem; }
.catalog-tools h2 { margin: 0; font-size: clamp(2rem, 5vw, 3rem); letter-spacing: -.04em; }
.search {
  display: flex;
  align-items: center;
  gap: .55rem;
  width: min(22rem, 100%);
  padding: 0 .95rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper);
  box-shadow: 0 7px 20px rgba(124,75,91,.08);
}
.search span { color: var(--ink-soft); font-size: 1.1rem; }
.search input { width: 100%; padding: .75rem 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; }
.search input::placeholder { color: #a992a2; }

.repository {
  scroll-margin-top: 1rem;
  margin-bottom: 2rem;
  padding: clamp(1.1rem, 3vw, 1.7rem);
  border: 1px solid var(--line);
  border-radius: 2rem;
  background: rgba(255,254,250,.88);
  box-shadow: var(--shadow);
}
.repository--mango { border-top: 5px solid var(--mango); }
.repository--berry { border-top: 5px solid var(--berry); }
.repository__head { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; margin-bottom: 1.25rem; }
.repository__head h3 { margin: 0; font-size: clamp(1.55rem, 4vw, 2.15rem); letter-spacing: -.04em; }
.repository__head h3 span { display: inline-block; margin-left: .35rem; padding: .2rem .55rem; border-radius: 999px; background: #fff2dc; color: var(--mango-deep); font-size: .7rem; letter-spacing: 0; vertical-align: middle; }
.repository--berry .repository__head h3 span { background: #f7eafb; color: #9567b6; }
.repository__head p:not(.repository__kicker) { margin: .25rem 0 0; color: var(--ink-soft); }
.repository__kicker { margin: 0 0 .12rem; color: var(--mango-deep); font-size: .73rem; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
.repository--berry .repository__kicker { color: #9567b6; }

.source-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15.2rem, 1fr)); gap: .65rem; }
.source-card {
  display: flex;
  align-items: center;
  gap: .72rem;
  min-width: 0;
  padding: .72rem;
  border: 1px solid #f2e6df;
  border-radius: 1rem;
  background: #fff;
  text-decoration: none;
  transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
}
.source-card:hover, .source-card:focus-visible { transform: translateY(-2px); border-color: var(--pink); box-shadow: 0 9px 20px rgba(124,75,91,.11); }
.source-card img { flex: 0 0 auto; width: 54px; height: 54px; border-radius: 13px; object-fit: cover; background: #fff5e7; }
.source-card__copy { display: flex; flex: 1 1 auto; min-width: 0; flex-direction: column; }
.source-card__copy b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-card__copy > span { display: flex; align-items: center; gap: .4rem; margin-top: .16rem; color: var(--ink-soft); font-size: .72rem; }
.source-card__add { flex: 0 0 auto; display: grid; place-items: center; width: 1.8rem; height: 1.8rem; border-radius: 50%; background: #fff3dd; color: var(--mango-deep); font-weight: 900; }
.rating { padding: .05rem .42rem; border-radius: 999px; font-style: normal; font-size: .64rem; font-weight: 850; }
.rating--safe { background: var(--mint); color: #4c733c; }
.rating--mature { background: #fff0c9; color: #91611d; }
.rating--adult { background: #ffe0eb; color: #a4486d; }
.empty { margin: 0; padding: 2.5rem 1rem; border: 1px dashed var(--line); border-radius: 1rem; color: var(--ink-soft); text-align: center; }

.footer { display: flex; flex-direction: column; align-items: center; padding: 3rem 0 4rem; text-align: center; color: var(--ink-soft); }
.footer p { margin: .35rem 0 0; }
.footer__links a { color: var(--mango-deep); font-weight: 800; }
.footer__built { font-size: .75rem; opacity: .72; }

@media (max-width: 48rem) {
  .hero { min-height: auto; grid-template-columns: 1fr; padding-bottom: 2.5rem; }
  .hero__card { display: none; }
  .hero__copy { padding: 2.6rem 0 1rem; }
  .catalog-tools, .repository__head { align-items: stretch; flex-direction: column; }
  .search { width: 100%; }
  .repository__actions .button { flex: 1 1 auto; }
}

@media (max-width: 34rem) {
  .hero, main, .footer { width: min(100% - 1.25rem, 70rem); }
  .topbar__links a { padding: .4rem .52rem; }
  .topbar__links a:nth-child(3) { display: none; }
  .hero h1 { font-size: clamp(3rem, 17vw, 4.4rem); }
  .hero__actions .button { flex: 1 1 100%; }
  .ticker__fade { width: 2rem; }
  .compat { align-items: flex-start; }
  .source-grid { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .ticker__track, .hero__sparkle { animation: none; }
  .button, .source-card { transition: none; }
}
`;
}

await main();
