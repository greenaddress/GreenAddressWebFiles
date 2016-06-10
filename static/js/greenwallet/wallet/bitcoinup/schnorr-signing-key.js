var extend = require('xtend/mutable');
var secp256k1 = require('secp256k1-alpha');
var secp256k1ctx = null;

module.exports = SchnorrSigningKey;

extend(SchnorrSigningKey.prototype, {
  signHash: signHash,
  getAddress: getAddress,
  getPublicKeyBuffer: getPublicKeyBuffer,
  derive: derive,
  deriveHardened: deriveHardened
});
SchnorrSigningKey.secp256k1 = secp256k1;
SchnorrSigningKey.getSecp256k1Ctx = checkContext;

function SchnorrSigningKey (hdnode) {
  this.hdnode = hdnode;
}

function signHash (msgIn) {
  checkContext();
  return new Promise(function (resolve, reject) {
    var key = this.hdnode.keyPair;
    var sig = secp256k1._malloc(64);
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
    var i;
    for (i = 0; i < 32; ++i) {
      secp256k1.setValue(msg + i, msgIn[i], 'i8');
    }
    if (secp256k1._secp256k1_schnorr_sign(
      secp256k1ctx, msg, sig, seckey, 0, 0
    ) !== 1) {
      reject('secp256k1 Schnorr sign failed');
    }
    var len = 64;
    var ret = new Buffer(len);
    for (i = 0; i < len; ++i) {
      ret.writeUInt8(secp256k1.getValue(sig + i, 'i8') & 0xff, i);
    }
    secp256k1._free(sig);
    secp256k1._free(msg);
    secp256k1._free(seckey);

    resolve(ret);
  }.bind(this));
}

function getAddress () {
  return this.hdnode.keyPair.getAddress().toString();
}

function getPublicKeyBuffer () {
  return this.hdnode.keyPair.getPublicKeyBuffer();
}

function derive (i) {
  return Promise.resolve(this.hdnode.derive(i)).then(function (hd) {
    return new SchnorrSigningKey(hd);
  });
}

function deriveHardened (i) {
  return Promise.resolve(this.hdnode.deriveHardened(i)).then(function (hd) {
    return new SchnorrSigningKey(hd);
  });
}

function checkContext () {
  if (secp256k1ctx === null) {
    secp256k1ctx = secp256k1._secp256k1_context_create(3);
    secp256k1._secp256k1_pedersen_context_initialize(secp256k1ctx);
    secp256k1._secp256k1_rangeproof_context_initialize(secp256k1ctx);
  }
  return secp256k1ctx;
}

