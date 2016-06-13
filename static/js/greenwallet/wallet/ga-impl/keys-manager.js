var BigInteger = require('bigi');
var extend = require('xtend/mutable');

module.exports = GAKeysManager;

extend(GAKeysManager.prototype, {
  _getKey: _getKey,
  getGAPublicKey: getGAPublicKey,
  getMyPublicKey: getMyPublicKey,
  getMyPrivateKey: getMyPrivateKey,
  getMyScanningKey: getMyScanningKey,
  getSubaccountRootKey: getSubaccountRootKey
});

function GAKeysManager (options) {
  this.gaHDNode = options.gaService.gaHDNode;
  this.gaUserPath = options.gaService.gaUserPath;

  // optimisation for non-subaccounts subkeys and slow hardware wallets
  // (we don't need the priv-derivation to derive non-subaccount subkeys)
  this.pubHDWallet = options.pubHDWallet;
  this.privHDWallet = options.privHDWallet;
}

function _subpath (hd, pathBuffer) {
  var copy = new Buffer(pathBuffer);
  for (var i = 0; i < 32; i++) {
    hd = hd.derive(+BigInteger.fromBuffer(copy.slice(0, 2)));
    copy = copy.slice(2);
  }
  return hd;
}

function getGAPublicKey (subaccountPointer, pointer) {
  var gaNode = this.gaHDNode;
  if (subaccountPointer) {
    gaNode = _subpath(gaNode.derive(3), this.gaUserPath).derive(subaccountPointer);
  } else {
    gaNode = _subpath(gaNode.derive(1), this.gaUserPath);
  }
  return gaNode.derive(pointer);
}

function getSubaccountRootKey (subaccountPointer) {
  return this.privHDWallet.deriveHardened(3).then(function (hd) {
    return hd.deriveHardened(subaccountPointer);
  });
}

function _getKey (signing, subaccountPointer, pointer, keyBranch) {
  if (keyBranch === undefined) {
    keyBranch = 1; // REGULAR
  }
  var key;
  // TODO: subaccount key caching (to avoid deriving via hw wallet multiple times)
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
  }.bind(this));
}

function getMyPublicKey (subaccountPointer, pointer) {
  // priv only for subaccounts -- avoid involving hw wallets when not necessary
  return this._getKey(false, subaccountPointer, pointer);
}

function getMyPrivateKey (subaccountPointer, pointer) {
  // always priv, even when it's not a subaccount
  return this._getKey(true, subaccountPointer, pointer);
}

function getMyScanningKey (subaccountPointer, pointer) {
  // always priv, even when it's not a subaccount
  return this._getKey(true, subaccountPointer, pointer, 5 /* = BLINDED branch */);
}
