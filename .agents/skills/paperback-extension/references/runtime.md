# Paperback 0.8 boundary

The authority is the installed `@paperback/types` **0.8.7**, then the adapter in
`common/`. The official toolchain repository's matching types/commands can
clarify behavior; generated protobuf/Swift devtools files are transport code,
not additional source capabilities.

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

When reconstructing image bytes, preserve the native response object and
content type as the existing interceptor does. `App.createPBImage` and
`App.createPBCanvas` are native 0.8 APIs used by the existing Mangago image
processor; browser canvas is a different API and is unavailable. Preserve
supported native image processing and test actual drawing on the app.
