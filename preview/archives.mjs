// Web preview: the core and the connector as their releases publish them, for this machine (linux-x86_64): the same
// `sidevoice-core-<v>-linux-x86_64.tar.zst` the connector fetches, and the connector's own archive. A release names
// its version (`vX.Y.Z`) or is `nightly`. The archive is checked against the release's SHA256SUMS, unpacked once per
// digest, and only a core that runs no models (`rust-native-v2`: the room alone) is offered in this pod.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { RefError } from "../refs.mjs";

export const TARGET = "linux-x86_64";
/** What each kind is: its repository, its archive's name for a version, and the program inside it. */
export const KINDS = {
  core: {
    repo: "sidevoice/sidevoice-core",
    asset: (version) => `sidevoice-core-${version}-${TARGET}.tar.zst`,
    program: "sidevoice-core-rust/bin/sidevoice-core-rust",
  },
  connector: {
    repo: "sidevoice/sidevoice-connector",
    asset: (version) => `sidevoice-connector-${version}-${TARGET}.tar.zst`,
    program: "sidevoice-connector/bin/sidevoice-connector",
  },
};
/** The only core kind run here: it holds no models (sidevoice-core#89). */
export const ROOM_ONLY = "rust-native-v2";

/** The version in an archive's name for release `tag`: `nightly`, or the tag without its `v`. */
export function versionOf(tag) {
  return tag === "nightly" ? "nightly" : tag.replace(/^v/, "");
}

/** The digest SHA256SUMS gives `name`, or null. */
export function sumFor(sums, name) {
  for (const line of sums.split("\n")) {
    const [digest, file] = line.trim().split(/\s+\*?/);
    if (file === name && /^[0-9a-f]{64}$/.test(digest)) return digest;
  }
  return null;
}

/** The releases of `kind` to pick from: their tags, newest first, `nightly` among them when it is there. */
export async function listArchives(api, kind) {
  const releases = (await api(`/repos/${KINDS[kind].repo}/releases?per_page=30`)) ?? [];
  return releases
    .filter((release) => !release.draft && release.assets.some((asset) => asset.name === KINDS[kind].asset(versionOf(release.tag_name))))
    .map((release) => ({ tag: release.tag_name, prerelease: release.prerelease, published: release.published_at }));
}

/**
 * The unpacked archives of this server, by kind and release tag. `cache` is where they live; `api` is GitHub's, and
 * `fetch` downloads the assets (both replaceable for tests).
 */
export function archives({ cache, api, fetch = globalThis.fetch }) {
  const pending = new Map();

  async function unpack(kind, tag) {
    const { repo, asset, program } = KINDS[kind];
    const release = await api(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
    if (!release) throw new RefError(404, `${repo} has no release ${tag}`);
    const name = asset(versionOf(tag));
    const archive = release.assets.find((a) => a.name === name);
    const sumsAsset = release.assets.find((a) => a.name === "SHA256SUMS");
    if (!archive || !sumsAsset) throw new RefError(404, `${repo} ${tag} has no ${name} with its SHA256SUMS`);
    const download = async (url) => {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new RefError(502, `downloading ${url}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const sums = new TextDecoder().decode(await download(sumsAsset.browser_download_url));
    const expected = sumFor(sums, name);
    const bytes = await download(archive.browser_download_url);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (!expected || digest !== expected) throw new RefError(502, `${name} is ${digest}; SHA256SUMS says ${expected ?? "nothing"}`);
    const dir = join(cache, `${kind}-${digest}`);
    const done = join(dir, ".unpacked");
    if (!(await stat(done).then(() => true, () => false))) {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      await untar(zstdDecompressSync(bytes), dir);
      await writeFile(done, tag);
    }
    let core = null;
    if (kind === "core") {
      core = JSON.parse(await readFile(join(dir, "sidevoice-core-rust/native-core.json"), "utf8"));
      if (core.kind !== ROOM_ONLY) {
        throw new RefError(409, `core ${tag} is a ${core.kind} core, which runs models: only ${ROOM_ONLY} (room-only) cores run in this pod`);
      }
    }
    return { kind, tag, digest, dir, program: join(dir, program), source: core?.source_sha ?? null };
  }

  return {
    /** The unpacked archive of `kind` (`core`, `connector`) at release `tag`, downloaded the first time. */
    get(kind, tag) {
      if (!KINDS[kind]) throw new RefError(400, `no such kind: ${kind}`);
      if (typeof tag !== "string" || !/^(nightly|v[\w.+-]+)$/.test(tag)) throw new RefError(400, `not a release: ${tag}`);
      const key = `${kind}/${tag}`;
      // A nightly moves: it is asked again each time; a version never does.
      if (tag === "nightly" || !pending.has(key)) {
        const promise = unpack(kind, tag);
        pending.set(key, promise);
        promise.catch(() => pending.delete(key));
      }
      return pending.get(key);
    },
  };
}

/** Unpacks a tar held in memory into `dir`, with the system's tar. */
function untar(bytes, dir) {
  return new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-x", "-C", dir], { stdio: ["pipe", "ignore", "pipe"] });
    let error = "";
    tar.stderr.on("data", (chunk) => (error += chunk));
    tar.on("error", reject);
    tar.on("close", (code) => (code === 0 ? resolve() : reject(new RefError(502, `tar: ${error.trim()}`))));
    tar.stdin.end(bytes);
  });
}
