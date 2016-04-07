var Window = require('global/window');
// load libs, this is basically a shame folder
require('./lib');

var app = module.exports = require('./greenwallet');

Window.app = app;
