<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/readme-header-on-dark.svg" />
  <img alt="Sidevoice — Give your coding agent a voice. Keep the conversation." src=".github/assets/readme-header.svg" width="750" />
</picture>

# sidevoice-playground

An internal app to try [sidevoice-engine](https://github.com/sidevoice/sidevoice-engine) by hand. You name an engine
build — a version, `nightly`, `latest`, a release link — and the playground downloads it and uses it, so trying an
engine build never means rebuilding the playground. Then: text to speech, speech to text, comparing models, and the
round trip text → speech → text.

A web app, and a Tauri app for macOS on Apple silicon that also runs the **native** engine, compiled into it (below).
How engines are loaded: [`DESIGN.md`](DESIGN.md).

## Status

- **Works**: naming an engine and loading its web build from GitHub Releases (checked against the release's
  `SHA256SUMS`), several versions side by side; a local build of any ref (`--engine-tarball`). With an engine that
  has the model interface (`models`, `install`, `uninstall`, `load`, sidevoice-engine#41 on), a screen per
  capability: text to speech and speech to text each pick a family, then one of its models that does the task, and
  install and load it there with progress and cancel, in its recommended build or the one picked under Advanced
  (every build `models()` lists, those that do not run here with their reason). Then speaking (voice, language,
  speed), transcribing a recording or an upload, and the round trip with its word error rate. Models download to
  and run in the browser (OPFS), never on the server. Phone and desktop alike; the look is the Sidevoice app's.
  Older builds say they cannot speak or transcribe. `models()` does not name a model's family yet (up to #41): it is
  read from the model id until the engine says it.
- **Git refs**: a pull request, branch or commit loads the engine CI's build of its head commit (the
  `engine-npm-<sha>` Actions artifact, kept 7 days), fetched by the server with a GitHub token.
- **Not yet**: release builds whose package carries `dist/snippets/` and npm dependencies (#41 on) do not load from
  a release: the in-memory import cannot resolve them.
- **The macOS app**: the same page, plus the native engine compiled in (below). Unsigned: CI builds the `.dmg`.

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

**Builds of git refs.** sidevoice-engine's CI uploads the npm package of every commit it builds as the Actions
artifact `engine-npm-<full sha>`, kept 7 days. For a ref, the server asks the GitHub API for its head commit, finds
that artifact from a successful run, downloads it, checks the zip against the digest the API gives (when it gives
one), and installs and serves the tarball like a local build, under `/engines/<sha>/`; once per commit. It says
when there is no build: no CI run yet, CI still running, the run failed, or the artifact expired. Artifacts need a
GitHub token even on a public repository: the server reads one from `--github-token-file`
(`~/.agent/secrets/github.token` by default), uses it for reads only, and never sends it to the page or logs it.
Each build's dependencies get their own scope in the page's import map; a browser that takes only one import map
per page (anything before Chrome 133) needs a reload after the first load of a ref.

What you can type in the engine box:

| You type | It loads |
|---|---|
| `0.2.0`, `v0.2.0`, `@sidevoice/engine@0.2.0`, `…/releases/tag/v0.2.0` | that release's web build |
| `nightly`, `…/releases/tag/nightly` | the latest green `main` |
| `latest` | the newest published release |
| `local` | the build passed with `--engine-tarball` |
| `#27`, `…/pull/27`, `…/tree/<branch>`, `…/commit/<sha>`, a branch, a SHA | the CI build of its head commit (below) |

## The macOS app

A Tauri v2 app for Apple silicon (`src-tauri/`) that shows the same page, `web/`, in a webview, with no server and
no access gate: nothing listens on the network, and only the app's own page reaches its commands. Its engine box
offers one more choice first, **native**: sidevoice-engine compiled into the app, the sherpa-onnx backend linked
statically, on the engine's own `NativeHost` and bundled catalogue. The page reaches it through Tauri commands that
mirror a web build's `WebEngine` (`models`, `install` with its progress as events, `uninstall`, `load`, then
`voices`, `speak` and `transcribe` on the loaded model; `web/engine/native.mjs`, `src-tauri/src/native.rs`), so the
text-to-speech, speech-to-text and round-trip screens work the same on either engine. Models download to
`~/Library/Application Support/dev.sidevoice.playground/sidevoice-engine/`.

**The native engine is the version the app was built with.** It is pinned in `src-tauri/Cargo.toml` as a git
dependency at one commit (today `main` at `6ae37d1`, version 0.1.0); the engine box names it (`native 0.1.0 @
6ae37d1`) and says so. Trying another engine natively means changing that pin (a tag such as `v0.2.0` once it
exists: `tag = "v0.2.0"` in place of `rev`), running `cargo update -p sidevoice-engine` in `src-tauri/`, and
rebuilding. Web builds still load in the app as in a browser — releases, `nightly`, `latest` — their release assets
coming through the app instead of `server.mjs`. Git refs and `--engine-tarball` builds do not: the server fetches and
installs those, and the app does not run it; use the web playground for them.

**What the native engine runs.** What sidevoice-engine's native build runs at the pinned commit: sherpa-onnx models
(Whisper and NeMo transducers to transcribe; Kokoro, Piper and Supertonic to speak), **on the CPU only**: the
statically linked sherpa-onnx libraries have no Core ML (sidevoice-engine#33 brings it back), and nothing runs on
Metal yet. Builds for other backends do not run: transformers.js is the web build's (`backend-not-in-this-build`,
shown under Advanced), and MLX is a stub that fails with `not-implemented` if picked. whisper.cpp
(sidevoice-engine#40, Metal) comes with a later `main`, by moving the pin.

**Opening the unsigned .dmg.** CI's `macOS app (Apple silicon) .dmg` job uploads it as the artifact
`sidevoice-playground-macos-aarch64` (a zip holding `sidevoice-playground_engine-<commit>_aarch64.dmg`, kept 30
days). The app is signed ad hoc, not with a Developer ID, and not notarised, so Gatekeeper stops it the first time:

1. Unzip the artifact, open the `.dmg` and drag *Sidevoice Playground* to Applications.
2. Either clear the quarantine flag the browser put on it — `xattr -dr com.apple.quarantine "/Applications/Sidevoice
   Playground.app"` — and open it as usual; or open it once, dismiss the warning, then in System Settings → Privacy
   & Security choose *Open Anyway* (on macOS 15 the old right-click → Open no longer bypasses it). If macOS says the
   app "is damaged", it is the quarantine flag: the `xattr` line fixes it.
3. The first recording asks for the microphone.

**Building it.** On a Mac with Apple silicon, Rust `1.98.1` (`src-tauri/rust-toolchain.toml`, the engine's) and
Node 22:

```sh
# sherpa-onnx's static libraries, as sidevoice-engine documents for consumers: its own `cargo xtask sherpa-libs`, from
# a checkout of the engine at the commit src-tauri/Cargo.lock pins, checked against the digests it pins.
export SHERPA_ONNX_LIB_DIR="$(cd ../sidevoice-engine && cargo xtask sherpa-libs)"
npm run tauri dev                        # the app, from web/ as it is
npm run tauri build -- --bundles app     # src-tauri/target/release/bundle/macos/Sidevoice Playground.app
```

Without `SHERPA_ONNX_LIB_DIR` the `sherpa-onnx` crate's build script downloads the libraries itself, unchecked. The
`-D_GLIBCXX_USE_CXX11_ABI=0` line sidevoice-engine#40 asks of consumers is for Linux x86_64 only (sherpa-onnx's
static libraries there use libstdc++'s old ABI, and whisper.cpp must match); macOS links libc++, where it does not
apply, and the pinned engine has no whisper.cpp yet. A Linux build of the app would need it once the pin includes #40.

## Layout

```
web/            the page: index.html, app.mjs (UI), audio.mjs (record, decode, WAV)
  engine/         spec.mjs (what you typed → a release or a ref), load.mjs (download, verify, import),
                  tar.mjs (gzip + ustar), host.mjs (the page's capabilities for WebEngine.create),
                  native.mjs (the app's native engine in WebEngine's shape)
src-tauri/      the macOS app: main.rs, native.rs (the engine's commands), values.rs (its values as the page reads
                them), release.rs (release assets for the page); tauri.conf.json, Info.plist (the microphone)
server.mjs      serves web/ and /fetch, the relay for engine release assets (github.com sends no CORS headers)
access.mjs      the access gate: the token, the cookie, the check every request goes through
served-engine.mjs  an engine tarball installed and served under a prefix, with its import map
refs.mjs        a git ref → its head commit → its CI artifact, verified, unzipped (zip.mjs) and served
test/           node --test
```
