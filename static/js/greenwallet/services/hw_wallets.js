var allHwWallets = require('wallet').GA.allHwWallets;
var BaseHWWallet = require('wallet').GA.BaseHWWallet;
var window = require('global/window');

var BASE_URL = window.BASE_URL;
var LANG = window.LANG;

module.exports = factory;

factory.dependencies = ['$q', 'trezor', 'btchip', '$timeout', '$rootScope', '$uibModal'];
function factory ($q, trezor, btchip, $timeout, $rootScope, $uibModal) {
  BaseHWWallet.registerGUICallback('requireUsbDevice', showRequireDeviceModal);

  function showRequireDeviceModal (d) {
    // show a modal asking the user to connect a HW device, reject the given
    // deferred (d argument) if user cancels the modal, return an object
    // (modal) allowing closing the modal with close() method.
    var modal;
    $rootScope.safeApply(function () {
      var options = {
        templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_usb_device.html'
      };
      modal = $uibModal.open(options);
      modal.result.finally(function () {
        d.reject();
      });
    });
    return {
      // wrap in a function to avoid needing to return modal as another deferred
      close: function () { modal.close(); }
    };
  }

  return {
    // for our wallet it is recommended to always access these
    // hwwallets-related objects through this Angular module, since it does
    // the necessary initialization as above (registering GUI callbacks)
    allHwWallets: allHwWallets,
    BaseHWWallet: BaseHWWallet,
    success: false,
    checkDevices: function (cur_net) {
      allHwWallets.forEach(function (hw) {
        hw.checkForDevices(cur_net);
      });
      return BaseHWWallet.currentWallet;
    },
    waitForHwWallet: function (cur_net) {
      var d = $q.defer();

      var modal;
      var check = function () {
        var missingCount = 0;
        var allCount = allHwWallets.length;

        allHwWallets.forEach(function (hw) {
          hw.checkForDevices(cur_net, {failOnMissing: true});
        });

        BaseHWWallet.currentWallet.then(function (device) {
          d.resolve(device);
          if (modal) {
            modal.close();
          }
        }, function (err) {
          if (!err || !err.missingDevice) {
            // retry only on missing device
            d.reject(err);
            d = null; // do not callback multiple times
          } else if (d) { // missing device + never callbacked (d != null)
            missingCount += 1;
            if (missingCount === allCount) {
              // show modal && retry on all confirmed missing
              if (!modal) {
                modal = showRequireDeviceModal(d);
              }
              $timeout(check, 1000);
            }
          }
        });
      };
      check();
      return d.promise;
    }
  };
}
