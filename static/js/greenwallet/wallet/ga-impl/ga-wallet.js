var extend = require('xtend/mutable');

var TxConstructor = require('../tx-constructor');
var BaseWallet = require('./base-wallet');
var GAUtxoFactory = require('./utxo-factory').GAUtxoFactory;
var GAAddressFactory = require('./address-factory');
var GAFeeEstimatesProvider = require('./fee-estimates-factory');

module.exports = GAWallet;

GAWallet.prototype = new BaseWallet();
extend(GAWallet.prototype, {
  setupSubAccount: setupSubAccount
});
function GAWallet () {
  BaseWallet.apply(this, arguments);
}

function setupSubAccount (subaccount) {
  var changeAddrFactory = new GAAddressFactory(
    this.service, this.hdwallet, {subaccountPointer: subaccount.pointer}
  );
  var utxoFactory = new GAUtxoFactory(
    this.service,
    {privHDWallet: this.hdwallet,
     pubHDWallet: this.hdwallet,
     subaccount: subaccount}
  );
  if (this.txConstructors[ 1 ] === undefined) {
    this.txConstructors[ 1 ] = {};
  }
  // feeasset
  this.txConstructors[ 1 ][ subaccount.pointer ] = new TxConstructor(
    {
      utxoFactory: utxoFactory,
      changeAddrFactory: changeAddrFactory,
      feeEstimatesFactory: new GAFeeEstimatesProvider(this.service)
    }
  );
}
