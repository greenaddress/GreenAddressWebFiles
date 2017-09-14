var wally = require('wallyjs');
var bitcoin = require('bitcoinjs-lib');
var test = require('tape');
var bip39 = require('bip39');
var wallet = require('..');

bitcoin.networks.testnet.pubKeyHash = 235;
bitcoin.networks.testnet.scriptHash = 40;
// BTC_BLINDED_VERSION = 4

test('CA', function (t) {
  wally.wally_sha256(new Buffer('ca_spender', 'ascii')).then(function (entropy) {
    var mnemonic = bip39.entropyToMnemonic(new Buffer(entropy));
    var seed = bip39.mnemonicToSeed(mnemonic);
    var userWallet = new wallet.GA.AssetsWallet({
      unblindedCache: {},
      signingWalletOptions: {
        hd: new wallet.bitcoinup.SchnorrSigningKey(
          bitcoin.HDNode.fromSeedHex(new Buffer(seed).toString('hex'), bitcoin.networks.testnet),
          {mnemonic: mnemonic}
        )
      },
      SigningWalletClass: wallet.GA.HashSwSigningWallet
    });
    userWallet.loggedIn.then(function () {
      var constructor = userWallet.txConstructors[2][0];
      constructor.constructTx([
        {
          value: 100,
          ctDestination: {
            b58: 'CTEtVRtWbHLX5rkSM8fNhkcouAHkwF6KRUC7w5MCUEpBY3kFRwYeFR15UuHdpR2KNAGN5ruFDNQMHo9v',
            network: bitcoin.networks.testnet
          }
        }
      ]).then(function (tx) {
        userWallet.service.call(
          'com.greenaddress.vault.send_raw_tx', [tx.toBuffer(true).toString('hex')]
        );
      }).catch(function (e) {
        console.log(e);
      });
    }).catch(function (e) { console.log(e); });
  });
});
