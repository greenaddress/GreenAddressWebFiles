var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var bs58check = require('bs58check');
var bufferEquals = require('buffer-equals');
var crypto = require('crypto');
var bcrypto = bitcoin.crypto;
var bscript = bitcoin.script;
var bufferutils = bitcoin.bufferutils;
var opcodes = bitcoin.opcodes;
var Buffer = require('buffer').Buffer;
var extend = require('xtend/mutable');
var SchnorrSigningKey = require('./schnorr-signing-key');

var Transaction = require('./transaction');

module.exports = AssetsTransaction;

function AssetsTransactionImpl () {
  bitcoin.Transaction.apply(this, arguments);
}

AssetsTransactionImpl.prototype = new bitcoin.Transaction();
extend(AssetsTransactionImpl.prototype, {
  byteLength: byteLength,
  signedByteLength: signedByteLength,
  clone: clone,
  toBuffer: toBuffer,
  toBufferForSigning: toBufferForSigning,
  hashForSignature: hashForSignature
});

AssetsTransaction.prototype = new Transaction();
extend(AssetsTransaction.prototype, {
  build: build,
  _addFeeAndChange: _addFeeAndChange,
  _addFeeAndChangeWithAsset: _addFeeAndChangeWithAsset,
  _addChangeOutput: _addChangeOutput,
  _rebuildCT: _rebuildCT,
  _calcCTOutData: _calcCTOutData,
  signAll: signAll,
  signInput: signInput,
  addInput: addInput,
  addOutput: addOutput,
  replaceOutput: replaceOutput
});
AssetsTransaction.fromHex = fromHex;

/* C&P from bitcoin.types: */
var typeforce = require('typeforce')

function nBuffer (value, n) {
  typeforce(types.Buffer, value)
  if (value.length !== n) throw new Error('Expected ' + (n * 8) + '-bit Buffer, got ' + (value.length * 8) + '-bit Buffer')
  return true
}

function Hash160bit (value) { return nBuffer(value, 20) }
function Hash256bit (value) { return nBuffer(value, 32) }
function Buffer256bit (value) { return nBuffer(value, 32) }

var UINT53_MAX = Math.pow(2, 53) - 1
function UInt2 (value) { return (value & 3) === value }
function UInt8 (value) { return (value & 0xff) === value }
function UInt32 (value) { return (value >>> 0) === value }
function UInt53 (value) {
  return typeforce.Number(value) &&
    value >= 0 &&
    value <= UINT53_MAX &&
    Math.floor(value) === value
}

// external dependent types
var BigInt = typeforce.quacksLike('BigInteger')
var ECPoint = typeforce.quacksLike('Point')

// exposed, external API
var ECSignature = typeforce.compile({ r: BigInt, s: BigInt })
var Network = typeforce.compile({
  messagePrefix: typeforce.oneOf(typeforce.Buffer, typeforce.String),
  bip32: {
    public: UInt32,
    private: UInt32
  },
  pubKeyHash: UInt8,
  scriptHash: UInt8,
  wif: UInt8,
  dustThreshold: UInt53
})

// extend typeforce types with ours
var types = {
  BigInt: BigInt,
  Buffer256bit: Buffer256bit,
  ECPoint: ECPoint,
  ECSignature: ECSignature,
  Hash160bit: Hash160bit,
  Hash256bit: Hash256bit,
  Network: Network,
  UInt2: UInt2,
  UInt8: UInt8,
  UInt32: UInt32,
  UInt53: UInt53
}

for (var typeName in typeforce) {
  types[typeName] = typeforce[typeName]
}
/* END C&P from bitcoin.types */

function signedByteLength (signInIndex) {
  var forSigning = signInIndex !== -1;
  function scriptSize (someScript) {
    var length = someScript.length

    return bufferutils.varIntSize(length) + length
  }

  var forSigningInputLenDelta = 0;
  if (signInIndex !== -1) {
    var signIn = this.ins[signInIndex];
    forSigningInputLenDelta =
      (33 + (signIn.prevOutRaw
                  ? scriptSize(signIn.prevOutRaw.range_proof) +
                    scriptSize(signIn.prevOutRaw.nonce_commitment)
                  : 2));
  }

  return (
    8 +
    bufferutils.varIntSize(this.ins.length) +
    bufferutils.varIntSize(this.outs.length) +
    (forSigning ? 0 :
      (bufferutils.varIntSize(this.outs.length) + this.outs.length * 8)) +
    this.ins.reduce(function (sum, input) {
      return sum + 40 + scriptSize(input.script) + forSigningInputLenDelta
    }, 0) +
    this.outs.reduce(function (sum, output) {
      return sum + 33 + scriptSize(output.script) +
        (forSigning ? 32 :
          ((output.range_proof ? scriptSize(output.range_proof) : 1) +
           (output.nonce_commitment ? scriptSize(output.nonce_commitment) : 1))
        ) +
        32 // asset id
      }, 0
    )
  )
}

