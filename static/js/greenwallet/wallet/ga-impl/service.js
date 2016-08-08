var autobahn = require('autobahn');
var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var crypto = require('crypto');
var extend = require('xtend/mutable');
module.exports = GAService;

extend(GAService.prototype, {
  connect: connect,
  disconnect: disconnect,
  call: call
});

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

function connect (hd, cb, eb) {
  this.connection = new autobahn.Connection({
    url: 'ws://localhost:8080/v2/ws',
    realm: 'realm1'
  });
  this.connection.onopen = function (session) {
    try {
      this.session = session;
      var randomPathHex = (BigInteger
          .fromBuffer(crypto.randomBytes(8))
          .toString(16)
      );
      while (randomPathHex.length < 16) {
        randomPathHex = '0' + randomPathHex;
      }
      return this.call('com.greenaddress.login.get_challenge',
        [ hd.getAddress() ]).then(function (challenge) {
          var challengeBuf = new BigInteger(challenge).toBuffer();
          var pathBytes = new Buffer(randomPathHex, 'hex');
          var key = Promise.resolve(hd);
          for (var i = 0; i < 4; i++) {
            key = key.then(function (key) {
              var dk = key.derive(+BigInteger.fromBuffer(pathBytes.slice(0, 2)));
              pathBytes = pathBytes.slice(2);
              return dk;
            });
          }
          return key.then(function (key) {
            return key.signHash(challengeBuf);
          });
        }).then(function (signature) {
          return this.call('com.greenaddress.login.authenticate',
            [ [signature.r.toString(), signature.s.toString()], false, randomPathHex ]
          );
        }.bind(this)).then(function (data) {
          if (data === false) {
            eb('Login failed');
          } else {
            // data contains some wallet configuration data
            if (data.gait_path) {
              this.gaUserPath = new Buffer(data.gait_path, 'hex');
              cb(data);
            } else {
              // first login -- we need to set up the path
              var pathHex = hd.derivePath().toString('hex');
              this.call(
                'com.greenaddress.login.set_gait_path', [pathHex]
              ).then(function () {
                data.gait_path = pathHex;
                this.gaUserPath = new Buffer(pathHex, 'hex');
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
