# Kagane on Paperback 0.8

## Reader and mirror fixes in 5.0.5

- The CDN page route is `/api/v2/books/page/original/{book_id}/{page_id}.{ext}?token=...`. The book request still uses `is_datasaver=false`; the image URL does not. Keep the manifest's extension and reading order.
- Earlier 0.8 releases returned the legacy image route without `/original/`. Normalize those saved URLs before dispatch, including when their access tokens have not expired.
- Paperback 0.8 cannot resend an image from `interceptResponse`. Expiring tokens are renewed in `interceptRequest`; concurrent pages share one renewal per site and book. Preserve the native image response and let the app decode it.
- Only `kagane.moe` and `kagane.org` are selectable. New installs and saved choices for removed mirrors use `.moe`; a saved `.org` choice remains valid. Manga and chapter IDs are unchanged.
- The inherited verification request uses a fixed constructor domain. Kagane overrides that SDK hook to load the selected mirror's homepage with the same user agent as its requests. A Cloudflare error during token renewal must reach the app rather than being swallowed and replaced by a stale image request. This uses the normal app verification screen, not an automatic challenge solver.

## Verification limits

Checked 2026-11-13 using the pinned Paperback 0.8.7 SDK and Node 22. The updated regression checks fail on 5.0.4's URL, mirror, and verification behavior and pass on 5.0.5. They cover legacy/current URLs, concurrent token renewal, renewed file mapping, verification error propagation, selected/default/removed mirrors, and the existing caching and request rates.

The full offline `npm run verify` gate passed on Node 22.23.5, including all 24 source bundles and repository links. This environment injects an `UNDICI-EHPA` startup warning; that specific warning was disabled because the tooling regression checks intentionally require empty stderr. No checks or assertions were removed.

The direct `.moe` integrity request is Cloudflare-challenged from this environment. `.org` returns a legitimate integrity token, but earlier CDN checks here also returned 404. The official 0.8 live suite exercised Not Your Typical Reincarnation Story, chapter 116, but reported 0 passed and 5 failed: no home items and HTTP 502 for details, chapters, chapter details and search. Those are unverified, not passes. Live image delivery and the verification screen must be checked separately on a Paperback 0.8 device. The user has confirmed the corresponding `.moe` reader-path fix works in Paperback 0.9; that does not prove 0.8 device rendering.

Never commit live tokens or cookies in fixtures or logs.
