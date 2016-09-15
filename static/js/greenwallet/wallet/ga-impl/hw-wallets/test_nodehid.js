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
  this.data = utxo.data;
  this.subaccount = utxo.subaccount;
  this.raw = utxo;
  this.raw.subaccount = this.subaccount.pointer;
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
      mockAddressFactory.subaccount = cur_subaccount;
      return mockSigningWallet.scriptFactory.create2of2Script(
        cur_subaccount.pointer, 1
      ).then(function (script) {
        return {
          pointer: 1,
          script: script
        };
      });
    }
  }, mockSigningWallet, {}
);


test('wipe trezor', function (t) {
  TrezorHwWallet.checkForDevices().then(function (dev) {
    HwWallet.registerGUICallback('trezorSetupModal', function (opts) {
      opts.finalize();
      return {close: function () { }};
    });
    return dev.setupSeed(mnemonic).then(t.end);
  }).catch(t.fail);
});

test('construct tx', function (t) {
  var runTests = [
    // [subaccount, changeIdx]
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
    [2, 0]
  ];
  var test_d = Promise.resolve();
  runTests.forEach(function (test) {
    var subaccount = test[0];
    var changeIdx = test[1];
    test_d = test_d.then(function () {
      return testChangeOutput(t, subaccount, changeIdx);
    });
  });
  test_d.then(function () {
    t.end();
  }, function (e) { console.log(e.stack); t.fail(e); });
});

function testChangeOutput (t, subaccount, changeIdx) {
  var expected = [
    ['010000000158caedb4a165113876d860c5c43e2f2ef854e1c66db3768ee5e4e95f33a3de' +
    '7f0000000049004752210390bc6488ae93f5b7e2dcb934f85a6b7e1d5930f06d3cec37e77' +
    '88f19ea41b3e62103b324f0ccf03db6553aef5424fe221fa538c4d43c715f3bac0f350fb6' +
    'd221a1c552aeffffffff029a7ca4350000000017a9148fbebcf42b4f8af0adf61cef852fe' +
    'de3349a58b387102700000000000017a9144098810ba97acf098d778c36538ec82d7516b4' +
    'e28700000000',
    '010000000158caedb4a165113876d860c5c43e2f2ef854e1c66db3768ee5e4e95f33a3de7' +
    'f0000000049004752210390bc6488ae93f5b7e2dcb934f85a6b7e1d5930f06d3cec37e778' +
    '8f19ea41b3e62103b324f0ccf03db6553aef5424fe221fa538c4d43c715f3bac0f350fb6d' +
    '221a1c552aeffffffff02102700000000000017a9144098810ba97acf098d778c36538ec8' +
    '2d7516b4e2879a7ca4350000000017a9148fbebcf42b4f8af0adf61cef852fede3349a58b' +
    '38700000000'],
    ['010000000158caedb4a165113876d860c5c43e2f2ef854e1c66db3768ee5e4e95f33a3de' +
    '7f00000000490047522102fe4767768d35e6f7e7a7c023923535d1b70552cb6a46dce21e4' +
    'e74924717db91210374915ad1f9e5bdd20e9818ded99d59bd33cea0479d0c8810c31ecf6d' +
    '2c76e6ad52aeffffffff029a7ca4350000000017a914327b4505d212c3a78460245e85101' +
    '5b90d23c2c487102700000000000017a9144098810ba97acf098d778c36538ec82d7516b4' +
    'e28700000000',
    '010000000158caedb4a165113876d860c5c43e2f2ef854e1c66db3768ee5e4e95f33a3de7' +
    'f00000000490047522102fe4767768d35e6f7e7a7c023923535d1b70552cb6a46dce21e4e' +
    '74924717db91210374915ad1f9e5bdd20e9818ded99d59bd33cea0479d0c8810c31ecf6d2' +
    'c76e6ad52aeffffffff02102700000000000017a9144098810ba97acf098d778c36538ec8' +
    '2d7516b4e2879a7ca4350000000017a914327b4505d212c3a78460245e851015b90d23c2c' +
    '48700000000'],
    ['010000000158caedb4a165113876d860c5c43e2f2ef854e1c66db3768ee5e4e95f33a3de' +
    '7f000000006c004c6952210360c7e0273bcecbb311c4cd8b60d212ce15a29f436368e4f1e' +
    '0ec0552e8eb42f7210327e443d836fee5927d04ad6e4bfae8579e8b0085a52917147c5eb4' +
    '447ff9fe562103bd1d41bd846d5a20e199d8861aa1ce36a08b6e3b4259fb3766a57f39255' +
    '786c453aeffffffff02327ba4350000000017a91462a6857cf25470a69ee22907f740193b' +
    'ac5272bd87102700000000000017a9144098810ba97acf098d778c36538ec82d7516b4e28' +
    '700000000']
  ][subaccount][changeIdx];
  cur_subaccount = subaccounts[subaccount];
  var constructor = new TxConstructor({
    signingWallet: mockSigningWallet,
    utxoFactory: mockUtxoFactory,
    changeAddrFactory: mockAddressFactory,
    feeEstimatesFactory: mockFeeEstimatesFactory,
    transactionClass: proxy('../../bitcoinup/transaction', {
      'crypto': {randomBytes: function () { return new Buffer([changeIdx]); }}
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
    t.equal(
      tx.tx.toBuffer().toString('hex'), expected,
      'subaccount=' + subaccount + ', change output at index=' + changeIdx);
  }, function (e) { console.log(e.stack); t.fail(e); });
}

var subaccounts = [
  {pointer: null, type: 'main'},
  {pointer: 1, type: '2of2'},
  {pointer: 2, type: '2of3',
   '2of3_backup_chaincode': '4b6c6f7dce92180b1a66e86da1679153d8628ea619f2ba2a69395c3997ca39c3',
   '2of3_backup_pubkey': '02a20a7954b65e22a481483935584dae338422ff957f8cd11a905fb7ceec707762'}
];
var cur_subaccount = subaccounts[0];

function mockListAllUtxo () {
  var tx = new bitcoin.Transaction();
  tx.addInput(
    new Buffer(
      '0000000000000000000000000000000000000000000000000000000000000000', 'hex'
    ), 0, 0xffffffff, new Buffer('aa', 'hex')
  );
  tx.addOutput(new Buffer('aa', 'hex'), 899985450);
  tx.addOutput(new Buffer('aa', 'hex'), 10000);
  return Promise.resolve([
    { ga_asset_id: 1,
      pt_idx: 0,
      subaccount: cur_subaccount,
      value: '899985450',
      block_height: null,
      txhash: tx.getId().toString('hex'),
      pointer: 2,
      data: tx.toBuffer() },
    { ga_asset_id: 1,
      pt_idx: 1,
      subaccount: cur_subaccount,
      value: '10000',
      block_height: null,
      txhash: tx.getId().toString('hex'),
      pointer: 1,
      data: tx.toBuffer() }
  ].map(function (data) { return new MockUtxo(data); }));
}

function mockGetFeeEstimate () {
  return [10000, 1];
}
