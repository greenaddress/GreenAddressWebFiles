var angular = require('angular');
var BaseHWWallet = require('wallet').GA.BaseHWWallet;
var window = require('global/window');

var BASE_URL = window.BASE_URL;
var LANG = window.LANG;
var gettext = window.gettext;

module.exports = factory;

factory.dependencies = ['$uibModal', 'notices', '$rootScope'];

function factory ($uibModal, notices, $rootScope) {
  BaseHWWallet.registerGUICallback('trezorSetupModal', showSetupModal);
  BaseHWWallet.registerGUICallback('trezorPINPrompt', promptPin);
  BaseHWWallet.registerGUICallback('trezorPassphrasePrompt', promptPassphrase);
  BaseHWWallet.registerGUICallback('trezorButtonPrompt', promptButton);

  function showSetupModal (options) {
    // show a modal asking the user to either setup a HW device, or reset/reuse
    // it if it's already set up. return an object (modal) allowing closing the
    // modal with close() method.
    var scope = $rootScope.$new();
    scope.trezor = {
      already_setup: options.alreadySetup,
      setting_up: false,
      use_gait_mnemonic: options.usingMnemonic,
      store: function () {
        this.setting_up = true;
        options.finalize();
      },
      reuse: function () {
        options.reuse();
      }
    };
    var modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_trezor_setup.html',
      scope: scope
    });
    modal.result.catch(function () { options.cancel(); });
    return modal;
  }

  function promptPin (type, callback) {
    var scope, modal;
    scope = angular.extend($rootScope.$new(), {
      pin: '',
      type: type
    });

    modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_trezor_pin.html',
      size: 'sm',
      windowClass: 'pinmodal',
      backdrop: 'static',
      keyboard: false,
      scope: scope
    });

    modal.result.then(
      function (res) { callback(null, res); },
      function (err) { callback(err); }
    );
  }

  function promptPassphrase (callback) {
    var scope, modal;

    scope = angular.extend($rootScope.$new(), {
      passphrase: ''
    });

    modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_trezor_passphrase.html',
      size: 'sm',
      windowClass: 'pinmodal',
      backdrop: 'static',
      keyboard: false,
      scope: scope
    });

    modal.result.then(
      function (res) { callback(null, res); },
      function (err) { callback(err); }
    );
  }

  function promptButton (dev) {
    var modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_trezor_confirm_button.html',
      size: 'sm',
      windowClass: 'pinmodal',
      backdrop: 'static',
      keyboard: false
    });

    dev.once('pin', function () {
      try { modal.close(); } catch (e) {}
    });
    dev.once('receive', function () {
      try { modal.close(); } catch (e) {}
    });
    dev.once('error', function () {
      try { modal.close(); } catch (e) {}
    });
  }

  var handleError = function (e) {
    var message;
    if (e === 'Opening device failed') {
      message = gettext("Device could not be opened. Make sure you don't have any TREZOR client running in another tab or browser window!");
    } else {
      message = e;
    }
    $rootScope.safeApply(function () {
      notices.makeNotice('error', message);
    });
  };

  return {};
}
