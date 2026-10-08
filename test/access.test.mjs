import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessToken, gate } from "../access.mjs";

const request = (url, cookie) => ({ url, headers: cookie ? { cookie } : {} });

test("each start makes a new token, 32 random bytes in base64url, written over a file only its owner reads", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "playground-access-")), "secrets", "token");
  const token = await accessToken(file);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await readFile(file, "utf8")).trim(), token);
  const next = await accessToken(file);
  assert.notEqual(next, token);
  assert.equal((await readFile(file, "utf8")).trim(), next);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("every request needs the cookie, which the token in the URL sets once", () => {
  const token = "a".repeat(43);
  const { check } = gate(token);
  assert.deepEqual(check(request("/")), { ok: false });
  assert.deepEqual(check(request("/fetch?url=x")), { ok: false });
  assert.deepEqual(check(request(`/?access=${"b".repeat(43)}`)), { ok: false });
  assert.deepEqual(check(request("/?access=")), { ok: false });

  const opened = check(request(`/app.mjs?x=1&access=${token}`));
  assert.equal(opened.redirect, "/app.mjs?x=1");
  assert.match(opened.cookie, /; HttpOnly; Secure; SameSite=Strict; Path=\/$/);
  assert.ok(!opened.cookie.includes(token), "the cookie does not carry the token");

  const cookie = opened.cookie.split(";")[0];
  assert.deepEqual(check(request("/local-engine.json", `other=1; ${cookie}`)), { ok: true });
  assert.deepEqual(check(request("/", `${cookie}x`)), { ok: false });
  assert.deepEqual(check(request("/", cookie.replace(/=.*/, "=nope"))), { ok: false });
});
