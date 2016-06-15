var extend = require('xtend/mutable');

var TxConstructor = require('../tx-constructor');
var BaseWallet = require('./base-wallet');
var GAUtxoFactory = require('./utxo-factory').GAUtxoFactory;
var GAAddressFactory = require('./address-factory');

module.exports = GAWallet;

GAWallet.prototype = new BaseWallet();
extend(GAWallet.prototype, {
  setupSubAccount: setupSubAccount
});
function GAWallet () {
  BaseWallet.apply(this, arguments);
}

function setupSubAccount (subaccount) {
  this.subaccounts.push(subaccount);

  var changeAddrFactory = new GAAddressFactory(
    this.service, this.hdwallet, {subaccountPointer: subaccount.pointer}
  );
  var utxoFactory = new GAUtxoFactory(
    this.service,
    {scriptFactory: this.scriptFactory,
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
      feeEstimatesFactory: this.feeEstimatesFactory
    }
  );
}
