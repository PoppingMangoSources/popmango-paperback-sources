# Paperback 0.8 contributor and agent guide

This repository ports sources to **Paperback 0.8**, using the official
`@paperback/toolchain` and `@paperback/types` pinned to **0.8.7**. Read this file
before changing a source or shared code. `CLAUDE.md` imports it; keep instructions
here instead of maintaining two copies.

Use the [paperback-extension skill](.agents/skills/paperback-extension/SKILL.md)
for source work. Read [conversion details](docs/CONVERSION.md) when porting and
[testing](docs/TESTING.md) before claiming a fix works on a device.

## Boundaries

- Preserve the official CLI, lockfile, 0.8.7 package pins, and native bundle
  format: `versioning.json`, `<Source>/source.js`, and `<Source>/includes/`.
- Preserve the existing repository page, `paperback://addRepo` and
  `paperback://installExtensions` links, `/all`, and the `/0.8` compatibility path.
  Do not replace them with another reader's registry or a relay service.
- A 0.9 implementation is a behavior reference, not a compatible SDK. Do not
  copy `ExtensionImpl`, `pbconfig.ts`, `static/`, `paperback-cli`, or
  `registerDefaultTests` into this project. Mana and Android APIs are likewise
  not available to a Paperback source.
- Keep source fixes inside that source unless the problem is shared. Shared
  adapter changes affect every source: run the full gate and identify affected
  sources. Do not rewrite working neighbors or import a new framework as cleanup.
- Do not rename shipped source directories or change saved manga/chapter IDs
  without an explicit migration decision. Do not commit cookies, tokens, captured
  account data, generated bundles, or `node_modules`.

## Layout and implementation

| Path | Responsibility |
| --- | --- |
| `src/<Name>/<Name>.ts` | Export `<Name>Info` and class `<Name> extends PopmangoSource` |
| `src/<Name>/models.ts` | Site types, constants, sections, filter values |
| `src/<Name>/network.ts` | Site requests and interceptor behavior |
| `src/<Name>/parsers.ts` | HTML/JSON parsing and model conversion |
| `src/<Name>/includes/icon.png` | Icon packaged by the official bundler |
| `common/` | Shared 0.8 bridge, request manager, settings, menu, URL and model helpers |
| `scripts/` | Node-only repository checks and development tools |

Keep the existing source's structure when fixing it. Split substantial crypto
or image processing when necessary; do not create one-line wrapper modules or
service classes for plain requests. Prefer free functions for fetches/parsers;
use classes where the SDK or shared adapter requires them. Put shared shapes in
models, avoid `any`, and comment on non-obvious constraints rather than narrating
code. Preserve existing license notices; new implementation files use the
repository's GPL-3.0-or-later/Popmango header.

Before implementing, inspect actual home/search/details/chapter/reader responses
and record the request, field paths or selectors, pagination signal, and access
flags. Compare reference implementations against these responses. Keep only
small, sanitized fixtures needed to reproduce a bug.

- Use listing payloads directly; avoid one detail request per search/home card.
- Drive pagination from the server's cursor/count/next link. Wire every exposed
  filter and setting, including exclusions where supported. Do not silently drop
  capabilities in a port; document what 0.8 genuinely cannot represent.
- Return stable, sufficient IDs and useful errors for locked, empty, malformed,
  or failed readers. Do not turn request or Cloudflare failures into empty lists.
- Preserve chapter numbers, volume metadata, upload groups, dates, and explicit
  `sortingIndex` when supplied. Test duplicate uploads and volume restarts in the
  app; ordering and duplicate grouping are different behaviors. Do not invent
  numeric encodings as a generic workaround.

## Device runtime constraints

`common/` is an adapter, not the 0.9 SDK. Sources import its supported vocabulary
from `../../common`; general native `App.*` integration belongs in the bridge.
Existing image processors may use the pinned native `App.createPBImage` and
`App.createPBCanvas` APIs, as Mangago does. These are not browser canvas APIs;
preserve that distinction and verify reconstructed images on a device.

