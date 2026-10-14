# Testing on a device

The typechecker and `npm run check` catch a lot, but some failures only show up
inside the app: a global the runtime does not have, a selector the app's own
cheerio rejects, an image the reader cannot draw. This is how to see a change
working on a phone before it is published.

## Serve the sources from your computer

```sh
npm run serve -- -w
```

This builds every source and serves the repository over your local network;
`-w` rebuilds whenever a file changes. Find your computer's address on the
Wi-Fi network (`ipconfig` on Windows, `ipconfig getifaddr en0` on a Mac), then
in Paperback add a repository at:

```
http://<your-computer's-address>:8080
```

The phone and the computer must be on the same network, and it has to be
`http` — a local server has no certificate for `https`.

### If Paperback cannot reach it

If adding the repository times out while the same address opens fine in Safari,
iOS is blocking Paperback from the local network. Turn it on under
**Settings → Privacy & Security → Local Network → Paperback**. iOS can switch
this off again after an update or a reinstall, so it is the first thing to
check when local testing stops working for no clear reason.

## Watch the logs

The toolchain can stream the app's log to your terminal:

```sh
npx paperback logcat --ip=<your-phone's-address>
```

It connects to the phone on port 27015. A source's `console.log` output and the
errors it throws appear here as they happen, which is the quickest way to see
why a screen came back empty. Whether the app accepts the connection depends on
the build of Paperback installed; if it never connects, the errors the app
shows on screen are the fallback.

## What is worth checking by hand

- **Every screen a change touches** — home page, search, a series, a chapter.
  An error in one of them leaves only that screen empty.
- **A chapter's pages actually render.** A page list that loads is not the same
  as images that draw, particularly for a source that rebuilds its images.
- **Settings open and keep their values** after leaving and coming back.
- **The version number went up.** The app caches a source by version, so a fix
  shipped under an old number never reaches anyone who already has it.
