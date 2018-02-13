#!/bin/bash

set -e

# Add the wally plugin:
if [ \! -e libwally-core ]; then
    git clone https://github.com/ElementsProject/libwally-core.git libwally-core
    (cd libwally-core && git checkout c628a5af1d9ede89d142d70abaf4c4f09f0e3bc9)
fi
