var bitcoinup = require('../bitcoinup/index.js');
var bufferEquals = require('buffer-equals');
var TxConstructor = require('../tx-constructor');
var extend = require('xtend/mutable');
var extendCopy = require('xtend');

module.exports = AssetsTxConstructor;

AssetsTxConstructor.prototype = Object.create(TxConstructor.prototype);
extend(AssetsTxConstructor.prototype, {
  refreshUtxo: refreshUtxo,
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
      options.feeChangeAddrFactory.getNextOutputScriptWithPointer.bind(
        options.feeChangeAddrFactory
      )
  };
}

function _collectOutputs (values, options) {
  options = options || {};
  var ret = [];
  var deferreds = [];
  var assetIsFee = bufferEquals(
    this.buildOptions.feeNetworkId,
    this.buildOptions.assetNetworkId
  );

  deferreds.push(TxConstructor._makeUtxoFilter(
    this.buildOptions.assetNetworkId,
    values.asset + assetIsFee ? values.fee : 0,
    'not enough asset',
    options
  )(this.utxo).then(function (assetUtxo) {
    Array.prototype.push.apply(ret, assetUtxo);
  }));

  if (!assetIsFee) {
    deferreds.push(TxConstructor._makeUtxoFilter(
      this.buildOptions.feeNetworkId,
      values.fee,
      'not enough money for fee',
      extendCopy(options, {isFeeAsset: true})
    )(this.feeUtxo).then(function (feeUtxo) {
      Array.prototype.push.apply(ret, feeUtxo);
    }));
  }

  return Promise.all(deferreds).then(function () {
    return ret;
  });
}

function _initializeNeededValue (outputsWithAmounts, options, feeEstimate) {
  // 16b is very conservative
  // (just version[4b]+num_inputs[1b]+num_outputs[1b]+one_output[10b]
  var initialFeeEstimate = 16 * feeEstimate / 1000;
  return {asset: TxConstructor.prototype._initializeNeededValue.call(
            this, outputsWithAmounts, options, feeEstimate
          ),
          fee: initialFeeEstimate};
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
