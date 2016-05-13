var window = require('global/window');

var BASE_URL = window.BASE_URL;
var LANG = window.LANG;

module.exports = factory;

factory.dependencies = ['$q', 'trezor', 'btchip', '$timeout', '$rootScope', '$uibModal'];
function factory ($q, trezor, btchip, $timeout, $rootScope, $uibModal) {
  return {
    success: false,
    showModal: function (d) {
      var that = this;
      if (!that.modal) {
        $rootScope.safeApply(function () {
          var options = {
            templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/wallet_modal_usb_device.html'
          };
          that.modal = $uibModal.open(options);
          that.modal.result.finally(function () {
            if (!that.success) d.reject();
          });
        });
      }
    },
    waitForHwWallet: function () {
      var d = $q.defer();
      var that = this;
      var doSuccess = function () {
        d.resolve();
        that.success = true;
        if (that.modal) {
          that.modal.close(); // modal close cancels the tick
        }
      };
      var check = function () {
        trezor.getDevice(true).then(function () {
          doSuccess();
        }, function (err) {
          if (err && (err.pluginLoadFailed || err.outdatedFirmware)) {
            // don't retry on unrecoverable errors
            d.reject();
            return;
          }
          btchip.getDevice(true).then(function () {
            doSuccess();
          }, function () {
            // can be set to success by signup (if trezor got connected)
            if (!that.success) that.showModal(d);
            $timeout(check, 1000);
          });
        });
      };
      check();
      return d.promise;
    }
  };
}
