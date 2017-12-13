var window = require('global/window');

module.exports = factory;

factory.dependencies = ['$timeout', '$document'];

function factory ($timeout, $document) {
  var timeoutms = 1000;
  var autotimeoutService = {
    promise: false,
    callbacks: [],

    registerObserverCallback: registerObserverCallback,
    stop: stop,
    start: start
  };

  return autotimeoutService;

  function start (amountminutes) {
    autotimeoutService.stop();
    if (Number(amountminutes) !== 0) {
      reset(amountminutes);
      autotimeoutService.promise = $timeout(countdown, timeoutms);
      $document.find('body').on('mousemove keydown DOMMouseScroll mousewheel mousedown touchstart', function () {
        try {
          reset(amountminutes);
        } catch (err) {
          // already logged out
          console.log(err.stack || err);
        // autotimeoutService.stop()
        }
      });
    }
  }
  function stop () {
    $document.find('body').off('mousemove keydown DOMMouseScroll mousewheel mousedown touchstart');
    if (autotimeoutService.promise) {
      $timeout.cancel(autotimeoutService.promise);
      autotimeoutService.promise = false;
    }
  }
  function registerObserverCallback (callback) {
    autotimeoutService.callbacks.push(callback);
  }

  function notifyObservers () {
    autotimeoutService.callbacks.map(runObserver);
  }

  function runObserver (fn) {
    try {
      fn();
    } catch (_) {}
  }

  function reset (amountminutes) {
    autotimeoutService.startTime = Date.now();
    autotimeoutService.expires = Math.round(amountminutes * 1000 * 60);
    autotimeoutService.left = autotimeoutService.expires;
  }

  function countdown () {
    var now = Date.now();
    autotimeoutService.left = autotimeoutService.left - timeoutms;
    if ((now - autotimeoutService.startTime) >= autotimeoutService.expires) {
      autotimeoutService.stop();
      if (require('has-chrome-storage')) {
        window.chrome.runtime.reload();
      } else {
        window.location.reload();
      }
    } else {
      notifyObservers();
      autotimeoutService.promise = $timeout(countdown, timeoutms);
    }
  }
}
