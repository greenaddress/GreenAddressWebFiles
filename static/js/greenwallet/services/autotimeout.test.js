var test = require('tape');
var window = require('global/window');
var document = require('global/document');

test('auto timeout', function (t) {
  t.plan(26);

  var AutoTimeout = require('./autotimeout');
  var $timeout = setTimeout;
  var listening = false;
  var wakeHandler = null;
  $timeout.cancel = clearTimeout;

  window.location = {
    reload: function () {
      t.notOk('should not call reload yet');
    }
  };

  document.find = function (nodeName) {
    t.equal(nodeName, 'body', 'attached to body directly');
    return {
      on: function (selector, fn) {
        t.notOk(listening, 'doesnt listen twice');
        t.ok(typeof fn === 'function', 'passes in handler');
        wakeHandler = fn;
        listening = selector;
      },
      off: function (selector) {
        if (!listening) {
          t.notOk(listening, 'calls off when it doesnt need to');
        } else {
          t.equal(listening, selector, 'unlistens on the same selector');
          listening = false;
        }
      }
    };
  };

  var autotimeout = AutoTimeout($timeout, document);

  t.ok(autotimeout);

  // 16 tests run without the timers
  autotimeout.registerObserverCallback(function () {
    var secondsLeft = ~~(autotimeout.left / 1000);
    t.ok(true, 'handler runs ' + secondsLeft + 's left');
    if (secondsLeft === 1 && wakeHandler) {
      t.doesNotThrow(wakeHandler, 'wake handler works');
      t.equal(~~autotimeout.left, 4000, 'starts count over');
      // don't wake anymore
      wakeHandler = null;
    }
  });

  autotimeout.start(5 / 60);
  t.equal(~~autotimeout.left, 5000, 'exposes time remaining');
  autotimeout.start(4 / 60);
  t.equal(~~autotimeout.left, 4000, 'exposes time remaining');

  // activate reload method
  window.location.reload = function () {
    t.ok(true, 'calls reload');
  };
});
