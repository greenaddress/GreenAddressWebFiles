#!/bin/bash

set -e

if [ "$(uname -s)" == "Darwin" ]; then
    OSX=true
fi

APPDIR=$PWD
READLINK=readlink
if which greadlink; then
    READLINK=greadlink
elif [ -n "$OSX" ]; then
    echo "greadlink missing! Try brew install coreutils."
    exit 1
fi

cd libwally-core
source ./tools/android_helpers.sh

all_archs=$(android_get_arch_list)
if [ -n "$1" ]; then
    all_archs="$1"
fi

echo '============================================================'
echo 'Initialising build:'
echo '============================================================'
tools/cleanup.sh
tools/autogen.sh

configure_opts="--disable-dependency-tracking --enable-js-wrappers --disable-swig-java --disable-swig-python"

./configure $configure_opts
make clean
make >& /dev/null
cd ..
