# Testing sequence

1. Run `npm ci` on Node 22.
2. Run `npm run verify`. This is the offline CI/pre-push gate, not a site test.
3. Inspect a changed source's manifest metadata, class exports and bundle.
4. Use `npm run test:live -- <Source>` for official 0.8.7 network tests of the
   built source. Optionally place the official test data in
   `src/<Source>/<Source>.test.json`: `mangaId`, `chapterId`, and
   `searchData: { query, includedTags, excludedTags }`. Use real public IDs,
   not credentials. Otherwise the official suite infers them from home items.
5. Follow `docs/TESTING.md` for on-device serving and logs.

The live adapter uses the pinned official `SourceTester` cases and runtime
polyfills against the bundled class. It avoids the CLI's local transpilation
path, which conflicts with this repo's `noEmit` config, awaits the full suite,
and returns failure when a test fails. It does not replace the official CLI,
modify `node_modules`, simulate WebViews, or implement another app's runtime.

Do not run the entire catalog repeatedly against live sites. Use the changed
source, respect its rate limit, and keep network checks separate from offline
CI. The manual workflow uploads logs without publishing. Do not classify a
network block as a pass or automatically rewrite working code based on it.

Verify these on Paperback 0.8 because Node tests cannot prove them:

- Settings open, persist and change the intended request or display.
- Search/tag selection and exclusions round-trip to real results.
- Chapter ordering, alternate groups, decimals and repeated numbers by volume.
- Images load and render, especially decrypted/descrambled bytes and headers.
- Cold-start chapter opening works without a previous details-page cache.
- The repository page adds the expected 0.8 repository and installs sources.

Report compiler/offline/live/device results separately. Include the source and
app versions, exercised title/chapter and any unavailable check. Temporary
capture or experiment files stay outside `src` and outside commits unless a
small sanitized regression fixture is needed.
