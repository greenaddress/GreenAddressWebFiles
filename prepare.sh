#!/bin/bash

set -e

./fetch_libwally.sh

# Build the wally plugin
./prepare_wally.sh

export LIBWALLY_DIR="$PWD/libwally-core"

yarn install
yarn run build
yarn run test
