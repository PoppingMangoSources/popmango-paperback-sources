# Testing on a device

Read [AGENTS.md](../AGENTS.md) for the contribution rules and
[DEVELOPMENT.md](../DEVELOPMENT.md) for local setup. Run `npm run verify` first:
it is offline and is also run by CI and the optional pre-push hook. It cannot
prove the behavior of a website or the native app.

## Run focused live checks

After building, `npm run test:live -- RinkoComics` runs the official 0.8.7
source test cases against the bundled class using the official Node polyfills.
It needs network access and returns a failing exit code if tests fail. The
**Live source checks** workflow does the same and uploads a separate log per
source. It runs weekly on Monday at 08:17 UTC, and manually on demand. The
schedule starts after the workflow reaches the default branch.

The default `all` selection discovers source entry points in `src/` and skips
only names in [the exclusion list](../.github/live-test-exclusions.json).
Each entry records a dated reason and should be removed after a successful
manual recheck. `npm run test:live:matrix` lists selected sources and reasons;
the workflow also records exclusions in its summary. Choosing a specific
source in the manual workflow overrides its exclusion, so blocked sites can
be retested without editing the list. Invalid names, stale exclusion names,
missing reasons and an empty enabled catalog fail selection.

Runs use at most two concurrent source jobs, keep other jobs running when one
fails, and never publish. An unexpected failure remains a failed job; tests
do not automatically classify failures as network problems or add exclusions.
Confirm an HTTP/network/challenge failure before excluding a source; an empty
parser result by itself is not proof of a network block.

The normal `npm test` remains the official `paperback test` command. Its local
transpilation path expects emitting TypeScript output, whereas this repo uses
`noEmit`; use `test:live` for local Node tests. For an app build supporting the
devtools service, the official device path is:

```sh
npm test -- RinkoComics --ip=<your-phone's-address>
```

Run `npm run bundle` before the device command. Device support and local-network
permissions vary; no connection is an unavailable check, not a passing test.
The devtools protobuf/Swift files do not extend what a source can return.

The live runner can read the official optional test data from
`src/<Source>/<Source>.test.json` (`mangaId`, `chapterId`, and `searchData` with
`query`, `includedTags`, `excludedTags`). Without it, tests infer a title from
the home page. Keep inputs public and verify the selected chapter is readable.

Node polyfills provide APIs and permissive object factories the phone may not
have. In particular, passing a Node test does not prove settings retention,
chapter grouping, native image rendering, or a successful Cloudflare challenge.

The typechecker and `npm run check` catch a lot, but some failures only show up
inside the app: a global the runtime does not have, a selector the app's own
cheerio rejects, an image the reader cannot draw. This is how to see a change
working on a phone before it is published.

## Serve the sources from your computer

```sh
npm run serve -- -w
```

This builds every source and serves the repository over your local network;
`-w` rebuilds whenever a file changes. Find your computer's address on the
Wi-Fi network (`ipconfig` on Windows, `ipconfig getifaddr en0` on a Mac), then
in Paperback add a repository at:

```
http://<your-computer's-address>:8080
```

The phone and the computer must be on the same network, and it has to be
`http` — a local server has no certificate for `https`.

### If Paperback cannot reach it

If adding the repository times out while the same address opens fine in Safari,
iOS is blocking Paperback from the local network. Turn it on under
**Settings → Privacy & Security → Local Network → Paperback**. iOS can switch
this off again after an update or a reinstall, so it is the first thing to
check when local testing stops working for no clear reason.

## Watch the logs

The toolchain can stream the app's log to your terminal:

```sh
npx paperback logcat --ip=<your-phone's-address>
```

It connects to the phone on port 27015. A source's `console.log` output and the
errors it throws appear here as they happen, which is the quickest way to see
why a screen came back empty. Whether the app accepts the connection depends on
the build of Paperback installed; if it never connects, the errors the app
shows on screen are the fallback.

## What is worth checking by hand

- **Every screen a change touches** — home page, search, a series, a chapter.
  An error in one of them leaves only that screen empty.
- **A chapter's pages actually render.** A page list that loads is not the same
  as images that draw, particularly for a source that rebuilds its images.
  "An error occurred while processing the byteArray" or Kingfisher's
  `dataModifyingFailed` means the interceptor handed back no bytes, usually
  from `App.createRawData`; it is not a Cloudflare problem.
- **One chapter of each image format** the site serves (JPEG, WebP, AVIF), and a
  chapter left open past any page-token lifetime.
- **Settings open and keep their values** after leaving and coming back.
- **The version number went up.** The app caches a source by version, so a fix
  shipped under an old number never reaches anyone who already has it.
- **Cold-start chapter access**, volume restarts, decimal numbers, alternate
  upload groups, search exclusions, and the affected setting's persisted value.

## Reading app errors

| Message on the phone | Meaning |
| --- | --- |
| `JSError Error [PaperbackError(300)] <message>` | The source threw; the message after it is the real error |
| "error processing the byteArray" / Kingfisher `dataModifyingFailed` | The interceptor handed back no image bytes (`App.createRawData`) |
| `AsyncOperationTimedOutError` | One source call took too long; too many sequential requests |
| "Duplicate title ids detected, please run database repair" | App database issue; the reader runs repair in settings |
| "Unsupported 0.8 Row" in settings | The reader is on the newer app's 0.8 compatibility layer |

Report offline, live, and device results separately with the source version,
Paperback app build, device OS and public title/chapter used. State any gaps.
