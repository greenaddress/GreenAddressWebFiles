var window = require('global/window');
var test = require('tape');

window.gettext = function (str) { return str; };
window.BASE_URL = '';

test('focus', function (t) {
  t.plan(4);

  var Focus = require('./focus');
  var hasBroadcasted = false;
  var rootScope = {
    $broadcast: function (method, name) {
      t.equal(method, 'focusOn');
      t.equal(name, 'foo');
      t.notOk(hasBroadcasted, 'broadcasts once');
      hasBroadcasted = true;
    }
  };
  var focusFn = Focus(rootScope, setTimeout);

  focusFn('foo');
  t.notOk(hasBroadcasted, 'broadcasts async');
});
