var bitcoinup = require('../bitcoinup/index.js');
var TxConstructor = require('../tx-constructor');
var extend = require('xtend/mutable');

module.exports = AssetsTxConstructor;

AssetsTxConstructor.prototype = new TxConstructor();
extend(AssetsTxConstructor.prototype, {
  refreshUtxo: refreshUtxo,
  createPrevScriptForPointer: createPrevScriptForPointer,
  _collectOutputs: _collectOutputs,
  _initializeNeededValue: _initializeNeededValue,
  _increaseNeededValue: _increaseNeededValue
});

function AssetsTxConstructor (options) {
  options.transactionClass = bitcoinup.AssetsTransaction;
  TxConstructor.call(this, options);

  this.feeUtxoFactory = options.feeUtxoFactory;
  this.feeChangeAddrFactory = options.feeChangeAddrFactory;
  this.buildOptions = {
    withAsset: true,
    assetNetworkId: options.assetNetworkId,
    feeNetworkId: options.feeNetworkId,
    changeAddrFactory: options.changeAddrFactory,
    feeChangeAddrFactory: options.feeChangeAddrFactory,
    getChangeAssetOutScript:
      options.feeChangeAddrFactory.getNextOutputScript.bind(
        options.feeChangeAddrFactory
      )
  };
}

function _collectOutputs (values, options) {
  options = options || {};
  var ret = [];
  var deferreds = [];

  deferreds.push(TxConstructor._makeUtxoFilter(
    this.buildOptions.assetNetworkId,
    values.asset,
    'not enough asset',
    options
  )(this.utxo).then(function (assetUtxo) {
    Array.prototype.push.apply(ret, assetUtxo);
  }));

  deferreds.push(TxConstructor._makeUtxoFilter(
    this.buildOptions.feeNetworkId,
    values.fee,
    'not enough money for fee',
    options
  )(this.feeUtxo).then(function (feeUtxo) {
    Array.prototype.push.apply(ret, feeUtxo);
  }));

  return Promise.all(deferreds).then(function () {
    return ret;
  });
}

function _initializeNeededValue (outputsWithAmounts) {
  return {asset: TxConstructor.prototype._initializeNeededValue.call(
            this, outputsWithAmounts
          ),
          fee: 0};
}

function _increaseNeededValue (oldVal, newVal) {
  return {asset: Math.max(oldVal.asset, newVal.asset),
          fee: Math.max(oldVal.fee, newVal.fee)};
}

function refreshUtxo () {
  TxConstructor.prototype.refreshUtxo.call(this);
  this.utxoDeferred = this.utxoDeferred.then(function () {
    return this.feeUtxoFactory.listAllUtxo().then(function (utxo) {
      this.feeUtxo = utxo;
    }.bind(this));
  }.bind(this));
  return this.utxoDeferred;
}

function createPrevScriptForPointer () {
  return new this.UtxoClass(
    this.gaService,
    {pointer: pointer,
     subaccount: this.subaccount.pointer,
     txhash: ''},
    {pubHDWallet: this.pubHDWallet,
     privHDWallet: this.privHDWallet,
     subaccount: this.subaccount}
  );
}