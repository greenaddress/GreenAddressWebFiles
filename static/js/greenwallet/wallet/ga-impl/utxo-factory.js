var BigInteger = require('bigi');
var extend = require('xtend/mutable');
var wally = require('../wally');

module.exports = {
  'GAUtxoFactory': GAUtxoFactory,
  'GAUtxo': GAUtxo
};

extend(GAUtxoFactory.prototype, {
  listAllUtxo: listAllUtxo,
  getRawTx: getRawTx,
  fetchUtxoDataForTx: fetchUtxoDataForTx
});

extend(GAUtxo.prototype, {
  getPrevScriptLength: utxoGetPrevScriptLength,
  getValue: utxoGetValue
});

function GAUtxoFactory (gaService, options) {
  this.options = options;
  this.gaService = gaService;
  this.UtxoClass = this.options.utxoClass || GAUtxo;

  this.subaccount = options.subaccount;
}

function listAllUtxo (options) {
  options = options || {};
  var _this = this;
  var args = [
    options.minConfs || 0, /* include 0-confs */
    this.subaccount.pointer || 0  /* subaccount */
  ];
  if (this.options.asset) {
    args.push('any');
  }
  return this.gaService.call(
    'com.greenaddress.txs.get_all_unspent_outputs',
    args
  ).then(function (utxos) {
    var utxo_deferreds = utxos.map(function (utxo) {
      var h = function (h) { return new Buffer(h, 'hex'); };
      // TODO: derive real privkey
      var privkey = '0101010101010101010101010101010101010101010101010101010101010101';
      if (!utxo.nonce_commitment) {
        utxo.assetId = utxo.asset_tag.substring(2);
        return new _this.UtxoClass(
          utxo,
          _this.options
        );
      }
      return wally.wally_asset_unblind(
        h(utxo.nonce_commitment),
        h(privkey),
        h(utxo.range_proof),
        h(utxo.commitment),
        h(utxo.asset_tag)
      ).then(function (unblindedData) {
        delete utxo.nonce_commitment;
        delete utxo.range_proof;
        delete utxo.commitment;
        delete utxo.asset_tag

        utxo.assetId = new Buffer(unblindedData[0]).toString('hex');
        utxo.value = BigInteger.fromByteArrayUnsigned(unblindedData[3]).toString();
        utxo.abf = new Buffer(unblindedData[1]).toString('hex');
        utxo.vbf = new Buffer(unblindedData[2]).toString('hex');

        return new _this.UtxoClass(
          utxo,
          _this.options
        );
      });
    });
    return Promise.all(utxo_deferreds);
  });
}

function getRawTx (txhash) {
  return this.gaService.call(
    'com.greenaddress.txs.get_raw_unspent_output',
    [txhash] // include 0-confs
  );
}

function fetchUtxoDataForTx (tx) {
  var _this = this;
  var d_all = Promise.resolve();
  tx.ins.forEach(function (inp) {
    d_all = d_all.then(function () {
      if (!inp.prevOut.data) {
        return _this.gaService.call(
          'com.greenaddress.txs.get_raw_output', [ inp.prevOut.raw.txhash ]
        ).then(function (data) {
          inp.prevOut.data = new Buffer(data, 'hex');
        });
      }
    });
  });
  return d_all;
}

function GAUtxo (utxo, options) {
  if (!utxo) return; // allow subclassing

  this.prevHash = [].reverse.call(new Buffer(utxo.txhash, 'hex'));
  this.ptIdx = utxo.pt_idx;
  this.value = +utxo.value;
  this.raw = utxo;

  // FIXME: scriptFactory is not used for signing anymore, just for CT
  //  - perhaps find a way to get rid of this dependency here too, and move
  //    CT decryption somewhere outside?
  this.scriptFactory = options.scriptFactory;
  this.subaccount = options.subaccount;
}

function utxoGetValue () {
  return Promise.resolve(this.value);
}

function utxoGetPrevScriptLength () {
  var numKeys = this.subaccount.type === '2of3' ? 3 : 2;
  return 1 +  // OP_2
         numKeys * 35 +  // keys pushdata
         2;  // OP_[23] OP_CHECKMULTISIG
}
