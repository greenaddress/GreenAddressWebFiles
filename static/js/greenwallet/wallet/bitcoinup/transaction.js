var bitcoin = require('bitcoinjs-lib');
var bufferutils = bitcoin.bufferutils;
var extend = require('xtend/mutable');

module.exports = Transaction;

extend(Transaction.prototype, {
  byteLength: byteLength,
  estimateSignedLength: estimateSignedLength,
  toBuffer: toBuffer,

  // (we don't want direct js lists manipulation because this object is going
  //  to eventually be a flat C structure with accessor methods)
  addOutput: addOutput,
  getOutputsCount: getOutputsCount,
  getOutput: getOutput,
  replaceOutput: replaceOutput,
  clearOutputs: clearOutputs,
  addInput: addInput,
  clearInputs: clearInputs
});
Transaction.fromHex = fromHex;

function Transaction () {
  this.tx = new bitcoin.Transaction();
}

function addInput (input) {
  var idx = this.tx.addInput(
    input.txHash, input.vout, input.sequence, input.prevOutScript
  );
  var ret = this.tx.ins[idx];
  ret.prevOut = input.prevOut;
  return ret;
}

function addOutput () {
  var idx = this.tx.addOutput.apply(this.tx, arguments);
  return this.tx.outs[idx];
}

function replaceOutput (idx, scriptPubKey, value, fee) {
  this.tx.outs[idx].script = scriptPubKey;
  this.tx.outs[idx].value = value;
  this.tx.outs[idx].fee = fee;
}

function clearOutputs () {
  this.tx.outs = [];
}

function clearInputs () {
  this.tx.ins = [];
}

function byteLength () {
  return this.tx.byteLength();
}

function estimateSignedLength () {
  var ret = this.tx.byteLength();
  this.tx.ins.forEach(function (input) {
    ret -= scriptSize(input.script.length);
    var scriptSigSize = (
        1 + // OP_0 required for multisig
        // TODO: classify prevscript and derive number of signatures from it
        2 * pushDataSize(64) + // 2 signatures pushdata
        pushDataSize(
          input.prevOut.getPrevScriptLength()
        ) // prevScript pushdata
    );
    ret += scriptSize(scriptSigSize);
  });

  return ret;

  function scriptSize (length) {
    return bufferutils.varIntSize(length) + length;
  }
  function pushDataSize (length) {
    return bufferutils.pushDataSize(length) + length;
  }
}

function toBuffer () {
  return this.tx.toBuffer();
}

function getOutputsCount () {
  return this.tx.outs.length;
}

function getOutput (i) {
  return this.tx.outs[i];
}

function fromHex (hex) {
  var ret = new Transaction();
  ret.tx = bitcoin.Transaction.fromHex(hex);
  return ret;
}