function byteLength () {
  return this.signedByteLength(-1);
}

function clone () {
  var newTx = new AssetsTransactionImpl()
  newTx.version = this.version
  newTx.locktime = this.locktime

  newTx.ins = this.ins.map(function (txIn) {
    return {
      hash: txIn.hash,
      index: txIn.index,
      script: txIn.script,
      sequence: txIn.sequence,
      prevValue: txIn.prevValue,
      prevOut: txIn.prevOut,
      prevOutRaw: txIn.prevOutRaw
    }
  })

  newTx.outs = this.outs.map(function (txOut) {
    return {
      value: txOut.value,
      script: txOut.script,
      commitment: txOut.commitment,
      range_proof: txOut.range_proof,
      nonce_commitment: txOut.nonce_commitment,
      asset_id: txOut.asset_id
    }
  })

  return newTx
}

function toBufferForSigning (signInIndex) {
  var buffer = new Buffer(this.signedByteLength(signInIndex))
  var forSigning = signInIndex != -1;

  var offset = 0
  function writeSlice (slice) {
    slice.copy(buffer, offset)
    offset += slice.length
  }

  function writeUInt32 (i) {
    buffer.writeUInt32LE(i, offset)
    offset += 4
  }

  function writeUInt64 (i) {
    bufferutils.writeUInt64LE(buffer, i, offset)
    offset += 8
  }

  function writeVarInt (i) {
    var n = bufferutils.writeVarInt(buffer, i, offset)
    offset += n
  }

  writeUInt32(this.version)
  writeVarInt(this.ins.length)

  if (forSigning) {
    var signIn = this.ins[signInIndex];
  }

  this.ins.forEach(function (txIn) {
    writeSlice(txIn.hash)
    writeUInt32(txIn.index)
    if (forSigning) {
      if (signIn.prevOutRaw) {
        writeSlice(signIn.prevOutRaw.commitment);
        writeVarInt(signIn.prevOutRaw.range_proof.length);
        writeSlice(signIn.prevOutRaw.range_proof);
        writeVarInt(signIn.prevOutRaw.nonce_commitment.length);
        writeSlice(signIn.prevOutRaw.nonce_commitment);
      } else {
        writeSlice(new Buffer(new Array(33-8)));
        var valBuf = new Buffer(8);
        bufferutils.writeUInt64LE(valBuf, signIn.prevValue, 0);
        writeSlice(bufferutils.reverse(valBuf));
        writeVarInt(0);
        writeVarInt(0);
      }
    }
    writeVarInt(txIn.script.length)
    writeSlice(txIn.script)
    writeUInt32(txIn.sequence)
  })

  if (!forSigning) {
    writeVarInt(this.outs.length);
    this.outs.forEach(function (txOut) {
      writeUInt64(txOut.fee || 0);
    });
  }

  writeVarInt(this.outs.length)
  this.outs.forEach(function (txOut) {
    if (txOut.commitment) {
      writeSlice(txOut.commitment);
    } else if (!txOut.valueBuffer) {
      writeSlice(new Buffer(new Array(33-8)));
      var valBuf = new Buffer(8);
      bufferutils.writeUInt64LE(valBuf, txOut.value, 0);
      writeSlice(bufferutils.reverse(valBuf));
    } else {
      writeSlice(txOut.valueBuffer)
    }

    if (forSigning) {
      if (txOut.range_proof) {
        var toHash = new Buffer(
          bufferutils.varIntSize(txOut.range_proof.length) +
          txOut.range_proof.length +
          bufferutils.varIntSize(txOut.nonce_commitment.length) +
          txOut.nonce_commitment.length
        );
        var toHashOffset = 0;
        toHashOffset += bufferutils.writeVarInt(toHash, txOut.range_proof.length, 0);
        txOut.range_proof.copy(toHash, toHashOffset);
        toHashOffset += txOut.range_proof.length;

        toHashOffset += bufferutils.writeVarInt(toHash, txOut.nonce_commitment.length, toHashOffset);
        txOut.nonce_commitment.copy(toHash, toHashOffset);

        var hash256 = bcrypto.hash256(toHash);
      } else {
        var hash256 = bcrypto.hash256(new Buffer([0, 0]));
      }
      writeSlice(hash256);
    } else {
      writeVarInt(txOut.range_proof ? txOut.range_proof.length : 0);
      if (txOut.range_proof) writeSlice(txOut.range_proof);
      writeVarInt(txOut.nonce_commitment ? txOut.nonce_commitment.length : 0);
      if (txOut.nonce_commitment) writeSlice(txOut.nonce_commitment);
    }

    if (txOut.asset_id) {
      writeSlice(txOut.asset_id);
    } else {
      writeSlice(new Buffer(new Array(32)));  // fill with zeroes
    }

    writeVarInt(txOut.script.length)
    writeSlice(txOut.script)
  })

  writeUInt32(this.locktime)
  return buffer
}

