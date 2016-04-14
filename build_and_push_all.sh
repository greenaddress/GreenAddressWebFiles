#!/bin/bash

MSG=$(git log --format=%B -n 1 $TRAVIS_COMMIT)

[ "$MSG" != "Updated locale" ] || exit 1

git config --global user.email "info@greenaddress.it"
git config --global user.name "GreenAddress"

tar -xf keys.tar

eval "$(ssh-agent -s)"
ssh-add crx

git clone git@github.com:greenaddress/WalletCrx.git
cp WalletCrx/static/wallet/config{,_regtest,_testnet}.js /tmp
cp WalletCrx/static/wallet/network{,_regtest,_testnet}.js /tmp
python render_templates.py WalletCrx
rm -rf WalletCrx/static
cp -r static WalletCrx/static
rm -rf WalletCrx/static/fonts/*.svg  # .woff are enough for crx
rm -rf WalletCrx/static/sound/*.wav  # .mp3 are enough for crx
rm WalletCrx/static/js/cdv-plugin-fb-connect.js  # cordova only
rm WalletCrx/static/js/facebook-js-sdk.js  # cordova only
rm WalletCrx/static/js/common_cordova_handlers.js  # cordova only
rm WalletCrx/static/js/{greenaddress,instant}.js  # web only
mkdir -p WalletCrx/static/wallet >/dev/null
mv /tmp/config{,_regtest,_testnet}.js WalletCrx/static/wallet/
mv /tmp/network{,_regtest,_testnet}.js WalletCrx/static/wallet/

cd WalletCrx
git add --all .
git commit -m"$MSG"
git push
cd ..



ssh-agent -k
eval "$(ssh-agent -s)"
ssh-add cordova

git clone git@github.com:greenaddress/WalletCordova.git
cp WalletCordova/www/greenaddress.it/static/wallet/network.js /tmp/network.js
cp WalletCordova/www/greenaddress.it/static/wallet/config.js /tmp/config.js
python render_templates.py -a WalletCordova/www/greenaddress.it
rm -rf WalletCordova/www/greenaddress.it/static
cp -r static WalletCordova/www/greenaddress.it/static
rm -rf WalletCordova/www/greenaddress.it/static/js/jsqrcode  # crx only
rm -rf WalletCordova/www/greenaddress.it/static/js/btchip-js-api  # crx only

# Cordova actually requires a subset of btchip files:
mkdir -p WalletCordova/www/greenaddress.it/static/js/btchip-js-api/api
mkdir -p WalletCordova/www/greenaddress.it/static/js/btchip-js-api/thirdparty
cp static/js/btchip-js-api/api/{ByteString,Convert,GlobalConstants.js} WalletCordova/www/greenaddress.it/static/js/btchip-js-api/api
cp -r static/js/btchip-js-api/thirdparty/{async,class,q} WalletCordova/www/greenaddress.it/static/js/btchip-js-api/thirdparty

rm WalletCordova/static/js/{greenaddress,instant}.js  # web only
mkdir -p WalletCordova/www/greenaddress.it/static/wallet >/dev/null
mv /tmp/config.js WalletCordova/www/greenaddress.it/static/wallet/config.js
mv /tmp/network.js WalletCordova/www/greenaddress.it/static/wallet/network.js

cd WalletCordova
git add --all .
git commit -m"$MSG"
git push
cd ..



ssh-agent -k
eval "$(ssh-agent -s)"
ssh-add webfiles

git clone git@github.com:greenaddress/GreenAddressWebFiles.git
cp -r locale GreenAddressWebFiles

cd GreenAddressWebFiles
git add locale
git commit -m"Updated locale"
git push
