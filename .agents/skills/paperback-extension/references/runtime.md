# Paperback 0.8 boundary

The authority is the installed `@paperback/types` **0.8.7**, then the adapter in
`common/`. The official toolchain repository's matching types/commands can
clarify behavior; generated protobuf/Swift devtools files are transport code,
not additional source capabilities.

In the official toolchain repository, `main` is 0.8 and the default branch `0.9`
is the TestFlight app's toolchain; clone with `-b main`. `main` adds one change
after the published 0.8.7: a bundler that shims `Buffer`/`process` into
bundles. npm never released it, so our bundles have no `Buffer`.

0.8.7 offers twelve settings rows and `common/Menu.ts` wraps all of them:
`selectRow`, `inputRow`, `secureInputRow`, `switchRow`, `stepperRow`,
`buttonRow`, `linkRow`, `labelRow`, `multilineLabelRow`, `headerRow`,
`oauthButtonRow` and `formRow` (a nested form). Store secrets typed into a
secure input in `stateManager.keychain`, not in `settingsKeys`.

## Source and app methods

| Implement in a source | Native method supplied by `PopmangoSource` |
| --- | --- |
| `getDiscoverSections` / `getDiscoverSectionItems` | `getHomePageSections` / `getViewMoreItems` |
| `getSearchResultItems` | `getSearchResults` |
| `getMangaInfo` | `getMangaDetails` |
| `getChapterList` | `getChapters(mangaId)` |
| `getPages` | `getChapterDetails(mangaId, chapterId)` |
| `getFilterSections` / `getSearchFieldList` | `getSearchTags` / `getSearchFields` |
| `getSettingsSections` | `getSourceMenu` |

Use `sourceInfo` and `Capability` from `common/Info.ts`; the adapter translates
them into native `SourceInfo` and intent bits. Check both method behavior and
declared intents. Preserve the `src/<Name>/<Name>.ts` export names, directory
name and icon path because the official bundler discovers them by convention.

## Network, parsing, state

- `common/Runtime.ts`: `Application.scheduleRequest` returns `[response, body]`,
  where `body.text` and `body.raw` are distinct. `fetchText` validates status;
  `fetchDocument` uses the app-provided Cheerio. Inspect these methods before
  porting 0.9 `ArrayBuffer` code.
- `common/UrlBuilder.ts`: call `URL(base)` and `.build()`, rather than relying
  on a global constructor or browser URL resolution.
- `common/Source.ts` creates the native request manager and translates
  `rateLimit` to `requestsPerSecond`. There is no source-side timer limiter.
- `common/Interceptor.ts` and `common/Cloudflare.ts` own cookie and challenge
  plumbing. Do not add a generic browser session or assume redirect response
  URLs are reported by 0.8.
- `common/Settings.ts` hydrates declared `settingsKeys`; subsequent reads may
  be synchronous. `common/Menu.ts` retains native bindings/rows deliberately.
  Do not replace it with 0.9 selector/form classes.

## Model losses and traps

Native chapters have `id`, `chapNum`, `volume`, `group`, `time`, `langCode` and
`sortingIndex`. Keep each meaning intact. Native `ChapterDetails` has only
`id`, `mangaId`, and image `pages`. Do not return a 0.9 HTML chapter.

Rich 0.9 listing metadata is flattened by `common/Convert.ts`; genre rails are
omitted by `common/Discover.ts` and genres remain available in search. Do not
create fake manga tiles for genre links. Native source ratings and the details
`hentai` flag do not reproduce all 0.9 per-title rating behavior.

Node types and polyfills can hide missing device globals. Use supported bridge
primitives or tested pure TypeScript for bytes/crypto. Keep `fetch`, DOM,
WebCrypto, timers, Node `Buffer`, filesystem and process APIs out of source
runtime logic. The bundle scanner checks a limited list of textual patterns;
passing it is not a complete runtime audit.

## Interceptors and image bytes

