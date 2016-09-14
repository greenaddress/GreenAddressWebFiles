var AddressFactory = require('../address-factory');
var bip39 = require('bip39');
var bitcoin = require('bitcoinjs-lib');
var bitcoinup = require('../../bitcoinup');
var TxConstructor = require('../../tx-constructor');
var extend = require('xtend/mutable');
var test = require('tape');
var proxy = require('proxyquire');
var GAService = require('../service');
var GAUtxo = require('../../ga-impl').Utxo;
var HwSigningWallet = require('../../ga-impl').HwSigningWallet;
var HwWallet = require('./base-hw-wallet');
var TrezorHwWallet = require('./trezor-hw-wallet');

var mockUtxoFactory = {
  listAllUtxo: mockListAllUtxo
};
var mockFeeEstimatesFactory = {
  getFeeEstimate: mockGetFeeEstimate
};

extend(MockUtxo.prototype, {
  getMyPrivateKey: GAUtxo.prototype.getMyPrivateKey,
  getPrevScript: GAUtxo.prototype.getPrevScript,
  getPrevScriptLength: GAUtxo.prototype.getPrevScriptLength,
  getValue: GAUtxo.prototype.getValue,
  _getKey: GAUtxo.prototype._getKey
});

var mnemonic = (
  'warrior success adjust argue snap damp glass ceiling velvet bundle neck ' +
  'crunch copper measure cotton found escape hole apple gesture ramp tell ' +
  'cliff truck'
);
var pubHDWallet = new bitcoinup.SchnorrSigningKey(
  bitcoin.HDNode.fromSeedHex(
    bip39.mnemonicToSeedHex(mnemonic), bitcoin.networks.testnet
  )
);
var privHDWallet = pubHDWallet;

function MockUtxo (utxo) {
  this.prevHash = [].reverse.call(new Buffer(utxo.txhash, 'hex'));
  this.ptIdx = utxo.pt_idx;
  this.value = +utxo.value;
  this.raw = utxo;
  this.data = utxo.data;

  this.subaccount = {name: 'Main', pointer: null, type: 'main'};
}

var mockSigningWallet = new HwSigningWallet({
  hd: privHDWallet.neutered(),
  hw: new TrezorHwWallet(bitcoin.networks.testnet),
  gaService: new GAService('testnet', {
    gaUserPath: new Buffer(
      '0000000000000000000000000000000000000000000000000000000000000000', 'hex'
    )
  })
});

var mockAddressFactory = new AddressFactory(
  {
    call: function () {
      return mockSigningWallet.scriptFactory.create2of2Script(0, 1).then(function(script) {
        return {
          pointer: 1,
          script: script
        };
      });
    }
  }, mockSigningWallet, {}
);

/*
test('wipe trezor', function (t) {
  TrezorHwWallet.checkForDevices().then(function (dev) {
    HwWallet.registerGUICallback('trezorSetupModal', function (opts) {
      opts.finalize();
      return {close: function () { }};
    });
    return dev.setupSeed(mnemonic).then(t.end);
  }).catch(t.fail);
});
*/
test('construct tx', function (t) {
  testChangeOutput(t, 0).then(function () {
    return testChangeOutput(t, 1);
  }).then(function () {
    t.end();
  }, function (e) { console.log(e.stack); t.fail(e); });
});

function testChangeOutput (t, idx) {
  var expected = [
    '010000000158caedb4a165113876d860c5c43e2f2ef854e1c66db3768ee5e4e95f33a3' +
    'de7f0000000049004752210203d19c2b0dd5aa7b11974ced072755ecdfdd81426434ef' +
    '61f20a0da73a7be1fd2103b324f0ccf03db6553aef5424fe221fa538c4d43c715f3bac' +
    '0f350fb6d221a1c552aeffffffff029a7ca4350000000017a9148fbebcf42b4f8af0ad' +
    'f61cef852fede3349a58b387102700000000000017a9144098810ba97acf098d778c36' +
    '538ec82d7516b4e28700000000',
    '010000000158caedb4a165113876d860c5c43e2f2ef854e1c66db3768ee5e4e95f33a3' +
    'de7f0000000049004752210203d19c2b0dd5aa7b11974ced072755ecdfdd81426434ef' +
    '61f20a0da73a7be1fd2103b324f0ccf03db6553aef5424fe221fa538c4d43c715f3bac' +
    '0f350fb6d221a1c552aeffffffff02102700000000000017a9144098810ba97acf098d' +
    '778c36538ec82d7516b4e2879a7ca4350000000017a9148fbebcf42b4f8af0adf61cef' +
    '852fede3349a58b38700000000'
  ][idx];
  console.log(expected);
  var constructor = new TxConstructor({
    signingWallet: mockSigningWallet,
    utxoFactory: mockUtxoFactory,
    changeAddrFactory: mockAddressFactory,
    feeEstimatesFactory: mockFeeEstimatesFactory,
    transactionClass: proxy('../../bitcoinup/transaction', {
      'crypto': {randomBytes: function () { return new Buffer([idx]); }}
    })
  });
  var assetNetworkId = new Buffer(
    '095cdb4b50450887a3fba5fa77bdd7ce969868b78e2e7a75886d8e324c9e331d',
    'hex'
  );
  constructor.buildOptions = {
    assetNetworkId: assetNetworkId,
    feeNetworkId: assetNetworkId
  };
  return constructor.constructTx([
    {value: 10000,
      scriptPubKey: bitcoin.address.toOutputScript(
        '2My8mvjL6r9BpvY11N95jRKdTV4roXvbQQZ', bitcoin.networks.testnet
      )}
  ]).then(function (tx) {
    t.equal(tx.tx.toBuffer().toString('hex'), expected, 'change output at index=' + idx);
  }, function (e) { console.log(e.stack); t.fail(e); });
}

function mockListAllUtxo () {
  var tx = new bitcoin.Transaction();
  tx.addInput(
    new Buffer(
      '0000000000000000000000000000000000000000000000000000000000000000', 'hex'
    ), 0, 0xffffffff, new Buffer('aa', 'hex')
  );
  tx.addOutput(new Buffer('aa', 'hex'), 899985450);
  tx.addOutput(new Buffer('aa', 'hex'), 10000);
  console.log(tx.toHex())
  return Promise.resolve([
    { ga_asset_id: 1,
      pt_idx: 0,
      subaccount: 0,
      value: '899985450',
      block_height: null,
      txhash: tx.getId().toString('hex'),
      pointer: 2,
      data: tx.toBuffer() },
    { ga_asset_id: 1,
      pt_idx: 1,
      subaccount: 0,
      value: '10000',
      block_height: null,
      txhash: tx.getId().toString('hex'),
      pointer: 1,
      data: tx.toBuffer() }
  ].map(function (data) { return new MockUtxo(data); }));
}

function mockGetNextOutputScript () {
  var toHash = (
    '522102964e7b79e43e0df9f5f82862383692dd7ba28cf59ea964ab6ba4add1ccaf55e82' +
    '103ea09b3d655fdffc09870d0bc514c45ffbbde3ec9699412f918b3f037341905d452ae'
  );
  return Promise.resolve(bitcoin.script.scriptHashOutput(
    bitcoin.crypto.hash160(new Buffer(toHash, 'hex'))
  ));
}

function mockGetNextAddress () {
  return this.getNextOutputScript().then(function (script) {
    return bitcoin.address.fromOutputScript(script, bitcoin.networks.testnet);
  });
}

function mockGetFeeEstimate () {
  return [10000, 1];
}
