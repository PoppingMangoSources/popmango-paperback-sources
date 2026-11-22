# XCOMIC on Paperback 0.8

## Mirrors in 1.1.5

Checked 2026-11-22 against source revision `d0ba0ee` and the public homepages.
Only `xcomic.me` and `comik.to` remain supported mirrors. Both returned HTTP 200;
`yona.to` and `xcomic.net` returned HTTP 301 to `https://comik.to/`.

The retired hosts must not appear in the mirror selector, request fallback list
or pasted-URL host matcher. Existing preferred and last-working settings are
validated against the supported list: a retired preferred host falls back to
`xcomic.me`, and a retired last-working host falls back to the supported
preferred host. A valid `comik.to` choice remains valid. Sharing uses the
supported active host. Manga and chapter IDs are unchanged.

Keep the existing fallback between supported mirrors, including HTTP 400.
Redirects can turn a query POST into a GET without its body, which can produce
400. HTTP 404 ends the attempt because both mirrors share one catalogue;
explicit Cloudflare challenges still reach the app.

The offline flow regression covers the native selector, restored settings,
request hosts, sharing, pasted comic URLs, remembered successful hosts and
400/502/404/all-host failure behavior. Parser fixtures use a supported mirror.
Offline checks do not prove settings retention or image rendering on a device.

## Verification limits

The full `npm run verify` gate passed on Node 22.23.5 with the pinned 0.8.7
packages, including all 25 bundles and repository links. The new flow checks
failed on the old source before the mirror removal, then passed afterward.
Neither retired host remains in the shipped XCOMIC bundle.

Direct title GraphQL queries answered on both supported hosts. The official
live suite reported 0 passed and 5 failed: its default run stopped inferring
inputs at an empty Top Rated row. A second run with the public Ao no Orchestra
edition `lj36y` still had an empty Top Rated row and HTTP 502 for details,
chapters and search; no chapter could be inferred. That temporary test data
was removed. Live end-to-end behavior remains unverified. No Paperback 0.8
device was available to test settings retention or page rendering.