function toBuffer () {
  return this.toBufferForSigning(-1);
}

function fromHexImpl(tx, hex, __noStrict) {
  var buffer = new Buffer(hex, 'hex');

  var offset = 0
  function readSlice (n) {
    offset += n
    return buffer.slice(offset - n, offset)
  }

  function readUInt32 () {
    var i = buffer.readUInt32LE(offset)
    offset += 4
    return i
  }

  function readUInt64 () {
    var i = bufferutils.readUInt64LE(buffer, offset)
    offset += 8
    return i
  }

  function readVarInt () {
    var vi = bufferutils.readVarInt(buffer, offset)
    offset += vi.size
    return vi.number
  }

  function readScript () {
    return readSlice(readVarInt())
  }

  tx.version = readUInt32()

  var vinLen = readVarInt()
  for (var i = 0; i < vinLen; ++i) {
    tx.ins.push({
      hash: readSlice(32),
      index: readUInt32(),
      script: readScript(),
      sequence: readUInt32()
    })
  }

  tx.fees = [];

  var feesCount = readVarInt();
  while (feesCount--) {
    tx.fees.push(readUInt64());
  }

  var voutLen = readVarInt()
  for (i = 0; i < voutLen; ++i) {
    var commitment = readSlice(33);
    var value;
    if (commitment[0] == 0) {
      var valueBuf = new Buffer(commitment.slice(-8));
      value = bufferutils.readUInt64LE(
        bitcoin.bufferutils.reverse(valueBuf),
        0
      );
      commitment = null;
    } else {
      value = 0;
    }
    var range_proof = readScript();
    var nonce_commitment = readScript();
    var asset_id = readSlice(32);
    tx.outs.push({
      asset_id: asset_id,
      value: value,
      script: readScript(),
      range_proof: range_proof,
      nonce_commitment: nonce_commitment,
      commitment: commitment
    })
  }

  tx.locktime = readUInt32()

  if (__noStrict) return tx
  if (offset !== buffer.length) throw new Error('Transaction has unexpected data')

  return tx
}

var EMPTY_SCRIPT = new Buffer(0);
var ONE = new Buffer('0000000000000000000000000000000000000000000000000000000000000001', 'hex');

function hashForSignature (inIndex, prevOutScript, hashType) {
  typeforce(types.tuple(types.UInt32, types.Buffer, /* types.UInt8 */ types.Number), arguments)

  // https://github.com/bitcoin/bitcoin/blob/master/src/test/sighash_tests.cpp#L29
  if (inIndex >= this.ins.length) return ONE

  var txTmp = this.clone()

  // in case concatenating two scripts ends up with two codeseparators,
  // or an extra one at the end, this prevents all those possible incompatibilities.
  var hashScript = bscript.compile(bscript.decompile(prevOutScript).filter(function (x) {
    return x !== opcodes.OP_CODESEPARATOR
  }))
  var i

  // blank out other inputs' signatures
  txTmp.ins.forEach(function (input) { input.script = EMPTY_SCRIPT })
  txTmp.ins[inIndex].script = hashScript

  // blank out some of the inputs
  if ((hashType & 0x1f) === Transaction.SIGHASH_NONE) {
    // wildcard payee
    txTmp.outs = []

    // let the others update at will
    txTmp.ins.forEach(function (input, i) {
      if (i !== inIndex) {
        input.sequence = 0
      }
    })
  } else if ((hashType & 0x1f) === Transaction.SIGHASH_SINGLE) {
    var nOut = inIndex

    // only lock-in the txOut payee at same index as txIn
    // https://github.com/bitcoin/bitcoin/blob/master/src/test/sighash_tests.cpp#L60
    if (nOut >= this.outs.length) return ONE

    txTmp.outs = txTmp.outs.slice(0, nOut + 1)

    // blank all other outputs (clear scriptPubKey, value === -1)
    var stubOut = {
      script: EMPTY_SCRIPT,
      valueBuffer: VALUE_UINT64_MAX
    }

    for (i = 0; i < nOut; i++) {
      txTmp.outs[i] = stubOut
    }

    // let the others update at will
    txTmp.ins.forEach(function (input, i) {
      if (i !== inIndex) {
        input.sequence = 0
      }
    })
  }

  // blank out other inputs completely, not recommended for open transactions
  if (hashType & Transaction.SIGHASH_ANYONECANPAY) {
    txTmp.ins[0] = txTmp.ins[inIndex]
    txTmp.ins = txTmp.ins.slice(0, 1)
  }

  // serialize and hash
  var buffer = new Buffer(txTmp.signedByteLength(inIndex) + 4)
  buffer.writeInt32LE(hashType, buffer.length - 4)
  txTmp.toBufferForSigning(inIndex).copy(buffer, 0)

  return bcrypto.hash256(buffer)
}

