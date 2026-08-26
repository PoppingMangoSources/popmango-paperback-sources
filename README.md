# Popmango Sources — Paperback 0.8

Novels, manga, manhwa & manhua extensions for **Paperback 0.8**.

These are the Popmango sources, rebuilt against the 0.8 extension API. The
0.9 versions live in a separate repository; this one exists because 0.8 and
0.9 are different enough that a 0.9 bundle simply will not load on 0.8.

## Adding the repository

Open this link on a device with Paperback 0.8 installed:

**<https://poppingmangosources.github.io/popmango-paperback-sources/0.8>**

Or, inside the app: **Settings → Extensions → Add Repository**, then paste the
URL above.

## Repository layout

```
src/
  lib/            shared runtime the sources are written against
  <SourceName>/
    <SourceName>.ts   entry point: source info + extension class
    models.ts         constants, ids and local types
    network.ts        request building and fetching
    parsers.ts        HTML/JSON to model conversion
    includes/icon.png source icon (required by the bundler)
scripts/
  build-site.mjs  generates the repository homepage after bundling
website/
  the homepage template and assets
```

Every source folder must contain a `<SourceName>.ts` matching its directory
name and an `includes/icon.png`, otherwise the bundler skips it.

## Working on the sources

```bash
npm install          # install the toolchain
npm run typecheck    # type check every source
npm run bundle       # build into ./bundles
npm run serve        # serve the bundles for on-device testing
npm test             # run the source test suite
```

Bundles are published automatically. Pushing to `main` publishes to `/0.8`;
pushing to any other branch publishes to a folder named after that branch, so
work in progress can be installed without disturbing the stable repository.
Deleting a branch removes its folder again.

## About the 0.9 → 0.8 conversion

`src/lib` is a small compatibility runtime. It exposes the helpers the 0.9
sources were written against — a request scheduler, an interceptor base class,
a URL builder, a Cloudflare guard, a rate limiter, cookie storage — implemented
on top of the 0.8 primitives. Because of it, a source's `network.ts` and
`parsers.ts` carry over from 0.9 largely unchanged, and only the entry point
needs real work.

The parts of the 0.9 API that 0.8 has no equivalent for are documented in
[`docs/CONVERSION.md`](docs/CONVERSION.md), together with what each one is
mapped to instead.

## Licence

[MIT](LICENSE)
