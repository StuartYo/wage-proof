#!/usr/bin/env bash
# Build CosmWasm contracts (Rust 1.78 on E:), shrink with wasm-opt, write checksums.
# Usage: bash scripts/cw-build.sh [crate ...]   (default: all workspace crates)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/rustenv.sh
crates=("$@"); [ ${#crates[@]} -eq 0 ] && crates=(wage-proof-cw wage-proof-registry)
mkdir -p cw/artifacts
for c in "${crates[@]}"; do
  [ -d "cw/$c" ] || continue
  (cd cw && RUSTFLAGS='-C link-arg=-s' cargo build --release --locked --target wasm32-unknown-unknown -p "$c")
  name=${c//-/_}
  # --signext-lowering: keep only MVP opcodes so wasmvm 1.4.1 accepts the module
  npx --no-install wasm-opt -Oz --signext-lowering "cw/target/wasm32-unknown-unknown/release/$name.wasm" -o "cw/artifacts/$name.wasm"
done
(cd cw/artifacts && sha256sum *.wasm > checksums.txt && ls -l *.wasm && cat checksums.txt)
