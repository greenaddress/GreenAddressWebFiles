var window = require('global/window');
var is_chrome_app = require('has-chrome-storage');

var gettext = window.gettext;
var BASE_URL = window.BASE_URL;
var LANG = window.LANG;

module.exports = factory;

factory.dependencies = ['$q', '$uibModal', 'mnemonics', 'focus', 'cordovaReady'];

function factory ($q, $uibModal, mnemonics, focus, cordovaReady) {
  var bip38Service = {};
  var iframe;
  bip38Service.processMessage = function (message) {
    var d = $q.defer();
    if (window.cordova) {
      var method;
      var data;
      var password = message.password;
      if (message.mnemonic_decrypted) {
        method = 'encrypt_raw';
        data = message.mnemonic_decrypted;
      } else if (message.mnemonic_encrypted) {
        method = 'decrypt_raw';
        data = message.mnemonic_encrypted;
      }
      cordovaReady(function () {
        window.cordova.exec(function (result) {
          d.resolve({data: result});
        }, function (fail) {
          d.reject(fail);
        }, 'BIP38', method, [Array.from(data), password]);
      })();
    } else if (is_chrome_app) {
      var process = function () {
        var listener = function (message) {
          window.removeEventListener('message', listener);
          d.resolve(message);
        };
        window.addEventListener('message', listener);
        iframe.contentWindow.postMessage(message, '*');
      };
      if (!iframe) {
        if (document.getElementById('id_iframe_bip38_service')) {
          iframe = document.getElementById('id_iframe_bip38_service');
          process();
        } else {
          iframe = document.createElement('IFRAME');
          iframe.onload = process;
          iframe.setAttribute('src', '/bip38_sandbox.html');
          iframe.setAttribute('class', 'ng-hide');
          iframe.setAttribute('id', 'id_iframe_bip38_service');
          document.body.appendChild(iframe);
        }
      } else {
        process();
      }
    } else {
      var worker = new window.Worker('/static/js/greenwallet/signup/bip38_worker.js');
      worker.onmessage = function (message) {
        d.resolve(message);
      };
      worker.postMessage(message);
    }
    return d.promise;
  };
  bip38Service.encrypt_mnemonic_modal = function ($scope, seed) {
    var d = $q.defer();
    $scope.encrypt_password_modal = {
      encrypt: function () {
        this.error = undefined;
        if (!this.password) {
          this.error = gettext('Please provide a password.');
          return;
        }
        if (this.password !== this.password_repeated) {
          this.error = gettext('Passwords do not match.');
          return;
        }
        this.encrypting = true;
        var that = this;
        bip38Service.processMessage({password: that.password, mnemonic_decrypted: seed}).then(function (message) {
          mnemonics.toMnemonic(message.data).then(function (mnemonic) {
            that.encrypting = false;
            d.resolve(mnemonic);
            modal.close();
          });
        });
      }
    };
    var modal = $uibModal.open({
      templateUrl: BASE_URL + '/' + LANG + '/wallet/partials/signuplogin/modal_encryption_password.html',
      scope: $scope
    });
    modal.opened.then(function () { focus('encryptPasswordModal'); });
    return d.promise;
  };
  return bip38Service;
}
