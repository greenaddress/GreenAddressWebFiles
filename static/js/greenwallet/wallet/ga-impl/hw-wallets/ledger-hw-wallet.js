var extend = require('xtend/mutable');
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
  // getChallengeArguments: getChallengeArguments,
  // getPublicKey: getPublicKey,
  // signMessage: signMessage,
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
LedgerHWWallet.initDevice = function () {};
HWWallet.initSubclass(LedgerHWWallet);

function LedgerHWWallet (network) {
  this.network = network;
}

function pingDevice (device) {
  LedgerHWWallet.anyDevice = device;  // used for pin resetting
  return device.getFirmwareVersion_async();
}

function listDevices (network, options) {
  return cardFactory.list_async();
}

function openDevice (network, options, device) {
  return cardFactory.getCardTerminal(device).getCard_async().then(function (dongle) {
    return new BTChip(dongle);
  });
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

      ledger.getWalletPublicKey_async('').then(function () {
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
    replug_required = false;
    resetting = false;
    already_setup = false;
    var hex = bip39.mnemonicToSeedHex(mnemonic);
    var ledger = LedgerHWWallet.currentDevice;
    return ledger.setupNew_async(
      0x01, // wallet mode

      0x02 | // deterministic signatures
      0x08, // skip second factor if consuming only P2SH inputs in a transaction

      _this.network.pubKeyHash,
      _this.network.scriptHash,
      new ByteString('0000', ASCII),
      undefined, // wipePin

      // undefined,  // keymapEncoding
      // true,  // restoreSeed
      hex && new ByteString(hex, HEX) // bip32Seed
    ).then(function () {
      return ledger.setKeymapEncoding_async().then(function () {
        var storing = false;
        var setting_up = false;
        var gait_setup = true;
        var replug_for_backup = !mnemonic;
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
  };
}
