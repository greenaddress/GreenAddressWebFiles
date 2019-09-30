var Window = require('global/window');

if (Window.Promise === undefined) {
  Window.Promise = require('promise-polyfill');
  var promiseFinally = require('promise.prototype.finally');
  promiseFinally.shim();
}

// load libs, this is basically a shame folder
require('./lib');

var app = module.exports = require('./greenwallet');

Window.app = app;
