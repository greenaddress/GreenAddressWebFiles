var bitcoin = require('bitcoinjs-lib');
var test = require('tape');
var SchnorrSigningKey = require('./schnorr-signing-key');

var testKey = new SchnorrSigningKey(bitcoin.HDNode.fromSeedHex(
  new Buffer(new Array(16)), bitcoin.networks.testnet
));

test('sign with plain ecdsa', function (t) {
  testKey.signHash(new Uint8Array(32)).then(function (signature) {
    t.equal(
      signature.r.toString(),
      '47327661853837316749706525471602232479695825679526551970632217348679308083440',
      'signature.r equals the expected value'
    );
    t.equal(
      signature.s.toString(),
      '53347192737374997935654279548444756898005173666183971520728481817152115246343',
      'signature.s equals the expected value'
    );
    t.end();
  }).catch(t.fail);
});

test('sign with Schnorr', function (t) {
  testKey.signHashSchnorr(new Uint8Array(32)).then(function (signature) {
    t.equal(
      signature.toString('hex'),
      '46f7ab95c516e0d77425a3592f21829119fb17b80356ace98055264b10584f9f' +
      'cfd7f5aa03b22112ef11231e224b6bd27c5be47d4ad47452075d435f4081a5a4',
      'signature equals the expected value'
    );
    t.end();
  }).catch(t.fail);
});
