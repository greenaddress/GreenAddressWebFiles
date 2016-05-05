var app = require('./app');
require('./signuplogin');
require('./info');
require('./receive');
require('./send');
require('./settings');
require('./transactions');
require('./controllers');
require('./directives');
require('./mnemonics');
require('./apps');

require('./services')();

// last minute initialization code attached to app
require('./init');

module.exports = app;
