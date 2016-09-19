var autobahn = require('autobahn');
var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
module.exports = GAService;

extend(GAService.prototype, {
  connect: connect,
  disconnect: disconnect,
  call: call,
  login: login,
  _loginWithSigningWallet: _loginWithSigningWallet,
  _loginWithWatchOnly: _loginWithWatchOnly
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

function login (options, cb, eb) {
  var _this = this;
  this._loginOptions = options;
  if (this._connectInProgress) {
    // Update callbacks in case tx_sender service called connect without them,
    // and then login is called quickly afterwards, before connection is
    // established. This way we avoid making 2 connections at once and still
    // have the callbacks fired.
    this._loginCb = cb;
    this._loginEb = eb;
  } else if (!this.session) {
    this.connect(options, cb, eb);
  } else {
    try {
      if (options.signingWallet) {
        _this._loginWithSigningWallet(options.signingWallet, cb, eb);
      } else {
        var watchOnly = options.watchOnly;
        if (!watchOnly) {
          throw new Error('You must provide either signingWallet or watchOnly!');
        }
        _this._loginWithWatchOnly(watchOnly, cb, eb);
      }
    } catch (e) {
      eb(e);
    }
  }
}

function _loginWithSigningWallet (signingWallet, cb, eb) {
  var _this = this;
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
}

function _loginWithWatchOnly (options, cb, eb) {
  return this.call(
    'com.greenaddress.login.watch_only', [options.tokenType, options.token, false]
  ).then(function (data) {
    cb(JSON.parse(data));
  }).catch(eb);
}

function connect (options, cb, eb) {
  // cb, eb will be called only on successful login
  this.connection = new autobahn.Connection({
    url: this.wsUrl,
    realm: 'realm1'
  });
  this._connectInProgress = true;
  this._loginOptions = options;
  this._loginCb = cb;
  this._loginEb = eb;
  var _this = this;
  this.connection.onopen = function (session) {
    _this.session = session;
    delete _this._connectInProgress;
    if (_this._loginOptions) {
      _this.login(_this._loginOptions, _this._loginCb, _this._loginEb);
    }
    // delete the callbacks to make sure they are used only once
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
