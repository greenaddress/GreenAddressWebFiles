var BaseKeysManager = require('./base-keys-manager');
var extend = require('xtend/mutable');

module.exports = SWKeysManager;

SWKeysManager.prototype = Object.create(BaseKeysManager.prototype);
extend(SWKeysManager.prototype, {
  _getKey: _getKey,
  getMyPrivateKey: getMyPrivateKey,
  getMyScanningKey: getMyScanningKey,
  getSubaccountRootKey: getSubaccountRootKey,
  getUtxoPrivateKey: getUtxoPrivateKey
});

function SWKeysManager (options) {
  BaseKeysManager.call(this, options);

  this.privHDWallet = options.privHDWallet;
}

function getSubaccountRootKey (subaccountPointer) {
  if (subaccountPointer) {
    return this.privHDWallet.deriveHardened(3).then(function (hd) {
      return hd.deriveHardened(subaccountPointer);
    });
  } else {
    return Promise.resolve(this.privHDWallet);
  }
}

function _getKey (signing, subaccountPointer, pointer, keyBranch) {
  if (keyBranch === undefined) {
    keyBranch = 1; // REGULAR
  }
  var key;
  if (subaccountPointer) {
    key = this.getSubaccountRootKey(subaccountPointer);
    if (!signing) {
      key = key.then(function (hd) {
        return hd.neutered();
      });
    }
  } else {
    key = Promise.resolve(signing ? this.privHDWallet : this.pubHDWallet);
  }
  var deriveFuncName;
  if (keyBranch === 5) {
    // scanning keys are all hardened
    deriveFuncName = 'deriveHardened';
  } else {
    deriveFuncName = 'derive';
  }
  return key.then(function (hd) {
    return hd[deriveFuncName](keyBranch);
  }).then(function (hd) {
    return hd[deriveFuncName](pointer);
  });
}

function getMyPrivateKey (subaccountPointer, pointer) {
  // always priv, even when it's not a subaccount
  return this._getKey(true, subaccountPointer, pointer);
}

function getMyScanningKey (subaccountPointer, pointer) {
  // always priv, even when it's not a subaccount
  return this._getKey(true, subaccountPointer, pointer, 5 /* = BLINDED branch */);
}

function getUtxoPrivateKey (utxo) {
  return this.getMyPrivateKey(
    utxo.subaccount.pointer, utxo.raw.pointer
  );
}
