var Window = require('global/window');

// include all the libraries
Window.autobahn = require('./autobahn.min');
require('./angular');
require('./sha512');

require('./d3.min');
require('./crossfilter.min');
require('./dc.min');
require('./gettext');

// whatever this means?
Window.notCdvapp = function () {
  require('./jsqrcode/grid');
  require('./jsqrcode/version');
  require('./jsqrcode/detector');
  require('./jsqrcode/formatinf');
  require('./jsqrcode/errorlevel');
  require('./jsqrcode/bitmat');
  require('./jsqrcode/datablock');
  require('./jsqrcode/bmparser');
  require('./jsqrcode/datamask');
  require('./jsqrcode/rsdecoder');
  require('./jsqrcode/gf256poly');
  require('./jsqrcode/gf256');
  require('./jsqrcode/decoder');
  require('./jsqrcode/qrcode');
  require('./jsqrcode/findpat');
  require('./jsqrcode/alignpat');
  require('./jsqrcode/databr');
}
