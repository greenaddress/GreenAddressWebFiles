#!/bin/bash

set -e

# Add the wally plugin:
if [ \! -e libwally-core ]; then
    git clone https://github.com/ElementsProject/libwally-core.git libwally-core
    (cd libwally-core && git checkout de8ae9c474f362577e315a15967ea8172ca819aa)
fi
