var bitcoinup = require('../bitcoinup');
var extend = require('xtend/mutable');

var GAService = require('./service');
var GAFeeEstimatesFactory = require('./fee-estimates-factory');
var GAHashSwSigningWallet = require('./hash-sw-signing-wallet');

module.exports = BaseWallet;

extend(BaseWallet.prototype, {
  _loginHDWallet: _loginHDWallet,
  getSubaccountByPointer: getSubaccountByPointer
});

function BaseWallet (options) {
  if (!options) return;  // allow subclassing

  this.service = new GAService();

  if (options.SigningWalletClass) {
    var signingWallet = new options.SigningWalletClass(
      extend(options.signingWalletOptions, {gaService: this.service})
    );
    this.signingWallet = signingWallet;
    this.loggedIn = this._loginHDWallet();
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
  }

  this.loggedIn = this.loggedIn.then(function (data) {
    // TxConstructor calls the service, so it needs to be constructed only
    // after login succeeds:
    this.txConstructors = {};
    this.subaccounts = data.subaccounts;
    this.subaccounts.push({
      name: 'Main',
      pointer: null,
      type: 'main'
    });
    this.assets = data.assets;
    this.feeEstimatesFactory = new GAFeeEstimatesFactory(
      this.service, data.fee_estimates
    );

    // scriptFactory is required by setupSubAccount below:
    this.scriptFactory = this.signingWallet.scriptFactory;

    this.subaccounts.forEach(function (subaccount) {
      this.setupSubAccount(subaccount);
    }.bind(this));

    return data;
  }.bind(this));
}

function _loginHDWallet () {
  return new Promise(function (resolve, reject) {
    this.service.connect(this.signingWallet, resolve, reject);
  }.bind(this));
}

function getSubaccountByPointer (pointer) {
  return this.subaccounts.filter(function (subaccount) {
    return subaccount.pointer === pointer;
  })[0];
}
