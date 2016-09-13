var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
var SchnorrSigningKey = require('../../bitcoinup/schnorr-signing-key');
var window = require('global/window');

var gettext = window.gettext;

var HWWallet = require('./base-hw-wallet');

module.exports = TrezorHWWallet;

TrezorHWWallet.prototype = Object.create(HWWallet.prototype);
extend(TrezorHWWallet.prototype, {
  deviceTypeName: 'TREZOR',
  getChallengeArguments: getChallengeArguments,
  getPublicKey: getPublicKey,
  signMessage: signMessage,
  setupSeed: setupSeed,
  _recovery: _recovery,
  getDevice: getDevice
});
TrezorHWWallet.checkForDevices = checkForDevices;
TrezorHWWallet.foundCbs = [];
TrezorHWWallet.missingCbs = [];
TrezorHWWallet.missingCbsOnce = [];
TrezorHWWallet.promptPin = promptPin;
TrezorHWWallet.promptPassphrase = promptPassphrase;
TrezorHWWallet.handleButton = handleButton;
TrezorHWWallet.handleError = handleError;

function TrezorHWWallet (network) {
  this.network = network;
}

function promptPin () {
  if (HWWallet.guiCallbacks.trezorPINPrompt) {
    HWWallet.guiCallbacks.trezorPINPrompt.apply(null, arguments);
  }
}

function promptPassphrase () {
  if (HWWallet.guiCallbacks.trezorPassphrasePrompt) {
    HWWallet.guiCallbacks.trezorPassphrasePrompt.apply(null, arguments);
  }
}

function handleButton () {
  if (this.buttonCb) this.buttonCb();
}

function handleError () {
  if (this.errorCb) this.errorCb();
}

function getPublicKey (path) {
  var _this = this;
  return this.getDevice().then(function () {
    var dev = TrezorHWWallet.currentDevice;
    path = path || '';
    var pathArray = [];
    path.split('/').forEach(function (index) {
      if (!index.length) return;
      if (index.indexOf("'") === index.length - 1) {
        pathArray.push((~~index.slice(0, -1)) + 0x80000000);
      } else {
        pathArray.push(~~index);
      }
    });
    if (path.length === 0 && _this.rootPublicKey) {
      return Promise.resolve(_this.rootPublicKey);
    } else {
      return dev.getPublicKey(pathArray).then(function (pubkey) {
        var pk = pubkey.message.node.public_key;
        pk = pk.toHex ? pk.toHex() : pk;
        var keyPair = bitcoin.ECPair.fromPublicKeyBuffer(
          new Buffer(pk, 'hex'),
          _this.network
        );
        var cc = pubkey.message.node.chain_code;
        cc = cc.toHex ? cc.toHex() : cc;
        var chainCode = new Buffer(cc, 'hex');
        var hdwallet = new bitcoin.HDNode(keyPair, chainCode);
        if (path.length === 0) {
          _this.rootPublicKey = hdwallet;
        }
        return new SchnorrSigningKey(hdwallet);
      });
    }
  });
}

function signMessage (path, message) {
  message = new Buffer(message, 'utf8').toString('hex');
  return this.getDevice().then(function () {
    var dev = TrezorHWWallet.currentDevice;
    return dev._typedCommonCall('SignMessage', 'MessageSignature', {
      'message': message,
      address_n: path
    });
  }).then(function (res) {
    var sig = res.message.signature;
    sig = sig.toHex ? sig.toHex() : sig;
    var signature = bitcoin.ECSignature.parseCompact(new Buffer(sig, 'hex'));
    return {
      r: signature.signature.r,
      s: signature.signature.s,
      i: signature.i
    };
  });
}

function getChallengeArguments () {
  return this.getPublicKey().then(function (hdWallet) {
    return [ 'com.greenaddress.login.get_trezor_challenge', hdWallet.keyPair.getAddress(), true ];
  });
}

