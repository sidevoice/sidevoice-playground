// The repositories whose CI builds the playground loads, and how each names the npm package of a commit it uploads as
// an Actions artifact (kept 7 days): the engine's (`cargo xtask npm` in sidevoice-engine) and the voice module's
// (`cargo xtask npm` in sidevoice-voice). Releases are the engine's only for now: sidevoice-voice publishes none yet.

/** @typedef {{ repo: string, artifact: (sha: string) => string, releases: boolean }} Source */

/** @type {Source} */
export const ENGINE = { repo: "sidevoice/sidevoice-engine", artifact: (sha) => `engine-npm-${sha}`, releases: true };

/** @type {Source} */
export const VOICE = { repo: "sidevoice/sidevoice-voice", artifact: (sha) => `voice-npm-${sha}`, releases: false };
