var bitcoinup = require('../bitcoinup');
var extend = require('xtend/mutable');

var TxConstructor = require('../tx-constructor');
var AssetsTxConstructor = require('./assets-tx-constructor');
var BaseWallet = require('./base-wallet');
var GAUtxoFactory = require('./utxo-factory').GAUtxoFactory;
var GAConfidentialUtxo = require('./confidential-utxo');
var GAAddressFactory = require('./address-factory');
var GAFeeEstimatesProvider = require('./fee-estimates-factory');

module.exports = GAAssetsWallet;

GAAssetsWallet.prototype = new BaseWallet();
extend(GAAssetsWallet.prototype, {
  setupSubAccount: setupSubAccount
});
function GAAssetsWallet (options) {
  BaseWallet.call(this, options);
  this.unblindedCache = options.unblindedCache;
}

function makeAssetsClassWithDefaultAsssetId (assetId) {
  AssetsTransactionWithDefaultAsset.prototype =
    new bitcoinup.AssetsTransaction();

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

  var changeAddrFactory = new GAAddressFactory(
    this.service, this.hdwallet, {subaccountPointer: subaccount.pointer}
  );
  Object.keys(this.assets).forEach(function (assetId) {
    var asset = {
      id: Number.parseInt(assetId),
      name: this.assets[assetId].name,
      networkId: new Buffer(this.assets[assetId].network_id, 'hex')
    };
    if (this.txConstructors[ asset.id ] === undefined) {
      this.txConstructors[ asset.id ] = {};
    }

    if (asset.id === 1) {
      // feeasset
      this.txConstructors[ asset.id ][ subaccount.pointer ] = new TxConstructor(
        {
          utxoFactory: new GAUtxoFactory(
            this.service,
            {utxoClass: GAConfidentialUtxo,
             scriptFactory: this.scriptFactory,
             unblindedCache: this.unblindedCache,
             subaccount: subaccount}
          ),
          changeAddrFactory: changeAddrFactory,
          feeEstimatesFactory: new GAFeeEstimatesProvider(this.service),
          transactionClass: makeAssetsClassWithDefaultAsssetId(
            asset.networkId
          )
        }
      );
      this.txConstructors[ asset.id ][ subaccount.pointer ].buildOptions = {
        changeAddrFactory: changeAddrFactory,
        assetNetworkId: new Buffer(this.assets[1].network_id, 'hex'),
        feeNetworkId: new Buffer(this.assets[1].network_id, 'hex')
      };
    } else {
      // nonfeeasset
      this.txConstructors[ asset.id ][ subaccount.pointer ] = new AssetsTxConstructor({
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
          {utxoClass: GAConfidentialUtxo,
           scriptFactory: this.scriptFactory,
           subaccount: subaccount}),
        changeAddrFactory: changeAddrFactory,
        feeChangeAddrFactory: changeAddrFactory,
        feeEstimatesFactory: new GAFeeEstimatesProvider(this.service),
        assetNetworkId: asset.networkId,
        feeNetworkId: new Buffer(this.assets[1].network_id, 'hex')
      });
    }
  }.bind(this));
}
