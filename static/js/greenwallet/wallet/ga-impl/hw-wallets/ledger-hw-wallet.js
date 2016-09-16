var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
var SchnorrSigningKey = require('../../bitcoinup/schnorr-signing-key');
var window = require('global/window');

var gettext = window.gettext;

var bip39 = require('bip39');
var HWWallet = require('./base-hw-wallet');

var BTChip = require('../../hw-apis/ledger-js/api/BTChip');
var ChromeapiPlugupCardTerminalFactory = require('../../hw-apis/ledger-js/api/ChromeapiPlugupCardTerminalFactory');
var ByteString = require('../../hw-apis/ledger-js/api/ByteString');
var ASCII = require('../../hw-apis/ledger-js/api/GlobalConstants').ASCII;
var HEX = require('../../hw-apis/ledger-js/api/GlobalConstants').HEX;
var cardFactory = new ChromeapiPlugupCardTerminalFactory();

module.exports = LedgerHWWallet;

LedgerHWWallet.prototype = Object.create(HWWallet.prototype);
extend(LedgerHWWallet.prototype, {
  deviceTypeName: 'Ledger',
  getChallengeArguments: getChallengeArguments,
  getPublicKey: getPublicKey,
  signMessage: signMessage,
  // signTransaction: signTransaction,
  setupSeed: setupSeed,
  _recovery: _recovery,
  _resetRecovery: _resetRecovery
});
LedgerHWWallet.pingDevice = pingDevice;
LedgerHWWallet.checkForDevices = checkForDevices;
LedgerHWWallet.listDevices = listDevices;
LedgerHWWallet.openDevice = openDevice;
// LedgerHWWallet.promptPin = promptPin;
// LedgerHWWallet.promptPassphrase = promptPassphrase;
// LedgerHWWallet.handleButton = handleButton;
// LedgerHWWallet.handleError = handleError;
LedgerHWWallet.initDevice = initDevice;
HWWallet.initSubclass(LedgerHWWallet);

function LedgerHWWallet (network) {
  this.network = network;
}

function pingDevice (device) {
  LedgerHWWallet.anyDevice = device;  // used for pin resetting
  return device.getFirmwareVersion_async().then(function (version) {
    var features = {};
    var firmwareVersion = version.firmwareVersion.bytes(0, 4);
    if (firmwareVersion.toString(HEX) < '00010408') {
      device.card.disconnect_async();
      return Promise.reject('Too old Ledger firmware. Please upgrade.');
    }
    features.signMessageRecoveryParam =
      firmwareVersion.toString(HEX) >= '00010409';
    features.quickerVersion =
      firmwareVersion.toString(HEX) >= '0001040b';
    device.features = features;
  });
}

function listDevices (network, options) {
  return cardFactory.list_async();
}

function openDevice (network, options, device) {
  return cardFactory.getCardTerminal(device).getCard_async().then(function (dongle) {
    return new BTChip(dongle);
  });
}

