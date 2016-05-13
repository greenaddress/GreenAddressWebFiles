var window = require('global/window');
var angular = require('angular');

module.exports = factory;

function factory () {
  return parseKeyValue;

  function parseKeyValue (keyValue) {
    var obj = {};
    var key_value;
    var key;
    angular.forEach((keyValue || '').split('&'), function (keyValue) {
      if (keyValue) {
        key_value = keyValue.split('=');
        key = tryDecodeURIComponent(key_value[0]);
        if (key !== undefined) {
          var val = (key_value[1] !== undefined) ? tryDecodeURIComponent(key_value[1]) : true;
          if (!obj[key]) {
            obj[key] = val;
          } else if (toString.call(obj[key]) === '[object Array]') {
            obj[key].push(val);
          } else {
            obj[key] = [obj[key], val];
          }
        }
      }
    });
    return obj;
  }

  function tryDecodeURIComponent (value) {
    try {
      return window.decodeURIComponent(value);
    } catch (e) {
      // Ignore any invalid uri component
    }
  }
}
