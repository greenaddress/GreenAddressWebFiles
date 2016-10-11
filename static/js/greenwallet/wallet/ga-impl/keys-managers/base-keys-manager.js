var BigInteger = require('bigi');
var branches = require('../constants').branches;
var extend = require('xtend/mutable');

module.exports = BaseKeysManager;

extend(BaseKeysManager.prototype, {
  getGASubAccountPubKey: getGASubAccountPubKey,
  getGAPublicKey: getGAPublicKey,
  getMyPublicKey: getMyPublicKey
});

function BaseKeysManager (options) {
  this.gaService = options.gaService;
  this._subaccountsGACache = {};

  // optimisation for non-subaccounts subkeys and slow hardware wallets
  // (we don't need the priv-derivation to derive non-subaccount subkeys)
  this.pubHDWallet = options.pubHDWallet;
}

function _subpath (hd, pathBuffer) {
  var copy = new Buffer(pathBuffer);
  for (var i = 0; i < 32; i++) {
    hd = hd.derive(+BigInteger.fromBuffer(copy.slice(0, 2)));
    copy = copy.slice(2);
  }
  return hd;
}

function getGASubAccountPubKey (subaccountPointer) {
  if (!this._subaccountsGACache[subaccountPointer]) {
    var gaNode = this.gaService.gaHDNode;
    if (subaccountPointer) {
      gaNode = _subpath(
        gaNode.derive(branches.SUBACCOUNT), this.gaService.gaUserPath
      ).derive(subaccountPointer);
    } else {
      gaNode = _subpath(
        gaNode.derive(branches.REGULAR), this.gaService.gaUserPath
      );
    }
    this._subaccountsGACache[subaccountPointer] = gaNode;
  }
  return this._subaccountsGACache[subaccountPointer];
}

function getGAPublicKey (subaccountPointer, pointer) {
  return this.getGASubAccountPubKey(subaccountPointer).derive(pointer);
}

function getMyPublicKey (subaccountPointer, pointer, branch) {
  // priv only for subaccounts -- avoid involving hw wallets when not necessary
  return this._getKey(false, subaccountPointer, pointer, branch);
}