function AssetsTransaction () {
  this.tx = new AssetsTransactionImpl();
}

function fromHex (hex) {
  var ret = new AssetsTransaction();
  fromHexImpl(ret.tx, hex);
  return ret;
}

function addInput (input) {
  var ret = Transaction.prototype.addInput.call(this, input);
  ret.prevValue = input.prevValue;
  return ret;
}

function addOutput (outScript, value, fee, assetId) {
  var idx = this.tx.addOutput(outScript, value);
  var ret = this.tx.outs[idx];
  ret.fee = fee;
  ret.asset_id = assetId;
  return ret;
}

function replaceOutput (idx, outScript, value, fee, assetId) {
  this.tx.outs[idx].script = outScript;
  this.tx.outs[idx].value = value;
  this.tx.outs[idx].fee = fee;
  this.tx.outs[idx].asset_id = assetId;
}

function signInput (i) {
  var prevOut = this.tx.ins[i].prevOut;
  return Promise.all(
    [prevOut.getPrevScript(), prevOut.getSigningKey()]
  ).then(function (values) {
    var prevScript = values[0];
    var signingKey = values[1];
    return signingKey.signHash(
      this.tx.hashForSignature(i, prevScript, 1)
    ).then(function (sig) {
      this.tx.ins[i].script = bitcoin.script.compile([].concat(
        bitcoin.opcodes.OP_0, // OP_0 required for multisig
        new Buffer([0]), // to be replaced by backend with server's sig
        new Buffer([].concat(
          Array.prototype.slice.call(sig), [1]
        )), // our signature with SIGHASH_ALL
        prevScript
      ));
    }.bind(this));
  }.bind(this));
}

function _rebuildCT () {
  Object.keys(this.isCT).forEach(function (k) {
    if (!this.isCT[k]) {
      return;
    }

    var inputsCount = 0;
    var outputsCount = 0;
    this.tx.ins.forEach(function (input) {
      if (input.prevOut.assetNetworkId.toString('hex') === k &&
          input.blindingFactor) {
        inputsCount += 1;
      }
    });
    this.tx.outs.forEach(function (out) {
      if (out.asset_id.toString('hex') === k && out.valueToBlind) {
        outputsCount += 1;
      }
    });
    var ctState = {
      blindedInputsCount: inputsCount,
      blindedOutputsCount: outputsCount,
      assetIdHex: k,
      outputIdx: 0
    };
    this.tx.outs.forEach(function (out, idx) {
      if (out.asset_id.toString('hex') !== k || !out.valueToBlind) {
        return;
      }
      var extendWith = this._calcCTOutData(idx, ctState);
      extend(out, extendWith);
    }.bind(this));
  }.bind(this));
}

