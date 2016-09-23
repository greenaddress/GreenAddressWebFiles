var BaseKeysManager = require('./base-keys-manager');
var branches = require('../branches');
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
    return this.privHDWallet.deriveHardened(branches.SUBACCOUNT).then(function (hd) {
      return hd.deriveHardened(subaccountPointer);
    });
  } else {
    return Promise.resolve(this.privHDWallet);
  }
}

function _getKey (signing, subaccountPointer, pointer, keyBranch) {
  if (keyBranch === undefined) {
    keyBranch = branches.REGULAR;
  }
  var key;
  var privDer = (keyBranch === branches.BLINDED || keyBranch === branches.EXTERNAL);
  if (subaccountPointer) {
    key = this.getSubaccountRootKey(subaccountPointer);
    if (!(privDer || signing)) {
      key = key.then(function (hd) {
        return hd.neutered();
      });
    }
  } else {
    key = Promise.resolve((privDer || signing) ? this.privHDWallet : this.pubHDWallet);
  }
  var deriveFuncName;
  if (privDer) {
    // priv-derived and scanning keys are all hardened
    deriveFuncName = 'deriveHardened';
  } else {
    deriveFuncName = 'derive';
  }
  return key.then(function (hd) {
    return hd[deriveFuncName](keyBranch);
  }).then(function (hd) {
    return hd[deriveFuncName](pointer);
  }).then(function (hd) {
    if (!signing) {
      return hd.neutered();
    }
    return hd;
  });
}

function getMyPrivateKey (subaccountPointer, pointer, branch) {
  // always priv, even when it's not a subaccount
  return this._getKey(true, subaccountPointer, pointer, branch);
}

function getMyScanningKey (subaccountPointer, pointer) {
  // always priv, even when it's not a subaccount
  return this._getKey(true, subaccountPointer, pointer, branches.BLINDED);
}

function getUtxoPrivateKey (utxo) {
  return this.getMyPrivateKey(
    utxo.subaccount.pointer, utxo.raw.pointer, utxo.raw.branch
  );
}
