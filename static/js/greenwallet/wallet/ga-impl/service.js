var autobahn = require('autobahn');
var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var bip39 = require('bip39');
var extend = require('xtend/mutable');
var pbkdf2 = require('pbkdf2').pbkdf2Sync;
var sha512 = require('sha512');
var SchnorrSigningKey = require('../bitcoinup/schnorr-signing-key.js');

module.exports = GAService;

extend(GAService.prototype, {
  deriveHD: deriveHD,
  getGAHDNode: getGAHDNode,
  connect: connect,
  disconnect: disconnect,
  call: call
});
GAService.derivePath = derivePath;

function GAService (netName) {
  this.netName = netName || 'testnet';
  if (this.netName === 'testnet') {
    this.gaHDNode = new bitcoin.HDNode(
      bitcoin.ECPair.fromPublicKeyBuffer(
        new Buffer(
          // ga testnet pubkey
          '036307e560072ed6ce0aa5465534fb5c258a2ccfbc257f369e8e7a181b16d897b3',
          'hex'
        ),
        bitcoin.networks['testnet']
      ),
      new Buffer(
        // ga testnet chaincode
        'b60befcc619bb1c212732770fe181f2f1aa824ab89f8aab49f2e13e3a56f0f04',
        'hex'
      )
    );
  }
}

function deriveHD (mnemonic) {
  var curNet = bitcoin.networks[this.netName];  // 'testnet' for testnet
  var seed = bip39.mnemonicToSeedHex(mnemonic);  // this is slow, perhaps move to a webworker
  return Promise.resolve(
    new SchnorrSigningKey(bitcoin.HDNode.fromSeedHex(seed, curNet))
  );
}

function derivePathSeed (mnemonic) {
  var mnemonicBuffer = new Buffer(mnemonic, 'utf8');
  var saltBuffer = new Buffer('greenaddress_path', 'utf8');

  return pbkdf2(mnemonicBuffer, saltBuffer, 2048, 64, 'sha512');
}

function derivePath (mnemonic) {
  var seedBuffer = derivePathSeed(mnemonic);
  var hasher = sha512.hmac('GreenAddress.it HD wallet path');
  return hasher.finalize(seedBuffer);
}

function connect (hd, mnemonic, cb, eb) {
  this.connection = new autobahn.Connection({
    url: 'ws://localhost:8080/v2/ws',
    realm: 'realm1'
  });
  this.connection.onopen = function (session) {
    try {
      this.session = session;
      return this.call('com.greenaddress.login.get_challenge',
        [ hd.getAddress() ]).then(function (challenge) {
          var challengeBuf = new BigInteger(challenge).toBuffer();
          return hd.signHash(challengeBuf);
        }).then(function (signature) {
          return this.call('com.greenaddress.login.authenticate',
            [ Array.prototype.slice.call(signature), false ]
          );
        }.bind(this)).then(function (data) {
          if (data === false) {
            eb('Login failed');
          } else {
            // data contains some wallet configuration data
            if (data.gait_path) {
              this.gaPath = new Buffer(data.gait_path, 'hex');
              cb(data);
            } else {
              // first login -- we need to set up the path
              var pathHex = GAService.derivePath(mnemonic).toString('hex');
              this.call(
                'com.greenaddress.login.set_gait_path', [pathHex]
              ).then(function () {
                data.gait_path = pathHex;
                this.gaPath = new Buffer(pathHex, 'hex');
                cb(data);
              }.bind(this), eb);
            }
          }
        }.bind(this), eb);
    } catch (e) {
      eb(e);
    }
  }.bind(this);
  this.connection.onclose = eb;
  this.connection.open();
}

function disconnect () {
  delete this.connection.onclose;
  this.connection.close();
}

function call (uri, args) {
  return this.session.call(uri, args);
}

function _subpath (hd, pathBuffer) {
  var copy = new Buffer(pathBuffer);
  for (var i = 0; i < 32; i++) {
    hd = hd.derive(+BigInteger.fromBuffer(copy.slice(0, 2)));
    copy = copy.slice(2);
  }
  return hd;
}

function getGAHDNode (subaccount) {
  var gaNode = this.gaHDNode;
  if (subaccount) {
    gaNode = _subpath(gaNode.derive(3), this.gaPath).derive(subaccount);
  } else {
    gaNode = _subpath(gaNode.derive(1), this.gaPath);
  }
  return gaNode;
}