function _addChangeOutput (script, value, assetNetworkId) {
  // 1. Generate random change output index. It is done for privacy reasons,
  //    to avoid easy tracing of coins with constant change index.
  var changeIdx = (
    +BigInteger.fromBuffer(crypto.randomBytes(4))
  ) % (this.getOutputsCount() + 1);

  // 2. add the output at the index
  if (changeIdx === this.getOutputsCount()) {
    this.addOutput(script, value, 0, assetNetworkId);
  } else {
    var newOutputs = [];
    for (var i = 0; i < this.getOutputsCount(); ++i) {
      if (i === changeIdx) {
        newOutputs.push({
          script: script, value: value, fee: 0, asset_id: assetNetworkId
        });
      }
      newOutputs.push(this.getOutput(i));
    }
    this.clearOutputs();
    newOutputs.forEach(function (out) {
      var newOut = this.addOutput(out.script, out.value, out.fee, out.asset_id);

      // keep old CT data in case of non-CT asset change being added:
      newOut.commitment = out.commitment;
      newOut.nonce_commitment = out.nonce_commitment;
      newOut.range_proof = out.range_proof;

      // keep data necessary to re-generate CT data too:
      newOut.valueToBlind = out.valueToBlind;
      newOut.scanningPubkey = out.scanningPubkey;
    }.bind(this));
  }

  return changeIdx;
}

