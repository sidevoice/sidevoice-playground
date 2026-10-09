<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/readme-header-on-dark.svg" />
  <img alt="Sidevoice — Give your coding agent a voice. Keep the conversation." src=".github/assets/readme-header.svg" width="750" />
</picture>

# sidevoice-playground

An internal app to try [sidevoice-engine](https://github.com/sidevoice/sidevoice-engine) by hand. You pick an engine
build — a version, `nightly`, `latest`, a pull request, a branch — and the playground downloads it and uses it, so
trying an engine build never means rebuilding the playground. Then: text to speech, speech to text, comparing
models, and the round trip text → speech → text.

A web app, and a Tauri app for macOS on Apple silicon that can also run any engine commit **natively**, built on the
Mac (below). How engines are loaded: [`DESIGN.md`](DESIGN.md).

## Status

- **Works**: picking an engine and loading its web build from GitHub Releases (checked against the release's
  `SHA256SUMS`), several versions side by side; a local build of any ref (`--engine-tarball`). With an engine that
  has the model interface (`models`, `install`, `uninstall`, `load`, sidevoice-engine#41 on), a screen per
  capability: text to speech and speech to text each pick a family, then one of its models that does the task, and
  install and load it there with progress and cancel, in its recommended build or the one picked under Advanced
  (every build `models()` lists, those that do not run here with their reason). Then speaking (voice, language,
  speed), transcribing a recording or an upload, and the round trip with its word error rate. Models download to
  and run in the browser (OPFS), never on the server. Phone and desktop alike; the look is the Sidevoice app's.
  Older builds say they cannot speak or transcribe. `models()` does not name a model's family yet (up to #41): it is
  read from the model id until the engine says it.
- **Git refs**: an open pull request or a branch loads the engine CI's build of its head commit (the
  `engine-npm-<sha>` Actions artifact, kept 7 days), fetched by the server with a GitHub token.
- **Not yet**: release builds whose package carries `dist/snippets/` and npm dependencies (#41 on) do not load from
  a release: the in-memory import cannot resolve them.
- **The macOS app**: the same page, and the native engine of any version, pull request or branch, built on the Mac
  (below). Unsigned: CI builds the `.dmg`.

## Run

You need Node.js 22. No dependencies to install.

```sh
npm start        # http://localhost:5174 (PORT to change it); open it once with ?access=<token>, below
npm test         # unit tests; PLAYGROUND_NETWORK=1 also loads the real nightly web build in Node
```

**Access.** Every route asks for a token, because the playground is meant to be reached through a tunnel too. Each
start makes a new one (32 random bytes, base64url), keeps it in memory and writes it over
`~/.agent/secrets/sidevoice-playground-access` (mode 600; `--access-file` to change it); a restart invalidates the
last one. Open any URL once with `?access=<token>`: the server sets an HttpOnly, Secure, SameSite=Lax cookie and
redirects to the URL without it. Anything else gets 401. The token is never logged.

**A local engine build.** For a build no release carries (a pull request, a branch), make the npm tarball in an
engine checkout (`cargo xtask npm`, in `target/npm/`) and pass it:

```sh
node server.mjs --engine-tarball ../sidevoice-engine/target/npm/sidevoice-engine-0.1.0.tgz \
  --engine-label "local build (#41 @ efa1d6d)" [--engine-sha256 <hex>]
```

The server installs it as a consumer would, with its npm dependencies, into a scratch directory, serves it under
`/local-engine/` and gives the page the import map its dependencies need. The Version list then offers it first.
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

**Picking an engine.** Three dropdowns, each with its Load button and, below it, the details of what is picked.
Nothing is typed: the server lists them through the GitHub API with its token (`/engine-builds`, behind the access
gate like every route, kept a minute; *Refresh lists* asks anew), and only the listing reaches the page.

| Dropdown | Lists | Details shown | It loads |
|---|---|---|---|
| Version | the local build (with `--engine-tarball`), `nightly`, `latest release (vX.Y.Z)`, every `vX.Y.Z` with a web build | version and digest, or publication date | that build; a release's web build from GitHub Releases |
| Pull request | the open pull requests, `#<number> <title>` | author, head (`owner:branch @ sha`), draft, whether its `engine-npm-<sha>` build is there (until when) or expired | the CI build of its head commit (below); while the head has none, the newest earlier commit of the pull request that has one, said in its label (`head building; loads <sha> (N commits behind)`) |
| Branch | the branches | head commit | the CI build of its head commit |

## The macOS app

A Tauri v2 app for Apple silicon (`src-tauri/`) that shows the same page, `web/`, in a webview, with no server and
no access gate: nothing listens on the network, and only the app's own page reaches its commands. Nothing of the
engine is compiled into it. It offers the same three dropdowns, listed from GitHub's API directly (no token: 60
requests an hour), and one more, **Run**:

- **its web build, in this window**: a release's web build loads as in a browser, its assets coming through the app
  instead of `server.mjs`. Pull requests and branches do not: their web builds are fetched and installed by the
  server, which the app does not run.
- **natively: built on this Mac, run beside the app**: any version, pull request or branch. The app takes the commit
  it names and builds **the native runner** for it: a small crate shipped with the app as a template
  (`src-tauri/runner/`), sidevoice-engine as a git dependency at that commit, built with `cargo build --release` by
  the template's own `build.sh`. The build's output shows in the engine box as it goes; *Cancel* kills it. The first
  build of a commit takes minutes (whisper.cpp is compiled from source); its binary is kept and reused. Then the app
  starts the runner as a child process and speaks to it in JSON lines (`src-tauri/runner/src/main.rs`), whose
  operations mirror a web build's `WebEngine` (`models`, `install` with progress, `uninstall`, `load`, `voices`,
  `speak`, `transcribe`), so the text-to-speech, speech-to-text and round-trip screens work the same on either.

