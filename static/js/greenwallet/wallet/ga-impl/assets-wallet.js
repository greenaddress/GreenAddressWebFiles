var bitcoinup = require('../bitcoinup');
var extend = require('xtend/mutable');

var TxConstructor = require('../tx-constructor');
var AssetsTxConstructor = require('./assets-tx-constructor');
var BaseWallet = require('./base-wallet');
var GAUtxoFactory = require('./utxo-factory').GAUtxoFactory;
var GAConfidentialUtxo = require('./confidential-utxo');
var GAAddressFactory = require('./address-factory');

module.exports = GAAssetsWallet;

GAAssetsWallet.prototype = Object.create(BaseWallet.prototype);
extend(GAAssetsWallet.prototype, {
  setupSubAccount: setupSubAccount
});
function GAAssetsWallet (options) {
  BaseWallet.call(this, options);
  this.unblindedCache = options.unblindedCache;
}

function makeAssetsClassWithDefaultAsssetId (assetId) {
  AssetsTransactionWithDefaultAsset.prototype = Object.create(bitcoinup.AssetsTransaction.prototype);

  extend(AssetsTransactionWithDefaultAsset.prototype, {
    addOutput: addOutput,
    replaceOutput: replaceOutput
  });

  function AssetsTransactionWithDefaultAsset () {
    bitcoinup.AssetsTransaction.call(this);
  }

  function addOutput (outScript, value, fee) {
    return bitcoinup.AssetsTransaction.prototype.addOutput.call(
      this, outScript, value, fee, assetId
    );
  }

  function replaceOutput (idx, outScript, value, fee) {
    bitcoinup.AssetsTransaction.prototype.replaceOutput.call(
      this, idx, outScript, value, fee, assetId
    );
  }

  return AssetsTransactionWithDefaultAsset;
}

function setupSubAccount (subaccount) {
  this.subaccounts.push(subaccount);

  if (!this.signingWallet) {
    // watch only
    return;
  }

  var changeAddrFactory = new GAAddressFactory(
    this.service, this.signingWallet, {
      subaccount: subaccount,
      scriptFactory: this.scriptFactory
    }
  );
  var feeAssetId, feeAssetIdHex;
  var _this = this;
  var feeAssetNum = 2;
  Object.keys(this.assetIds).forEach(function (assetIdHex) {
    if (_this.assetIds[assetIdHex] === feeAssetNum) {
      feeAssetIdHex = assetIdHex;
      feeAssetId = new Buffer(assetIdHex, 'hex');
    }
  });
  Object.keys(this.assets).forEach(function (assetIdHex) {
    var assetId = new Buffer(assetIdHex, 'hex');
    var asset = {
      id: this.assetIds[assetIdHex],
      name: this.assets[assetIdHex],
      networkId: assetId
    };
    var feeAsset = {
      id: this.assetIds[feeAssetIdHex],
      name: this.assets[feeAssetIdHex],
      networkId: feeAssetId
    };
    if (this.txConstructors[ asset.id ] === undefined) {
      this.txConstructors[ asset.id ] = {};
    }
    this.txConstructors[ asset.id ][ subaccount.pointer ] = new AssetsTxConstructor({
      signingWallet: this.signingWallet,
      utxoFactory: new GAUtxoFactory(
        this.service,
        {asset: asset,
         utxoClass: GAConfidentialUtxo,
         scriptFactory: this.scriptFactory,
         unblindedCache: this.unblindedCache,
         subaccount: subaccount}
      ),
      feeUtxoFactory: new GAUtxoFactory(
        this.service,
        {asset: feeAsset,
         utxoClass: GAConfidentialUtxo,
         scriptFactory: this.scriptFactory,
         subaccount: subaccount}),
      changeAddrFactory: changeAddrFactory,
      feeChangeAddrFactory: changeAddrFactory,
      feeEstimatesFactory: this.feeEstimatesFactory,
      assetNetworkId: assetId,
      feeNetworkId: feeAssetId
    });
  }.bind(this));
}
