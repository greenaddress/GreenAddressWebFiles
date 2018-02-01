#!/usr/bin/env bash
set -e

sed -i 's/deb.debian.org/httpredir.debian.org/g' /etc/apt/sources.list
apt-get -yqq update && apt-get -yqq upgrade
apt-get -yqq install unzip git curl build-essential python-virtualenv python-pip make swig autoconf libtool pkg-config lib32z1 python-dev libffi-dev virtualenv
curl -sL https://deb.nodesource.com/setup_8.x | bash -
curl -sL https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
apt-get -yqq update
apt-get -yqq install nodejs yarn
if [ -f /.dockerenv ]; then
    rm -rf /var/lib/apt/lists/* /var/cache/* /tmp/* /usr/share/locale/* /usr/share/man /usr/share/doc /lib/xtables/libip6*
fi
