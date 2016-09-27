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
    waitForHwWallet: function (cur_net, options) {
      options = options || {};
      var d = $q.defer();

      var modal;
      var check = function () {
        var toRace = [];
        var spliced = [];

        allHwWallets.forEach(function (hw, i) {
          toRace.push(
            hw.checkForDevices(cur_net, {failOnMissing: true}).then(function (device) {
              return [i, device];
            }).catch(function (e) {
              return $q.reject([i, e]);
            })
          );
        });

        race(toRace).then(cb, eb);

        function race (promises) {
          // missing from our Angular version
          var deferred = $q.defer();
          promises.forEach(function (promise) {
            $q.when(promise).then(deferred.resolve, deferred.reject);
          });
          return deferred.promise;
        }
        function cb (device) {
          var i = device[0];
          device = device[1];
          if (options.filterDeviceCb && !options.filterDeviceCb(device)) {
            // errback missing if given filter doesn't allow the current device
            return eb([i, {missingDevice: true}]);
          }
          d.resolve(device);
          if (modal) {
            modal.close();
          }
        }
        function eb (err) {
          var i = err[0];
          spliced.forEach(function (j) {
            if (j < i) i -= 1;
          });
          err = err[1];
          if (!err || !err.missingDevice) {
            // retry only on missing device
            d.reject(err);
            d = null; // do not callback multiple times
          } else if (d) { // missing device + never callbacked (d != null)
            toRace.splice(i, 1);
            spliced.push(i);
            if (toRace.length === 0) {
              // show modal && retry on all confirmed missing
              if (!modal) {
                modal = showRequireDeviceModal(d);
              }
              $timeout(check, 1000);
            } else {
              // wait for remaining wallets
              race(toRace).then(cb, eb);
            }
          }
        }
      };
      check();
      return d.promise;
    }
  };
}
