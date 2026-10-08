import { test } from "node:test";
import assert from "node:assert/strict";
import { unzip } from "../zip.mjs";
import { zip } from "./zip-fixture.mjs";

test("a zip's files come out whole, stored or deflated", () => {
  for (const deflate of [true, false]) {
    const files = unzip(zip({ "sidevoice-engine-0.1.0.tgz": "tarball bytes ".repeat(100), "dir/note.txt": "hi" }, { deflate }));
    assert.equal(new TextDecoder().decode(files.get("sidevoice-engine-0.1.0.tgz")), "tarball bytes ".repeat(100));
    assert.equal(new TextDecoder().decode(files.get("dir/note.txt")), "hi");
  }
});

test("what is not a zip is refused", () => {
  assert.throws(() => unzip(new Uint8Array(100)), /no end of central directory/);
});
