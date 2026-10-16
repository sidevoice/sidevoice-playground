// Where the Rust toolchain for source builds lives. It is configured explicitly, never found through the PATH this server
// happened to be started with (a supervisor or a stale shell may not have cargo on it).
//   SIDEVOICE_RUST_HOME   directory holding `rustup/` and `cargo/` (default ~/tools/rust)
//   SIDEVOICE_CC          C compiler/linker for crates that need one (default ~/tools/bin/zigcc when present)
//   SIDEVOICE_AR          archiver for those crates' C code (default ~/tools/bin/zigar when present: the pod has no ar)
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { RefError } from "../refs.mjs";

const executable = (path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };

/** `{ cargo, env }` for a cargo build, or a RefError saying exactly what is missing. */
export function rustToolchain(source = process.env) {
  const home = source.SIDEVOICE_RUST_HOME || join(homedir(), "tools/rust");
  const cargoHome = join(home, "cargo");
  const cargo = join(cargoHome, "bin/cargo");
  if (!executable(cargo)) throw new RefError(500, `cargo not found at ${cargo}; install the Rust toolchain there or set SIDEVOICE_RUST_HOME to the directory holding rustup/ and cargo/`);
  const env = { RUSTUP_HOME: join(home, "rustup"), CARGO_HOME: cargoHome, PATH: [join(cargoHome, "bin"), source.PATH].filter(Boolean).join(delimiter) };
  const cc = source.SIDEVOICE_CC || join(homedir(), "tools/bin/zigcc");
  if (executable(cc)) {
    env.CC = cc;
    env.CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER = cc;
  } else if (source.SIDEVOICE_CC) throw new RefError(500, `SIDEVOICE_CC=${cc} is not executable`);
  const ar = source.SIDEVOICE_AR || join(homedir(), "tools/bin/zigar");
  if (executable(ar)) env.AR = ar;
  else if (source.SIDEVOICE_AR) throw new RefError(500, `SIDEVOICE_AR=${ar} is not executable`);
  return { cargo, env };
}
