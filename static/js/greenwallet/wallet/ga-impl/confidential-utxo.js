var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
var GAUtxo = require('./utxo-factory').GAUtxo;
var SchnorrSigningKey = require('../bitcoinup').SchnorrSigningKey;

module.exports = GAConfidentialUtxo;

GAConfidentialUtxo.prototype = Object.create(GAUtxo.prototype);
extend(GAConfidentialUtxo.prototype, {
  getValue: getValue,
  unblind: unblind
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

function unblind () {
  var utxo = this;
  var privkey = '0101010101010101010101010101010101010101010101010101010101010101';
  // TODO: derive real privkey
  // this.scriptFactory.keysManager.getMyScanningKey(
  //  this.raw.subaccount,
  //  this.raw.pointer
  // )
  var h = function (h) { return new Buffer(h, 'hex'); };
  return wally.wally_asset_unblind(
    utxo.raw.nonce_commitment,
    h(privkey),
    utxo.raw.range_proof,
    utxo.raw.commitment,
    h(utxo.raw.asset_tag)
  ).then(function (unblindedData) {
    delete utxo.nonce_commitment;
    delete utxo.range_proof;
    delete utxo.commitment;
    delete utxo.asset_tag

    utxo.assetId = new Buffer(unblindedData[0]).toString('hex');
    utxo.value = BigInteger.fromByteArrayUnsigned(unblindedData[3]).toString();
    utxo.abf = new Buffer(unblindedData[1]).toString('hex');
    utxo.vbf = new Buffer(unblindedData[2]).toString('hex');
    return utxo;
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