| Bridge behavior on a 0.8 device | Consequence |
| --- | --- |
| `App.createByteArray(rawData)` is a view over the response's buffer | Decrypt or XOR into it in place; the page changes without a write-back |
| `App.createRawData(...)` returns `null` and raises "error processing the byteArray" | Never use it; the reader then fails with Kingfisher `dataModifyingFailed` |
| Only `rawData` is writable on the app's response; the same object must be returned | `common/Interceptor.ts` writes changed fields only (error 303 otherwise) |
| `interceptRequest` can await native calls and change `url` | Renew short-lived page tokens here (see Kagane) |
| `interceptResponse` cannot resend or change `status` | A 401 retry is impossible; renew before the request |
| WebP is decoded by URL extension (reported by another 0.8 source) | Keep `.webp` URLs for WebP; prefer `image/webp` when re-encoding |

Shipped 0.8 sources make network requests from inside `interceptRequest`
through the same request manager: MangaDex refreshes its login token there,
and MangaPlus resolves placeholder thumbnail URLs. Keep such requests to the
rare path and make sure they cannot match the condition that triggers them.

The 0.8.7 Node polyfill's `createByteArray` copies and its `createRawData`
returns an object, so Node passes code that fails on a phone.

## Other bridge facts

- `requestManager.cookieStore` (`getAllCookies`, `addCookie`, `removeCookie`)
  is the app's own cookie jar, the one the Cloudflare web view writes.
  `stateManager.keychain` is secure storage for credentials.
- When a site challenges only chapter pages, point
  `getCloudflareBypassRequestAsync` at a real chapter URL, not the home page.
- The app runs a library refresh as one `getChapters` per title; keep it to
  one or two requests and rely on `rateLimit`, or sites ban the reader's IP.
  Long request chains in one call fail with `AsyncOperationTimedOutError`.
- The newer Paperback app runs 0.8 sources through a compatibility layer that
  skips `interceptResponse` and shows select rows as "Unsupported 0.8 Row".
  These sources target the 0.8 app; report the newer app as unsupported.

When reconstructing image bytes, preserve the native response object and
content type as the existing interceptor does. `App.createPBImage` and
`App.createPBCanvas` are native 0.8 APIs used by the existing Mangago image
processor; browser canvas is a different API and is unavailable. Preserve
supported native image processing and test actual drawing on the app.

## Lessons from working 0.8 sources

- Parallel state-store calls race in the Swift bridge; `SettingsStore` reads
  and writes one key at a time. Do the same for any direct `stateManager` use.
- An empty chapter list makes the app drop the title's reading progress, so
  `getChapters` throws instead. A source must not swallow a failed list into `[]`.
- iOS autocorrect types curly quotes. The adapter straightens search text,
  typed search fields and `inputRow` values; normalize any other user text.
- `App.create*` objects lose data across the bridge if spread or copied;
  build each once with its final values.
- iOS will not follow a redirect onto plain `http`; request the final `https`
  URL directly.
- The device's `Date` parses ISO and RFC dates only; use `common/Dates.ts` for
  relative or localized dates.
- A clearance cookie is tied to the User-Agent it was issued with: the bypass
  request and every later request must send the same one. Paperback uses
  Apple's network stack, so a non-Apple User-Agent can be refused.
- Fetch paged chapter lists one page at a time; a `Promise.all` burst trips
  site rate limits. Where `rateLimit` is not enough, queue calls one in flight.
- Rebuild filter and settings objects on every call; do not cache SDK objects.
- Sorting exact title matches first in search makes migration from another
  source easier.
- Calling `sectionCallback` with an empty row and again with the same object
  once it has items is what MangaDex does and what our adapter does. One other
  source reports it "breaks the UI"; change it only with a device test.
- Never `eval` or `new Function` site scripts; parse them as text.
- Pure-JS npm packages (for example `html-entities`) bundle fine; anything
  needing Node built-ins does not, because the published 0.8.7 bundler adds no shims.
- A `#fragment` on a page URL is still on `response.request.url` in
  `interceptResponse`; MangaPlus carries each page's XOR key that way and
  decrypts in place through `App.createByteArray`.
- A source may create several request managers, each with its own
  `requestsPerSecond` and interceptor, for hosts with different limits. Images
  still load through the source's `requestManager`. `HEAD` requests work.
- A tile can carry a placeholder image URL that `interceptRequest` resolves on
  demand, instead of one detail request per tile.
- When an API's offsets shift between pages, carry the ids already shown in
  the paging metadata and drop repeats.
- Store login tokens in `stateManager.keychain`.
- `eval` exists on the device, but site scripts are still parsed, not run.
- Another repository taking over a source ID at a higher version reports the
  app may list both copies; tell readers which repository to update from.
