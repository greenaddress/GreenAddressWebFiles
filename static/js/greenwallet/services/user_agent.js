var window = require('global/window');
var is_chrome_app = require('has-chrome-storage');

var is_cordova_app = window.cordova;

module.exports = function () {
  return function (wallet) {
    if (is_cordova_app) {
      return 'Cordova ' + window.cordova.platformId +
      ' (version=' + wallet.version + ')';
    } else if (is_chrome_app) {
      return 'Chrome ' + '(version=' + wallet.version + ')';
    } else {
      return 'Browser';
    }
  };
};
