// Reading a zip file, enough for a GitHub Actions artifact: its central directory, stored and deflated entries.

import { inflateRawSync } from "node:zlib";

/** Each file in the zip `bytes`, by name. */
export function unzip(bytes) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(data);
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(at) !== 0x02014b50) throw new Error("zip: broken central directory");
    const method = data.readUInt16LE(at + 10);
    const compressed = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const [nameLength, extraLength, commentLength] = [28, 30, 32].map((o) => data.readUInt16LE(at + o));
    const local = data.readUInt32LE(at + 42);
    const name = data.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (compressed === 0xffffffff || size === 0xffffffff) throw new Error(`zip: ${name} needs zip64`);

    if (data.readUInt32LE(local) !== 0x04034b50) throw new Error(`zip: ${name} has no local header`);
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + compressed);
    let file;
    if (method === 0) file = raw;
    else if (method === 8) file = inflateRawSync(raw);
    else throw new Error(`zip: ${name} uses compression method ${method}`);
    if (file.length !== size) throw new Error(`zip: ${name} is ${file.length} bytes, its header says ${size}`);
    files.set(name, new Uint8Array(file));
  }
  return files;
}

function findEnd(data) {
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 0xffff); at--) {
    if (data.readUInt32LE(at) === 0x06054b50) return at;
  }
  throw new Error("zip: no end of central directory");
}
