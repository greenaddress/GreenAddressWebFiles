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
    if (window.cordova || (global.process && global.process.versions.node)) {
      var wally = require('wallyjs');
      if (message.mnemonic_encrypted) {
        var bytes = message.mnemonic_encrypted;
        var salt = bytes.slice(-4);
        d.resolve(wally.wally_scrypt(
          new Buffer(message.password, 'utf-8'), salt, 16384, 8, 8, 64
        ).then(function (derivedBytes) {
          var DECRYPT = 2;
          return wally.wally_aes(
            derivedBytes.slice(32, 32+32), bytes.slice(0, -4), DECRYPT
          ).then(function (decrypted) {
            for (var x = 0; x < 32; x++) {
              decrypted[x] ^= derivedBytes[x];
            }
            return decrypted;
          });
        }).then(function (decrypted) {
          var hash = Bitcoin.bitcoin.crypto.hash256(decrypted);
          for (var i = 0; i < 4; i++) {
              if (hash[i] != salt[i]) {
                return {data: {error: 'invalid password'}};
              }
          }
          return {data: decrypted};
        }));
      } else if (message.mnemonic_decrypted) {
        var data = message.mnemonic_decrypted;
        if (!message.salt_a) {
            message.salt_a = Bitcoin.bitcoin.crypto.hash256(data).slice(0, 4);
        }
        var salt = new Uint8Array(message.salt_a);

        d.resolve(wally.wally_scrypt(
          new Buffer(message.password, 'utf-8'), salt, 16384, 8, 8, 64
        ).then(function (key) {
          var derivedhalf1 = key.slice(0, 32), derivedhalf2 = key.slice(32, 64);
          var decrypted = [];
          for (var i = 0; i < 32; i++) {
              decrypted.push(data[i] ^ derivedhalf1[i]);
          }
          var ENCRYPT = 1;
          return wally.wally_aes(
            new Buffer(derivedhalf2), new Buffer(decrypted), ENCRYPT
          );
        }).then(function (encrypted) {
          var saltBuf = new Buffer(salt);
          return {data: Buffer.concat([new Buffer(encrypted), saltBuf])};
        }));
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
