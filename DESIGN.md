# Design: loading an arbitrary engine at run time

Status: the web path is built. The native path is built as **C3** (below), by the operator's decision of 2026-10-09:
the macOS app builds a runner on the user's Mac for the engine commit picked, and runs it as a child process. Nothing
of the engine is compiled into the app. C1 (the engine publishing the runner) stays the way to skip that build, and
waits for the engine owner's decision on the points marked *engine change*.

The goal: the operator names an engine (a version, `nightly`, `latest`, a release link, a pull request, a branch, a
commit) and the playground downloads that build and uses it. Trying an engine build never means rebuilding the
playground.

## What the engine gives us today (sidevoice-engine `main` at `d23dd31`)

- **Web**: every release and the `nightly` pre-release carry the npm package as an asset
  (`sidevoice-engine-X.Y.Z.tgz`, `sidevoice-engine-nightly.tgz`) plus `SHA256SUMS` and a SLSA attestation. npm gets
  the same bytes, for `vX.Y.Z` only (`@sidevoice/engine` holds only a `0.0.0` placeholder so far). The package is
  `wasm-bindgen --target web` output with no `snippets/`: one ES module and one `.wasm`.
- `WebEngine` exposes `create(host)`, `backends()` and `offers(task)`. Nothing prepares, speaks or transcribes yet,
  and the web build's one backend (`transformers-js`) is a stub. No open PR adds those to the web build.
