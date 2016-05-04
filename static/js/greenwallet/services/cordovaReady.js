var window = require('global/window');

module.exports = factory;

function factory () {
  return cordovaReady;
}

function cordovaReady (fn) {
  // cordovaReady is called even when there is no Cordova support, hence
  // the plain `return fn` below.

  // This is because WebSockets are implemented on Android in Cordova,
  // so the initial implementation was a generic wrapper which runs
  // code even without Cordova, to allow running the same WebSockets
  // code on desktop and Android.

  // (See the usage in js/greenwallet/services.js: ab.connect()
  // is wrapped inside cordovaReady, because it uses WebSockets)

  // Maybe it might be better to add some runEvenWithoutCordova
  // argument to cordovaReady for that WebSockets special case,
  // and by default don't run anything on desktop from the function
  // returned there...
  if (!window.cordova) {
    return fn;
  }

  var queue = [];

  var impl = function () {
    queue.push([this, Array.prototype.slice.call(arguments)]);
  };

  document.addEventListener('deviceready', function () {
    queue.forEach(function (args) {
      fn.apply(args[0], args[1]);
    });
    impl = fn;
    navigator.splashscreen.hide();
  }, false);

  return function () {
    return impl.apply(this, arguments);
  };
}
