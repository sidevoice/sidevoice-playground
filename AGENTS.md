# AGENTS.md

Rules for any coding agent (and person) working in this repository.

- An internal tool to try sidevoice-engine builds by hand. Keep it small: no framework, no build step, no runtime
  dependencies. The page is plain ES modules in `web/`; `server.mjs` serves it; tests run with `node --test`.
- Code, comments, docs and commit messages are in **English**. The UI is English only: it is not a product.
- Web builds of the engine are loaded at run time, never bundled. The one exception is the macOS app's native engine
  (`src-tauri/`), compiled in at the commit `src-tauri/Cargo.toml` pins: moving it is a pin change and a rebuild
  (`DESIGN.md`). Anything that needs a change in sidevoice-engine is a proposal to its owner, not a change made from
  here.
- The page knows no Tauri beyond `web/engine/native.mjs` and the fetcher in `app.mjs`: the screens use one engine
  interface, a web build's `WebEngine`, and the native commands mirror it.
- **No model is downloaded or run on a development machine that cannot afford it.** Real inference is proved in CI.
- Pull request titles are [Conventional Commits](https://www.conventionalcommits.org) (CI checks them); PRs are
  squash-merged. Third-party actions are pinned by commit SHA, with the version in a comment.
