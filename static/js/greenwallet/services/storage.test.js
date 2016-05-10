var test = require('tape');
var Storage = require('./storage');

var KEY = 'some key';
var VALUE = 'indeed';
var OBJVALUE = {foo: 'bar'};

test('storage', function (t) {
  t.test('basic get and set', function (t) {
    t.plan(3);

    var storage = Storage(require('q'));
    t.ok(storage, 'valid service');

    storage.set(KEY, VALUE, function (err) {
      t.notOk(err, 'no errors');

      storage.get(KEY)
        .catch(function (err) {
          console.error(err);
          t.ok(true, 'received error');
        })
        .then(function (value) {
          t.equals(value, VALUE, 'value matches');
        });
    });
  });

  t.test('object get and set', function (t) {
    t.plan(3);

    var storage = Storage(require('q'));
    t.ok(storage, 'valid service');

    storage.set(KEY, OBJVALUE, function (err) {
      t.notOk(err, 'no errors');

      storage.get(KEY)
        .catch(function (err) {
          console.error(err);
          t.ok(true, 'received error');
        })
        .then(function (value) {
          t.deepEqual(value, OBJVALUE);
        });
    });
  });

  t.test('multiple keys', function (t) {
    t.plan(3);

    var storage = Storage(require('q'));
    t.ok(storage, 'valid service');

    storage.set({
      foo: 'bar',
      which: 'indeed'
    }, function (err) {
      t.notOk(err, 'no errors');

      storage.get(['foo', 'which'])
        .catch(function (err) {
          console.error(err);
          t.ok(true, 'received error');
        })
        .then(function (value) {
          t.deepEqual(value, {
            foo: 'bar',
            which: 'indeed'
          });
        });
    });
  });
});
