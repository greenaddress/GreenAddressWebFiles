var angular = require('angular');
var window = require('global/window');

var BaseHWWallet = require('wallet').GA.BaseHWWallet;
var BASE_URL = window.BASE_URL;
var LANG = window.LANG;

module.exports = factory;

factory.dependencies = ['$q', '$uibModal', '$rootScope', 'focus', 'notices'];

function factory ($q, $uibModal, $rootScope, focus, notices) {
  BaseHWWallet.registerGUICallback('ledgerSetupModal', showSetupModal);
  BaseHWWallet.registerGUICallback('ledgerPINPrompt', showPINPrompt);
  BaseHWWallet.registerGUICallback('ledgerPleaseOpenBitcoinApp', pleaseOpenApp);

  function pleaseOpenApp () {
    notices.makeNotice(
      'error',
      gettext('Ledger Dashboard detected, please open the Bitcoin app to access.')
    );
  }

  function showSetupModal (options) {
    // show a modal asking the user to either setup a HW device, or reset/reuse
    // it if it's already set up. return an object (modal) allowing closing the
    // modal with close() method.
    var scope = $rootScope.$new();
    scope.btchip = {
      can_reset: options.canReset,
      can_spend_p2sh: options.canSpendP2SH,
      already_setup: options.alreadySetup,
      gait_setup: false,
      use_gait_mnemonic: options.usingMnemonic,
      storing: false,
      replug_required: false,
      reset: function () {
        this.resets_remaining = 3;
        this.resetting = true;
        this.replug_required = true;
        options.reset();
      },
      reuse: function () {
        options.reuse();
      },
      store: function () {
        options.finalize();
      }
    };
    var modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_btchip_setup.html',
      scope: scope
    });
    modal.result.catch(function () { options.cancel(); });
    modal.attempt = function (num, replug_required) {
      $rootScope.safeApply(function () {
        scope.btchip.resets_remaining = num;
        scope.btchip.replug_required = replug_required;
        scope.btchip.resetting = replug_required;
        scope.btchip.already_setup = replug_required;
      });
    };
    modal.replugForBackup = function () {
      $rootScope.safeApply(function () {
        scope.btchip.gait_setup = true;
        scope.btchip.replug_for_backup = true;
      });
    };
    return modal;
  }

  function showPINPrompt (callback) {
    pinModalCallbacks.push({cb: callback});
    if (pinModalCallbacks.length > 1) return; // modal already displayed
    var scope, modal;

    scope = angular.extend($rootScope.$new(), {
      pin: '',
      pinNotCancelable: pinNotCancelable
    });
    pinNotCancelable = false;

    modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_btchip_pin.html',
      size: 'sm',
      windowClass: 'pinmodal',
      backdrop: 'static',
      keyboard: false,
      scope: scope
    });

    focus('btchipPinModal');

    return modal.result.then(
      function (res) {
        var oldCallbacks = pinModalCallbacks.slice();
        var d = $q.when();
        for (var i = 0; i < oldCallbacks.length; i++) {
          d = queueCallback(i);
        }
        pinModalCallbacks = [];
        return d;

        function queueCallback (i) {
          return d.then(function () {
            return oldCallbacks[i].cb(null, res);
          });
        }
      },
      function (err) {
        var oldCallbacks = pinModalCallbacks.slice();
        for (var i = 0; i < oldCallbacks.length; i++) {
          oldCallbacks[i].cb(err);
        }
        pinModalCallbacks = [];
      }
    );
  }

  var pinModalCallbacks = [];
  var pinNotCancelable = false;
  return {};
}
