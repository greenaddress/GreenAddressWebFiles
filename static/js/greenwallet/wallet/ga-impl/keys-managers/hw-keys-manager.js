var BaseKeysManager = require('./base-keys-manager');
var extend = require('xtend/mutable');

module.exports = HWKeysManager;

HWKeysManager.prototype = Object.create(BaseKeysManager.prototype);
extend(HWKeysManager.prototype, {
  _getKey: _getKey,
  getSubaccountRootKey: getSubaccountRootKey,
  _getSubaccountPrefix: _getSubaccountPrefix
});

function HWKeysManager (options) {
  this.gaService = options.gaService;

  // optimisation for non-subaccounts subkeys and slow hardware wallets
  // (we don't need the priv-derivation to derive non-subaccount subkeys)
  this.pubHDWallet = options.pubHDWallet;
  this.hw = options.hw;
}

function _getSubaccountPrefix (subaccountPointer, suffix) {
  suffix = suffix || '';
  return subaccountPointer
    ? "3'/" + subaccountPointer + "'" + suffix
    : '';
}

function getSubaccountRootKey (subaccountPointer) {
  // TODO caching
  if (subaccountPointer) {
    return this.hw.getPublicKey(this._getSubaccountPrefix(subaccountPointer));
  } else {
    return Promise.resolve(this.pubHDWallet);
  }
}

function _getKey (signing, subaccountPointer, pointer, keyBranch) {
  if (signing) {
    throw new Error('Signing keys are not implemented for HW wallets!');
  }
  if (keyBranch === 5) {
    throw new Error('Scanning keys are not implemented for HW wallets!');
  }
  if (keyBranch === undefined) {
    keyBranch = 1; // REGULAR
  }
  if (keyBranch === 2) {
    // priv derived
    return this.hw.getPublicKey(
      this._getSubaccountPrefix(subaccountPointer, '/') +
      keyBranch + "'/" + pointer + "'"
    );
  }
  var key;
  if (subaccountPointer) {
    key = this.getSubaccountRootKey(subaccountPointer);
  } else {
    key = Promise.resolve(this.pubHDWallet);
  }
  return key.then(function (hd) {
    return hd.derive(keyBranch);
  }).then(function (hd) {
    return hd.derive(pointer);
  });
}

