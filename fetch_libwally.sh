#!/bin/bash

set -e

# Add the wally plugin:
if [ \! -e libwally-core ]; then
    git clone https://github.com/ElementsProject/libwally-core.git libwally-core
    (cd libwally-core && git checkout 85596bc1b80b5336ca843b5306e8d0d655185195)
fi
