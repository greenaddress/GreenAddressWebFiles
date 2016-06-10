var bitcoinup = require('../bitcoinup');
var extend = require('xtend/mutable');

var TxConstructor = require('../tx-constructor');
var AssetsTxConstructor = require('./assets-tx-constructor');
var GAService = require('./service');
var GAUtxoFactory = require('./utxo-factory').GAUtxoFactory;
var GAConfidentialUtxo = require('./confidential-utxo');
var GAAddressFactory = require('./address-factory');
var GAFeeEstimatesProvider = require('./fee-estimates-factory');

module.exports = GAAssetsWallet;

extend(GAAssetsWallet.prototype, {
  getBalance: getBalance,
  sendTxTo: sendTxTo,
  setupSubAccount: setupSubAccount,
  _loginHDWallet: _loginHDWallet
});

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

function GAAssetsWallet (options) {
  this.service = new GAService();

  if (options.mnemonic) {
    this.loggedIn = this.service.deriveHD(
      options.mnemonic
    ).then(function (hdwallet) {
      this.hdwallet = hdwallet;
      return this._loginHDWallet(options.mnemonic);
    }.bind(this));
  } else if (options.existingSession) {
    this.hdwallet = new bitcoinup.SchnorrSigningKey(
      options.existingSession.hdwallet
    );
    this.service.session = options.existingSession.session;
    this.service.gaPath = new Buffer(options.existingSession.gaPath, 'hex');
    this.loggedIn = Promise.resolve(options.existingSession.loginData);
  }

  this.loggedIn = this.loggedIn.then(function (data) {
    // TxConstructor calls the service, so it needs to be constructed only
    // after login succeeds:
    this.txConstructors = {};
    var subaccounts = data.subaccounts;
    subaccounts.push({
      name: 'Main',
      pointer: null,
      type: 'main'
    });
    this.assets = data.assets;
    subaccounts.forEach(function (subaccount) {
      this.setupSubAccount(subaccount);
    }.bind(this));
    return data;
  }.bind(this));
}

function setupSubAccount (subaccount) {
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
             privHDWallet: this.hdwallet,
             pubHDWallet: this.hdwallet,
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
           privHDWallet: this.hdwallet,
           pubHDWallet: this.hdwallet,
           subaccount: subaccount}
        ),
        feeUtxoFactory: new GAUtxoFactory(
          this.service,
          {utxoClass: GAConfidentialUtxo,
           privHDWallet: this.hdwallet,
           pubHDWallet: this.hdwallet,
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

function _loginHDWallet (mnemonic) {
  return new Promise(function (resolve, reject) {
    this.service.connect(this.hdwallet, mnemonic, resolve, reject);
  }.bind(this));
}

function getBalance () {

}

function sendTxTo (recipient, amount, options) {

}
