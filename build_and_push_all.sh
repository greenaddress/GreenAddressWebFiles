#!/bin/bash

MSG=$(git log --format=%B -n 1 $TRAVIS_COMMIT)
git config --global user.email "info@greenaddress.it"
git config --global user.name "GreenAddress"

tar -xf keys.tar

eval "$(ssh-agent -s)"
ssh-add crx

git clone git@github.com:greenaddress/WalletCrx.git
python render_templates.py WalletCrx
cp -r static WalletCrx

cd WalletCrx
git add .
git commit -m"$MSG"
git push
cd ..



ssh-agent -k
eval "$(ssh-agent -s)"
ssh-add cordova

git clone git@github.com:greenaddress/WalletCordova.git
python render_templates.py -a WalletCordova/www/greenaddress.it
cp -r static WalletCordova/www/greenaddress.it

cd WalletCordova
git add .
git commit -m"$MSG"
git push