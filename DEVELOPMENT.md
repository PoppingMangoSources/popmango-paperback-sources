# Development

Read [AGENTS.md](AGENTS.md) for source conventions and
[docs/CONVERSION.md](docs/CONVERSION.md) for 0.9-to-0.8 mapping.

## Setup and checks

Use Node 22, then `npm ci`. Both official Paperback packages remain pinned to
0.8.7; do not substitute the 0.9 CLI. Run `npm run verify` before pushing. It
typechecks, runs the existing offline regressions, bundles with the official
CLI, scans for unsupported device globals, verifies exports/icons/manifest
metadata, and tests the existing repository-page generator and install links
offline. No source websites or device are required for this gate.

`npm run hooks` sets this clone's `core.hooksPath` to `.githooks`. The optional
pre-push hook runs that gate and `git diff --check`; it changes no remote branch
rules. `git config --local --unset core.hooksPath` disables it for this clone.

## Live and device checks

See [docs/TESTING.md](docs/TESTING.md). `npm run test:live -- <Source>` runs the
official 0.8.7 test cases against the actual bundled class with the official
Node polyfills. It awaits the full suite and exits nonzero for reported failures.
It does not emulate the device's missing globals or prove its rendering.

The **Live source check** workflow is manual, read-only, and uploads logs. It is
separate from offline CI: site outages, authentication and challenges should
not make unrelated documentation changes fail. There is no scheduled crawl,
automated account login, browser bypass service, or README status commit.

## Publishing

The existing official bundler and page/deep-link generation remain in place.
`main` publishes `/all` and mirrors it to `/0.8`; other branches publish under
their name with slashes replaced by hyphens. Do not use `all`, `0.8`, or
`gh-pages` as testing branch names. The publishing workflow now validates its
actual target folder before writing Pages. PR checks do not publish.

Direct pushes remain possible with the owner's chosen branch rules. CI runs
after a direct push; validation in the publishing job stops that job before it
publishes a failed build. This is independent of requiring checks in branch
protection.

## Maintenance choices

The repo-local skill uses `.agents/skills/paperback-extension`; the matching
`.claude/skills` path is a symlink so both tools read one copy. The skill's
`agents/openai.yaml` and `.claude/agents/paperback-extension.md` carry the same
name, description and default task for each tool. Keep detailed
runtime facts and release steps in its references rather than duplicating them
in `CLAUDE.md`.

Dependabot opens weekly dependency/action PRs. The official Paperback packages
are excluded from automatic version updates to preserve the 0.8.7 target.
Review updates and run the gate; no auto-merge workflow is installed.

Use the existing offline crypto/parser regressions rather than copying a Mana
host harness, Android build scripts, Rust installers or a site's experimental
relay/crypto extraction pipeline. Add a source-specific test or generator when
a reproducible source need justifies it, and keep Node-only tools outside `src`.
