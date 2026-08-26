# Porting a source from 0.9 to 0.8

The two extension APIs differ enough that a 0.9 bundle will not load on 0.8 at
all. Most of the difference is absorbed by `common/`, so a port is mostly
mechanical. This is the map.

## What stays the same

`models.ts`, `network.ts` and `parsers.ts` carry over nearly unchanged. They
talk to `common/` rather than the app, and `common/` keeps the vocabulary the
0.9 sources already used — `Application.scheduleRequest`, `PaperbackInterceptor`,
`URL(...)`, `CloudflareError`, a rate limiter, cookie storage, and the model
shapes in `common/Types.ts`.

The changes that are needed there are small:

| 0.9 | Here |
| --- | --- |
| `import … from "@paperback/types"` | `import … from "../../common"` |
| `cheerio.load(html)` | `Application.loadDocument(html)` |
| `Application.arrayBufferToUTF8String(data)` | `Application.fetchText(...)`, or `body.text` |
| `new URL(base)` | `URL(base)` |
| `url.toString()` | `url.build()` (`toString()` still works) |
| interceptor cookies as `Record` | unchanged — `common/` converts them |
| `interceptResponse(req, res, ArrayBuffer)` | `interceptResponse(req, res, ResponseBody)` |

## What has to be rewritten

The entry point. `pbconfig.ts` and `main.ts` become a single
`src/<Name>/<Name>.ts` exporting two things the bundler looks for by name:

```ts
export const <Name>Info = sourceInfo({ … });   // was pbconfig.ts
export class <Name> extends PopmangoSource { … } // was main.ts
```

The class is exported, not an instance — 0.8 constructs it itself, passing in
cheerio.

### Method mapping

| 0.9 | Here |
| --- | --- |
| `initialise()` | the constructor |
| `getDiscoverSections()` | same name, same shape |
| `getDiscoverSectionItems(section, metadata)` | same name, same shape |
| `getSearchResults(query, metadata, sorting)` | `getSearchResultItems(query, metadata)` |
| `getMangaDetails(mangaId)` | `getMangaInfo(mangaId)` |
| `getChapters(sourceManga)` | `getChapterList(sourceManga)` |
| `getChapterDetails(chapter)` | `getPages(chapter)` |
| `getAdvancedSearchForm()` / `getSortingOptions()` | `getFilterSections()` |
| `cloudflareBypassCompleted()` | handled by `common/` |

The base class implements the 0.8 methods (`getHomePageSections`,
`getViewMoreItems`, `getSearchResults`, `getMangaDetails`, `getChapters`,
`getChapterDetails`, `getSearchTags`, `getCloudflareBypassRequestAsync`) in
terms of the ones above, so a source never implements them directly.

### Capabilities

0.9 lists them; 0.8 packs them into one bit field. `sourceInfo` does the
packing:

| 0.9 | Here |
| --- | --- |
| `CHAPTER_PROVIDING` | `Capability.CHAPTERS` |
| `DISCOVER_SECTION_PROVIDING` | `Capability.HOME_PAGE` |
| `CLOUDFLARE_BYPASS_PROVIDING` | `Capability.CLOUDFLARE` |
| `SETTINGS_UI` | `Capability.SETTINGS` |
| `SEARCH_RESULT_PROVIDING` | implied; every source searches |

## Where the conversion loses something

These are the parts 0.8 has no equivalent for. Each one is handled the same
way in every source, so the behaviour stays predictable.

**Per-title content ratings.** 0.9 rates each title; 0.8 has one `hentai` flag
on the details page and nothing at all on a listing tile. A title rated `ADULT`
sets the flag; `MATURE` and `EVERYONE` do not. The source's own rating still
decides, so a site-wide filter such as an age-gate cookie keeps working.

**Rich carousel items.** 0.9 tiles carry a supertitle, a summary and a row of
icon-and-text items. 0.8 tiles have a title, an image and one subtitle line.
Sources join the useful parts with a bullet — usually the newest chapter plus
the rating or status.

**Section layouts.** 0.9 has five; 0.8 has four, and only `featured` maps
across exactly. `prominentCarousel` becomes the large row, `simpleCarousel` and
`chapterUpdates` become the normal row.

**Genre sections.** A 0.9 genre rail is a strip of links. 0.8 has no tile that
can hold one, so these sections are dropped from the home page rather than
rendered as titles that do not exist. The genres stay reachable as search
filters.

**Search forms.** 0.9 builds a real form with text fields, toggles and
tri-state tags. 0.8 offers one text box plus tags to include or exclude. Each
filter therefore becomes a tag section, with the tag id prefixed by the section
it came from so the source can take it apart again. A sort order is a tag
section too; where a source offers one, choosing more than one leaves the first
in effect.

**Tri-state tags.** 0.9 tags can be neutral, included or excluded. 0.8 has
include and exclude only, and a source that cannot express exclusion returns
`false` from `supportsTagExclusion()`.

**Chapter and page lookups.** 0.9 hands a source the whole series and the whole
chapter; 0.8 passes ids. The base class keeps the last series and its chapter
list so the source still receives complete objects, and refetches when the app
jumps straight to a chapter after a restart.

**Settings screens.** 0.9 settings forms have no counterpart in `common/` yet.
A source needing one implements 0.8's `getSourceMenu()` directly and declares
`Capability.SETTINGS`.

## Checklist

- [ ] `src/<Name>/<Name>.ts` exports `<Name>Info` and `<Name>`
- [ ] `src/<Name>/includes/icon.png` exists
- [ ] The class name, the file name and the folder name all match
- [ ] `npm run typecheck` is clean
- [ ] `npm run bundle` lists the source in `bundles/versioning.json`
