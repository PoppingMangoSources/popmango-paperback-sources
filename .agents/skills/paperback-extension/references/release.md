# Release checklist

- Inspect the exact base-to-head diff and keep it focused. Preserve user edits
  and contributor authorship; do not force-update a shared branch unexpectedly.
- For shipped source changes, increment the source version in `<Name>Info`.
  New sources start at `1.0.0`; existing fixes normally increment the patch.
  A source replacing another repository's build of the same ID starts above
  that build's version, and only when its manga and chapter IDs are identical.
  Determine which source bundles a shared-runtime change affects and bump
  those. Documentation and repository-tooling changes alone need no source bump.
- Keep saved source/manga/chapter IDs stable. Add the real site icon under
  `src/<Name>/includes/`; the official CLI copies this directory, not `static/`
  or a Mana asset folder.
- Run `npm run verify` and `git diff --check`. Run focused live/device checks
  appropriate to the behavior and say when a check was unavailable.
- A source that rewrites page bytes ships only after pages rendered on a phone;
  an offline pass has missed this before.
- If the source catalog changed, run `npm run readme` and review its generated
  sections. Do not hand-edit source counts or mix unrelated 0.9 catalog changes.
- Keep `/all`, `/0.8`, `versioning.json`, `source.js`, native metadata and
  `paperback://` links compatible. Test branch previews use the existing
  folder mapping in `scripts/publish-folder.mjs`: `main` maps to `all`, other
  non-ASCII-alphanumeric/dot/underscore/hyphen characters become hyphens, and
  non-alphanumeric starts get a `branch-` prefix. Publication and deletion
  share the mapping; avoid reserved names `all`, `0.8`, `gh-pages` and branch
  names that normalize to the same folder.
- Write a concrete commit/PR summary and validation notes. Never add an
  `Assisted-by` trailer. Do not change permissions or branch protections.

The optional pre-push hook runs the offline gate in a local clone. CI validates
again; direct pushes remain controlled by the owner's GitHub settings, not by
agent instructions. Publishing performs validation before uploading the site.
Do not claim a successful push proves the site or device behavior passed.
