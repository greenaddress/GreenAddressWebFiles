var bitcoin = require('bitcoinjs-lib');
var ByteString = require('../../hw-apis/ledger-js/api/ByteString');
var extend = require('xtend/mutable');
var window = require('global/window');
var HEX = require('../../hw-apis/ledger-js/api/GlobalConstants').HEX;
var Q = require('../../hw-apis/ledger-js/thirdparty/q/q.min');
var scriptTypes = require('../constants').scriptTypes;

module.exports = LedgerCordovaWrapper;

function txSerializeOutputs (tx) {
  var parts = [];

  parts.push(bitcoin.bufferutils.varIntBuffer(tx.outs.length));

  tx.outs.forEach(function (txout) {
    var valueBuf = new Buffer(8);
    bitcoin.bufferutils.writeUInt64LE(valueBuf, txout.value, 0);
    parts.push(valueBuf);
    parts.push(bitcoin.bufferutils.varIntBuffer(txout.script.length));
    parts.push(txout.script);
  });

  return Buffer.concat(parts);
}

function LedgerCordovaWrapper () {
  this.dongle = {
    disconnect_async: function () {
      var promise = Q.defer();
      window.cordova.exec(function () {
        promise.resolve();
      }, function (fail) {
        promise.reject(fail);
      }, 'BTChip', 'disconnect', []);
      return promise.promise;
    }
  };
  this.callQueue = [];
}
extend(LedgerCordovaWrapper.prototype, {
  getVendorId: function () {
    return new Promise(function (cb, eb) {
      return window.cordova.exec(function (result) {
        cb(result);
      }, function (fail) {
        eb(fail);
      }, 'BTChip', 'getVendorId', []);
    });
  },
  makeFirstCall: function () {
    var next = function () {
      this.callQueue.shift();
      if (this.callQueue.length) {
        this.makeFirstCall();
      }
    }.bind(this);
    var call = this.callQueue[0];
    window.cordova.exec(function (result) {
      call[0](result);
      next();
    }, function (fail) {
      call[1](fail);
      next();
    }, 'BTChip', call[2], call[3]);
  },
  queuedCordovaCall: function (cb, eb, func, args) {
    this.callQueue.push([cb, eb, func, args]);
    if (this.callQueue.length === 1) {
      this.makeFirstCall();
    }
  },
  getFirmwareVersion_async: function () {
    var promise = Q.defer();
    this.queuedCordovaCall(function (result) {
      result = new ByteString(result, HEX);
      promise.resolve({
        compressedPublicKeys: result.byteAt(0) === 0x01,
        firmwareVersion: result.bytes(1)
      });
    }, function (fail) {
      promise.reject(fail);
    }, 'getFirmwareVersion', []);
    return promise.promise;
  },
  verifyPin_async: function (pin) {
    var _this = this;
    if (this.pin_verified) return Promise.resolve();
    var promise = Q.defer();
    this.queuedCordovaCall(function (result) {
      _this.pin_verified = true;
      promise.resolve();
    }, function (fail) {
      promise.reject(fail);
    }, 'verifyPin', [ pin.toString(HEX) ]);
    return promise.promise;
  },
  getWalletPublicKey_async: function (path) {
    var promise = Q.defer();
    this.queuedCordovaCall(function (result) {
      promise.resolve({
        bitcoinAddress: { value: result.bitcoinAddress },
        chainCode: new ByteString(result.chainCode, HEX),
        publicKey: new ByteString(result.publicKey, HEX)
      });
    }, function (fail) {
      promise.reject(fail);
    }, 'getWalletPublicKey', [ path ]);
    return promise.promise;
  },
  signMessagePrepare_async: function (path, msg) {
    var promise = Q.defer();
    this.queuedCordovaCall(function (result) {
      promise.resolve(result);
    }, function (fail) {
      promise.reject(fail);
    }, 'signMessagePrepare', [ path, msg.toString(HEX) ]);
    return promise.promise;
  },
  signMessageSign_async: function (pin) {
    var promise = Q.defer();
    this.queuedCordovaCall(function (result) {
      promise.resolve(new ByteString(result, HEX));
    }, function (fail) {
      promise.reject(fail);
    }, 'signMessageSign', [pin.toString(HEX)]);
    return promise.promise;
  },
  gaStartUntrustedHashTransactionInput_async: function (newTransaction, tx, i, segwit) {
    var promise = Q.defer();
    var inputs = [];
    for (var j = 0; j < tx.ins.length; j++) {
      var input = tx.ins[ j ];
      var txhash = input.hash.toString('hex');
      var outpointAndSequence = new Buffer(8);
      outpointAndSequence.writeUInt32LE(input.index, 0);
      outpointAndSequence.writeUInt32LE(input.sequence, 4);
      outpointAndSequence = outpointAndSequence.toString('hex');
      var value = '';
      if (segwit) {
        var valueBuf = new Buffer(8);
        bitcoin.bufferutils.writeUInt64LE(valueBuf, input.prevOut.value, 0);
        value = valueBuf.toString('hex');
      }
      inputs.push(txhash + outpointAndSequence + value);
    }
    var script = tx.ins[ i ].script.toString('hex');
    this.queuedCordovaCall(function (result) {
      promise.resolve(result);
    }, function (fail) {
      promise.reject(fail);
    }, 'startUntrustedTransaction', [ newTransaction, i, inputs, script, segwit ]);
    return promise.promise;
  },

  gaUntrustedHashTransactionInputFinalizeFull_async: function (tx) {
    var promise = Q.defer();
    this.queuedCordovaCall(function (result) {
      promise.resolve(result);
    }, function (fail) {
      promise.reject(fail);
    }, 'finalizeInputFull', [ txSerializeOutputs(tx).toString('hex') ]);
    return promise.promise;
  },
  signTransaction_async: function (path, transactionAuthorization, lockTime) {
    var promise = Q.defer();
    this.queuedCordovaCall(function (result) {
      promise.resolve(new ByteString(result, HEX));
    }, function (fail) {
      promise.reject(fail);
    }, 'untrustedHashSign', [ path, lockTime ]);
    return promise.promise;
  }
});
