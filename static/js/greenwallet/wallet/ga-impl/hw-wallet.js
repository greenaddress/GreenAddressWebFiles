var extend = require('xtend/mutable');

module.exports = HWWallet;

HWWallet.register = register;
HWWallet.registerError = registerError;
HWWallet.currentWallet = new Promise(function (resolve, reject) {
  HWWallet.resolveCurrentWallet = resolve;
  HWWallet.rejectCurrentWallet = reject;
});

function HWWallet () {
}

function register (wallet) {
  if (HWWallet.resolveCurrentWallet) {
    HWWallet.resolveCurrentWallet(wallet);
    HWWallet.resolveCurrentWallet = null;
  }
}

function registerError (error) {
  if (HWWallet.resolveCurrentWallet) {
    HWWallet.rejectCurrentWallet(error);

    // create a new promise after the old one got rejected:
    HWWallet.currentWallet = new Promise(function (resolve, reject) {
      HWWallet.resolveCurrentWallet = resolve;
      HWWallet.rejectCurrentWallet = reject;
    });
  }
}
