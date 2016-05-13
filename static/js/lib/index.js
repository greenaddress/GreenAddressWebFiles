var Window = require('global/window');

// include all the libraries
Window.autobahn = require('./autobahn.min');
Window.$q = require('q');

require('./angular');
require('./sha512');

require('./d3.min');
require('./crossfilter.min');
require('./dc.min');
require('./gettext');