function _addFeeAndChangeWithAsset (options) {
  var feeEstimate = options.feeEstimate;
  var prevouts = options.prevOutputs;
  var changeCache = options.changeCache || {};
  var getChangeFeeOutputScript = options.getChangeOutScript;
  var getChangeAssetOutputScript = options.getChangeAssetOutScript;

  // 1. calculate prevouts total values for assets and fee
  var prevoutsAsset = prevouts.filter(function (prevout) {
    return bufferEquals(prevout.assetNetworkId, options.assetNetworkId);
  });
  var prevoutsFee = prevouts.filter(function (prevout) {
    // not asset -- assume fee:
    return !bufferEquals(prevout.assetNetworkId, options.assetNetworkId);
  });
  var prevoutsAssetTotalDeferred = _sumPrevouts(prevoutsAsset);
  var prevoutsFeeTotalDeferred = _sumPrevouts(prevoutsFee);

  return Promise.all(
    [prevoutsAssetTotalDeferred, prevoutsFeeTotalDeferred]
  ).then(function (results) {
    var prevoutsAssetTotal = results[ 0 ];
    var prevoutsFeeTotal = results[ 1 ];

    // 2. calculate current sum of output values
    var currentAssetValue = 0;
    var i;
    for (i = 0; i < this.getOutputsCount(); ++i) {
      currentAssetValue +=
        this.getOutput(i).valueToBlind || this.getOutput(i).value;
    }

    var requiredValues = {
      fee: Math.round(feeEstimate * this.estimateSignedLength() / 1000),
      asset: currentAssetValue
    };

    var ret = Promise.resolve();
    var assetChangeIdx = -1;

    if (prevoutsAssetTotal < requiredValues.asset) {
      // not enough -- return a request to fetch more prevouts
      return Promise.resolve([ requiredValues, changeCache ]);
    }

    // 4. make sure asset change is right
    if (prevoutsAssetTotal > requiredValues.asset) {
      // add a change output since we have more assets than the value
      if (changeCache.assetChange) {
        ret = Promise.resolve(changeCache.assetChange);
      } else {
        ret = getChangeAssetOutputScript();
      }
      ret = ret.then(function (outScript) {
        changeCache.assetChange = outScript;
        assetChangeIdx = this._addChangeOutput(
          outScript,
          prevoutsAssetTotal - requiredValues.asset,
          options.assetNetworkId,
          options.changeAddrFactory
        );
        // update required fee for the new output
        requiredValues.fee = Math.round(
          feeEstimate * this.estimateSignedLength() / 1000
        );

        if (!this.isCT[ options.assetNetworkId.toString('hex') ]) {
          return;
        }

        this.tx.outs[ assetChangeIdx ].valueToBlind = this.tx.outs[ assetChangeIdx ].value;
        this.tx.outs[ assetChangeIdx ].value = 0;
        return options.changeAddrFactory.getScanningKeyForScript(
          this.tx.outs[ assetChangeIdx ].script
        ).then(function (k) {
          this.tx.outs[ assetChangeIdx ].scanningPubkey = (
            k.hdnode.keyPair.getPublicKeyBuffer()
          );
          this._rebuildCT();
        }.bind(this));
      }.bind(this));
    } else if (this.isCT[ options.assetNetworkId.toString('hex') ]) {
      // if CT is enabled for asset, make sure we have at least one CT output
      var anyCTAssetOuts = false;
      for (i = 0; i < this.getOutputsCount(); ++i) {
        if (bufferEquals(
              this.tx.outs[ i ].asset_id,
              options.assetNetworkId) &&
            this.tx.outs[ i ].commitment) {
          anyCTAssetOuts = true;
          break;
        }
      }

      if (!anyCTAssetOuts && assetChangeIdx === -1) {
        // we need some change to make a correct CT
        requiredValues.asset += 1;
        return [ requiredValues, changeCache ];
      }
    }

    return ret.then(function (prev) {
      if (prev !== undefined) {
        return prev;
      }

      // 5. make sure fee change is right
      if (prevoutsFeeTotal < requiredValues.fee) {
        // not enough -- return a request to fetch more prevouts
        return Promise.resolve([ requiredValues, changeCache ]);
      }

      if (prevoutsFeeTotal === requiredValues.fee) {
        // we got exactly the required value of prevouts
        return { changeIdx: assetChangeIdx };
      }

      var ret2;
      // add a change output if fee prevouts are more than fee
      if (changeCache.feeChange) {
        ret2 = Promise.resolve(changeCache.feeChange);
      } else {
        ret2 = getChangeFeeOutputScript();
      }
      return ret2.then(function (outScript) {
        changeCache.feeChange = outScript;
        var changeIdx = this._addChangeOutput(
          outScript,
          prevoutsFeeTotal - requiredValues.fee,
          options.feeNetworkId,
          options.changeAddrFactory
        );

        if (assetChangeIdx >= 0 && changeIdx <= assetChangeIdx) {
          // adding the fee change before asset change changes the assetChangeIdx
          assetChangeIdx += 1;
        }

        function iterateFee () {
          if (requiredValues.fee >= Math.round(
            feeEstimate * this.estimateSignedLength() / 1000
          )) {
            return Promise.resolve();
          }

          requiredValues.fee = Math.round(
            feeEstimate * this.estimateSignedLength() / 1000
          );

          if (prevoutsFeeTotal === requiredValues.fee) {
            // After adding the change output, which made the transaction larger,
            // the prevouts match exactly the fee, but we now have change which
            // cannot be zero.
            // In such case increase the fee to have at least minimum change value.
            requiredValues.fee += 2730;
          }

          if (prevoutsFeeTotal < requiredValues.fee) {
            return Promise.resolve([ requiredValues, changeCache ]);
          }

          // 5. update with the final fee and set the fee field in the output:
          this.replaceOutput(
            changeIdx,
            changeCache.feeChange,
            prevoutsFeeTotal - requiredValues.fee,
            requiredValues.fee,
            options.feeNetworkId
          );

          if (!this.isCT[ options.feeNetworkId.toString('hex') ]) {
            return Promise.resolve();
          }
          this.tx.outs[ changeIdx ].valueToBlind = this.tx.outs[ changeIdx ].value;
          this.tx.outs[ changeIdx ].value = 0;

          return options.changeAddrFactory.getScanningKeyForScript(
            this.tx.outs[ changeIdx ].script
          ).then(function (k) {
            this.tx.outs[ changeIdx ].scanningPubkey = (
              k.hdnode.keyPair.getPublicKeyBuffer()
            );
            this._rebuildCT();
          }.bind(this)).then(
            iterateFee.bind(this)
          );
        }
        return iterateFee.call(this).then(function (ret) {
          return ret || { changeIdx: assetChangeIdx };
        });
      }.bind(this));
    }.bind(this));
  }.bind(this));
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

function _addFeeAndChange (options) {
  if (options.withAsset) {
    return this._addFeeAndChangeWithAsset(options);
  }
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
  var ret = Promise.resolve({changeIdx: -1});  // -1 indicates no change

  return prevoutsValueDeferred.then(function (prevoutsValue) {
    if (prevoutsValue < requiredValue + fee) {
      // not enough -- return a request to fetch more prevouts
      return Promise.resolve([ requiredValue + fee, changeCache ]);
    }

    if (prevoutsValue === requiredValue + fee) {
      // we got exactly the required value of prevouts
      return ret;
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
        prevoutsValue - (requiredValue + fee),
        options.feeNetworkId,
        options.changeAddrFactory
      );
    }.bind(this)).then(function (changeIdx) {
      function iterateFee () {
        if (fee >= Math.round(
          feeEstimate * this.estimateSignedLength() / 1000
        )) {
          return Promise.resolve();
        }

        fee = Math.round(feeEstimate * this.estimateSignedLength() / 1000);

        if (prevoutsValue === requiredValue + fee) {
          // After adding the change output, which made the transaction larger,
          // the prevouts match exactly the fee, but we now have change which
          // cannot be zero.
          // In such case increase the fee to have at least minimum change value.
          fee += 2730;
        }

        if (prevoutsValue < requiredValue + fee) {
          return Promise.resolve([ requiredValue + fee, changeCache ]);
        }

        this.replaceOutput(
          changeIdx,
          changeCache,
          prevoutsValue - (requiredValue + fee),
          fee,
          options.feeNetworkId
        );

        if (!this.isCT[ options.feeNetworkId.toString('hex') ]) {
          return Promise.resolve();
        }

        this.tx.outs[ changeIdx ].valueToBlind = this.tx.outs[ changeIdx ].value;
        this.tx.outs[ changeIdx ].value = 0;
        return options.changeAddrFactory.getScanningKeyForScript(
          this.tx.outs[ changeIdx ].script
        ).then(function (k) {
          this.tx.outs[ changeIdx ].scanningPubkey = (
            k.hdnode.keyPair.getPublicKeyBuffer()
          );
          this._rebuildCT();
        }.bind(this)).then(
          iterateFee.bind(this)
        );
      }

      return iterateFee.call(this).then(function (ret) {
        return ret || { changeIdx: changeIdx };
      });
    }.bind(this));

    return ret;
  }.bind(this));
}

