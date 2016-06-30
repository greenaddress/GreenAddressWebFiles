var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');

var HWWallet = require('./hw-wallet');

module.exports = TrezorHWWallet;

TrezorHWWallet.prototype = new HWWallet();
extend(TrezorHWWallet.prototype, {
  deviceTypeName: 'TREZOR',
  promptPin: promptPin,
  promptPassphrase: promptPassphrase,
  handleButton: handleButton,
  handleError: handleError,
  registerPinCallback: registerPinCallback,
  registerPassphraseCallback: registerPassphraseCallback,
  registerButtonCallback: registerButtonCallback,
  registerErrorCallback: registerErrorCallback,
  getChallengeArguments: getChallengeArguments,
  getRootPublicKey: getRootPublicKey,
  signMessage: signMessage
});
TrezorHWWallet.checkForDevices = checkForDevices;

function TrezorHWWallet (device, network) {
  this.device = device;
  this.network = network;

  device.on('pin', this.promptPin);
  device.on('passphrase', this.promptPassphrase);
  device.on('error', this.handleError);
  device.on('button', this.handleButton);
}

var trezor_api;

function promptPin () {
  if (this.pinCb) this.pinCb();
}

function promptPassphrase () {
  if (this.passphraseCb) this.passphraseCb();
}

function handleButton () {
  if (this.buttonCb) this.buttonCb();
}

function handleError () {
  if (this.errorCb) this.errorCb();
}

function registerPinCallback (cb) {
  this.pinCb = cb;
}

function registerPassphraseCallback (cb) {
  this.passphraseCb = cb;
}

function registerButtonCallback (cb) {
  this.buttonCb = cb;
}

function registerErrorCallback (cb) {
  this.errorCb = cb;
}

function getRootPublicKey () {
  var _this = this;
  if (this.rootPublicKey) {
    return Promise.resolve(this.rootPublicKey);
  } else {
    return this.device.getPublicKey([]).then(function (pubkey) {
      var pk = pubkey.message.node.public_key;
      pk = pk.toHex ? pk.toHex() : pk;
      var keyPair = new bitcoin.ECPair.fromPublicKeyBuffer(
        new Buffer(pk, 'hex'),
        _this.network
      );
      var cc = pubkey.message.node.chain_code;
      cc = cc.toHex ? cc.toHex() : cc;
      var chainCode = new Buffer(cc, 'hex');
      var hdwallet = new bitcoin.HDNode(keyPair, chainCode);
      _this.rootPublicKey = hdwallet;
      return hdwallet;
    });
  }
}

function signMessage (path, message) {
  return this.device._typedCommonCall('SignMessage', 'MessageSignature', {'message': message, address_n: path})
    .then(function (res) {
      var sig = res.message.signature;
      sig = sig.toHex ? sig.toHex() : sig;
      var signature = bitcoin.ECSignature.parseCompact(new Buffer(sig, 'hex'));
      return {r: signature.signature.r, s: signature.signature.s, i: signature.i};
    });
}

function getChallengeArguments () {
  return this.getRootPublicKey().then(function(hdWallet) {
    return [ "com.greenaddress.login.get_trezor_challenge", hdWallet.keyPair.getAddress(), true ];
  });
}

function checkForDevices (network) {
  var is_chrome_app = require('has-chrome-storage');
  if (!is_chrome_app) return;

  if (TrezorHWWallet.isChecking) return;
  TrezorHWWallet.isChecking = true;

  var tick, plugin_d;

  if (trezor_api) {
    plugin_d = Promise.resolve(trezor_api);
  } else {
    plugin_d = window.trezor.load();
  }
  plugin_d.then(function (api) {
    trezor_api = api;
    tick = setInterval(function () {
      trezor_api.devices().then(function (devices) {
        if (devices.length) {
          clearInterval(tick);
          TrezorHWWallet.isChecking = false;

          trezor_api.open(devices[0]).then(function (dev_) {

            dev_.initialize().then(function (init_res) {
              var outdated = false;
              if (init_res.message.major_version < 1) outdated = true;
              else if (init_res.message.major_version === 1 &&
                init_res.message.minor_version < 3) outdated = true;
              if (outdated) {
                HWWallet.registerError({
                  outdatedFirmware: true,
                  message: gettext(
                    'Outdated firmware. Please upgrade to at least 1.3.0 at http://mytrezor.com/'
                  ),
                  recoverable: false
                });
              } else {
                HWWallet.register(new TrezorHWWallet(dev_, network));
              }
            });
          }, function (err) {
            console.error(err.stack || err);
            HWWallet.registerError('Opening device failed');
          });
        }
      });
    }, 1000);
  }).catch(function () {
    HWWallet.registerError({
      pluginLoadFailed: true,
      message: gettext('TREZOR plugin load failed!'),
      recoverable: false
    });
  });
}
