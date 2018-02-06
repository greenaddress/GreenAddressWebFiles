#!/bin/bash

set -e

# Add the wally plugin:
if [ \! -e libwally-core ]; then
    git clone https://github.com/ElementsProject/libwally-core.git libwally-core
    (cd libwally-core && git checkout 482e2da273275e99013aecf84c4f9df95f895ab3)

fi
# Build the wally plugin
./prepare_wally.sh

export LIBWALLY_DIR="$PWD/libwally-core"

yarn install
yarn run build
yarn run test
