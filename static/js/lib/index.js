var Window = require('global/window');

// include all the libraries
Window.autobahn = require('./autobahn.min');
Window.$q = require('q');

require('./angular');
require('./sha512');

require('./gettext');
