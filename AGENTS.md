# AGENTS.md

Rules for any coding agent (and person) working in this repository.

- An internal tool to try sidevoice-engine builds by hand. Keep it small: no framework, no build step, no runtime
  dependencies. The page is plain ES modules in `web/`; `server.mjs` serves it; tests run with `node --test`.
- Code, comments, docs and commit messages are in **English**. The UI is English only: it is not a product.
- The engine is loaded at run time, never bundled or compiled in (`DESIGN.md`). Anything that needs a change in
  sidevoice-engine is a proposal to its owner, not a change made from here.
- **No model is downloaded or run on a development machine that cannot afford it.** Real inference is proved in CI.
- Pull request titles are [Conventional Commits](https://www.conventionalcommits.org) (CI checks them); PRs are
  squash-merged. Third-party actions are pinned by commit SHA, with the version in a comment.