function _calcCTOutData (outputIdx, ctState) {
  var secp256k1 = SchnorrSigningKey.secp256k1;
  var secp256k1_ctx = SchnorrSigningKey.getSecp256k1Ctx();

  var allCount = ctState.blindedInputsCount + ctState.blindedOutputsCount;

  if (!ctState.blindptrs) {
    var blindingFactors = [];
    var i;
    for (i = 0; i < this.tx.ins.length; ++i) {
      if (this.tx.ins[i].blindingFactor &&
          this.tx.ins[i].prevOut.assetNetworkId.toString('hex') ===
            ctState.assetIdHex) {
        blindingFactors.push(this.tx.ins[i].blindingFactor);
      }
    }

    var blindptrs = secp256k1._malloc(4 * allCount);
    ctState.curBlindptr = 4 * ctState.blindedInputsCount;
    for (i = 0; i < allCount; ++i) {
      var j;
      if (i < ctState.blindedInputsCount) {
        secp256k1.setValue(blindptrs + 4*i, blindingFactors[i], '*');
      } else {
        var cur = secp256k1._malloc(32);
        secp256k1.setValue(blindptrs + 4 * i, cur, '*');
        var rand = crypto.randomBytes(32);
        for (j = 0; j < 32; ++j) {
          secp256k1.setValue(cur + j, rand[ j ], 'i8');
        }
      }
    }
    ctState.blindptrs = blindptrs;
  }

  if (ctState.outputIdx == ctState.blindedOutputsCount - 1) {
    if (1 != secp256k1._secp256k1_pedersen_blind_sum(
      secp256k1_ctx,
      secp256k1.getValue(ctState.blindptrs + 4 * (allCount - 1), '*'),
      ctState.blindptrs,
      allCount - 1,
      ctState.blindedInputsCount
    )) {
      throw new Error('secp256k1 pedersen blind sum failed');
    }
  }
  var commitment = secp256k1._malloc(33);
  var curOutput = this.tx.outs[outputIdx];
  if (1 != secp256k1._secp256k1_pedersen_commit(
    secp256k1_ctx,
    commitment,
    secp256k1.getValue(ctState.blindptrs + ctState.curBlindptr, '*'),
    curOutput.valueToBlind % Math.pow(2, 32),
    Math.floor(curOutput.valueToBlind / Math.pow(2, 32))
  )) {
    throw new Error('secp256k1 Pedersen commit failed');
  }
  var j;
  var rangeproof_len = secp256k1._malloc(4);
  var len = 5134;
  var rangeproof = secp256k1._malloc(len);
  var rangeproof_len_buf = new BigInteger(''+len).toBuffer();
  while (rangeproof_len_buf.length < 4) {
    rangeproof_len_buf = Buffer.concat([new Buffer([0]), rangeproof_len_buf]);
  }
  for (j = 0; j < 4; ++j) {
    secp256k1.setValue(rangeproof_len+j, rangeproof_len_buf[4-j-1], 'i8');
  }
  var ephemeral_key = bitcoin.ECPair.makeRandom({rng: crypto.randomBytes});
  var secexp_buf = ephemeral_key.d.toBuffer();
  var secexp = secp256k1._malloc(32);
  var nonce = secp256k1._malloc(33);
  var nonce_res = secp256k1._malloc(32);
  var pubkey_p = secp256k1._malloc(64);
  for (j = 0; j < 32; ++j) {
    secp256k1.setValue(secexp+j, secexp_buf[j], 'i8');
  }
  for (j = 0; j < 33; ++j) {
    secp256k1.setValue(nonce+j, curOutput.scanningPubkey[j], 'i8');
  }
  if (1 != secp256k1._secp256k1_ec_pubkey_parse(
    secp256k1_ctx,
    pubkey_p,
    nonce,
    33
  )) {
    throw new Error('secp256k1 EC pubkey parse failed');
  }
  if (1 != secp256k1._secp256k1_ecdh(
    secp256k1_ctx,
    nonce_res,
    pubkey_p,
    secexp
  )) {
    throw new Error('secp256k1 ECDH failed');
  }
  var nonce_buf = new Buffer(32);
  for (j = 0; j < 32; ++j) {
    nonce_buf[j] = secp256k1.getValue(nonce_res + j, 'i8') & 0xff;
  }
  nonce_buf = bitcoin.crypto.sha256(nonce_buf);
  for (var j = 0; j < 32; ++j) {
    secp256k1.setValue(nonce_res + j, nonce_buf[j], 'i8');
  }
  if (1 != secp256k1._secp256k1_rangeproof_sign(
    secp256k1_ctx,
    rangeproof,
    rangeproof_len,
    0, 0,
    commitment,
    secp256k1.getValue(ctState.blindptrs + ctState.curBlindptr, '*'),
    nonce_res,
    0, 32,
    curOutput.valueToBlind % Math.pow(2, 32),
    Math.floor(curOutput.valueToBlind / Math.pow(2, 32))
  )) {
    throw new Error('secp256k1 rangeproof sign failed');
  }
  for (j = 0; j < 4; ++j) {
    rangeproof_len_buf[4-j-1] = secp256k1.getValue(
      rangeproof_len+j, 'i8'
    ) & 0xff;
  }
  len = +BigInteger(rangeproof_len_buf);
  var commitmentBuf = new Buffer(33);
  for (j = 0; j < 33; ++j) {
      commitmentBuf[j] = secp256k1.getValue(commitment + j, 'i8') & 0xff;
  }
  var rangeProofBuf = new Buffer(len);
  for (j = 0; j < len; ++j) {
    rangeProofBuf[j] = secp256k1.getValue(rangeproof+j, 'i8') & 0xff;
  }
  ctState.curBlindptr += 4;
  ctState.outputIdx += 1;
  var nonceCommitment = ephemeral_key.getPublicKeyBuffer();

  return {
    commitment: commitmentBuf,
    range_proof: rangeProofBuf,
    nonce_commitment: nonceCommitment
  };
}

