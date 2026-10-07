<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/readme-header-on-dark.svg" />
  <img alt="Sidevoice — Give your coding agent a voice. Keep the conversation." src=".github/assets/readme-header.svg" width="750" />
</picture>

# sidevoice-playground

An internal app to try [sidevoice-engine](https://github.com/sidevoice/sidevoice-engine) by hand. You name an engine
build — a version, `nightly`, `latest`, a release link — and the playground downloads it and uses it, so trying an
engine build never means rebuilding the playground. Then: text to speech, speech to text, comparing models, and the
round trip text → speech → text.

A web app; later also a Tauri app for macOS on Apple silicon. How engines are loaded, and the open questions for the
native path: [`DESIGN.md`](DESIGN.md).

## Status

- **Works**: naming an engine and loading its web build from GitHub Releases (checked against the release's
  `SHA256SUMS`), several versions side by side; what each build offers per task (`backends()`, `offers()`);
  recording or uploading audio and playing it back.
- **Not yet**: speaking and transcribing. No engine web build exposes them yet; the panels say what the active
  engine does expose. Git refs (pull requests, branches, commits) are recognised but cannot be loaded: no build of
  them is kept anywhere yet. The Tauri app.

## Run

You need Node.js 22. No dependencies to install.

```sh
npm start        # http://localhost:5174 (PORT to change it)
npm test         # unit tests; PLAYGROUND_NETWORK=1 also loads the real nightly web build in Node
```

What you can type in the engine box:

| You type | It loads |
|---|---|
| `0.2.0`, `v0.2.0`, `@sidevoice/engine@0.2.0`, `…/releases/tag/v0.2.0` | that release's web build |
| `nightly`, `…/releases/tag/nightly` | the latest green `main` |
| `latest` | the newest published release |
| `#27`, `…/pull/27`, `…/tree/<branch>`, `…/commit/<sha>`, a branch, a SHA | refused for now, with the reason (`DESIGN.md`, *Arbitrary refs*) |

## Layout

```
web/            the page: index.html, app.mjs (UI), audio.mjs (record, decode, WAV)
  engine/         spec.mjs (what you typed → a release or a ref), load.mjs (download, verify, import),
                  tar.mjs (gzip + ustar), host.mjs (the page's capabilities for WebEngine.create)
server.mjs      serves web/ and /fetch, the relay for engine release assets (github.com sends no CORS headers)
test/           node --test
```