- **Native**: consumers compile the crate at a git tag. There is no binary artifact, no C ABI, no CLI. The open PRs
  add the real native pieces: sherpa-onnx Whisper/Kokoro (#27), the catalogue (#28), the installer and `NativeHost`
  (#29). Once they land, a native consumer can prepare a model and speak or transcribe — but only by compiling the
  engine in.
- No build exists for a git ref that is not `main` or a tag: the PR CI builds the npm package and keeps nothing.
- github.com sends no CORS headers on release downloads: a page cannot fetch an asset by itself.

## Web: release assets, verified and imported in the page (built)

1. The operator types a name; `web/engine/spec.mjs` reads it as a release tag (versions in any spelling, release
   links, `nightly`), `latest` (resolved through the GitHub API, which does allow CORS) or a git ref.
2. The shell downloads the tarball and `SHA256SUMS` from the release. In the browser, through `server.mjs`'s
   `/fetch` (localhost only, engine release URLs only); in Tauri, through a Rust command doing the same.
3. The page checks the tarball against `SHA256SUMS`, unpacks it in memory, imports the entry module from a `data:`
   URL and initialises it with the `.wasm` bytes. Each load is its own module instance, so several versions live side
   by side and can be compared.

Why release assets rather than npm through a CDN (jsDelivr, esm.sh): the nightly is never on npm, the bytes are the
same, and one path covers both. A CDN would spare the `/fetch` relay for versions only, and the relay is needed for
the nightly anyway.

Not done: the attestation is not verified in the page (sigstore verification in a browser is heavy). `SHA256SUMS`
from the same release protects against a broken download, not against a tampered release. Acceptable for an
internal tool; the Tauri side could verify the attestation natively later.

## Native (Tauri, macOS on Apple silicon): the options

| | How | For | Against |
|---|---|---|---|
| **A. Webview only** | The Tauri app is the web shell; it loads the wasm build like the browser does. | No native code beyond a fetch command. Ready now. | Exercises only the web build's backends. sherpa-onnx and MLX — what the desktop app runs — are never tried. Misses the point of a macOS build. |
| **B. dlopen a C ABI library** | Each release ships `libsidevoice_engine.dylib` with a stable C ABI; the app downloads and `dlopen`s it. *Engine change.* | One process, no IPC. | A C ABI is the hardest contract to keep across pre-1.0 versions — the very versions the playground straddles. An uncaught C++ exception in sherpa-onnx aborts the whole app (#27 says so). Two versions in one process each open their own ONNX Runtime: symbol clashes, so no side-by-side comparison. Async API to flatten into C. |
| **C. Runner process (sidecar)** | Each release ships a small `sidevoice-engine-runner` binary built from the engine; the app downloads it, checks it, spawns it and talks JSON lines over stdio. *Engine change.* | A crash kills the runner, not the app. Several versions run side by side. A versioned, extensible protocol instead of struct layouts; engine error codes pass through as they are. CI proves real inference by running the same binary headless. | One more release asset (macOS arm64 is enough). A protocol to keep. Audio crosses a pipe (negligible here). |
| **D. Compile the engine into the app** | The Tauri app depends on the crate at a tag. | What the desktop app does. | Every engine build means rebuilding the app: what the operator asked to avoid. Rejected. |

### Where the runner comes from

- **C1. The engine owns it** (recommended). A `runner/` binary crate in the engine's workspace, a thin adapter over
  the public API (`Engine::new(NativeHost, [BundledCatalog])`, `offers`, `prepare`, speak/transcribe). `release.yml`
  attaches `sidevoice-engine-runner-X.Y.Z-macos-aarch64.tar.gz` to versions and the nightly, inside `SHA256SUMS` and
  the attestation. Whoever breaks the engine API fixes the adapter in the same PR; the protocol is versioned by the
  engine.
- **C2. The playground owns it.** No engine change, but the playground chases every breaking change of a pre-1.0
  API, and an adapter written for one engine version does not compile against another: it would need one adapter
  per API generation. Fragile, and the adapter logic lives away from its owner.
- **C3. Built on the user's machine per ref** (**chosen**, operator, 2026-10-09). The playground owns the adapter as
  in C2, but ships it as a *template*, not a binary: `src-tauri/runner/`, a crate depending on sidevoice-engine at
  `rev = @ENGINE_REV@`, a resource of the app, never linked into it. For the commit a picked release, pull request or
  branch names, the app runs the template's `build.sh`, which writes the crate out with that commit, gets sherpa-onnx's
  static libraries as the engine documents for consumers (its own `cargo xtask sherpa-libs`, digest-checked, through
  `SHERPA_ONNX_LIB_DIR`; the crate's own unchecked download for an engine without it), and runs `cargo build
  --release`. The binary is kept per commit under the app's data directory and reused; the cargo target directory is
  shared, so a second commit builds faster than the first. No engine change, any ref works the day it is pushed, and
  a crash stays in the runner. Against: the user's Mac needs Rust, CMake and Xcode's tools (the app says which is
  missing and how to install it), the first build of a commit takes minutes (whisper.cpp from source), and the one
  adapter compiles only against engines with the model interface (sidevoice-engine#58 on): an older engine fails as
  a build error. CI builds the template against the engine's `main`, so the adapter breaking is caught when the
  engine moves, not on a Mac.

### Runner protocol

As built for C3 (`src-tauri/runner/src/main.rs` documents it): one JSON object per line on stdin, one per line on
stdout, mirroring what the page uses of a web build's `WebEngine` — `hello`, `models`, `install` and `load` (jobs
whose progress comes as `{ event: "progress", job, ... }` lines, stopped by `cancel`), `uninstall`, then `voices`,
`speak` and `transcribe` on a loaded model's handle, and `free`. Values are the shapes the web build gives
JavaScript; a failure is `{ id, error: { code, params, message? } }`; audio crosses as base64 of little-endian f32.
The sketch first proposed to the engine owner for C1, before the model interface existed:

```
→ { "id": 1, "op": "hello" }                 ← { "id": 1, "engine": "0.3.0", "protocol": 1, "backends": [...] }
→ { "id": 2, "op": "offers", "task": "stt" } ← { "id": 2, "offers": [{ "model", "build", "offered", "why"? }] }
→ { "id": 3, "op": "prepare", "model": "...", "build": "..." }
                                             ← { "id": 3, "progress": { "done", "total" } } ... { "id": 3, "ready": true }
→ { "id": 4, "op": "speak", "build": "...", "text": "...", "voice"?: "...", "out": "/path.wav" }
→ { "id": 5, "op": "transcribe", "build": "...", "wav": "/path.wav", "language"?: "en" }
                                             ← { "id": 5, "text": "..." }
```

The data directory (models) is passed on the command line and shared by every runner version, so a model is
downloaded once whatever engine version uses it (#29 stores files by digest).

## Arbitrary refs (pull requests, branches, commits)

Nothing builds them today. Options:

- **R1. Engine CI keeps its PR builds** (recommended). `ci.yml` already runs `cargo xtask npm`; uploading the tarball
  (and the runner, with C1) as a 7-day workflow artifact is one step. The playground finds the run for the ref's head
  commit and downloads the artifact. *Engine change.* Downloading Actions artifacts needs a GitHub token even on a
  public repo: the shell's side (`server.mjs`, the Tauri side) reads it from the environment; the page never sees it.
- **R2. The playground builds them.** A `workflow_dispatch` workflow checks the engine out at the ref and runs its
  own `cargo xtask npm` (and the runner build), publishing to a playground pre-release. No engine change, but the
  playground repository is private, so downloads need a token too, and the engine gets built in two places.

**Chosen: R1.** The engine's CI uploads the npm package of each commit as the artifact `engine-npm-<full sha>`
(7 days). `server.mjs` resolves the ref to its head commit through the GitHub API, takes that commit's artifact
from a successful run, checks it against the API's digest, and serves it installed (`refs.mjs`, README, *Builds of
git refs*). A ref built by hand loads as a local build: `server.mjs --engine-tarball`.

From sidevoice-engine#41 the package imports npm dependencies (transformers.js, eSpeak NG) from
`dist/snippets/`, so the in-memory `data:` import of a release build cannot resolve them. A local build is served
installed, with an import map; release builds will need the same (the relay installing the verified tarball, or a
CDN for the dependencies).

## Recommendation

1. **Web**: as built — release assets through a fetch relay, verified, imported in the page.
2. **Native**: **C3** (built): the runner built on the user's Mac per engine commit, spawned by the app. **C1** — an
   engine-owned runner binary per release — when skipping that build is worth an engine change.
3. **Refs**: **R1** — the engine's CI keeps its PR builds as artifacts.

## What this asks of the engine

- (C1) A `sidevoice-engine-runner` binary and its protocol, attached to releases and the nightly for
  `macos-aarch64` (Linux x86_64 too would let CI prove inference on cheaper runners).
- (R1) `ci.yml` uploads the npm tarball (and the runner) as artifacts on pull requests.
- For web inference at all: `WebEngine` gaining prepare / speak / transcribe, and a real web backend.

## Proof of inference

Never on the development pod. Once the repository exists, the playground's CI (macOS 14, arm64) downloads the
runner for a named engine version and runs a round trip — Kokoro speaks a sentence, Whisper transcribes it, the
normalised texts must match — the same check #27 runs inside the engine, here through the downloaded artifact.
