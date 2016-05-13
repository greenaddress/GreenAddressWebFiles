var window = require('global/window');

module.exports = factory;

function factory () {
  if (require('has-chrome-storage') || window.cordova) {
    return 'greenaddress.it';
  } else {
    return window.location.hostname;
  }
}
