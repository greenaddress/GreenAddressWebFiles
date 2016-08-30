var bitcoin = require('bitcoinjs-lib');
var bip39 = require('bip39');
var extend = require('xtend/mutable');
var pbkdf2 = require('pbkdf2').pbkdf2Sync;
var secp256k1 = require('secp256k1-alpha');
var secp256k1ctx = null;
var sha512 = require('sha512');

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
SchnorrSigningKey.secp256k1 = secp256k1;
SchnorrSigningKey.getSecp256k1Ctx = checkContext;
SchnorrSigningKey.fromMnemonic = fromMnemonic;

function SchnorrSigningKey (hdnode, options) {
  options = options || {};
  this.hdnode = hdnode;
  this.mnemonic = options.mnemonic;
  this.pathSeed = options.pathSeed;
}

function _signHash (msgIn, schnorr) {
  checkContext();
  var _this = this;
  return new Promise(function (resolve, reject) {
    var key = _this.hdnode.keyPair;
    var sig, siglenPointer;
    if (schnorr) {
      sig = secp256k1._malloc(64);
    } else {
      sig = secp256k1._malloc(128);
      siglenPointer = secp256k1._malloc(4);
    }
    var msg = secp256k1._malloc(32);
    var seckey = secp256k1._malloc(32);
    var start = key.d.toByteArray().length - 32;
    var slice;
    if (start >= 0) {  // remove excess zeroes
      slice = key.d.toByteArray().slice(start);
    } else {  // add missing zeroes
      slice = key.d.toByteArray();
      while (slice.length < 32) slice.unshift(0);
    }

    secp256k1.writeArrayToMemory(slice, seckey);
    if (!schnorr) {
      secp256k1.setValue(siglenPointer, 128, 'i32');
    }
    var i;
    for (i = 0; i < 32; ++i) {
      secp256k1.setValue(msg + i, msgIn[i], 'i8');
    }
    var len = -1;
    if (schnorr) {
      if (secp256k1._secp256k1_schnorr_sign(
          secp256k1ctx, sig, msg, seckey, 0, 0
      ) !== 1) {
        reject('secp256k1 Schnorr sign failed');
      } else {
        len = 64;
      }
    } else {
      len = -1;
      var sigOpaque = secp256k1._malloc(64);
      if (secp256k1._secp256k1_ecdsa_sign(
          secp256k1ctx, sigOpaque, msg, seckey, 0, 0
      ) !== 1) {
        reject('secp256k1 ECDSA sign failed');
      } else if (secp256k1._secp256k1_ecdsa_signature_serialize_der(
                 secp256k1ctx, sig, siglenPointer, sigOpaque
      ) !== 1) {
        reject('secp256k1 ECDSA signature serialize failed');
      } else {
        len = secp256k1.getValue(siglenPointer, 'i32');
      }
      secp256k1._free(sigOpaque);
    }
    if (len !== -1) {
      var ret = new Buffer(len);
      for (i = 0; i < len; ++i) {
        ret.writeUInt8(secp256k1.getValue(sig + i, 'i8') & 0xff, i);
      }
      if (schnorr) {
        resolve(ret);
      } else {
        resolve(bitcoin.ECSignature.fromDER(ret));
      }
    }
    secp256k1._free(sig);
    if (!schnorr) {
      secp256k1._free(siglenPointer);
    }
    secp256k1._free(msg);
    secp256k1._free(seckey);
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

function checkContext () {
  var SECP256K1_FLAGS_BIT_CONTEXT_VERIFY = (1 << 8);
  var SECP256K1_FLAGS_BIT_CONTEXT_SIGN = (1 << 9);
  var SECP256K1_FLAGS_TYPE_CONTEXT = (1 << 0);
  var SECP256K1_CONTEXT_VERIFY = (SECP256K1_FLAGS_TYPE_CONTEXT | SECP256K1_FLAGS_BIT_CONTEXT_VERIFY);
  var SECP256K1_CONTEXT_SIGN = (SECP256K1_FLAGS_TYPE_CONTEXT | SECP256K1_FLAGS_BIT_CONTEXT_SIGN);
  if (secp256k1ctx === null) {
    secp256k1ctx = secp256k1._secp256k1_context_create(
      SECP256K1_CONTEXT_VERIFY | SECP256K1_CONTEXT_SIGN
    );
    secp256k1._secp256k1_pedersen_context_initialize(secp256k1ctx);
    secp256k1._secp256k1_rangeproof_context_initialize(secp256k1ctx);
  }
  return secp256k1ctx;
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
