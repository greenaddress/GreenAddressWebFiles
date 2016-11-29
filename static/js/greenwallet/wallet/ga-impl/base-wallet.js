var bitcoin = require('bitcoinjs-lib');
var bitcoinup = require('../bitcoinup');
var extend = require('xtend/mutable');

var GAService = require('./service');
var GAFeeEstimatesFactory = require('./fee-estimates-factory');
var GAHashSwSigningWallet = require('./signing-wallets/hash-sw-signing-wallet');

module.exports = BaseWallet;

extend(BaseWallet.prototype, {
  _loginHDWallet: _loginHDWallet,
  _loginWatchOnly: _loginWatchOnly,
  getSubaccountByPointer: getSubaccountByPointer
});

function BaseWallet (options) {
  if (!options) return;  // allow subclassing

  this.service = options.gaService || new GAService(
    options.netName || 'testnet', options
  );

  if (options.SigningWalletClass) {
    var signingWallet = new options.SigningWalletClass(
      extend(options.signingWalletOptions, {gaService: this.service})
    );
    this.signingWallet = signingWallet;
    this.loggedIn = this._loginHDWallet(signingWallet);
  } else if (options.existingSession) {
    this.signingWallet = new GAHashSwSigningWallet({
      hd: new bitcoinup.SchnorrSigningKey(
        options.existingSession.hdwallet, options.existingSession.mnemonic
      ),
      gaService: this.service
    });
    this.service.session = options.existingSession.session;
    this.service.gaUserPath = new Buffer(options.existingSession.gaUserPath, 'hex');
    this.loggedIn = Promise.resolve(options.existingSession.loginData);
  } else if (options.watchOnly) {
    this.loggedIn = this._loginWatchOnly(options.watchOnly);
  }

  this.loggedIn = this.loggedIn.then(function (data) {
    // TxConstructor calls the service, so it needs to be constructed only
    // after login succeeds:
    this.txConstructors = {};
    this.assets = data.assets;
    this.feeEstimatesFactory = new GAFeeEstimatesFactory(
      this.service, data.fee_estimates
    );

    if (this.signingWallet) {
      // scriptFactory is required by setupSubAccount below (for non watch-only):
      this.scriptFactory = this.signingWallet.scriptFactory;
    } else {
      this.watchOnlyHDWallet = new bitcoin.HDNode(
        bitcoin.ECPair.fromPublicKeyBuffer(
          new Buffer(data.public_key, 'hex')
        ),
        new Buffer(data.chain_code, 'hex')
      );
    }

    this.subaccounts = [];
    this.setupSubAccount({
      name: 'Main',
      pointer: 0,
      type: 'main'
    });
    data.subaccounts.forEach(function (subaccount) {
      this.setupSubAccount(subaccount);
    }.bind(this));

    return data;
  }.bind(this));
}

function _loginHDWallet (signingWallet) {
  return new Promise(function (resolve, reject) {
    this.service.login({signingWallet: signingWallet}, resolve, reject);
  }.bind(this));
}

function _loginWatchOnly (options) {
  return new Promise(function (resolve, reject) {
    this.service.login({watchOnly: options}, resolve, reject);
  }.bind(this));
}

function getSubaccountByPointer (pointer) {
  return this.subaccounts.filter(function (subaccount) {
    return subaccount.pointer === pointer;
  })[0];
}