function build (options) {
  this.clearInputs();
  this.clearOutputs();
  this.isCT = {};

  options.prevOutputs.map(function (prevOut) {
    this.addInput({
      txHash: prevOut.prevHash,
      vout: prevOut.ptIdx,
      prevValue: prevOut.value,
      prevOut: prevOut
    });
    if (prevOut.blindingFactor) {
      this.isCT[prevOut.assetNetworkId.toString('hex')] = true;
      this.tx.ins[ this.tx.ins.length - 1 ].prevOutRaw = prevOut.raw;
      this.tx.ins[ this.tx.ins.length - 1 ].blindingFactor = prevOut.blindingFactor;
    }
  }.bind(this));

  options.outputsWithAmounts.forEach(function (output) {
    if (!output.ctDestination) {
      this.addOutput(
        output.scriptPubKey,
        output.value,
        0,
        options.assetNetworkId
      );
    } else {
      this.isCT[options.assetNetworkId.toString('hex')] = true;

      var decoded = bs58check.decode(output.ctDestination.b58);
      var toVersion = decoded[ 1 ];
      var toScanningPubkey = decoded.slice(2, 35);
      var toHash = decoded.slice(35);
      this.addOutput(
        bitcoin.address.toOutputScript(
          bitcoin.address.toBase58Check(toHash, toVersion),
          output.ctDestination.network
        ), 0, 0, options.assetNetworkId
      );
      this.tx.outs[ this.tx.outs.length - 1 ].valueToBlind = output.value;
      this.tx.outs[ this.tx.outs.length - 1 ].scanningPubkey = toScanningPubkey;
    }
  }.bind(this));

  this._rebuildCT();

  return this._addFeeAndChange(options);
}

function signAll () {
  var ret = Promise.resolve();
  for (var i = 0; i < this.tx.ins.length; ++i) {
    (function (i) {
      ret = ret.then(function () {
        return this.signInput(i);
      }.bind(this));
    }).call(this, i);
  }
  return ret;
}