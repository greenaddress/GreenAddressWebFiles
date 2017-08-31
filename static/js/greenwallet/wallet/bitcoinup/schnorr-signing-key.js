var bitcoin = require('bitcoinjs-lib');
var bip39 = require('bip39');
var extend = require('xtend/mutable');
var pbkdf2 = require('pbkdf2').pbkdf2Sync;
var sha512 = require('sha512');
var wally = require('wallyjs');

module.exports = SchnorrSigningKey;

extend(SchnorrSigningKey.prototype, {
  _signHash: _signHash,
  signHash: signHash,
  signHashSchnorr: signHashSchnorr,
  getAddress: getAddress,
  getChainCode: getChainCode,
  getPublicKeyBuffer: getPublicKeyBuffer,
  derive: derive,
  deriveHardened: deriveHardened,
  derivePathSeed: derivePathSeed,
  derivePath: derivePath,
  neutered: neutered
});
SchnorrSigningKey.fromMnemonic = fromMnemonic;

function SchnorrSigningKey (hdnode, options) {
  options = options || {};
  this.hdnode = hdnode;
  this.mnemonic = options.mnemonic;
  this.pathSeed = options.pathSeed;
  this.seed = options.seed;
}

function _signHash (msgIn, schnorr) {
  var key = this.hdnode.keyPair;
  return wally.wally_ec_sig_from_bytes(
    key.d.toBuffer(32),
    new Buffer(msgIn),
    schnorr ? 2 : 1
  ).then(function (compact) {
    if (schnorr) {
      return compact;
    }
    return wally.wally_ec_sig_to_der(compact).then(bitcoin.ECSignature.fromDER);
  });
}

function signHash (msgIn) {
  return this._signHash(msgIn, false);
}

function signHashSchnorr (msgIn) {
  return this._signHash(msgIn, true);
}

function getAddress () {
  return this.hdnode.keyPair.getAddress().toString();
}

function getChainCode () {
  return this.hdnode.chainCode;
}

function getPublicKeyBuffer () {
  return this.hdnode.keyPair.getPublicKeyBuffer();
}

function derive (i) {
  // hdnode can be async (if patched by GA), but doesn't have to (bitcoinjs)
  return Promise.resolve(this.hdnode.derive(i)).then(function (hd) {
    return new SchnorrSigningKey(hd);
  });
}

function neutered () {
  return Promise.resolve(new SchnorrSigningKey(this.hdnode.neutered()));
}

function deriveHardened (i) {
  // hdnode can be async (if patched by GA), but doesn't have to (bitcoinjs)
  return Promise.resolve(this.hdnode.deriveHardened(i)).then(function (hd) {
    return new SchnorrSigningKey(hd);
  });
}

function fromMnemonic (mnemonic, netName) {
  var curNet = bitcoin.networks[netName || 'testnet'];
  var seed = bip39.mnemonicToSeedHex(mnemonic);  // this is slow, perhaps move to a webworker
  return Promise.resolve(
    new SchnorrSigningKey(
      bitcoin.HDNode.fromSeedHex(seed, curNet), {mnemonic: mnemonic}
    )
  );
}

function derivePathSeed () {
  if (!this.pathSeed) {
    var mnemonicBuffer = new Buffer(this.mnemonic, 'utf8');
    var saltBuffer = new Buffer('greenaddress_path', 'utf8');

    this.pathSeed = pbkdf2(mnemonicBuffer, saltBuffer, 2048, 64, 'sha512');
  }
  return this.pathSeed;
}

function derivePath () {
  var seedBuffer = this.derivePathSeed();
  var hasher = sha512.hmac('GreenAddress.it HD wallet path');
  return Promise.resolve(hasher.finalize(seedBuffer));
}