function _setupWrappers (device) {
  // wrap some functions to allow using them even after disconnecting the dongle
  // (prompting user to reconnect and enter pin)
  var WRAP_FUNCS = [
    'gaStartUntrustedHashTransactionInput_async',
    'signMessagePrepare_async',
    'getWalletPublicKey_async'
  ];
  WRAP_FUNCS.forEach(function (func_name) {
    var origFunc = device[func_name];
    device[func_name+'_orig'] = origFunc;
    device[func_name] = function () {
      var origArguments = arguments;
      var d;
      try {
        d = origFunc.apply(device, arguments);
      } catch (e) {
        // handle `throw "Connection is not open"` gracefully - getDevice() below
        return Promise.reject(e);
      }
      return d.then(function (data) {
        return data;
      }, function (error) {
        if (!error || !error.indexOf || error.indexOf('Write failed') !== -1) {
          return Promise.reject(gettext('Ledger communication failed'));
        } else {
          if (error.indexOf('6982') >= 0) {
            device.pin_verified = false;
            // setMsg("Dongle is locked - enter the PIN")
            return new Promise(function (resolve, reject) {
              HWWallet.guiCallbacks.ledgerPINPrompt(function (err, pin) {
                if (err || !pin) {
                  return reject(err);
                }
                resolve(pin);
              });
            }).then(function (pin) {
              return device.verifyPin_async(new ByteString(pin, ASCII)).then(function () {
                return origFunc.apply(device, origArguments).then(function (ret) {
                  return ret;
                });
              }).fail(function (error) {
                device.card.disconnect_async();
                if (error.indexOf('6982') >= 0 || error.indexOf('63c') >= 0) {
                  return Promise.reject(gettext('Invalid PIN'));
                } else if (error.indexOf('6985') >= 0) {
                  return Promise.reject(gettext('Dongle is not set up'));
                } else if (error.indexOf('6faa') >= 0) {
                  return Promise.reject(gettext('Dongle is locked - reconnect the dongle and retry'));
                } else {
                  return Promise.reject(error);
                }
              });
            });
          } else if (error.indexOf('6985') >= 0) {
            return Promise.reject(gettext('Dongle is not set up'));
          } else if (error.indexOf('6faa') >= 0) {
            return Promise.reject(gettext('Dongle is locked - remove the dongle and retry'));
          }
        }
      });
    };
  });
}

function initDevice (device) {
  _setupWrappers(device);
}

function checkForDevices (network, options) {
  options = options || {};

  var isChromeApp = require('has-chrome-storage');
  var nodeHid;
  try {
    nodeHid = require('node-hid');
  } catch (e) { }
  if (!isChromeApp && !(nodeHid && nodeHid.getDevices)) {
    return Promise.reject('No Ledger support present');
  }

  return HWWallet.checkForDevices(LedgerHWWallet, network, options);
}

function getChallengeArguments () {
  return this.getPublicKey().then(function (hdWallet) {
    return [ 'com.greenaddress.login.get_trezor_challenge', hdWallet.hdnode.keyPair.getAddress(), false ];
  });
}

