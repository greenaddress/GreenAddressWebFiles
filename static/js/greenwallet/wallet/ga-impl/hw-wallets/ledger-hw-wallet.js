var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
var SchnorrSigningKey = require('../../bitcoinup/schnorr-signing-key');
var window = require('global/window');
var gettext = window.gettext || function (s) { return s; };
var bip39 = require('bip39');
var HWWallet = require('./base-hw-wallet');
var LedgerCordovaWrapper = require('./ledger-cordova-wrapper');
var BTChip = require('../../hw-apis/ledger-js/api/BTChip');
var ChromeapiPlugupCardTerminalFactory = require('../../hw-apis/ledger-js/api/ChromeapiPlugupCardTerminalFactory');
var ByteString = require('../../hw-apis/ledger-js/api/ByteString');
var Convert = require('../../hw-apis/ledger-js/api/Convert');
var ASCII = require('../../hw-apis/ledger-js/api/GlobalConstants').ASCII;
var HEX = require('../../hw-apis/ledger-js/api/GlobalConstants').HEX;
var cardFactory = new ChromeapiPlugupCardTerminalFactory();
var cardFactoryNano = new ChromeapiPlugupCardTerminalFactory(1);

module.exports = LedgerHWWallet;

LedgerHWWallet.prototype = Object.create(HWWallet.prototype);
extend(LedgerHWWallet.prototype, {
  deviceTypeName: 'Ledger',
  canSpendP2PKH: false,
  canSpendP2SH: canSpendP2SH,
  isRecoverySupported: isRecoverySupported,
  getChallengeArguments: getChallengeArguments,
  getPublicKey: getPublicKey,
  signMessage: signMessage,
  signTransaction: signTransaction,
  setupSeed: setupSeed,
  _recovery: _recovery,
  _resetRecovery: _resetRecovery,
  _doSignMessageCountdown: _doSignMessageCountdown
});
LedgerHWWallet.pingDevice = pingDevice;
LedgerHWWallet.checkForDevices = checkForDevices;
LedgerHWWallet.listDevices = listDevices;
LedgerHWWallet.openDevice = openDevice;
LedgerHWWallet.initDevice = initDevice;
LedgerHWWallet.disconnectCurrentDevice = disconnectCurrentDevice;
HWWallet.initSubclass(LedgerHWWallet);

function LedgerHWWallet (network) {
  this.network = network;
}

function canSpendP2SH () {
  return this.getDevice().then(function () {
    var tx = new bitcoin.Transaction();
    var script = bitcoin.script.multisigOutput(
      2, [
        new bitcoin.ECPair(BigInteger.valueOf(1)).getPublicKeyBuffer(),
        new bitcoin.ECPair(BigInteger.valueOf(2)).getPublicKeyBuffer()
      ]
    );
    tx.addInput(new Buffer(32), 0, 0xffffffff, script);
    return LedgerHWWallet.currentDevice.gaStartUntrustedHashTransactionInput_async(
      true,
      _cloneTransactionForSignature(tx, script, 0),
      0
    ).then(function () {
      return true;
    }).catch(function () {
      return false;
    });
  });
}

