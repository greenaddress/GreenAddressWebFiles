var extend = require('xtend/mutable');

module.exports = HWKeysManager;

extend(HWKeysManager.prototype, {
  _getKey: _getKey,
  getSubaccountRootKey: getSubaccountRootKey
});

function HWKeysManager (options) {
  this.gaService = options.gaService;

  // optimisation for non-subaccounts subkeys and slow hardware wallets
  // (we don't need the priv-derivation to derive non-subaccount subkeys)
  this.pubHDWallet = options.pubHDWallet;
  this.hw = options.hw;
}

function getSubaccountRootKey (subaccountPointer) {
  throw new Error('not implemented');
}

function _getKey (signing, subaccountPointer, pointer, keyBranch) {
  throw new Error('not implemented');
}

