#!/bin/bash

set -e

# Add the wally plugin:
if [ \! -e libwally-core ]; then
    git clone https://github.com/greenaddress/libwally-core.git libwally-core
    (cd libwally-core && git checkout e942864f73d76f372dfeee6d1c7aa048c5b8b5c2)
fi
