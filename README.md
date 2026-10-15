<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/readme-header-on-dark.svg" />
  <img alt="Sidevoice — Give your coding agent a voice. Keep the conversation." src=".github/assets/readme-header.svg" width="750" />
</picture>

# sidevoice-playground

An internal app to try [sidevoice-engine](https://github.com/sidevoice/sidevoice-engine) by hand. You pick an engine
build — a version, `nightly`, `latest`, a pull request, a branch — and the playground downloads it and uses it, so
trying an engine build never means rebuilding the playground. Then: text to speech, speech to text, comparing
models, and the round trip text → speech → text.

Two more sections sit beside the engine's: **Voice**, a call on the voice module
([sidevoice-voice](https://github.com/sidevoice/sidevoice-voice)) with the engine loaded, and **Connector**, the
connector's test bench ([sidevoice-connector](https://github.com/sidevoice/sidevoice-connector)) reached through
this server.

A web app, and a Tauri app for macOS on Apple silicon that can also run any engine commit **natively**, built on the
Mac (below). How engines are loaded: [`DESIGN.md`](DESIGN.md).

## Status

- **Works**: picking an engine and loading its web build from GitHub Releases (checked against the release's
  `SHA256SUMS` and installed by the server with its npm dependencies), several versions side by side; a local build
  of any ref (`--engine-tarball`). With an engine that has the model interface (`models`, `install`, `uninstall`,
  `load`, sidevoice-engine#41 on), a screen per capability: text to speech and speech to text each pick a family, then
  one of its models that does the task, and
  install and load it there with progress and cancel, in its recommended build or the one picked under Advanced
  (every build `models()` lists, those that do not run here with their reason). Then speaking (voice, language,
  speed), transcribing a recording or an upload, and the round trip with its word error rate. **Turn detection**
  runs the voice module's chain on the microphone: the engine's voice-activity stream (probability graph where the
  backend gives one, speech start and end), then at each end of speech either the end-of-turn model (smart-turn, its
  P(end) against a threshold) or silence with patience, with sidevoice-voice's numbers (`web/turns/chain.mjs`);
  end-of-turn needs an engine from sidevoice-engine main at 8aa89d1 (#78) on, and the native runner has neither
  stream. Models download to
  and run in the browser (OPFS), never on the server. Phone and desktop alike; the look is the Sidevoice app's.
  Older builds say they cannot speak or transcribe. `models()` does not name a model's family yet (up to #41): it is
  read from the model id until the engine says it.
- **Git refs**: an open pull request or a branch loads the engine CI's build of its head commit (the
  `engine-npm-<sha>` Actions artifact, kept 7 days), fetched by the server with a GitHub token.
- **Voice** (web only): a CI build of `@sidevoice/voice` (a pull request's or a branch's `voice-npm-<sha>`
  artifact, fetched like an engine ref's), a call on it with the active engine's models: voice activity, speech to
  text (language), text to speech (voice), end of turn, patience, and the browser's echo cancellation on or off. It
  shows the call's state, the microphone's level, its turns with their transcripts and timings, and each reply as it
  sounds (heard, sounding, rest). The page stands in for the room: it answers each finished turn with what was
  heard, when asked, or speaks a reply typed in.
- **Connector**: the connector's test bench (`cargo xtask bench` in a sidevoice-connector checkout, on
  127.0.0.1:4477) under `/connector/`, through this server's access gate (`--bench-url` to point elsewhere). The
  bench's page and logic stay in the connector; the section says whether it answers and opens it. In the macOS app,
  it gives the command and the bench's own address.
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

**Builds of releases.** For a version, `nightly` or `latest`, the server downloads the release's npm tarball and its
`SHA256SUMS` (no token needed), checks the one against the other, and installs and serves it like a local build, under
`/engines/<its sha256>/`, so the package's own modules (`dist/snippets/`) and its npm dependencies resolve. Once per
tarball: `nightly`, whose tarball changes, is checked again each time it is loaded, and shows its digest in its name.

**Picking an engine.** Three dropdowns, each with its Load button and, below it, the details of what is picked.
Nothing is typed: the server lists them through the GitHub API with its token (`/engine-builds`, behind the access
gate like every route, kept a minute; *Refresh lists* asks anew), and only the listing reaches the page.

| Dropdown | Lists | Details shown | It loads |
|---|---|---|---|
| Version | the local build (with `--engine-tarball`), `nightly`, `latest release (vX.Y.Z)`, every `vX.Y.Z` with a web build | version and digest, or publication date | that build; a release's web build from GitHub Releases, installed by the server (below) |
| Pull request | the open pull requests, `#<number> <title>` | author, head (`owner:branch @ sha`), draft, whether its `engine-npm-<sha>` build is there (until when) or expired | the CI build of its head commit (below); while the head has none, the newest earlier commit of the pull request that has one, said in its label (`head building; loads <sha> (N commits behind)`) |
| Branch | the branches | head commit | the CI build of its head commit |

## The macOS app

A Tauri v2 app for Apple silicon (`src-tauri/`) that shows the same page, `web/`, in a webview, with no server and
no access gate: nothing listens on the network, and only the app's own page reaches its commands. Nothing of the
engine is compiled into it. It offers the same three dropdowns, listed from GitHub's API directly (no token: 60
requests an hour), and one more, **Run**:

- **its web build, in this window**: only a release whose package imports nothing loads here, from memory, its assets
  coming through the app. A package with npm dependencies or its own modules (`dist/snippets/`, sidevoice-engine#41
  on: `nightly`, `v0.2.0`) needs them installed and served beside it, which the web playground's server does and the
  app, with no server, does not; it is refused saying so. Pull requests and branches do not load here either. Run
  those natively here, or in the web playground.
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

**Download.** main's newest app is the `nightly` pre-release:
<https://github.com/sidevoice/sidevoice-playground/releases/download/nightly/sidevoice-playground_aarch64.dmg> (its
commit in the release notes, its digest in `SHA256SUMS` beside it); after installing it, `xattr -dr
com.apple.quarantine "/Applications/Sidevoice Playground.app"` (below).

**Opening the unsigned .dmg.** CI's `macOS app (Apple silicon) .dmg` job uploads it as the artifact
`sidevoice-playground-macos-aarch64` (a zip holding `sidevoice-playground_<commit>_aarch64.dmg`, kept 30 days), and
on main to the `nightly` pre-release. The app is signed ad hoc, not with a Developer ID, and not notarised, so
Gatekeeper stops it the first time:

1. Unzip the artifact (or take the nightly's `.dmg`), open the `.dmg` and drag *Sidevoice Playground* to Applications.
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

## Web preview

### Turn Lab: real spoken conversation

The access-gated link is **`http://localhost:5174/turn-lab?access=<token from the playground access file>`**. Open it once; the gate stores a cookie and redirects to `/turn-lab`. For a remote browser, use the same `/turn-lab?access=…` path on the playground tunnel and set `--preview-origin` to the second, browser-reachable preview tunnel. The Turn Lab starts the pinned real room, pairs its browser through the web build's own pairing protocol, connects a scripted MCP agent in inject mode, and puts the room, script menu, event log, reply hearing (including unconfirmed rows), agent notices and case checks together. Allow the microphone prompt; the browser downloads its local models automatically on first use. Once the call joins, speak. Use **Get messages** to reconnect the scripted agent in pull mode.

For an isolated local run, use ports away from the live playground:

```sh
PORT=5314 node server.mjs --preview-port 5315 --cache-dir /tmp/sidevoice-turn-lab-cache --access-file /tmp/sidevoice-turn-lab-access
# Open http://localhost:5314/turn-lab?access=<token from /tmp/sidevoice-turn-lab-access>
```

The four candidate SHA pins are in [`preview/turn-lab.config.json`](preview/turn-lab.config.json) and shown in the Turn Lab itself. Re-pin a producer by changing its one SHA entry and restarting the lab. Core and connector full SHAs are source-built in an isolated cache; the binary SHA-256 is recorded in the run trace. Web is built from its full SHA and its `@sidevoice/voice` dependency is forced to the chosen voice CI tarball even if npm already has the web commit's old version. The trace records the voice package digest as well. The current pins are core `792d7a06bbac926188cf10d900a747af10a762c9`, voice `1aa57b0c05f15207def0fda0572b47b1dfd36712`, connector `68ecf8265b5fe06988c4bcf1055fec78587451b5` (T PR #126), and web `2f4e853a5c6e57e64cb36ff1220857d01cb33d10` (T PR #126). Recheck moving producer heads before a test run. Build hosts need Rust 1.98, Cargo, a C compiler, and Node 22. The room runs no server-side inference; browser Silero, Smart Turn, and local TTS run in the real web/voice build.

Each T01–T16 case variant is selectable from the scripted agent menu and from the mock scenario picker. Turn fixtures live under `preview/mock/scenarios/turns/`; they specify timed actions, expected epoch changes, fates, screen marks, agent notices and tool results. The separate `preview/mock/turn-contract.mjs` checks each fixture against the closed #19 outcome and required steps. T08 and T11 also drive the actual mock room socket and inspect its history, epochs and playback receipts. The fixture result says **MODEL MATCH**, never PASS: the reference model cannot establish that the pinned core, connector, browser and physical audio behaved that way. The live judge has automatic evidence rules for 14 cases; the other 11 show Manual, including T10 speaker echo/AEC and behavior that needs a real speaker and microphone. An automatic case stays Pending until its evidence arrives.

The existing mock/core API shape check accepts only the binaries matching this config's SHA and digest receipts: set `PLAYGROUND_CONFORMANCE=1`, `PLAYGROUND_CORE_BIN` and `PLAYGROUND_CONNECTOR_BIN` to those source-built executable paths, then run `node --test test/mock-conformance.test.mjs`. The ordinary CI suite leaves this candidate-only test skipped; it does not compare the T mock against an older nightly release.

The real sidevoice-web, at a release, `main`, a branch or a pull request, built by checkout and opened on an origin
of its own. **Mocked** (the default) for UX: everything it talks to answers from a scenario, picked with its options
in a card over the page and switched live. Or on the **real core and connector** of a picked release, in a scenario
of its own: nothing faked, and no model runs (the core offered is the room-only one, `rust-native-v2`).

- **The web** is built by checkout, once per commit: a bare mirror of the repository (`git archive` of the commit),
  then the web's own build (`npm ci`, `npm run build`, `node scripts/assemble-static-web.mjs`). Only the site is
  kept, the 3 newest. A web that pins an `@sidevoice/*` version npm does not have yet takes it from the engine or
  voice build picked for it (their CI tarballs); with none picked, the start says which.
- **The preview origin** is a listener of its own (`--preview-port`, PORT+1 by default; `--preview-origin` is its
  public address, behind a tunnel), so the web's storage there is never the playground's. It is behind the same
  access gate (the page links to it with the token). What is built, unpacked and kept lives under `--cache-dir`
  (`~/.cache/sidevoice-playground`).

**Mocked** (`preview/mock/`). The origin's `/` is a shell: the web in a frame sized by the view (browser, the
desktop app's window, a phone), and the card. The site's `/voice/target.js` — the classic script a deployment puts
before the web's module — hands the page to the shell, which puts in its mocks through the seams the web already has:
`fetch` (the machines, the room and the page's own origin answer the routes the web asks: rendezvous, identity,
pairing, devices, the presentation's reads) and, in the app view, `window.__sidevoiceDesktop.host` (the desktop
bridge, with its local host). Identities are real P-256 keys and codes are real `SV1.` codes, so the web pairs with
its own code.

- **The voice and the models** are mocked through the two interfaces the web takes them by: `VoiceHost` and
  `ModelCatalogs`. In the app view they are the bridge's `host.voice` and `host.engine`; in the browser view the
  origin serves the web's own `@sidevoice/voice` and `@sidevoice/engine` chunks (told by their exports) as the
  mocks' `createVoiceHost` and `WebEngine`, so the web's own catalogue and model-source code runs on them. The
  catalogues are the local one (a few of sidevoice-engine's `catalog/families`, with their builds by place) and
  OpenAI's and ElevenLabs' (listed with an accepted key; refused, missing or unreachable otherwise). Installs report
  progress and can be cancelled or fail; a local model's voices are listed once it is installed. No microphone is
  used: the card's **Speak** says its text into whatever listens (a transcription test, a call), and options make
  the microphone denied or missing, the transcription silent or failing, and speech fail. A try that asks for its
  take (the web's contract gap #40, pending in the voice module) is handed one as the voice stops: made up from what
  it told — a voiced tone at its levels while the person spoke, quiet pauses, its turns' marks — or none, as the voice
  0.3.x gives, with the option set so. Every scenario has these options (`preview/mock/voice-options.json`).
- **Scenarios** are `preview/mock/scenarios/*.json`: a world (the page's target, the machines this device knows or
  could pair with, the desktop app's local host) and options, each value a set of fields it changes. An option marked
  ↻ reloads the page from the storage the world says it had; any other one is live.
- **This computer's Sidevoice**, in the app view, is as the desktop app's: Prepare installs it (`localHost.install`:
  download with its bytes, cancellable, then verification, staging, service start), the install command under it to run by
  hand. *First visit* (the setup's Prepare this computer) and
  *Desktop app with its local host* (Settings) have its every state in *State*, and "the install command run": it
  starts, then answers or fails as *A start ends* says. "The app installs Sidevoice ↻: no" leaves only the command.
- **The card** (Alt+Shift+P, or its header, shows and hides it) picks the scenario, view, language and options; gives
  pairing codes for each machine (valid, expired, used, plain http, damaged, another machine answering) to paste into
  the page; runs the world's time at ×1, ×4 or paused; and lists what the mocks were asked. Everything it picks is in
  the address: a link opens the same screen. Its "Updates elsewhere", in any scenario and view, makes this computer's
  Sidevoice behind the one the desktop app bundles (↻, in the Desktop app view) and the first paired machine behind
  (its `/api/host/status` names the latest and a mock command; the page is asked to look again, live); these, like the
  app updater's states, are the world's, not the address's.
- **The desktop app's floating card** stands beside the room in the app view: the web's real card page
  (`/voice/call-controls.html`) in a frame of its own, given the app's card seam (`host.callControls`,
  `preview/mock/card-host.mjs`) and fed from the room frame's store, level and caption, as the desktop bridge reads
  them. It shows while the card is wanted (set up, and a call on in A or the voice on in B), stays a moment to say why
  when the call or the voice ends by itself, and logs each command in the activity; its "Open Sidevoice" flashes the
  room. "Behind the card"
  switches what the translucent card sits on, and "Card: always show controls" is the app's setting. The card's
  "Floating card states" puts the idle warning, an ending by itself and the agents muted (B) in the room's facts.
- **Faithful to the web**: once a web commit is built, its own TypeScript checks the mocks against its types
  (`@sidevoice/protocol`, the desktop bridge's, the pairing's; `preview/mock/web-types.d.ts`), and a mocked start
  of a commit they do not match says where. **Faithful to the core**: `test/mock-conformance.test.mjs` asks the
  nightly core and the newest connector what the mocks answer, and checks every status and field
  (`PLAYGROUND_CONFORMANCE=1`, on in CI).

**Dev mode, live.** A sidevoice-web worktree of this machine, served by its own Vite dev server (`npm run dev`,
on a free port) behind the preview origin and its gate, with the mocked preview's shell, card and mocks around it:
an edit saved in the worktree reaches the browser by Vite's hot reload, whose socket the origin passes on (the web's
own Vite config points it at `wss://<page host>:443`, so it works through the tunnel, not at `http://localhost`).
In dev the web's `@sidevoice/voice` and `@sidevoice/engine` modules are the mocks' as in a build (told by their
exports). The worktrees offered are those of the checkout `--dev-repo` names (`/workspace/sidevoice/sidevoice-web` by
default), each with its dependencies installed; nothing is ever installed into one.

1. Make the worktree, once, and install its dependencies:
   `git -C /workspace/sidevoice/sidevoice-web worktree add /workspace/sidevoice/worktrees/web-onboarding feat/onboarding`,
   then `npm ci` in it.
2. Start it: the playground's Web preview section, *Mode: Dev*, pick the worktree, *Start*, then *Open the preview*.
   From the pod, the same with the access cookie: `POST /preview/start` with `{"mode":"dev","worktree":"<path>"}` on the
   playground's port (`/preview/status` says how it goes, and the dev server's output).
3. Edit the worktree: each save shows in the open preview. Nothing restarts.
4. Stop it with *Stop* (`POST /preview/stop`); starting another preview stops it too, and so does the server exiting.

**Real core and connector.** The core and the connector are the archives their releases publish for linux-x86_64
(the core's, the one the connector fetches), checked against `SHA256SUMS` and unpacked once per digest. A run starts
the core in the scenario's own profile, told to answer the preview origin (`SIDEVOICE_ALLOWED_HOSTS`,
`SIDEVOICE_ALLOWED_ORIGINS`); the origin serves the site and passes `/api/…` and socket upgrades to the core as
they came. *Pairing code* asks the connector, in the same profile, for a one-time code (`pair-device`). Its
scenarios are `preview/scenarios/*.json`: *Fresh install* empties its profile and, on the first page, the browser's
storage for the preview origin (`/preview-reset`); *Paired* keeps both (*Forget* starts it over). One run at a time,
mocked or real: a start stops the last one.

## Layout

```
web/            the page: index.html, app.mjs (UI), audio.mjs (record, decode, WAV)
  voice.mjs, voice/call.mjs  the Voice section: the DOM, and what it makes of the call (no DOM)
  connector.mjs   the Connector section
  preview.mjs, preview/choices.mjs  the Web preview section, and its pickers' choices (no DOM)
  sources.mjs     the repositories builds come from (engine, voice) and their artifacts' names
  engine/         choices.mjs (the pickers' choices), spec.mjs (a choice → a release or a ref),
                  load.mjs (download, verify, import),
                  tar.mjs (gzip + ustar), host.mjs (the page's capabilities for WebEngine.create),
                  listing.mjs (what there is to pick, from GitHub's API), native.mjs (the app's native runner in
                  WebEngine's shape)
src-tauri/      the macOS app: main.rs, runner.rs (the native runner: built, started, spoken to), release.rs
                (release assets for the page); tauri.conf.json, Info.plist (the microphone)
  runner/         the native runner's template: Cargo.toml.in, build.sh, src/ (the protocol, the engine's values)
server.mjs      serves web/, the engine and voice builds the page loads, and the bench under /connector/
bench.mjs       the reverse proxy to the connector's test bench
access.mjs      the access gate: the token, the cookie, the check every request goes through
served-engine.mjs  an engine or voice tarball installed and served under a prefix, with its import map
engine-builds.mjs  the releases, pull requests and branches to pick from, listed through the GitHub API
release-builds.mjs  a release's tarball, checked against its SHA256SUMS, installed and served
preview/        the Web preview: web-build.mjs (by checkout), archives.mjs (core, connector), runs.mjs,
                proxy.mjs (the preview origin), index.mjs (its routes), dev.mjs (dev mode), scenarios/ (real core);
                mock/: world.mjs, machines.mjs, bridge.mjs, card-host.mjs, models.mjs, voice.mjs, attach.mjs, chunks.mjs (the mocks),
                shell + card, scenarios/, voice-options.json
refs.mjs        a git ref → its head commit → its CI artifact (engine or voice), verified, unzipped (zip.mjs) and served
test/           node --test
```
