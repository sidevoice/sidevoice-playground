// The page as an engine host: what `WebEngine.create(host)` asks of it (the engine's src/web/host.rs). Only
// capabilities are bridged in the engine so far; storage and downloads are not.

/** `{ os, arch, accelerators, memoryMb?, cores? }`, the shape the engine reads strictly. */
export async function browserCapabilities(nav = globalThis.navigator) {
  const accelerators = ["wasm"];
  if (nav?.gpu && (await nav.gpu.requestAdapter().catch(() => null))) accelerators.unshift("webgpu");
  return {
    os: "web",
    arch: "wasm32",
    accelerators,
    // navigator.deviceMemory is in GiB, rounded and capped by the browser; absent outside Chromium.
    memoryMb: nav?.deviceMemory ? Math.round(nav.deviceMemory * 1024) : undefined,
    cores: nav?.hardwareConcurrency || undefined,
  };
}

export function browserHost() {
  return { capabilities: () => browserCapabilities() };
}
