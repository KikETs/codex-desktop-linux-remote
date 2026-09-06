#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
mkdir -p build
args=(-std=c++17 -O2 -Wall -Wextra -Werror -Ivendor/root/usr/include src/tpm-key.cpp
      -l:libtss2-esys.so.0 -l:libtss2-mu.so.0 -l:libtss2-tctildr.so.0)
g++ "${args[@]}" -o build/tpm-key
g++ -DRC_TEST_TPM "${args[@]}" -o build/tpm-key-test
chmod 700 build/tpm-key build/tpm-key-test