What the native build needs on the Mac: Xcode (or its command line tools), CMake and Rust — `brew install cmake
rustup && rustup default stable`. The app finds them where Homebrew and rustup put them even when started from the
Finder; one that is missing is named in the engine box with the command that installs it. sherpa-onnx's static
libraries come as the engine documents for consumers: its own `cargo xtask sherpa-libs` checks them against its
pinned digests (in `~/.cache/sidevoice-engine/sherpa-onnx/`); an engine without that command leaves the download to
the sherpa-onnx crate, unchecked.

Where things are kept, under `~/Library/Application Support/dev.sidevoice.playground/`: `runners/<commit>/` (each
runner and its binary), `runners/target/` (cargo's build directory, shared, several GB: delete it to reclaim the
space, and the next build starts from scratch), `sidevoice-engine/` (the models, shared by every runner).

Limits. The runner is written against the model interface (sidevoice-engine#58 on): an older engine fails to build,
and says so as a build error. If the runner crashes (an uncaught C++ exception in sherpa-onnx, say), the app stays up,
the engine box says how it ended with its last lines of stderr, and loading it again starts it again. The native
engine runs what its native build runs at that commit (sherpa-onnx and whisper.cpp models; transformers.js builds
show as `backend-not-in-this-build`). CI builds the template against the engine's `main` and speaks the protocol to
it, so a template that no longer builds is caught there; no model is run.

**Opening the unsigned .dmg.** CI's `macOS app (Apple silicon) .dmg` job uploads it as the artifact
`sidevoice-playground-macos-aarch64` (a zip holding `sidevoice-playground_<commit>_aarch64.dmg`, kept 30 days). The
app is signed ad hoc, not with a Developer ID, and not notarised, so Gatekeeper stops it the first time:

1. Unzip the artifact, open the `.dmg` and drag *Sidevoice Playground* to Applications.
2. Either clear the quarantine flag the browser put on it — `xattr -dr com.apple.quarantine "/Applications/Sidevoice
   Playground.app"` — and open it as usual; or open it once, dismiss the warning, then in System Settings → Privacy
   & Security choose *Open Anyway* (on macOS 15 the old right-click → Open no longer bypasses it). If macOS says the
   app "is damaged", it is the quarantine flag: the `xattr` line fixes it.
3. The first recording asks for the microphone.

**Building it.** On a Mac with Apple silicon, Rust (`src-tauri/rust-toolchain.toml`) and Node 22:

```sh
npm run tauri dev                        # the app, from web/ as it is
npm run tauri build -- --bundles app     # src-tauri/target/release/bundle/macos/Sidevoice Playground.app
sh src-tauri/runner/build.sh <engine commit sha> /tmp/runner   # the native runner alone, as the app builds it
```

## Layout

```
web/            the page: index.html, app.mjs (UI), audio.mjs (record, decode, WAV)
  engine/         choices.mjs (the pickers' choices), spec.mjs (a choice → a release or a ref),
                  load.mjs (download, verify, import),
                  tar.mjs (gzip + ustar), host.mjs (the page's capabilities for WebEngine.create),
                  listing.mjs (what there is to pick, from GitHub's API), native.mjs (the app's native runner in
                  WebEngine's shape)
src-tauri/      the macOS app: main.rs, runner.rs (the native runner: built, started, spoken to), release.rs
                (release assets for the page); tauri.conf.json, Info.plist (the microphone)
  runner/         the native runner's template: Cargo.toml.in, build.sh, src/ (the protocol, the engine's values)
server.mjs      serves web/ and /fetch, the relay for engine release assets (github.com sends no CORS headers)
access.mjs      the access gate: the token, the cookie, the check every request goes through
served-engine.mjs  an engine tarball installed and served under a prefix, with its import map
engine-builds.mjs  the releases, pull requests and branches to pick from, listed through the GitHub API
refs.mjs        a git ref → its head commit → its CI artifact, verified, unzipped (zip.mjs) and served
test/           node --test
```
