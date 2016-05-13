var window = require('global/window');
var test = require('tape');
var proxy = require('proxyquire');

window.gettext = function (str) { return str; };
window.BASE_URL = '';

test('notices', function (t) {
  t.plan(38);

  var errorMessage = 'This is an error';
  var shouldChromeNotification = false;
  window.chrome = {
    notifications: {
      create: function (empty, opts) {
        t.ok(shouldChromeNotification);
        t.equal(empty, '', 'first param is always empty');
        t.deepEqual(opts, {
          type: 'basic',
          title: 'GreenAddress Notification',
          message: errorMessage,
          iconUrl: '/static/img/logos/logo-greenaddress.png'
        });
      }
    }
  };
  var ChromeNotices = proxy('./notices', {
    'has-chrome-storage': true
  });
  var Notices = proxy('./notices', {
    'has-chrome-storage': false
  });

  shouldChromeNotification = true;
  commonNoticeTests(ChromeNotices);
  shouldChromeNotification = false;
  commonNoticeTests(Notices);

  // run specific tests
  var rootScope = {};
  var timeout = setTimeout;
  var notices = Notices(rootScope, timeout);
  t.equal(rootScope.notices.length, 0);
  notices.makeNotice('info', 'Message 1', 200);
  t.equal(rootScope.notices.length, 1);
  notices.makeNotice('info', 'Message 2', 100);
  t.equal(rootScope.notices.length, 2);

  setTimeout(function () {
    t.equal(rootScope.notices.length, 1, 'removes entries');
    t.equal(rootScope.notices[0].msg, 'Message 1', 'handles out of order messages');
    notices.makeNotice('info', 'Message 3', 100);
    t.equal(rootScope.notices.length, 2, 'removes entries');
  }, 150);

  setTimeout(function () {
    t.equal(rootScope.notices.length, 1, 'removes entries');
    t.equal(rootScope.notices[0].msg, 'Message 3', 'handles ordered messages');
  }, 250);

  setTimeout(function () {
    t.equal(rootScope.notices.length, 0, 'cleans up');
  }, 310);

  function commonNoticeTests (Service) {
    basicTests(Service, t);

    var rootScope = {};
    var timeout = setTimeout;
    var notices = Service(rootScope, timeout);

    t.ok(notices);
    t.ok(Array.isArray(rootScope.notices));

    t.ok(typeof notices.makeError === 'function', 'api makeError');
    t.ok(typeof notices.makeNotice === 'function', 'api makeNotice');
    t.ok(typeof notices.setLoadingText === 'function', 'api setLoadingText');

    var scope = {
      wallet: {
        unit: 'mBTC'
      }
    };
    errorMessage = 'This is an error';
    notices.makeError(scope, new Error(errorMessage));
    t.equal(rootScope.notices.length, 1);

    // first check the message of a random server error
    var notenoughmoneyError = {
      error: 'com.greenaddress.error',
      args: ['something#someothererror', 'Do show this', {
        missing_satoshis: 1234
      }]
    };
    errorMessage = 'Do show this';
    notices.makeError(scope, notenoughmoneyError);
    t.equal(rootScope.notices.length, 2);
    // Then check the notenoughmoney error to make sure it is replaced
    notenoughmoneyError = {
      error: 'com.greenaddress.error',
      args: ['something#notenoughmoney', 'Do show this', {
        missing_satoshis: 1234
      }]
    };
    errorMessage = 'Not enough money, you need 0.01234 more mBTC to cover the transaction and fee';
    notices.makeError(scope, notenoughmoneyError);
    t.equal(rootScope.notices.length, 3);

    return rootScope;
  }
});

function basicTests (service, t) {
  t.ok(service, 'exists');
  t.ok(Array.isArray(service.dependencies) || !service.dependencies, 'dependencies is an array');
}
