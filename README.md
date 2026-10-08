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
  `SHA256SUMS`), several versions side by side; a local build of any ref (`--engine-tarball`). With an engine that
  has the model interface (`models`, `install`, `uninstall`, `load`, sidevoice-engine#41 on): the catalogue as it
  is for this browser, installing with progress and cancel, text to speech, speech to text from a recording or an
  upload, and the round trip with its word error rate. Models download to and run in the browser (OPFS), never on
  the server. Older builds show what they offer (`backends()`, `offers()`).
- **Not yet**: git refs typed in the engine box (they are recognised and refused: no build of them is kept anywhere
  yet; build one and pass it with `--engine-tarball`). Release builds whose package carries `dist/snippets/` and
  npm dependencies (#41 on) do not load from a release yet: the in-memory import cannot resolve them. The Tauri app.

## Run

You need Node.js 22. No dependencies to install.

```sh
npm start        # http://localhost:5174 (PORT to change it); open it once with ?access=<token>, below
npm test         # unit tests; PLAYGROUND_NETWORK=1 also loads the real nightly web build in Node
```

**Access.** Every route asks for a token, because the playground is meant to be reached through a tunnel too. Each
start makes a new one (32 random bytes, base64url), keeps it in memory and writes it over
`~/.agent/secrets/sidevoice-playground-access` (mode 600; `--access-file` to change it); a restart invalidates the
last one. Open any URL once with `?access=<token>`: the server sets an HttpOnly, Secure, SameSite=Strict cookie and
redirects to the URL without it. Anything else gets 401. The token is never logged.

**A local engine build.** For a build no release carries (a pull request, a branch), make the npm tarball in an
engine checkout (`cargo xtask npm`, in `target/npm/`) and pass it:

```sh
node server.mjs --engine-tarball ../sidevoice-engine/target/npm/sidevoice-engine-0.1.0.tgz \
  --engine-label "local build (#41 @ efa1d6d)" [--engine-sha256 <hex>]
```

The server installs it as a consumer would, with its npm dependencies, into a scratch directory, serves it under
`/local-engine/` and gives the page the import map its dependencies need. The engine box then offers `local`.
There is no `SHA256SUMS` for a local build: the page shows the tarball's digest, and `--engine-sha256` makes the
server refuse a tarball with another one.

What you can type in the engine box:

| You type | It loads |
|---|---|
| `0.2.0`, `v0.2.0`, `@sidevoice/engine@0.2.0`, `…/releases/tag/v0.2.0` | that release's web build |
| `nightly`, `…/releases/tag/nightly` | the latest green `main` |
| `latest` | the newest published release |
| `local` | the build passed with `--engine-tarball` |
| `#27`, `…/pull/27`, `…/tree/<branch>`, `…/commit/<sha>`, a branch, a SHA | refused for now, with the reason (`DESIGN.md`, *Arbitrary refs*) |

## Layout

```
web/            the page: index.html, app.mjs (UI), audio.mjs (record, decode, WAV)
  engine/         spec.mjs (what you typed → a release or a ref), load.mjs (download, verify, import),
                  tar.mjs (gzip + ustar), host.mjs (the page's capabilities for WebEngine.create)
server.mjs      serves web/ and /fetch, the relay for engine release assets (github.com sends no CORS headers)
access.mjs      the access gate: the token, the cookie, the check every request goes through
local-engine.mjs  a local engine tarball installed and served under /local-engine/, with its import map
test/           node --test
```
