#!/bin/bash

set -e

# Add the wally plugin:
if [ \! -e libwally-core ]; then
    git clone https://github.com/greenaddress/libwally-core.git libwally-core
    (cd libwally-core && git checkout f1c45e22bf16ddabea441fd1e09819b7e680e863)
fi
