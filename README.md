<p align="center">
  <img src="media/header.svg" alt="PoppingMango Sources — Novels, Manga, Manhwa & Manhua for Paperback 0.8, maintained by Popmango" width="100%"/>
</p>

<p align="center">
  <img src="media/badge-ios.svg" alt="iOS / iPadOS" height="28"/>
  <img src="media/badge-version.svg" alt="Paperback 0.8" height="28"/>
  <img src="media/badge-count.svg" alt="Source count" height="28"/>
</p>

<p align="center">
  <a href="https://poppingmangosources.github.io/popmango-paperback-sources/0.8/">
    <img src="media/button-add-08.svg" alt="Add PoppingMango 0.8 to Paperback" height="52"/>
  </a>
</p>

<p align="center">
  <a href="https://poppingmangosources.github.io/general-extensions-mangago/0.9/test/">
    <img src="media/button-add-09.svg" alt="Add PoppingMango 0.9 to Paperback" height="52"/>
  </a>
</p>

<p align="center">
  On iPhone or iPad, tap the button for the version you run and add the repository from the page that opens.<br/>
  To add it by hand, open Paperback, go to <b>Settings → Extensions → Add Repository</b>, and paste:
</p>

<p align="center">
  <code>https://poppingmangosources.github.io/popmango-paperback-sources/0.8/</code>
</p>

---

**PoppingMango** is an independent source list for [Paperback](https://paperback.moe) covering novels, manga, manhwa, and manhua, maintained by Popmango.

This repository holds the **0.8** extensions. The 0.9 versions live in their own repository — the two app versions load different formats, so a 0.9 bundle will not run on 0.8 and the other way round. Add whichever matches your app, or add both and let each one pick up what it can use.

| Repository | What it is |
| :--------- | :--------- |
| **[Paperback 0.8 Sources](https://github.com/PoppingMangoSources/popmango-paperback-sources)** | This repository. Extensions rebuilt against the 0.8 extension API. |
| **[Paperback 0.9 Sources](https://github.com/PoppingMangoSources/general-extensions-mangago)** | 28 extensions for Paperback 0.9, the list kept most current. |

## Sources

<!-- sources:start -->

**4 sources:** 4 manga, manhwa & manhua, all available from `0.8`.

### Manga, Manhwa & Manhua

| Source | Site |
| :----- | :--- |
| <img src="media/sources/bunmanga.png" width="22" align="top"/> **BunManga** | [bunmanga.com](https://bunmanga.com) |
| <img src="media/sources/cocomic.png" width="22" align="top"/> **Cocomic** | [cocomic.co](https://cocomic.co) |
| <img src="media/sources/likemanga.png" width="22" align="top"/> **LikeManga** | [likemanga.ink](https://likemanga.ink) |
| <img src="media/sources/vymanga.png" width="22" align="top"/> **VyManga** | [mangavyvy.net](https://mangavyvy.net) |

<!-- sources:end -->

Every source can also be installed on its own from the
[repository page](https://poppingmangosources.github.io/popmango-paperback-sources/0.8/) —
pick the ones you want and install just those, rather than the whole list.

## Support

<p align="center">
  <a href="https://discord.com/invite/inkdex">
    <img src="media/button-discord.svg" alt="Join the support Discord" height="36"/>
  </a>
</p>

Source problems are handled in the [**OTHER-REPOS**](https://discord.com/channels/965890377896845352/1367512880228077648) channel of the linked Discord, where the PoppingMango support chat lives.

<p align="center">
  <a href="https://discord.com/channels/965890377896845352/1367512880228077648">
    <img src="media/button-other-repos.svg" alt="Open the OTHER-REPOS Discord channel" height="36"/>
  </a>
</p>

Include the affected source, the page or title that failed, and screenshots or request details when possible, it makes fixes much faster.

**A new source you'd like added** — open an [issue](https://github.com/PoppingMangoSources/popmango-paperback-sources/issues) under the **source request** label. Requests only, and no promises about which ones get built.

## Building

```bash
npm install          # install the toolchain
npm run typecheck    # type check every source
npm run bundle       # build into ./bundles
npm run serve        # serve the bundles for on-device testing
npm test             # run the source test suite
```

Bundles are published automatically. Pushing to `main` publishes to `/0.8`; pushing to any other branch publishes to a folder named after that branch, so work in progress can be installed without disturbing the stable repository. Deleting a branch removes its folder again.

Repository layout, and what changes when a source is rebuilt for 0.8, are covered in [`docs/CONVERSION.md`](docs/CONVERSION.md). `common/` is a small runtime that implements the 0.8 extension interfaces on top of the newer model vocabulary, which is what keeps each source's parsers close to their 0.9 originals.

## Disclaimer

These extensions are **not** affiliated with Paperback or any supported website. All site names and logos belong to their respective owners.

## Licence

[GNU General Public License v3.0 or later](LICENSE). Sources rebuilt from the 0.9 repository keep the copyright notices they were published under, as that licence requires; files written for this repository carry Popmango's own notice.
