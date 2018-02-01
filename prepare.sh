#!/bin/bash

set -e

# Add the wally plugin:
if [ \! -e libwally-core ]; then
    git clone https://github.com/ElementsProject/libwally-core -b master --depth 1
fi
# Build the wally plugin
./prepare_wally.sh

export LIBWALLY_DIR="$PWD/libwally-core"

yarn install
yarn run build
yarn run test