- Use `Application.scheduleRequest`, `fetchText`, `fetchDocument`, and
  `loadDocument`. Use `URL(...)` from `common/` and `.build()`; do not assume a
  browser `URL`, `fetch`, DOM, or WebView API exists on the phone.
- There are no timers for source pacing. Configure `SourceOptions.rateLimit`;
  the native request manager throttles requests. Do not add timer retries.
- Decode bytes and perform crypto with supported bridge helpers or tested pure
  TypeScript. Node `Buffer`/crypto, WebCrypto, `TextDecoder`, and browser canvas
  code are not device fallbacks. Node-only test code may use Node APIs.
- Quote non-identifier attribute values in selectors, e.g.
  `meta[property="og:image"]`. The app supplies its own Cheerio.
- Declare every persisted setting key in `SourceOptions.settingsKeys`. Build
  settings rows with `common/Menu.ts`; its retained objects are intentional.
- Use the shared Cloudflare/cookie flow. Verify headers and cookie domains;
  a challenge is not a missing title. Do not log credentials.
- The 0.8 reader returns image `pages`; it does not accept the 0.9 HTML novel
  chapter format. A novel badge alone does not add reader support.
- When rewriting image bytes, preserve the native response object and set the
  matching content type, following the existing interceptor. Decrypt into
  `App.createByteArray(response.rawData)` in place, or re-encode with
  `canvas.encode`; `App.createRawData` returns `null` on 0.8 and the reader
  drops the page (`check-globals` rejects it). Verify rendering on a device,
  not only that page URLs are returned.
- `interceptRequest` may await native calls and rewrite the URL.
  `interceptResponse` cannot resend a request or change the status, so a
  short-lived token in a page URL is renewed before the request, not after a 401.
- Read "Lessons from working 0.8 sources" in the skill's `runtime.md` before
  touching settings storage, chapter lists, typed text or Cloudflare handling.
- Offline stubs of `App.*` must behave like the device, not like the Node
  polyfills. Show a regression check failing on the old code before trusting it.

## Commands and completion

Use Node 22 (as in CI) and `npm ci`.

```sh
npm run verify                 # offline gate: types, regressions, bundles, page/links
npm run hooks                  # opt in to the same gate before local git pushes
npm run serve -- -w             # official 0.8 development server
npm run test:live -- RinkoComics # official 0.8 tests against a built source; needs network
npm run test:live:matrix        # list the scheduled sources and exclusion reasons
npm test -- RinkoComics --ip=<phone-ip> # official device runner, when supported by app
```

`npm run verify -- --folder=branch-name` validates the same publication layout
used by CI. `npm run verify -- --skip-bundle --folder=branch-name` checks an
already-built folder; do not use it to validate stale output.

Checks also runs actionlint 1.7.12 over every workflow. If installed locally,
run `actionlint` from the repository root before pushing workflow changes.
Weekly live checks use `.github/live-test-exclusions.json`; every exclusion
needs a dated reason. A manual source selection overrides its exclusion.

Run the offline gate before finishing. Use `git diff --check` and inspect the
whole diff for unrelated changes. The optional pre-push hook is local tooling;
it does not prohibit collaborators from pushing directly to `main`.

For live or device changes, report which source/version, app build, title and
chapter were exercised. A blocked site, unavailable device, or unsupported
devtools connection is unverified, not a pass. Node polyfills cannot prove Swift
bridge behavior, settings retention, chapter grouping, or image rendering.

New sources start at `1.0.0`, unless they take over a source ID another 0.8 repository
already ships with identical manga and chapter IDs: then start one patch above
its version (Kagane is `5.0.1` over a `5.0.0` build) so installs update in place. Bump the existing source's patch version when its
shipped behavior changes. A shared behavior change needs bumps for the affected
sources; docs and development tooling alone do not. Refresh the README using
`npm run readme` when the published catalog changes and inspect its diff.

Use short, concrete commits and PR descriptions with relevant validation. Never
add `Assisted-by` trailers. Preserve contributor authorship. Do not modify branch
rules or repository permissions as part of a source change. Push to the branch
the user requested; otherwise use a focused branch and PR for review.
