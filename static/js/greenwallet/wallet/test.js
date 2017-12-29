var bitcoin = require('bitcoinjs-lib');
var bitcoinup = require('./bitcoinup');
var TxConstructor = require('./tx-constructor');
var extend = require('xtend/mutable');
var test = require('tape');
var proxy = require('proxyquire');
var GAUtxo = require('./ga-impl').Utxo;
var GAHashSwSigningWallet = require('./ga-impl').HashSwSigningWallet;

var mul = {'BTC': 1, 'mBTC': 1000, 'µBTC': 1000000, 'bits': 1000000}['mBTC'];

var satoshisToUnit = function (amount_satoshi) {
  return parseFloat(  // parseFloat required for iOS Cordova
    amount_satoshi * mul);
};

var mockUtxoFactory = {
  listAllUtxo: mockListAllUtxo
};

var mockAddressFactory = {
  getNextOutputScriptWithPointer: mockGetNextOutputScriptWithPointer,
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

var initialOptions = {
  satoshisToUnit: satoshisToUnit,
  walletUnit: 'mBTC'
};

var coinSelectionTestCases = [
  ['single utxo available',
    {
      utxo: [
        {value: 100000, blockHeight: 1}
      ],
      txValue: 10000, options: initialOptions, utxoExpected: [0]
    }
  ],
  ['8 utxo available, with different blockHeight',
    {
      utxo: [
        {value: 50000, blockHeight: 3},  // 0
        {value: 50000, blockHeight: 2},  // 1
        {value: 100000, blockHeight: 1}, // 2
        {value: 50000, blockHeight: 1},  // 3 - better match for the value
        {value: 3000, blockHeight: 1},   // 4
        {value: 3000, blockHeight: 1},   // 5
        {value: 3000, blockHeight: 1},   // 6
        {value: 50000, blockHeight: 2},  // 7
        {value: 50000, blockHeight: 3}   // 8
      ],
      txValue: 10000, options: initialOptions, utxoExpected: [3]
    }
  ],
  ['18 utxo available, blockHeight match not enough because fee too large',
    {
      utxo: [
        {value: 40, blockHeight: 5}, {value: 40, blockHeight: 5},    // 0,1
        {value: 40, blockHeight: 4}, {value: 40, blockHeight: 4},   // 2,3
        {value: 40, blockHeight: 3}, {value: 40, blockHeight: 3},   // 4,5
        {value: 40, blockHeight: 2}, {value: 40, blockHeight: 2},   // 6,7
        // first choice because lowest blockHeight:
        {value: 40, blockHeight: 1}, {value: 40, blockHeight: 1},   // 8,9
        {value: 40, blockHeight: 2}, {value: 40, blockHeight: 2},   // 10,11
        {value: 40, blockHeight: 3}, {value: 40, blockHeight: 3},   // 12,13
        {value: 40, blockHeight: 4}, {value: 40, blockHeight: 4},   // 14,15
        // 10 satoshi per byte * at least 42 bytes per input * 16 inputs
        // + at least 6720 bytes for output
        // = at least 3376 for fee - not enough if inputs chosen by nblockHeight
        // but the last input is enough to cover the whole tx
        {value: 3900, blockHeight: 10}, // 16 - could be used to cover fee
        {value: 4700, blockHeight: 10}  // 17 - but dust threshold actually requires more
      ],
      txValue: 640, options: initialOptions, utxoExpected: [17]
    }
  ],
  ['3 utxo available, 2 best result in dust output, 3rd needs to be added',
    {
      utxo: [
        {value: 10000, blockHeight: 1}, // 0
        {value: 10000, blockHeight: 1}, // 1
        {value: 19900, blockHeight: 2}  // 2
      ],
      txValue: 19900, options: {mockFee: 0}, utxoExpected: [0, 1, 2]
    }
  ],
  ['do not fail with not enough money with incorrect "next out is enough" check',
    // We had a bug which ignored the 9000-60000 outs because 900 seemed enough,
    // but then turned out to be not enough because of the increaseNeededValueForEachOutputBy
    // increment.
    {
      utxo: [
        {value: 8000000, blockHeight: 1},  // 0
        {value: 900, blockHeight: 1},      // 1
        {value: 9000, blockHeight: 1},     // 2
        {value: 60000, blockHeight: 1}     // 3
      ],
      txValue: 8000000, options: {mockFee: 60000}, utxoExpected: [0, 3]
    }
  ]
];

coinSelectionTestCases.forEach(function (testCase) {
  test('utxo selection: ' + testCase[0], function (t) {
    var currentUtxoFactory = {
      listAllUtxo: listCurrentUtxo
    };
    var constructor = new TxConstructor({
      signingWallet: mockSigningWallet,
      utxoFactory: currentUtxoFactory,
      changeAddrFactory: mockAddressFactory,
      feeEstimatesFactory: mockFeeEstimatesFactory
    });
    var assetNetworkId = new Buffer(
      '095cdb4b50450887a3fba5fa77bdd7ce969868b78e2e7a75886d8e324c9e331d',
      'hex'
    );
    constructor.buildOptions = {
      assetNetworkId: assetNetworkId,
      feeNetworkId: assetNetworkId
    };
    if (testCase[1].options.mockFee !== undefined) {
      mockFeeEstimatesFactory.mockFee = testCase[1].options.mockFee;
    }
    try {
      return constructor.constructTx([
        {
          value: testCase[1].txValue,
          scriptPubKey: bitcoin.address.toOutputScript(
            '2My8mvjL6r9BpvY11N95jRKdTV4roXvbQQZ', bitcoin.networks.testnet
          )
        }
      ], testCase[1].options).then(function (tx) {
        mockFeeEstimatesFactory.mockFee = undefined;
        var utxoActual = tx.tx.ins.map(
          function (i) {
            return i.hash[0];
          }
        ).sort(function (a, b) {
          return a - b;
        });
        t.equal(
          JSON.stringify(utxoActual), JSON.stringify(testCase[1].utxoExpected),
          'utxo = ' + JSON.stringify(testCase[1].utxoExpected)
        );
        t.end();
      }).catch(function (e) {
        mockFeeEstimatesFactory.mockFee = undefined;
        console.log(e.stack);
        t.fail(e);
      });
    } catch (e) {
      mockFeeEstimatesFactory.mockFee = undefined;
    }

    function listCurrentUtxo () {
      return Promise.resolve(testCase[1].utxo.map(function (data, i) {
        return new MockUtxo({
          ga_asset_id: 1,
          pt_idx: 0,
          subaccount: 0,
          value: data.value,
          block_height: data.blockHeight,
          txhash: (
            '0000000000000000000000000000000000000000000000000000000000000000' +
            i.toString(16)
          ).slice(-64),
          pointer: 0
        });
      }));
    }
  });
});

test('instant uses only 6-confs outputs', function (t) {
  // We had a bug which caused the last _collectOutputs from _constructTx
  // to try non-instant inputs in case the initial choice was not enough
  // for change.
  var currentUtxoFactory = {
    listAllUtxo: listCurrentUtxo
  };
  var constructor = new TxConstructor({
    signingWallet: mockSigningWallet,
    utxoFactory: currentUtxoFactory,
    changeAddrFactory: mockAddressFactory,
    feeEstimatesFactory: mockFeeEstimatesFactory
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
    {
      value: 9000, // needs to be low enough to allow the
                   // first check to choose just one output,
                   // to have the last _collectOutputs called.
                   // (the 'neededValueAndChange being Array' case in
                   // _constructTx)
      scriptPubKey: bitcoin.address.toOutputScript(
        '2My8mvjL6r9BpvY11N95jRKdTV4roXvbQQZ', bitcoin.networks.testnet
      )
    }
  ], {minConfs: 6}).then(function (tx) {
    var utxoActual = tx.tx.ins.map(
      function (i) {
        return i.hash[0];
      }
    ).sort(function (a, b) {
      return a - b;
    });
    t.equal(
      JSON.stringify(utxoActual), '[1,2]', 'utxo = [1,2]'
    );
    t.end();
  }).catch(function (e) {
    console.log(e.stack);
    t.fail(e);
  });

  function listCurrentUtxo (options) {
    options = options || {};
    var minConfs = options.minConfs || 1;
    var utxo;
    if (minConfs === 6) {
      utxo = [
        {id: 1, value: 10000, blockHeight: 1},
        {id: 2, value: 10000, blockHeight: 1}
      ];
    } else {
      utxo = [
        {id: 3, value: 10000, blockHeight: 1},
        {id: 4, value: 10000, blockHeight: 1}
      ];
    }
    return Promise.resolve(utxo.map(function (data) {
      return new MockUtxo({
        ga_asset_id: 1,
        pt_idx: 0,
        subaccount: 0,
        value: data.value,
        block_height: data.blockHeight,
        txhash: (
          '0000000000000000000000000000000000000000000000000000000000000000' +
          data.id.toString(16)
        ).slice(-64),
        pointer: 0
      });
    }));
  }
});

function testChangeOutput (t, idx) {
  var expected = [
    '01000000017f26be0b0bd7a00a87970df6b6c811a6faef8d721f13676a32987096b5bb' +
    '9405000000008d0001004190323b08f13c98b5961ef8f1e5ed5dce8168edaabd625c2d' +
    '6d878857f6785cd108d525c9cf19c3017e04f745b0538a29acf4cb0e39d9b03ced9552' +
    '0932c762f40147522102be99138b48b430a8ee40bf8b56c8ebc584c363774010a9bfe5' +
    '49a87126e617462102276463a2a65e26c3d617af43baf7bf10d3426f66162491fb2f89' +
    '3bb1fd1ed7fe52aeffffffff027a120000000000000000000000000000020000000000' +
    '00000000000000000000000000000000000000000000000035a476a00000095cdb4b50' +
    '450887a3fba5fa77bdd7ce969868b78e2e7a75886d8e324c9e331d17a914dce6977353' +
    '0780cbcf0fd40e54c5dd5c302728e98700000000000000000000000000000000000000' +
    '00000000000000000000000027100000095cdb4b50450887a3fba5fa77bdd7ce969868' +
    'b78e2e7a75886d8e324c9e331d17a9144098810ba97acf098d778c36538ec82d7516b4' +
    'e28700000000',
    '01000000017f26be0b0bd7a00a87970df6b6c811a6faef8d721f13676a32987096b5bb' +
    '9405000000008d0001004130e500e61d766930734d531fed8df661f81a7199d872e83b' +
    'abb8fc3f4a5d40e14bb54532a0a5a1607321fb5c0294bcbf022e5c74a18306b2d3af37' +
    'e08f2163800147522102be99138b48b430a8ee40bf8b56c8ebc584c363774010a9bfe5' +
    '49a87126e617462102276463a2a65e26c3d617af43baf7bf10d3426f66162491fb2f89' +
    '3bb1fd1ed7fe52aeffffffff0200000000000000007a12000000000000020000000000' +
    '000000000000000000000000000000000000000000000000000027100000095cdb4b50' +
    '450887a3fba5fa77bdd7ce969868b78e2e7a75886d8e324c9e331d17a9144098810ba9' +
    '7acf098d778c36538ec82d7516b4e28700000000000000000000000000000000000000' +
    '0000000000000000000035a476a00000095cdb4b50450887a3fba5fa77bdd7ce969868' +
    'b78e2e7a75886d8e324c9e331d17a914dce69773530780cbcf0fd40e54c5dd5c302728' +
    'e98700000000'
  ][idx];
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
    t.equal(tx.tx.toBuffer().toString('hex'), expected, 'change output at index=' + idx);
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

function mockGetNextOutputScriptWithPointer () {
  var toHash = (
  '522102964e7b79e43e0df9f5f82862383692dd7ba28cf59ea964ab6ba4add1ccaf55e82' +
    '103ea09b3d655fdffc09870d0bc514c45ffbbde3ec9699412f918b3f037341905d452ae'
  );
  return Promise.resolve({
    subaccount: 0,
    pointer: 1,
    outScript: bitcoin.script.scriptHash.output.encode(
      bitcoin.crypto.hash160(new Buffer(toHash, 'hex'))
    )
  });
}

function mockGetNextAddress () {
  return this.getNextOutputScript().then(function (script) {
    return bitcoin.address.fromOutputScript(script, bitcoin.networks.testnet);
  });
}

function mockGetFeeEstimate () {
  return [this.mockFee !== undefined ? this.mockFee : 10000, 1];
}