function _checkForDevices (network, options) {
  if (TrezorHWWallet.currentDevice) {
    return TrezorHWWallet.currentDevice.getPublicKey([]).then(function () {
      finishChecking();
      cbAll(TrezorHWWallet.currentDevice, new TrezorHWWallet(network));
    }, function () {
      // disconnect old device to avoid repated callbacks
      window.chrome.hid.disconnect(
        TrezorHWWallet.currentDevice._connectionId,
        doCheck
      );
    });
  } else {
    doCheck();
  }

  var tick;

  function doCheck () {
    var trezor_api = window.trezor.load();
    if (options.failOnMissing) {
      singleCheck();
    } else {
      tick = setInterval(singleCheck, 1000);
    }
    function singleCheck () {
      trezor_api.devices().then(function (devices) {
        if (!devices.length) {
          if (TrezorHWWallet.needsModal && !TrezorHWWallet.checkingModal) {
            TrezorHWWallet.checkingModal = (
              HWWallet.guiCallbacks.requireUsbDevice({reject: doCancel})
            );
          }
        }
        if (!devices.length) {
          ebAll({missingDevice: true});
          if (TrezorHWWallet.missingCbs.length + TrezorHWWallet.missingCbsOnce.length === 0) {
            clearInterval(tick);
          }
        } else {
          if (!TrezorHWWallet.isChecking) {
            // don't initialize device twice
            return;
          }
          finishChecking();

          trezor_api.open(devices[0]).then(function (dev_) {
            dev_.initialize().then(function (init_res) {
              var outdated = false;
              if (init_res.message.major_version < 1) outdated = true;
              else if (init_res.message.major_version === 1 &&
                init_res.message.minor_version < 3) outdated = true;
              if (outdated) {
                ebAll({
                  outdatedFirmware: true,
                  message: gettext(
                    'Outdated firmware. Please upgrade to at least 1.3.0 at http://mytrezor.com/'
                  ),
                  recoverable: false
                }, true);
              } else {
                cbAll(dev_, new TrezorHWWallet(network), true);
              }
            }).catch(ebAll);
          }, function (err) {
            console.error(err.stack || err);
            ebAll('Opening device failed', true);
          });
        }
      }, function (err) {
        if (err === 'No device found.' && options.failOnMissing) {
          ebAll({missingDevice: true});
        }
      });
    }
  }

  function finishChecking () {
    TrezorHWWallet.isChecking = false;
    TrezorHWWallet.needsModal = false;
    if (TrezorHWWallet.checkingModal) {
      TrezorHWWallet.checkingModal.close();
      TrezorHWWallet.checkingModal = null;
    }
  }
  function cbAll (device, wallet, newDevice) {
    if (newDevice) {
      device.on('pin', TrezorHWWallet.promptPin);
      device.on('passphrase', TrezorHWWallet.promptPassphrase);
      device.on('error', TrezorHWWallet.handleError);
      device.on('button', TrezorHWWallet.handleButton);
    }

    _cbAll(device, wallet);
  }
  function _cbAll (device, wallet) {
    TrezorHWWallet.currentDevice = device;
    TrezorHWWallet.foundCbs.forEach(function (cb) {
      cb(wallet);
    });
    TrezorHWWallet.foundCbs.length = 0;
    TrezorHWWallet.missingCbsOnce.length = 0;
    TrezorHWWallet.missingCbs.length = 0;
    clearInterval(tick);
    HWWallet.register(wallet);
  }
  function ebAll (error, options) {
    HWWallet.registerError(error);
    TrezorHWWallet.missingCbsOnce.forEach(function (data) {
      var i = data[0];
      var cb = data[1];
      TrezorHWWallet.foundCbs.splice(i, 1);
      cb(error);
    });
    TrezorHWWallet.missingCbsOnce.length = 0;

    var toSplice = [];
    TrezorHWWallet.missingCbs.forEach(function (data, i) {
      var j = data[0];
      var cb = data[1];
      var isModal = data[2];
      if ((isModal && options.isModal) || options.all) {
        toSplice.push(i);
        TrezorHWWallet.foundCbs.splice(j, 1);
      }
      cb(error);
    });
    for (var i = toSplice.length; i >= 0; --i) {
      TrezorHWWallet.missingCbs.splice(toSplice[i], 1);
    }
    clearInterval(tick);
  }
  function doCancel () {
    TrezorHWWallet.isChecking = false;
    TrezorHWWallet.checkingModal = null;
    ebAll(gettext('Cancelled'), {isModal: true});
  }
}

function checkForDevices (network, options) {
  options = options || {};

  var is_chrome_app = require('has-chrome-storage');
  if (!is_chrome_app) return;

  if (options.failOnMissing && options.modal) {
    // modal implies some form of waiting
    throw new Error('Cannot set failOnMissing and modal simultaneously.');
  }

  // disable multiple repeated checking to avoid spamming the API, but allow
  // checking again with failOnMissing. this allows having one global check
  // + additional polling in case of such need
  // (for example, GA has a global check on signup/login page, and polls
  // additionally when user wants to initiate a hw wallet action without
  // having a wallet connected)
  if (!TrezorHWWallet.isChecking) {
    TrezorHWWallet.isChecking = true;
    _checkForDevices(network, options);
  }
  return new Promise(function (resolve, reject) {
    var i = TrezorHWWallet.foundCbs.length;
    TrezorHWWallet.foundCbs.push(resolve);
    if (options.failOnMissing) {
      TrezorHWWallet.missingCbsOnce.push([i, reject]);
    } else {
      TrezorHWWallet.missingCbs.push([i, reject, options.modal]);
    }
    if (options.modal) {
      TrezorHWWallet.needsModal = true;
    }
  });
}

function setupSeed (mnemonic) {
  var modal;
  var _this = this;

  return new Promise(function (resolve, reject) {
    var modalOptions = {
      cancel: cancel,
      finalize: finalize,
      reuse: reuse,
      usingMnemonic: !!mnemonic
    };

    return _this.getPublicKey().then(function () {
      modal = HWWallet.guiCallbacks.trezorSetupModal(
        extend({ alreadySetup: true }, modalOptions)
      );
    }, function (err) {
      if (err.code !== 11) { // Failure_NotInitialized
        reject(err);
      } else {
        modal = HWWallet.guiCallbacks.trezorSetupModal(modalOptions);
      }
    });

    function cancel () {
      reject(gettext('Cancelled'));
    }

    function finalize () {
      var store_d;
      if (mnemonic) {
        store_d = _this._recovery(mnemonic);
      } else {
        store_d = TrezorHWWallet.device.resetDevice({ strength: 256 });
      }
      return store_d.then(function () {
        modal.close();
        resolve();
      }).catch(function (err) {
        modal.close();
        reject(err);
      });
    }

    function reuse () {
      if (mnemonic) {
        reject('Cannot reuse and use mnemonic at the same time!');
        return;
      }
      modal.close();
      resolve();
    }
  });
}

function _recovery (mnemonic) {
  var dev;
  return this.getDevice().then(function () {
    dev = TrezorHWWallet.currentDevice;
    return dev.wipeDevice();
  }).then(function () {
    return dev.loadDevice({mnemonic: mnemonic});
  });
}

function getDevice () {
  return TrezorHWWallet.checkForDevices(this.network, { modal: true });
}
