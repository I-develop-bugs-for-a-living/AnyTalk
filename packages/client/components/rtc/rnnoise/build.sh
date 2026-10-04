#!/usr/bin/env bash
# Builds wasm/RNNoiseWorklet.js and wasm/rnnoise.wasm from xiph/rnnoise.
#
# Needs emcc (Emscripten) on the PATH plus autoconf, automake, libtool and wget.
# The output is committed, so this only has to run when changing the worklet
# or updating RNNoise.
#
# Usage: ./build.sh [little]
#   little: use the smaller, lower quality model

set -euo pipefail

# upstream main, has newer models than the v0.2 release
RNNOISE_COMMIT=70f1d25

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --quiet https://gitlab.xiph.org/xiph/rnnoise.git "$work/rnnoise"
cd "$work/rnnoise"
git checkout --quiet "$RNNOISE_COMMIT"

# also downloads and checks the model
./autogen.sh

if [[ "${1:-}" == "little" ]]; then
  mv src/rnnoise_data_little.c src/rnnoise_data.c
  mv src/rnnoise_data_little.h src/rnnoise_data.h
fi

emconfigure ./configure CFLAGS=-O3 --disable-shared --disable-examples \
  --disable-doc --host=x86_64-unknown-linux-gnu
emmake make -j"$(nproc)"

mkdir -p "$here/wasm"
emcc -O3 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createRNNWasmModule \
  -s ENVIRONMENT=worklet \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MALLOC=emmalloc \
  -s STACK_SIZE=524288 \
  -s EXPORTED_FUNCTIONS="['_rnnoise_process_frame','_rnnoise_create','_rnnoise_destroy','_malloc','_free']" \
  -s EXPORTED_RUNTIME_METHODS="['HEAPF32']" \
  --extern-post-js "$here/worklet.js" \
  .libs/librnnoise.a \
  -o "$here/wasm/RNNoiseWorklet.js"

mv "$here/wasm/RNNoiseWorklet.wasm" "$here/wasm/rnnoise.wasm"
cp COPYING "$here/wasm/RNNOISE-COPYING"
ls -l "$here/wasm"
