// Immutable candidate binaries for the real-room preview. Only a full commit is accepted;
// the source and resulting executable live below the preview cache, never in a live checkout.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RefError } from "../refs.mjs";
import { runner } from "./web-build.mjs";

export const SOURCE = {
  core: { repo: "sidevoice/sidevoice-core", bin: "sidevoice-core-rust" },
  connector: { repo: "sidevoice/sidevoice-connector", bin: "sidevoice-connector" },
};

export function sourceBuilds({ cache, api, log = () => {}, run = runner(log) }) {
  const pending = new Map();
  async function get(kind, ref) {
    const spec = SOURCE[kind];
    if (!spec || !/^[0-9a-f]{40}$/.test(ref)) throw new RefError(400, "source builds require a full 40-character SHA");
    const commit = await api(`/repos/${spec.repo}/commits/${ref}`);
    if (commit?.sha !== ref) throw new RefError(404, `${spec.repo} does not resolve to ${ref}`);
    const key = `${kind}-${ref}`;
    if (!pending.has(key)) {
      const task = build(spec, kind, ref);
      pending.set(key, task);
      task.catch(() => pending.delete(key));
    }
    return pending.get(key);
  }
  async function build(spec, kind, sha) {
    const dir = join(cache, "source-builds", `${kind}-${sha}`);
    const program = join(dir, "target/release", spec.bin);
    if (!(await stat(program).then(() => true, () => false))) {
      const fetched = await readFile(join(dir, ".git/FETCH_HEAD"), "utf8").catch(() => "");
      if (fetched.slice(0, 40) !== sha) {
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        await run("git", ["init", "-q", dir]);
        await run("git", ["-C", dir, "remote", "add", "origin", `https://github.com/${spec.repo}.git`]);
        await run("git", ["-C", dir, "fetch", "--depth", "1", "origin", sha]);
        await run("git", ["-C", dir, "checkout", "--detach", "FETCH_HEAD"]);
      }
      const actual = (await readFile(join(dir, ".git/FETCH_HEAD"), "utf8")).slice(0, 40);
      if (actual !== sha) throw new RefError(409, `fetched ${actual}, expected ${sha}`);
      log(`Source-building ${spec.repo}@${sha}; the first Rust build can take several minutes…`);
      await run("cargo", ["build", "--locked", "--release", "--bin", spec.bin], { cwd: dir });
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(program)) hash.update(chunk);
    const digest = hash.digest("hex");
    await writeFile(join(dir, "binary.json"), JSON.stringify({ sha, digest, kind }));
    return { kind, tag: `sha:${sha}`, source: sha, digest, program, dir };
  }
  return { get };
}
