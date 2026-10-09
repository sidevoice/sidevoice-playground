#!/bin/sh
# Builds the native runner at one sidevoice-engine commit: writes the template out into OUT (Cargo.toml with the
# commit filled in, the sources beside it), builds it with `cargo build --release` and leaves the binary at
# OUT/bin/sidevoice-engine-runner. Everything it does is printed, line by line; a missing tool is said with the
# command that installs it, and exits 3.
#
# sherpa-onnx's static libraries come as the engine documents for consumers: its own `cargo xtask sherpa-libs`, from
# the engine's source at that commit, checks them against the digests it pins and SHERPA_ONNX_LIB_DIR links them. An
# engine without that command leaves the download to the sherpa-onnx crate's build script, unchecked.
#
#   sh build.sh <engine commit sha> <OUT> [<cargo target directory, shared between builds>]

set -eu

REV=${1:-}
OUT=${2:-}
case $REV in
  "" | *[!0-9a-f]*) echo "error: not a commit sha: '$REV'"; exit 2 ;;
esac
[ ${#REV} = 40 ] || { echo "error: not a full commit sha: $REV"; exit 2; }
[ -n "$OUT" ] || { echo "usage: sh build.sh <engine commit sha> <OUT> [<target directory>]"; exit 2; }
TEMPLATE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
export CARGO_TARGET_DIR="${3:-$OUT/target}"

# An app started from the Finder gets no shell profile: where rustup and Homebrew put their tools.
PATH="$HOME/.cargo/bin:/opt/homebrew/opt/rustup/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

missing() {
  echo "error: $1"
  exit 3
}
command -v cargo >/dev/null 2>&1 || missing "cargo was not found. Install Rust: brew install rustup && rustup default stable"
command -v cmake >/dev/null 2>&1 || missing "cmake was not found (whisper.cpp is built with it). Install it: brew install cmake"
if [ "$(uname -s)" = Darwin ]; then
  xcrun --find clang >/dev/null 2>&1 || missing "no C/C++ compiler. Install Xcode's command line tools: xcode-select --install"
fi
echo "== $(cargo --version), $(cmake --version | head -n 1)"

echo "== the runner for sidevoice-engine $REV, in $OUT"
mkdir -p "$OUT/src/values" "$OUT/bin"
sed "s/@ENGINE_REV@/$REV/" "$TEMPLATE/Cargo.toml.in" > "$OUT/Cargo.toml"
cp "$TEMPLATE/build.rs" "$OUT/build.rs"
cp "$TEMPLATE/src/main.rs" "$TEMPLATE/src/values.rs" "$OUT/src/"
cp "$TEMPLATE/src/values/tests.rs" "$OUT/src/values/"

echo "== fetching the engine's source"
METADATA=$(cargo metadata --format-version 1 --manifest-path "$OUT/Cargo.toml")
ENGINE=$(printf '%s' "$METADATA" | grep -o '"manifest_path":"[^"]*/sidevoice-engine-[^"/]*/[^"/]*/Cargo.toml"' | head -n 1 \
  | sed 's/^"manifest_path":"//; s/\/Cargo.toml"$//')
echo "   $ENGINE"

if [ -n "$ENGINE" ] && [ -f "$ENGINE/xtask/sherpa-onnx-libs.json" ]; then
  echo "== sherpa-onnx's libraries (the engine's cargo xtask sherpa-libs)"
  if LIBS=$(cd "$ENGINE" && cargo run --quiet --locked --manifest-path xtask/Cargo.toml --no-default-features -- sherpa-libs); then
    SHERPA_ONNX_LIB_DIR=$(printf '%s\n' "$LIBS" | tail -n 1)
    export SHERPA_ONNX_LIB_DIR
    echo "   $SHERPA_ONNX_LIB_DIR"
  else
    echo "warning: cargo xtask sherpa-libs failed: the sherpa-onnx crate downloads its libraries itself, unchecked"
  fi
else
  echo "== this engine has no cargo xtask sherpa-libs: the sherpa-onnx crate downloads its libraries itself, unchecked"
fi

echo "== cargo build --release (the first build at a commit compiles whisper.cpp: minutes)"
cargo build --release --manifest-path "$OUT/Cargo.toml"
cp "$CARGO_TARGET_DIR/release/sidevoice-engine-runner" "$OUT/bin/sidevoice-engine-runner.part"
mv "$OUT/bin/sidevoice-engine-runner.part" "$OUT/bin/sidevoice-engine-runner"
echo "== built: $OUT/bin/sidevoice-engine-runner"
