var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
var GAUtxo = require('./utxo-factory').GAUtxo;
var SchnorrSigningKey = require('../bitcoinup').SchnorrSigningKey;

module.exports = GAConfidentialUtxo;

GAConfidentialUtxo.prototype = Object.create(GAUtxo.prototype);
extend(GAConfidentialUtxo.prototype, {
  getValue: getValue,
  _unblindOutValueInner: _unblindOutValueInner,
  unblindOutValue: unblindOutValue
});

function GAConfidentialUtxo (utxo, options) {
  GAUtxo.call(this, utxo, options);
  if (this.raw.commitment) {
    this.raw.commitment = new Buffer(this.raw.commitment, 'hex');
    this.raw.nonce_commitment = new Buffer(this.raw.nonce_commitment, 'hex');
    this.raw.range_proof = new Buffer(this.raw.range_proof, 'hex');
  }
  this.unblindedCache = options.unblindedCache;
}

function _unblindOutValueInner (scanningKey) {
  var secp256k1 = SchnorrSigningKey.secp256k1;
  var secp256k1_ctx = SchnorrSigningKey.getSecp256k1Ctx();

  var secexp_buf = scanningKey.d.toBuffer();
  var secexp = secp256k1._malloc(32);
  var nonce = secp256k1._malloc(33);
  var nonce_res = secp256k1._malloc(32);
  var pubkey_p = secp256k1._malloc(64);
  var i;
  var p_arr = Array.prototype.slice.call(
    new BigInteger('' + pubkey_p).toBuffer()
  );
  while (p_arr.length < 4) p_arr.unshift(0);
  for (i = 0; i < 32; ++i) {
    secp256k1.setValue(secexp + i, secexp_buf[i], 'i8');
  }
  for (i = 0; i < 33; ++i) {
    secp256k1.setValue(nonce + i, this.raw.nonce_commitment[i], 'i8');
  }
  if (secp256k1._secp256k1_ec_pubkey_parse(
      secp256k1_ctx,
      pubkey_p,
      nonce,
      33
    ) !== 1) {
    throw new Error('secp256k1 EC pubkey parse failed');
  }
  if (secp256k1._secp256k1_ecdh(
      secp256k1_ctx,
      nonce_res,
      pubkey_p,
      secexp
    ) !== 1) {
    throw new Error('secp256k1 ECDH failed');
  }
  var nonce_buf = new Buffer(32);
  for (i = 0; i < 32; ++i) {
    nonce_buf[i] = secp256k1.getValue(nonce_res + i, 'i8') & 0xff;
  }
  nonce_buf = bitcoin.crypto.sha256(nonce_buf);
  for (i = 0; i < 32; ++i) {
    secp256k1.setValue(nonce_res + i, nonce_buf[i], 'i8');
  }
  var blinding_factor_out = secp256k1._malloc(32);
  var amount_out = secp256k1._malloc(8);
  var min_value = secp256k1._malloc(8);
  var max_value = secp256k1._malloc(8);
  var msg_out = secp256k1._malloc(4096);
  var msg_size = secp256k1._malloc(4);
  var commitment = secp256k1._malloc(33);
  for (i = 0; i < 33; ++i) {
    secp256k1.setValue(commitment + i, this.raw.commitment[i], 'i8');
  }
  var range_proof = secp256k1._malloc(this.raw.range_proof.length);
  for (i = 0; i < this.raw.range_proof.length; ++i) {
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
  if (rewindRes !== 1) {
    throw new Error('Invalid transaction.');
  }
  var ret = [];
  for (i = 0; i < 8; ++i) {
    ret[8 - i - 1] = secp256k1.getValue(amount_out + i, 'i8') & 0xff;
  }
  var val = BigInteger.fromBuffer(new Buffer(ret));
  return {
    value: +val,
    blinding_factor_out: blinding_factor_out
  };
}

function unblindOutValue () {
  if (this.blindingFactor) {
    return Promise.resolve({
      blinding_factor_out: this.blindingFactor,
      value: this.value
    });
  }
  return this.scriptFactory.keysManager.getMyScanningKey(
    this.raw.subaccount,
    this.raw.pointer
  ).then(function (scanningNode) {
    return this._unblindOutValueInner(
      scanningNode.hdnode.keyPair
    );
  }.bind(this)).then(function (res) {
    this.blindingFactor = res.blinding_factor_out;
    this.value = res.value;
    return res;
  });
}

function getValue () {
  var _this = this;
  if (this.value) {
    return Promise.resolve(this.value);
  } else {
    var cachedValue = Promise.resolve(null);
    if (this.unblindedCache) {
      cachedValue = this.unblindedCache.getValue(this.prevHash, this.ptIdx);
    }
    return cachedValue.then(function (value) {
      if (value !== null) {
        return value;
      }
      return _this.unblindOutValue().then(function (res) {
        if (_this.unblindedCache) {
          _this.unblindedCache.setValue(_this.prevHash, _this.ptIdx, res.value);
        }
        return res.value;
      });
    });
  }
}
