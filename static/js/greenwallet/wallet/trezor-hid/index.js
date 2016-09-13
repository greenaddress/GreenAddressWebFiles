'use strict'

var trezor = require('./trezor');

module.exports = {
  load: function (hidImpl) {
    return new trezor.Trezor(hidImpl);
  },
  ByteBuffer: trezor.ByteBuffer
}
