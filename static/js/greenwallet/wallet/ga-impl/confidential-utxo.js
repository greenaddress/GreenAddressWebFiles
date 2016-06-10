var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
var GAUtxo = require('./utxo-factory').GAUtxo;
var SchnorrSigningKey = require('../bitcoinup').SchnorrSigningKey;

module.exports = GAConfidentialUtxo;

GAConfidentialUtxo.prototype = new GAUtxo();
extend(GAConfidentialUtxo.prototype, {
  getValue: getValue,
  _unblindOutValueInner: _unblindOutValueInner,
  _unblindOutValue: _unblindOutValue
});

function GAConfidentialUtxo (service, utxo, options) {
  GAUtxo.call(this, service, utxo, options);
  if (this.raw.commitment) {
    this.raw.commitment = new Buffer(this.raw.commitment, 'hex');
    this.raw.nonce_commitment = new Buffer(this.raw.nonce_commitment, 'hex');
    this.raw.range_proof = new Buffer(this.raw.range_proof, 'hex');
  }
}

function _unblindOutValueInner (scanningKey) {
  var secp256k1 = SchnorrSigningKey.secp256k1;
  var secp256k1_ctx = SchnorrSigningKey.getSecp256k1Ctx();

  var secexp_buf = scanningKey.d.toBuffer();
  var secexp = secp256k1._malloc(32);
  var nonce = secp256k1._malloc(33);
  var nonce_res = secp256k1._malloc(32);
  var pubkey_p = secp256k1._malloc(64);
  var p_arr = Array.prototype.slice.call(
    new BigInteger(''+pubkey_p).toBuffer()
  );
  while (p_arr.length < 4) p_arr.unshift(0);
  for (var i = 0; i < 32; ++i) {
    secp256k1.setValue(secexp+i, secexp_buf[i], 'i8');
  }
  for (var i = 0; i < 33; ++i) {
    secp256k1.setValue(nonce + i, this.raw.nonce_commitment[i], 'i8');
  }
  if (1 != secp256k1._secp256k1_ec_pubkey_parse(
    secp256k1_ctx,
    pubkey_p,
    nonce,
    33
  )) {
    throw new Error('secp256k1 EC pubkey parse failed');
  }
  if (1 != secp256k1._secp256k1_ecdh(
      secp256k1_ctx,
      nonce_res,
      pubkey_p,
      secexp
  )) {
      throw new Error('secp256k1 ECDH failed');
  }
  var nonce_buf = new Buffer(32);
  for (var i = 0; i < 32; ++i) {
    nonce_buf[i] = secp256k1.getValue(nonce_res + i, 'i8') & 0xff;
  }
  nonce_buf = bitcoin.crypto.sha256(nonce_buf);
  for (var i = 0; i < 32; ++i) {
    secp256k1.setValue(nonce_res + i, nonce_buf[i], 'i8');
  }
  var blinding_factor_out = secp256k1._malloc(32);
  var amount_out = secp256k1._malloc(8);
  var min_value = secp256k1._malloc(8);
  var max_value = secp256k1._malloc(8);
  var msg_out = secp256k1._malloc(4096);
  var msg_size = secp256k1._malloc(4);
  var commitment = secp256k1._malloc(33);
  for (var i = 0; i < 33; ++i) {
    secp256k1.setValue(commitment + i, this.raw.commitment[i], 'i8');
  }
  var range_proof = secp256k1._malloc(this.raw.range_proof.length);
  for (var i = 0; i < this.raw.range_proof.length; ++i) {
    secp256k1.setValue(range_proof + i, this.raw.range_proof[i], 'i8');
  }
  var rewindRes = secp256k1._secp256k1_rangeproof_rewind(
    secp256k1_ctx,
    blinding_factor_out,
    amount_out,
    msg_out,
    msg_size,
    nonce_res,
    min_value,
    max_value,
    commitment,
    range_proof,
    this.raw.range_proof.length
  );
  if (rewindRes != 1) {
    throw "Invalid transaction."
  }
  var ret = [];
  for (var i = 0; i < 8; ++i) {
    ret[8-i-1] = secp256k1.getValue(amount_out+i, 'i8') & 0xff;
  }
  var val = BigInteger.fromBuffer(new Buffer(ret));
  return {
    value: +val,
    blinding_factor_out: blinding_factor_out
  };
}

function _unblindOutValue () {
  var SUBACCOUNT = 3;
  var BLINDED = 5;

  var key = Promise.resolve(this.privHDWallet);
  if (this.raw.subaccount) {
    key = key.then(function (key) {
      return key.deriveHardened(SUBACCOUNT);
    }).then(function (key) {
      return key.deriveHardened(this.raw.subaccount);
    }.bind(this));
  }
  return key.then(function (key) {
    return key.deriveHardened(BLINDED);
  }).then(function (branch) {
    return branch.deriveHardened(this.raw.pointer);
  }.bind(this)).then(function (scanningNode) {
    return this._unblindOutValueInner(
     scanningNode.hdnode.keyPair
    );
  }.bind(this));
}

function getValue () {
  if (this.value) {
    return Promise.resolve(this.value);
  } else {
    return this._unblindOutValue().then(function(res) {
      this.blindingFactor = res.blinding_factor_out;
      return res.value;
    }.bind(this));
  }
}