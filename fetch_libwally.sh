#!/bin/bash

set -e

# Add the wally plugin:
if [ \! -e libwally-core ]; then
    git clone https://github.com/ElementsProject/libwally-core.git libwally-core
    (cd libwally-core && git checkout f76881286d979b0592996fa3c57dc02e6faec443)
fi