function getPublicKey (path) {
  var _this = this;
  return this.getDevice().then(function () {
    var dev = LedgerHWWallet.currentDevice;
    path = path || '';
    if (path.length === 0 && _this.rootPublicKey) {
      return Promise.resolve(new SchnorrSigningKey(_this.rootPublicKey));
    } else {
      return dev.getWalletPublicKey_async(path).then(function (res) {
        var pk = res.publicKey.toString(HEX);
        var keyPair = bitcoin.ECPair.fromPublicKeyBuffer(
          new Buffer(pk, 'hex'),
          _this.network
        );
        keyPair.compressed = true;
        var cc = res.chainCode.toString(HEX);
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
  var msg_plain = message;
  message = new Buffer(message, 'utf8').toString('hex');
  var dev, pk;
  return this.getPublicKey().then(function (res) {
    pk = res;
    dev = LedgerHWWallet.currentDevice;
    return dev.signMessagePrepare_async(path, new ByteString(message, HEX));
  }).then(function (result) {
    return dev.signMessageSign_async(new ByteString('00', HEX));
  }).then(function (result) {
    var signature = bitcoin.ECSignature.fromDER(
      new Buffer('30' + result.bytes(1).toString(HEX), 'hex')
    );
    var i;
    if (dev.features.signMessageRecoveryParam) {
      i = result.byteAt(0) & 0x01;
    } else {
      i = bitcoin.ecdsa.calcPubKeyRecoveryParam(
        BigInteger.fromBuffer(bitcoin.message.magicHash(msg_plain)),
        { r: signature.r, s: signature.s },
        pk.keyPair.Q
      );
    }
    return {
      r: signature.r,
      s: signature.s,
      i: i
    };
  });
}

function setupSeed (mnemonic) {
  var _this = this;
  return this.getDevice().then(function () {
    var ledger = LedgerHWWallet.currentDevice;
    var modal;
    return new Promise(function (resolve, reject) {
      var modalOptions = {
        cancel: cancel,
        finalize: finalize,
        reuse: reuse,
        reset: reset,
        usingMnemonic: !!mnemonic
      };

      ledger.getWalletPublicKey_async_orig('').then(function () {
        modal = HWWallet.guiCallbacks.ledgerSetupModal(
          extend({ alreadySetup: true }, modalOptions)
        );
      }, function (error) {
        if (error.indexOf('6982') >= 0) {
          // setMsg("Dongle is locked - enter the PIN")
          modal = HWWallet.guiCallbacks.ledgerSetupModal(
            extend({ alreadySetup: true }, modalOptions)
          );
        } else if (error.indexOf('6985') >= 0) {
          // var setupText = "Dongle is not set up"
          modal = HWWallet.guiCallbacks.ledgerSetupModal(modalOptions);
        } else if (error.indexOf('6faa') >= 0) {
          // setMsg("Dongle is locked - remove the dongle and retry")
          modal = HWWallet.guiCallbacks.ledgerSetupModal(
            extend({ alreadySetup: true }, modalOptions)
          );
        }
      });

      function cancel () {
        reject(gettext('Cancelled'));
      }

      function finalize () {
        var store_d;
        if (mnemonic) {
          store_d = _this._recovery(mnemonic, modal);
        } else {
          store_d = LedgerHWWallet.currentDevice.resetDevice({ strength: 256 });
        }
        return store_d.then(function () {
          modal.close();
          resolve();
        }).catch(function (err) {
          modal.close();
          reject(err);
        });
      }

      function reset () {
        _this._resetRecovery(mnemonic, modal);
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
  });
}

function _recovery (mnemonic) {
  var _this = this;
  return _this.getDevice().then(function () {
    return new Promise(function (resolve, reject) {
      HWWallet.guiCallbacks.ledgerPINPrompt(function (err, pin) {
        if (err || !pin) {
          return reject(err);
        }
        resolve(pin);
      });
    });
  }).then(function (pin) {
    var hex = bip39.mnemonicToSeedHex(mnemonic);
    var ledger = LedgerHWWallet.currentDevice;
    return ledger.setupNew_async(
      0x01, // wallet mode

      0x02 | // deterministic signatures
      0x08, // skip second factor if consuming only P2SH inputs in a transaction

      _this.network.pubKeyHash,
      _this.network.scriptHash,
      new ByteString(pin, ASCII),
      undefined, // wipePin

      // undefined,  // keymapEncoding
      // true,  // restoreSeed
      hex && new ByteString(hex, HEX) // bip32Seed
    ).then(function () {
      return ledger.setKeymapEncoding_async().then(function () {
      }).fail(function (error) {
        console.log('setKeymapEncoding_async error: ' + error);
        return Promise.reject(error);
      });
    }).fail(function (error) {
      console.log('setupNew_async error: ' + error);
      return Promise.reject(error);
    });
  });
}

function _resetRecovery (mnemonic, modal) {
  var _this = this;
  var resets_remaining = 3;
  var wrong_pin = '00000000000000000000000000000000';
  return this.getDevice().then(attempt);

  function attempt () {
    return _this.getDevice().then(function () {
      var ledger = LedgerHWWallet.currentDevice;
      return ledger.verifyPin_async(new ByteString(wrong_pin, ASCII));
    }).then(function () {
      wrong_pin = '1234';
      return attempt();
    }).catch(function (error) {
      // setMsg("Dongle is locked - enter the PIN")
      var replug_required = true;
      if (error.indexOf('6982') >= 0 || error.indexOf('63c') >= 0) {
        if (error.indexOf('63c') >= 0) {
          resets_remaining = Number.parseInt(error[error.indexOf('63c') + 3], 10);
        } else {
          resets_remaining -= 1;
        }
      } else if (error.indexOf('6985') >= 0) {
        // var setupText = "Dongle is not set up"
        resets_remaining = 0;
        replug_required = false;
      }
      modal.attempt(resets_remaining, replug_required);
      if (replug_required) {
        LedgerHWWallet.anyDevice.card.disconnect_async();
        LedgerHWWallet.currentDevice = null;
        return attempt();
      }
    });
  }
}
