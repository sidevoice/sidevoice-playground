// Just enough of gzip + ustar to read an npm package tarball: regular files only, by path.

/**
 * @param {Uint8Array} gz
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function untgz(gz) {
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
  return untar(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/**
 * @param {Uint8Array} tar
 * @returns {Map<string, Uint8Array>}
 */
export function untar(tar) {
  const files = new Map();
  const decoder = new TextDecoder();
  const field = (at, len) => decoder.decode(tar.subarray(at, at + len)).replace(/\0.*$/s, "");
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = field(offset, 100);
    const prefix = field(offset + 345, 155);
    const size = parseInt(field(offset + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const path = prefix ? `${prefix}/${name}` : name;
    const start = offset + 512;
    if (start + size > tar.length) throw new Error(`truncated tarball at ${path}`);
    if (type === "0") files.set(path, tar.slice(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return files;
}
