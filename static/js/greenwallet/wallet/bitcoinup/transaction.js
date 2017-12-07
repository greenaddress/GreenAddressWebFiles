var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var crypto = require('crypto');
var scriptTypes = require('../ga-impl/constants').scriptTypes;
var extend = require('xtend/mutable');

module.exports = Transaction;

const SIG_LEN = 73;

extend(Transaction.prototype, {
  byteLength: byteLength,
  hasWitnesses: hasWitnesses,
  virtualSize: virtualSize,
  estimateSignedLength: estimateSignedLength,
  toBuffer: toBuffer,
  build: build,
  _addFeeAndChange: _addFeeAndChange,
  _addChangeOutput: _addChangeOutput,

  // (we don't want direct js lists manipulation because this object is going
  //  to eventually be a flat C structure with accessor methods)
  addOutput: addOutput,
  getOutputsCount: getOutputsCount,
  getOutput: getOutput,
  replaceOutput: replaceOutput,
  clearOutputs: clearOutputs,
  addInput: addInput,
  clearInputs: clearInputs,
  clearFeeChanges: clearFeeChanges
});
Transaction.fromHex = fromHex;

function Transaction () {
  this.tx = new bitcoin.Transaction();
}

function addInput (input) {
  var idx = this.tx.addInput(
    input.txHash, input.vout, input.sequence, input.prevOutScript
  );
  var script = bitcoin.script.compile([].concat(
    bitcoin.opcodes.OP_0,
    new Buffer(SIG_LEN), // average sig size
    new Buffer(SIG_LEN), // average sig size
    new Buffer(input.prevOut.getPrevScriptLength())
  ));
  if (input.prevOut.raw.script_type === scriptTypes.OUT_P2SH_P2WSH) {
    this.tx.setWitness(idx, [script]);
    this.tx.ins[idx].script = new Buffer(35);
  } else {
    this.tx.ins[idx].script = script;
  }
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

function clearFeeChanges () {
  for (var i = 0; i < this.tx.ins.length; ++i) {
    this.tx.ins[i].witness = [];
    this.tx.ins[i].script = [];
  }
}

function byteLength () {
  return this.tx.byteLength();
}

function hasWitnesses () {
  return this.tx.hasWitnesses();
}

function virtualSize () {
  return this.tx.virtualSize();
}

function estimateSignedLength () {
  if (!this.hasWitnesses()) {
    return this.byteLength();
  } else {
    return this.virtualSize();
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

function _addChangeOutput (script, value) {
  // 1. Generate random change output index. It is done for privacy reasons,
  //    to avoid easy tracing of coins with constant change index.
  var changeIdx = (
      +BigInteger.fromBuffer(crypto.randomBytes(4))
    ) % (this.getOutputsCount() + 1);

  // 2. add the output at the index
  if (changeIdx === this.getOutputsCount()) {
    var changeOut = this.addOutput(script.outScript, value, 0);
    changeOut.pointer = script.pointer;
    changeOut.subaccount = script.subaccount;
  } else {
    var newOutputs = [];
    for (var i = 0; i < this.getOutputsCount(); ++i) {
      if (i === changeIdx) {
        newOutputs.push({
          script: script.outScript, value: value, fee: 0,
          pointer: script.pointer, subaccount: script.subaccount
        });
      }
      newOutputs.push(this.getOutput(i));
    }
    this.clearOutputs();
    newOutputs.forEach(function (out) {
      var newOut = this.addOutput(out.script, out.value, out.fee);
      newOut.pointer = out.pointer;
      newOut.subaccount = out.subaccount;
    }.bind(this));
  }

  this.segwit_change = script.segwit_change;

  return changeIdx;
}

function _sumPrevouts (prevouts) {
  var ret = Promise.resolve(0);
  prevouts.forEach(function (prevout) {
    ret = ret.then(function (curTotal) {
      return prevout.getValue().then(function (nextVal) {
        return curTotal + nextVal;
      });
    });
  });
  return ret;
}

var DUST = 546;

function _addFeeAndChange (options) {
  var feeEstimate = options.feeEstimate;
  var prevouts = options.prevOutputs;
  var getChangeOutputScript = options.getChangeOutScript;
  var changeCache = options.changeCache;

  // 1. calculate prevouts value
  var prevoutsValueDeferred = _sumPrevouts(prevouts);

  // 2. calculate current sum of output values
  var requiredValue = 0;
  for (var i = 0; i < this.getOutputsCount(); ++i) {
    requiredValue += this.getOutput(i).valueToBlind || this.getOutput(i).value;
  }

  // 4. make sure fee is right
  var fee = Math.round(feeEstimate * this.estimateSignedLength() / 1000);
  if (options.feeMultiplier) {
    fee = Math.round(fee * options.feeMultiplier);
  }
  var ret = Promise.resolve({changeIdx: -1}); // -1 indicates no change

  return prevoutsValueDeferred.then(function (prevoutsValue) {
    if (options.subtractFeeFromOut) {
      if (this.tx.outs.length > 1) {
        throw new Error('subtractFeeFromOut not supported for multiple outputs');
      }

      if (prevoutsValue < fee + DUST) {
        // only the fee + DUST is required if we subtract from outputs
        return Promise.resolve([ fee + DUST, changeCache ]);
      }

      this.replaceOutput(
        0,
        this.tx.outs[0].script,
        prevoutsValue - fee,
        fee
      );

      return Promise.resolve();
    }

    if (prevoutsValue < requiredValue + fee) {
      // not enough -- return a request to fetch more prevouts
      return Promise.resolve([ requiredValue + fee, changeCache ]);
    }

    if (prevoutsValue === requiredValue + fee) {
      // we got exactly the required value of prevouts
      return ret;
    } else if (prevoutsValue < requiredValue + fee + DUST) {
      // if change results in adding outputs below dust, we need more inputs
      return Promise.resolve([ requiredValue + fee + DUST, changeCache ]);
    }

    // prevouts are larger than required value -- we need to add change output
    if (changeCache) {
      ret = Promise.resolve(changeCache);
    } else {
      ret = getChangeOutputScript();
    }
    ret = ret.then(function (outScript) {
      changeCache = outScript;
      return this._addChangeOutput(
        outScript,
        prevoutsValue - (requiredValue + fee)
      );
    }.bind(this)).then(function (changeIdx) {
      var iterateFee = getIterateFee(requiredValue, changeIdx, changeCache);

      return iterateFee.call(this).then(function (ret) {
        return ret || { changeIdx: changeIdx };
      });
    }.bind(this));

    function getIterateFee (requiredValueForFee, changeIdx, changeScript) {
      return iterateFee;

      function iterateFee () {
        // check if after constructing the tx the fee needs to be increased
        var expectedFee = Math.round(feeEstimate * this.estimateSignedLength() / 1000);
        if (options.feeMultiplier) {
          expectedFee = Math.round(expectedFee * options.feeMultiplier);
        }

        if (fee >= expectedFee) {
          return Promise.resolve();
        }

        fee = expectedFee;

        if (prevoutsValue < requiredValueForFee + fee + DUST) {
          // After adding the change output, which made the transaction larger,
          // the prevouts match the fee (+ at most DUST), but we now have
          // change which cannot be smaller than dust threshold.
          // In such case increase the fee to have at least minimum change value.
          fee += DUST;
          // (Without this check,
          //        prevoutsValue - (requiredValueForFee + fee) < DUST,
          //  which would result in an invalid value smaller than the
          //  dust threshold.)
          // Note this triggers the check below which requests prevoutsValue
          // increase from the caller. (Because after fee += DUST,
          //        prevoutsValue < requiredValueForFee + fee.)
        }

        if (prevoutsValue < requiredValueForFee + fee) {
          // prevouts are not enough for fee after adding the change output.
          return Promise.resolve([ requiredValueForFee + fee, changeCache ]);
        }

        this.replaceOutput(
          changeIdx,
          changeScript.outScript,
          prevoutsValue - (requiredValueForFee + fee),
          fee
        );

        return Promise.resolve();
      }
    }
    return ret;
  }.bind(this));
}

function build (options) {
  this.clearInputs();
  this.clearOutputs();
  options.prevOutputs.map(function (prevOut) {
    this.addInput({
      txHash: prevOut.prevHash,
      vout: prevOut.ptIdx,
      prevValue: prevOut.value,
      prevOut: prevOut,
      sequence: (options.rbfOptIn
        ? 0xFFFFFFFD
        : (options.locktime ? 0xFFFFFFFE : 0xFFFFFFFF)
      )
    });
  }.bind(this));

  options.outputsWithAmounts.forEach(function (output) {
    this.addOutput(
      output.scriptPubKey,
      output.value,
      0
    );
  }.bind(this));

  return this._addFeeAndChange(options);
}
