var window = require('global/window');
var cordova = window.cordova;
var Bitcoin = window.Bitcoin;

module.exports = factory;

factory.dependencies = ['cordovaReady', '$q'];

function factory (cordovaReady, $q) {
  var pbkdf2_iterations = 10; // Not ideal, but limitations of using javascript
  var cryptoService = {};
  cryptoService.encrypt = function (data, password) {
    if (window.cordova && cordova.platformId === 'ios') {
      var deferred = $q.defer();
      cordovaReady(function () {
        cordova.exec(function (param) {
          deferred.resolve(param);
        }, function (fail) {
          console.log('cryptoService.encrypt failed: ' + fail);
          deferred.resolve();
        }, 'AES', 'encrypt', [data, password]);
      })();
      return deferred.promise;
    } else {
      var salt = Bitcoin.randombytes(16);
      var key256Bits = Bitcoin.pbkdf2.pbkdf2Sync(
        password,
        salt,
        pbkdf2_iterations,
        256 / 8
      );
      var cipher = Bitcoin.aes.createCipheriv(
        'aes-256-cbc',
        key256Bits,
        salt
      );
      cipher.end(data);
      return $q.when(Bitcoin.Buffer.Buffer.concat([
        salt, cipher.read()
      ]).toString('base64'));
    }
  };
  cryptoService.decrypt = function (data, password) {
    if (window.cordova && cordova.platformId === 'ios') {
      var deferred = $q.defer();
      cordovaReady(function () {
        cordova.exec(function (param) {
          deferred.resolve(param);
        }, function (fail) {
          console.log('cryptoService.encrypt failed: ' + fail);
          deferred.resolve();
        }, 'AES', 'decrypt', [data, password]);
      })();
      return deferred.promise;
    } else {
      try {
        var parsed_data = new Bitcoin.Buffer.Buffer(data, 'base64');
        var salt = parsed_data.slice(0, 16);
        parsed_data = parsed_data.slice(16);
        var key256Bits = Bitcoin.pbkdf2.pbkdf2Sync(
          password,
          salt,
          pbkdf2_iterations,
          256 / 8
        );
        var cipher = Bitcoin.aes.createDecipheriv(
          'aes-256-cbc',
          key256Bits,
          salt
        );
        cipher.setAutoPadding(false);
        cipher.end(parsed_data);
        var decoded = cipher.read();
        // ignore padding bytes for backwards compatibility,
        // because our old implementation used the iso10126 padding:
        var padding = decoded[decoded.length - 1];
        decoded = decoded.slice(0, decoded.length - padding);
        if (decoded != null) {
          return $q.when(decoded.toString('utf-8'));
        }
      } catch (e) {
        console.log(e);
      }
      return $q.when();
    }
  };
  return cryptoService;
}
