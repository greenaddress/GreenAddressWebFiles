#!/usr/bin/env bash
set -e

sed -i 's/deb.debian.org/httpredir.debian.org/g' /etc/apt/sources.list
apt-get -yqq update && apt-get -yqq upgrade
apt-get -yqq install unzip git curl build-essential python-virtualenv python-pip make swig autoconf libtool pkg-config lib32z1 python-dev libffi-dev virtualenv
curl -sL https://deb.nodesource.com/setup_8.x | bash -
apt-get -yqq update
apt-get -yqq install nodejs
if [ -f /.dockerenv ]; then
    rm -rf /var/lib/apt/lists/* /var/cache/* /tmp/* /usr/share/locale/* /usr/share/man /usr/share/doc /lib/xtables/libip6*
fi
