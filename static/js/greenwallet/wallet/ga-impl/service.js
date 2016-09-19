var autobahn = require('autobahn');
var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
module.exports = GAService;

extend(GAService.prototype, {
  connect: connect,
  disconnect: disconnect,
  call: call,
  login: login
});

function GAService (netName, options) {
  options = options || {};
  this.gaUserPath = options.gaUserPath;
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
  this.wsUrl = options.wsUrl || 'ws://localhost:8080/v2/ws';
}

function login (signingWallet, cb, eb) {
  var _this = this;
  this._signingWallet = signingWallet;
  if (this._connectInProgress) {
    this._loginCb = cb;
    this._loginEb = eb;
  } else if (!this.session) {
    this.connect(signingWallet, cb, eb);
  } else {
    try {
      return signingWallet.getChallengeArguments().then(function (args) {
        return _this.call.call(_this, args[ 0 ], args.slice(1)); // eslint-disable-line
      }).then(function (challenge) {
        return signingWallet.signChallenge(challenge);
      }).then(function (signed) {
        var signature = signed.signature;
        var randomPathHex = signed.path;
        return _this.call('com.greenaddress.login.authenticate',
          [ signature, false, randomPathHex ]
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
            // *NOTE*: don't change the path after signup, because it *will*
            //         cause locked funds
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
  }
}

function connect (signingWallet, cb, eb) {
  this.connection = new autobahn.Connection({
    url: this.wsUrl,
    realm: 'realm1'
  });
  this._connectInProgress = true;
  this._signingWallet = signingWallet;
  this._loginCb = cb;
  this._loginEb = eb;
  var _this = this;
  this.connection.onopen = function (session) {
    _this.session = session;
    delete _this._connectInProgress;
    if (_this._signingWallet) {
      _this.login(_this._signingWallet, _this._loginCb, _this._loginEb);
    }
    delete _this._loginCb;
    delete _this._loginEb;
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
