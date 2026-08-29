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
| `getAdvancedSearchForm()` / `getSortingOptions()` | `getFilterSections()`, `getSearchFieldList()` |
| `getSettingsForm()` | `getSettingsSections()` |
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
tri-state tags. 0.8 offers tags to include or exclude, plus free-text boxes.
A filter that is a choice from a list becomes a tag section, with the tag id
prefixed by the section it came from so the source can take it apart again —
`getFilterSections()`. A filter that is not a choice from a list (a minimum
chapter count, an author's name) becomes a text box — `getSearchFieldList()` —
and what the reader types arrives in `SearchQuery.parameters` under the field's
id. A sort order is a tag section; where a source offers one, choosing more
than one leaves the first in effect. What is genuinely lost is the layout: the
grouping, the toggles and the ordering the 0.9 form controlled.

**Tri-state tags.** 0.9 tags can be neutral, included or excluded. 0.8 has
include and exclude only, and a source that cannot express exclusion returns
`false` from `supportsTagExclusion()`.

**Chapter and page lookups.** 0.9 hands a source the whole series and the whole
chapter; 0.8 passes ids. The base class keeps the last series and its chapter
list so the source still receives complete objects, and refetches when the app
jumps straight to a chapter after a restart. Because the details page and the
chapter list are usually the same page, a refetch would mean asking for it
twice; `Application` reuses a response fetched in the last few seconds so it is
asked for once.

**Redirects.** 0.9 reports the URL a request finally landed on and lets a
source re-apply its headers to a redirect target. 0.8 reports neither, so a
source that needs to know where it ended up asks for the canonical address in
the first place, and one that needs particular headers on the second hop tries
each candidate host itself rather than following a redirect blindly.

**Rebuilt images.** A source that unscrambles or decrypts a page image hands
back bytes in a different format from the ones that arrived. The app does sniff
the bytes — a PNG rebuilt from a JPEG is read correctly with nothing declared —
so the type is set alongside the new bytes as insurance for the formats sniffing
may not cover, not because the common case needs it.

The new bytes are written onto the response the app handed over, and that same
object is returned. Assigning to it is the path 0.8 sources actually take;
returning a different object is untried, so the chain only falls back to one if
the original refuses to be written to.

**Home page updates.** 0.9 can invalidate the home page after a setting
changes. 0.8 decides for itself when to rebuild, so
`Application.invalidateDiscoverSections()` does nothing here and the new
sections appear the next time the reader opens the page.

**Settings screens.** 0.9 forms become `getSettingsSections()`, built from the
row helpers in `common/Menu.ts` and declaring `Capability.SETTINGS`. The base
class wraps them in the single section 0.8's `getSourceMenu()` asks for.
Because 0.8's state store is asynchronous and a setting may be read from
somewhere that cannot wait — an interceptor rewriting a header, a URL being
assembled — every declared key is read into `this.settings` before any source
method runs, and read back synchronously after that.

## Checklist

- [ ] `src/<Name>/<Name>.ts` exports `<Name>Info` and `<Name>`
- [ ] `src/<Name>/includes/icon.png` exists
- [ ] The class name, the file name and the folder name all match
- [ ] `npm run typecheck` is clean
- [ ] `npm run bundle` lists the source in `bundles/versioning.json`