function isRecoverySupported () {
  return !LedgerHWWallet.currentDevice.isNanoS;
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

function _listCordova (cb, eb) {
  window.cordova.exec(function (result) {
    if (result) {
      cb([new LedgerCordovaWrapper()]);
    } else {
      cb([]);
    }
  }, eb, 'BTChip', 'has_dongle', []);
}

function listDevices (network, options) {
  if (options.cordova) {
    return new Promise(function (resolve, reject) {
      _listCordova(resolve, reject);
    });
  }

  return cardFactory.list_async().then(function (list) {
    if (list.length) {
      return list;
    } else {
      return cardFactoryNano.list_async();
    }
  });
}

function openDevice (network, options, device) {
  if (options.cordova) {
    return pingDevice(device).then(function () {  // populate features
      return device.getVendorId();
    }).then(function (vendorId) {
      device.isNanoS = vendorId === 0x2c97;
      return device;
    });
  }
  return cardFactory.getCardTerminal(device).getCard_async().then(function (dongle) {
    var ret = new BTChip(dongle);
    ret.isNanoS = device.device.vendorId === 0x2c97;
    return pingDevice(ret).then(function () {  // populate features
      return ret;
    });
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
    device[func_name + '_orig'] = origFunc;
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
          if (error.indexOf && error.indexOf('6982') >= 0) {
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
//                device.card.disconnect_async();
                if (error.indexOf && (error.indexOf('6982') >= 0 || error.indexOf('63c') >= 0)) {
                  return Promise.reject(gettext('Invalid PIN'));
                } else if (error.indexOf && error.indexOf('6985') >= 0) {
                  return Promise.reject(gettext('Dongle is not set up'));
                } else if (error.indexOf && error.indexOf('6faa') >= 0) {
                  return Promise.reject(gettext('Dongle is locked - reconnect the dongle and retry'));
                } else {
                  return Promise.reject(error);
                }
              });
            });
          } else if (error.indexOf && error.indexOf('6985') >= 0) {
            return Promise.reject(gettext('Dongle is not set up'));
          } else if (error.indexOf && error.indexOf('6faa') >= 0) {
            return Promise.reject(gettext('Dongle is locked - remove the dongle and retry'));
          } else {
            return Promise.reject(error);
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
  if (window.cordova && window.cordova.platformId === 'android') {
    return HWWallet.checkForDevices(
      LedgerHWWallet, network, extend({cordova: true}, options)
    );
  } else if (!isChromeApp && !(nodeHid && nodeHid.devices)) {
    return Promise.reject('No Ledger support present');
  }

  return HWWallet.checkForDevices(LedgerHWWallet, network, options);
}

