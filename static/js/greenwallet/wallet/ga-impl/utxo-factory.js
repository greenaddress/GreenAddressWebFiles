var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');

var SchnorrSigningKey = require('../bitcoinup').SchnorrSigningKey;

module.exports = {
  'GAUtxoFactory': GAUtxoFactory,
  'GAUtxo': GAUtxo
};

extend(GAUtxoFactory.prototype, {
  listAllUtxo: listAllUtxo,
  getRawTx: getRawTx
});

extend(GAUtxo.prototype, {
  getSigningKey: utxoGetSigningKey,
  getPrevScript: utxoGetPrevScript,
  getPrevScriptLength: utxoGetPrevScriptLength,
  getValue: utxoGetValue
});

function GAUtxoFactory (gaService, options) {
  this.options = options;
  this.gaService = gaService;
  this.UtxoClass = this.options.utxoClass || GAUtxo;

  this.subaccount = options.subaccount;
  this.scriptFactory = options.scriptFactory;
}

function listAllUtxo () {
  var args = [
    0, /* include 0-confs */
    this.subaccount.pointer || 0,  /* subaccount */
  ];
  if (this.options.asset) {
    args.push(this.options.asset)
  }
  return this.gaService.call(
    'com.greenaddress.txs.get_all_unspent_outputs',
    args
  ).then(function (utxos) {
    return utxos.map(function (utxo) {
      return new this.UtxoClass(
        this.gaService, utxo,
        {scriptFactory: this.scriptFactory,
         subaccountPointer: this.subaccount.pointer}
      );
    }.bind(this));
  }.bind(this));
}

function getRawTx (txhash) {
  return this.gaService.call(
    'com.greenaddress.txs.get_raw_unspent_output',
    [txhash] // include 0-confs
  );
}

function GAUtxo (gaService, utxo, options) {
  if (!gaService) return; // allow subclassing

  this.gaService = gaService;

  this.prevHash = [].reverse.call(new Buffer(utxo.txhash, 'hex'));
  this.ptIdx = utxo.pt_idx;
  this.value = +utxo.value;
  this.raw = utxo;

  this.scriptFactory = options.scriptFactory;
  this.subaccount = options.subaccount;
}

function getRootHDKey () {
  if (this.subaccount.pointer) {
    return _getSubaccountHDKey(this.privHDWallet, this.subaccount.pointer);
  } else {
    return Promise.resolve(this.privHDWallet);
  }
}

function utxoGetPrevScript () {
  return this.gaScriptFactory.createScriptForSubaccountAndPointer(
    this.subaccount, this.raw.pointer
  );
}

function utxoGetSigningKey () {
  return this.gaScriptFactory.keysManager.getSigningKey(
    this.subaccount.pointer, this.raw.pointer
  )
}

function utxoGetValue () {
  return Promise.resolve(this.value);
}

function utxoGetPrevScriptLength () {
  var numKeys = this.backupHDWallet ? 3 : 2;
  return 1 +  // OP_2
         numKeys * 35 +  // keys pushdata
         2;  // OP_[23] OP_CHECKMULTISIG
}
