var autobahn = require('autobahn');
var bitcoin = require('bitcoinjs-lib');
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

function connect (signingWallet, cb, eb) {
  this.connection = new autobahn.Connection({
    url: 'ws://localhost:8080/v2/ws',
    realm: 'realm1'
  });
  var _this = this;
  this.connection.onopen = function (session) {
    try {
      _this.session = session;
      return signingWallet.getChallengeArguments().then(function (args) {
        return _this.call.call(_this, args[ 0 ], args.slice(1)); // eslint-disable-line
      }).then(function (challenge) {
        return signingWallet.signChallenge(challenge);
      }).then(function (signed) {
        var signature = signed.signature;
        var randomPathHex = signed.path;
        return _this.call('com.greenaddress.login.authenticate',
          [ [signature.r.toString(), signature.s.toString()], false, randomPathHex ]
        );
      }).then(function (data) {
        if (data === false) {
          eb('Login failed');
        } else {
          // data contains some wallet configuration data
          if (data.gait_path) {
            _this.gaUserPath = new Buffer(data.gait_path, 'hex');
            cb(data);
          } else {
            // first login -- we need to set up the path
            var pathPromise = signingWallet.derivePath();
            return pathPromise.then(function (path) {
              var pathHex = path.toString('hex');
              return _this.call(
                'com.greenaddress.login.set_gait_path', [ pathHex ]
              ).then(function () {
                data.gait_path = pathHex;
                _this.gaUserPath = path;
                cb(data);
              });
            });
          }
        }
      }).catch(eb);
    } catch (e) {
      eb(e);
    }
  };
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