function getChallengeArguments () {
  return this.getPublicKey().then(function (hdWallet) {
    return [ 'com.greenaddress.login.get_trezor_challenge', hdWallet.hdnode.keyPair.getAddress(), true ];
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

function _doSignMessageCountdown (cb) {
  // second login is faster because pubkey is already derived:
  var _this = this;
  var expectedSigningMs = _this.hasLoggedIn ? 5000 : 3500;
  if (LedgerHWWallet.currentDevice.features.quickerVersion) {
    expectedSigningMs *= 0.74;
  }
  if (LedgerHWWallet.currentDevice.isNanoS) {
    expectedSigningMs /= 9;
  }

  var elapsed = 0;
  cb(1);
  var countdown = setInterval(function () {
    elapsed += 100;
    var progress = Math.min(100, Math.round(100 * elapsed / expectedSigningMs));
    cb(progress);
    if (progress >= 100) {
      _this.hasLoggedIn = true;
      clearInterval(countdown);
    }
  }, 100);
}

function signMessage (path, message, options) {
  options = options || {};
  var msg_plain = message;
  message = new Buffer(message, 'utf8').toString('hex');
  var dev, pk;
  var _this = this;

  return this.getPublicKey().then(function (res) {
    pk = res;
    dev = LedgerHWWallet.currentDevice;
    return dev.signMessagePrepare_async(path, new ByteString(message, HEX));
  }).then(function () {
    if (options.progressCb) {
      // start the countdown only after user has provided the PIN
      // (there's no simple way to hook into the PIN callback currently)
      _this._doSignMessageCountdown(options.progressCb);
    }
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
  var d;
  if (mnemonic) {
    // canSpendP2SH p2sh is required only for non-mnemonic (existing seed)
    // (this way we don't display the 'reuse' button for mnemonic writing)
    d = _this.getDevice().then(function () {
      return false;
    });
  } else {
    d = _this.canSpendP2SH();
  }
  return d.then(function (canSpendP2SH) {
    var ledger = LedgerHWWallet.currentDevice;
    var modal;
    return new Promise(function (resolve, reject) {
      var modalOptions = {
        cancel: cancel,
        finalize: finalize,
        reuse: reuse,
        reset: reset,
        canReset: _this.isRecoverySupported(),
        canSpendP2SH: canSpendP2SH,
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
        store_d = _this._recovery(mnemonic);
        return store_d.then(function () {
          if (mnemonic) {
            modal.close();
          } else {
            modal.replugForBackup();
            LedgerHWWallet.disconnectCurrentDevice();
          }
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
  var ledger;
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
    ledger = LedgerHWWallet.currentDevice;
    var hex = mnemonic && bip39.mnemonicToSeedHex(mnemonic);
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
    ).fail(function (error) {
      console.log('setupNew_async error: ' + error);
      return Promise.reject(error);
    });
  }).then(function () {
    return ledger.setKeymapEncoding_async().fail(function (error) {
      console.log('setKeymapEncoding_async error: ' + error);
      return Promise.reject(error);
    });
  }).then(function () {
    // 100, 200, 100, 20 values chosen empirically
    // - defaults seemed too fast, skipping some characters
    return ledger.setKeyboardConfig_async(100, 200, 100, 20).fail(function (error) {
      console.log('setKeyboardConfig_async error: ' + error);
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

function _prevOutToPath (prevOut, privDer) {
  var path = '';
  if (prevOut.subaccount.pointer) {
    path = "3'/" + prevOut.subaccount.pointer + "'/";
  }
  if (privDer) {
    path += "2'/" + prevOut.raw.pointer + "'";  // branch=EXTERNAL
  } else {
    path += '1/' + prevOut.raw.pointer;  // branch=REGULAR
  }
  return path;
}

function _cloneTransactionForSignature (tx, connectedScript, inIndex) {
  var txTmp = tx.clone();

  // Blank out other inputs' signatures
  txTmp.ins.forEach(function (txin) {
    txin.script = new Buffer([]);
  });

  txTmp.ins[inIndex].script = connectedScript;

  return txTmp;
}

function signTransaction (tx, options) {
  tx = tx.tx;
  return this.getDevice().then(function () {
    var device = LedgerHWWallet.currentDevice;
    var deferred = Promise.resolve();
    var signedN = 0;
    var progressCb = options.signingProgressCallback;
    tx.ins.forEach(function (inp, i) {
      var path = _prevOutToPath(inp.prevOut);
      deferred = deferred.then(function () {
        return options.scriptFactory.getUtxoPrevScript(inp.prevOut);
      }).then(function (script) {
        return device.gaStartUntrustedHashTransactionInput_async(
          i === 0,
          _cloneTransactionForSignature(tx, script, i),
          i
        ).then(function (res) {
          var this_ms = 0;
          var this_expected_ms = 6500;
          if (device.features.quickerVersion) this_expected_ms *= 0.55;
          if (device.isNanoS) this_expected_ms /= 9;
          var interval = setInterval(function () {
            this_ms += 100;
            var progress = signedN / tx.ins.length;
            progress += (1 / tx.ins.length) * (this_ms / this_expected_ms);
            if (this_ms > this_expected_ms) return;
            if (progressCb) progressCb(Math.min(100, Math.round(100 * progress)));
          }, 100);
          return device.gaUntrustedHashTransactionInputFinalizeFull_async(tx).then(function (finished) {
            return device.signTransaction_async(
              path,
              undefined,
              // Cordova requires int, while crx requires ByteString:
              window.cordova ? tx.locktime : new ByteString(Convert.toHexInt(tx.locktime), HEX)
            ).then(function (sig) {
              clearInterval(interval);
              signedN += 1;
              inp.script = bitcoin.script.compile([].concat(
                bitcoin.opcodes.OP_0, // OP_0 required for multisig
                new Buffer([0]), // to be replaced by backend with server's sig
                new Buffer('30' + sig.bytes(1).toString(HEX), 'hex'), // our sig
                script  // prevScript
              ));
            });
          }).catch(function (err) {
            clearInterval(interval);
            return Promise.reject(err);
          });
        });
      });
    });
    return deferred;
  });
}

function disconnectCurrentDevice () {
  LedgerHWWallet.currentDevice.card.disconnect_async();
  LedgerHWWallet.currentDevice = null;
}
