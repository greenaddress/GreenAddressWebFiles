var bitcoin = require('bitcoinjs-lib');
var bitcoinup = require('./bitcoinup');
var TxConstructor = require('./tx-constructor');
var extend = require('xtend/mutable');
var test = require('tape');
var proxy = require('proxyquire');
var GAUtxo = require('./ga-impl').Utxo;
var GAHashSwSigningWallet = require('./ga-impl').HashSwSigningWallet;

var mockUtxoFactory = {
  listAllUtxo: mockListAllUtxo
};

var mockAddressFactory = {
  getNextOutputScript: mockGetNextOutputScript,
  getNextAddress: mockGetNextAddress
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

var pubHDWallet = new bitcoinup.SchnorrSigningKey(
  bitcoin.HDNode.fromSeedHex(
    new Buffer(new Array(16)).toString('hex'), bitcoin.networks.testnet
  )
);
var privHDWallet = pubHDWallet;

function MockUtxo (utxo) {
  this.prevHash = [].reverse.call(new Buffer(utxo.txhash, 'hex'));
  this.ptIdx = utxo.pt_idx;
  this.value = +utxo.value;
  this.raw = utxo;

  this.subaccount = {name: 'Main', pointer: null, type: 'main'};
}

var mockSigningWallet = new GAHashSwSigningWallet({
  hd: privHDWallet,
  schnorrTx: true
});

mockSigningWallet.keysManager.getGAPublicKey = function () {
  return pubHDWallet;
};

test('construct tx', function (t) {
  testChangeOutput(t, 0).then(function () {
    return testChangeOutput(t, 1);
  }).then(function () {
    t.end();
  }, function (e) { console.log(e.stack); t.fail(e); });
});

function testChangeOutput (t, idx) {
  var expected = [
    '01000000017f26be0b0bd7a00a87970df6b6c811a6faef8d721f13676a32987096b5bb' +
    '9405000000008d000100414c4d1e136825252eb7ac23ef52eb5aa0715e1d678be0a774' +
    'e2f377423008be701cda2564043e9b5b888191a823227b8559584a538ed9a44599249e' +
    'e8e60f34d40147522102be99138b48b430a8ee40bf8b56c8ebc584c363774010a9bfe5' +
    '49a87126e617462102276463a2a65e26c3d617af43baf7bf10d3426f66162491fb2f89' +
    '3bb1fd1ed7fe52aeffffffff02c6110000000000000000000000000000020000000000' +
    '00000000000000000000000000000000000000000000000035a477540000095cdb4b50' +
    '450887a3fba5fa77bdd7ce969868b78e2e7a75886d8e324c9e331d17a914dce6977353' +
    '0780cbcf0fd40e54c5dd5c302728e98700000000000000000000000000000000000000' +
    '00000000000000000000000027100000095cdb4b50450887a3fba5fa77bdd7ce969868' +
    'b78e2e7a75886d8e324c9e331d17a9144098810ba97acf098d778c36538ec82d7516b4' +
    'e28700000000',
    '01000000017f26be0b0bd7a00a87970df6b6c811a6faef8d721f13676a32987096b5bb' +
    '9405000000008d00010041c00e2a98ee90df92064aa664df4cb77bd470506c6d50f5ea' +
    'efd80b8fcad9720137c9f6c70960d1b3231af8868d3af89269984cfaf3340231f39869' +
    '926083f3a70147522102be99138b48b430a8ee40bf8b56c8ebc584c363774010a9bfe5' +
    '49a87126e617462102276463a2a65e26c3d617af43baf7bf10d3426f66162491fb2f89' +
    '3bb1fd1ed7fe52aeffffffff020000000000000000c611000000000000020000000000' +
    '000000000000000000000000000000000000000000000000000027100000095cdb4b50' +
    '450887a3fba5fa77bdd7ce969868b78e2e7a75886d8e324c9e331d17a9144098810ba9' +
    '7acf098d778c36538ec82d7516b4e28700000000000000000000000000000000000000' +
    '0000000000000000000035a477540000095cdb4b50450887a3fba5fa77bdd7ce969868' +
    'b78e2e7a75886d8e324c9e331d17a914dce69773530780cbcf0fd40e54c5dd5c302728' +
    'e98700000000'
  ][idx];
  console.log(expected);
  var constructor = new TxConstructor({
    signingWallet: mockSigningWallet,
    utxoFactory: mockUtxoFactory,
    changeAddrFactory: mockAddressFactory,
    feeEstimatesFactory: mockFeeEstimatesFactory,
    transactionClass: proxy('./bitcoinup/assets-transaction', {
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
    t.equal(tx.tx.toString('hex'), expected, 'change output at index=' + idx);
  }, function (e) { console.log(e.stack); t.fail(e); });
}

function mockListAllUtxo () {
  return Promise.resolve([
    { ga_asset_id: 1,
      pt_idx: 0,
      subaccount: 0,
      value: '899985450',
      block_height: null,
      txhash: '0594bbb5967098326a67131f728deffaa611c8b6f60d97870aa0d70b0bbe267f',
    pointer: 2 },
    { ga_asset_id: 1,
      pt_idx: 1,
      subaccount: 0,
      value: '10000',
      block_height: null,
      txhash: '0594bbb5967098326a67131f728deffaa611c8b6f60d97870aa0d70b0bbe267f',
    pointer: 1 }
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
