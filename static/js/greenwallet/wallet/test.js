var bitcoin = require('bitcoinjs-lib');
var bitcoinup = require('./bitcoinup');
var TxConstructor = require('./tx-constructor');
var extend = require('xtend/mutable');
var test = require('tape');
var proxy = require('proxyquire');
var GAUtxo = require('./ga-impl').Utxo;

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
  getPubKey: GAUtxo.prototype.getPubKey,
  getSigningKey: GAUtxo.prototype.getSigningKey,
  getPrevScript: GAUtxo.prototype.getPrevScript,
  getPrevScriptLength: GAUtxo.prototype.getPrevScriptLength,
  _getKey: GAUtxo.prototype._getKey
});

function MockUtxo (utxo) {
  this.prevHash = [].reverse.call(new Buffer(utxo.txhash, 'hex'));
  this.ptIdx = utxo.pt_idx;
  this.value = +utxo.value;
  this.raw = utxo;

  // mock the hd keys
  this.gaService = {
    getGAHDNode: function () {
      return this.pubHDWallet.hdnode;
    }.bind(this)
  };

  this.pubHDWallet = new bitcoinup.SchnorrSigningKey(
    bitcoin.HDNode.fromSeedHex(
      new Buffer(new Array(16)), bitcoin.networks.testnet
    )
  );
  this.privHDWallet = this.pubHDWallet;
}

test('construct tx', function (t) {
  testChangeOutput(t, 0).then(function () {
    return testChangeOutput(t, 1);
  }).then(function () {
    t.end();
  }, t.fail);
});

function testChangeOutput (t, idx) {
  var expected = [
    '01000000017f26be0b0bd7a00a87970df6b6c811a6faef8d721f13676a32987096b5bb' +
    '9405000000008d00010041fc04e59f9a8c8fa9c1eca16bac056817525c1e546db05af6' +
    '377670027c24425748961d54287cc424b95372056f83aa9f9382d6aef676aeaf81f135' +
    'bbef01e02a01475221022b8989e24ecd8339c856ac385ced4ac3e3ec3cbe4120cceaa4' +
    '0d0edd70a420e52102276463a2a65e26c3d617af43baf7bf10d3426f66162491fb2f89' +
    '3bb1fd1ed7fe52aeffffffff02c6110000000000000000000000000000020000000000' +
    '00000000000000000000000000000000000000000000000035a4775400001d339e4c32' +
    '8e6d88757a2e8eb7689896ced7bd77faa5fba3870845504bdb5c0917a914dce6977353' +
    '0780cbcf0fd40e54c5dd5c302728e98700000000000000000000000000000000000000' +
    '000000000000000000000000271000001d339e4c328e6d88757a2e8eb7689896ced7bd' +
    '77faa5fba3870845504bdb5c0917a9144098810ba97acf098d778c36538ec82d7516b4' +
    'e28700000000',
    '01000000017f26be0b0bd7a00a87970df6b6c811a6faef8d721f13676a32987096b5bb' +
    '9405000000008d00010041fdffa0a73c0c4355b1ac512e478255f97595ccea0d1d855e' +
    'b4509820b730ca2eafa68bec21b3c1bd69ce6f6b6fbbe1a3a4aadb9b5d4444adeb25e3' +
    'b95d3d1c6201475221022b8989e24ecd8339c856ac385ced4ac3e3ec3cbe4120cceaa4' +
    '0d0edd70a420e52102276463a2a65e26c3d617af43baf7bf10d3426f66162491fb2f89' +
    '3bb1fd1ed7fe52aeffffffff020000000000000000c611000000000000020000000000' +
    '0000000000000000000000000000000000000000000000000000271000001d339e4c32' +
    '8e6d88757a2e8eb7689896ced7bd77faa5fba3870845504bdb5c0917a9144098810ba9' +
    '7acf098d778c36538ec82d7516b4e28700000000000000000000000000000000000000' +
    '0000000000000000000035a4775400001d339e4c328e6d88757a2e8eb7689896ced7bd' +
    '77faa5fba3870845504bdb5c0917a914dce69773530780cbcf0fd40e54c5dd5c302728' +
    'e98700000000'
  ][idx];
  var constructor = new TxConstructor({
    utxoFactory: mockUtxoFactory,
    changeAddrFactory: mockAddressFactory,
    feeEstimatesFactory: mockFeeEstimatesFactory,
    transactionClass: proxy('./bitcoinup/assets-transaction', {
      'crypto': {randomBytes: function () { return new Buffer([idx]); }}
    })
  });
  return constructor.constructTx([
    {value: 10000,
     scriptPubKey: bitcoin.address.toOutputScript(
       '2My8mvjL6r9BpvY11N95jRKdTV4roXvbQQZ', bitcoin.networks.testnet
     )}
  ]).then(function (tx) {
    t.equal(tx.toString('hex'), expected, 'change output at index=' + idx);
  }, t.fail);
}

function mockListAllUtxo () {
  return Promise.resolve([
    { asset_id: 1,
      pt_idx: 0,
      subaccount: 0,
      value: '899985450',
      block_height: null,
      txhash: '0594bbb5967098326a67131f728deffaa611c8b6f60d97870aa0d70b0bbe267f',
      pointer: 2 },
    { asset_id: 1,
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