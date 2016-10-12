// from https://github.com/bitcoinjs/bitcoinjs-lib/pull/520

var bitcoin = require('bitcoinjs-lib');
var bufferutils = require('bitcoinjs-lib').bufferutils;

var BufferWriter = function (length) {
  this.buffer = new Buffer(length);
  this.offset = 0;
};

BufferWriter.prototype.writeSlice = function (slice) {
  slice.copy(this.buffer, this.offset);
  this.offset += slice.length;

  return this;
};

BufferWriter.prototype.writeSliceWithVarInt = function (script) {
  this.writeVarInt(script.length);
  this.writeSlice(script);

  return this;
};

BufferWriter.prototype.writeScript = BufferWriter.prototype.writeSliceWithVarInt;

BufferWriter.prototype.writeInt = function (i) {
  this.buffer.writeUInt8(i, this.offset);
  this.offset += 1;

  return this;
};

BufferWriter.prototype.writeUInt64 = function (i) {
  bufferutils.writeUInt64LE(this.buffer, i, this.offset);
  this.offset += 8;

  return this;
};

BufferWriter.prototype.writeUInt32 = function (i) {
  this.buffer.writeUInt32LE(i, this.offset);
  this.offset += 4;

  return this;
};

BufferWriter.prototype.writeVarInt = function (i) {
  this.offset += bufferutils.writeVarInt(this.buffer, i, this.offset);

  return this;
};

function hashSegWit (tx, inIndex, prevOutScript, amount, hashType) {
  var Transaction = bitcoin.Transaction;
  var bcrypto = bitcoin.crypto;
  var bufferutils = bitcoin.bufferutils;

  var hashPrevouts = new Buffer(((new Array(32 + 1)).join('00')), 'hex');
  var hashSequence = new Buffer(((new Array(32 + 1)).join('00')), 'hex');
  var hashOutputs = new Buffer(((new Array(32 + 1)).join('00')), 'hex');

  function txOutToBuffer(txOut) {
    var bufferWriter = new BufferWriter(8 + bufferutils.varIntSize(txOut.script.length) + txOut.script.length);

    bufferWriter.writeUInt64(txOut.value);
    bufferWriter.writeScript(txOut.script);

    return bufferWriter.buffer;
  }

  if (!(hashType & Transaction.SIGHASH_ANYONECANPAY)) {
    hashPrevouts = bcrypto.hash256(Buffer.concat(tx.ins.map(function(txIn) {
      var bufferWriter = new BufferWriter(36);

      bufferWriter.writeSlice(txIn.hash);
      bufferWriter.writeUInt32(txIn.index);

      return bufferWriter.buffer;
    })))
  }

  if (!(hashType & Transaction.SIGHASH_ANYONECANPAY) && hashType & 0x1f != Transaction.SIGHASH_SINGLE && (hashType & 0x1f) != Transaction.SIGHASH_NONE) {
    hashSequence = bcrypto.hash256(Buffer.concat(tx.ins.map(function(txIn) {
      var bufferWriter = new BufferWriter(4);

      bufferWriter.writeUInt32(txIn.sequence);

      return bufferWriter.buffer;
    })));
  }

  if ((hashType & 0x1f) != Transaction.SIGHASH_SINGLE && (hashType & 0x1f) != Transaction.SIGHASH_NONE) {
    hashOutputs = bcrypto.hash256(Buffer.concat(tx.outs.map(function(txOut) {
      return txOutToBuffer(txOut)
    })));
  } else if ((hashType & 0x1f) == Transaction.SIGHASH_SINGLE && inIndex < tx.outs.length) {
    hashOutputs = bcrypto.hash256(txOutToBuffer(tx.outs[inIndex]));
  }

  var bufferWriter = new BufferWriter(4 + 32 + 32 + 32 + 4 + bufferutils.varIntSize(prevOutScript.length) + prevOutScript.length + 8 + 4 + 32 + 4 + 4);

  bufferWriter.writeUInt32(tx.version);

  bufferWriter.writeSlice(hashPrevouts);
  bufferWriter.writeSlice(hashSequence);

  // The input being signed (replacing the scriptSig with scriptCode + amount)
  // The prevout may already be contained in hashPrevout, and the nSequence
  // may already be contain in hashSequence.
  bufferWriter.writeSlice(tx.ins[inIndex].hash);
  bufferWriter.writeUInt32(tx.ins[inIndex].index);
  bufferWriter.writeScript(prevOutScript);
  bufferWriter.writeUInt64(amount);
  bufferWriter.writeUInt32(tx.ins[inIndex].sequence);

  bufferWriter.writeSlice(hashOutputs);

  bufferWriter.writeUInt32(tx.locktime);
  bufferWriter.writeUInt32(hashType);

  return bcrypto.hash256(bufferWriter.buffer);
}

module.exports = {hashSegWit: hashSegWit};
