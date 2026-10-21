---
name: paperback-extension
description: Create, port, fix, or review a source in this Paperback 0.8 repository using the official 0.8.7 toolchain and shared common adapter. Use for site reconnaissance, source implementation, 0.9 conversion, chapter/filter/settings bugs, runtime compatibility, or source verification and release.
---

# Build Paperback 0.8 sources

Read the root [AGENTS.md](../../../AGENTS.md) first. It is the repository's
instruction source; this skill supplies the working sequence. Never substitute
0.9, Mana, Android, or browser APIs for the pinned 0.8.7 types.

## 1. Establish the contract

Read [recon.md](references/recon.md). Inspect the live page or API for each
changed capability, then a comparable existing source. Record the requests,
field paths/selectors, pagination and failure conditions. Distinguish observed
facts from assumptions. Reproduce a bug before changing working code.

For a port, compare the full capability set: home rows, search, filters and
exclusions, sorts, settings, details, chapters and pages. Read
[CONVERSION.md](../../../docs/CONVERSION.md) for unavoidable 0.8 losses. Do not
silently label an unsupported feature implemented.

## 2. Use this repository's boundary

Read [runtime.md](references/runtime.md) and the relevant `common/` code. Export
`<Name>Info` and class `<Name>` from `src/<Name>/<Name>.ts`, extending
`PopmangoSource`. Keep the icon in `includes/icon.png`. Do not create a 0.9
`main.ts`/`pbconfig.ts` source or a Mana `Target`.

Implement models/constants, network requests, parsers, then source orchestration
and supported settings. Use the adapter's names and return shapes; inspect
installed native types when changing the adapter. Add a regression for a real
parser, crypto or shared-runtime defect when it can be reproduced offline.

Keep Node-only capture, extraction and test code in `scripts/`, never in device
bundles. Do not add a relay or copy an obfuscated site bundle merely because a
reference source uses one.

## 3. Verify behavior and limits

Read [testing.md](references/testing.md), then run `npm run verify`. Inspect the
manifest entry and actual bundle; a successful bundler exit alone is not enough.
Check the changed source against live responses and, where available, run
`npm run test:live -- <Name>`. A failed or blocked request remains a failure,
not a passing test or a reason to remove assertions.

Exercise the affected screens on Paperback 0.8. In particular, verify settings
retention, chapter ordering/grouping and image rendering on the phone. State
which checks were run and what remains unverified; do not claim Node tests prove
Swift bridge behavior.

## 4. Release a focused change

Read [release.md](references/release.md). Bump source versions only when shipped
source behavior changes. Preserve IDs, existing page/deep links, the official
0.8.7 toolchain and other branches. Review the complete diff and report evidence
and remaining limits. Never add an `Assisted-by` trailer.
