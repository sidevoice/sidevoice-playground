// The access gate: the playground is reachable from outside through a tunnel, so every route asks for a secret.
// A random token (32 bytes, base64url) is made at each start and lives in memory: a restart invalidates the last
// one. It is also written over a file only its owner can read, for whoever hands it out. It is accepted
// once as `?access=<token>` on any URL, which sets a cookie (HttpOnly, Secure, SameSite=Strict) and redirects to the
// same URL without it; from then on every request needs the cookie, and any other gets 401. The cookie carries a
// value derived from the token, not the token itself. Comparisons are constant-time. Nothing here logs the token.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_ACCESS_FILE = join(homedir(), ".agent/secrets/sidevoice-playground-access");
const COOKIE = "playground_access";

/** A new token, written over `file` (mode 600) for whoever hands it out. */
export async function accessToken(file = DEFAULT_ACCESS_FILE) {
  const token = randomBytes(32).toString("base64url");
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const scratch = `${file}.${process.pid}.tmp`;
  await writeFile(scratch, `${token}\n`, { mode: 0o600 });
  await chmod(scratch, 0o600);
  await rename(scratch, file);
  return token;
}

/**
 * A gate for `token`: `check(req)` says what to do with a request — `{ ok: true }`, `{ redirect, cookie }` when it
 * presents the token in the URL, or `{ ok: false }`.
 */
export function gate(token) {
  const cookieValue = createHmac("sha256", token).update("sidevoice-playground cookie").digest("base64url");
  const cookie = `${COOKIE}=${cookieValue}; HttpOnly; Secure; SameSite=Strict; Path=/`;
  return {
    check(req) {
      const url = new URL(req.url, "http://localhost");
      const offered = url.searchParams.get("access");
      if (offered !== null) {
        if (!same(offered, token)) return { ok: false };
        url.searchParams.delete("access");
        return { redirect: url.pathname + url.search, cookie };
      }
      return { ok: same(readCookie(req.headers.cookie, COOKIE), cookieValue) };
    },
  };
}

function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

/** Whether `a` equals `b`, in time independent of where they differ (both hashed to the same length first). */
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const digest = (text) => createHmac("sha256", "compare").update(text).digest();
  return timingSafeEqual(digest(a), digest(b)) && a.length === b.length;
}
