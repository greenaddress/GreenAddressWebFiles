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
var window = require('global/window');
var SchnorrSigningKey = require('./schnorr-signing-key');
var wally = require('wallyjs');

var Transaction = require('./transaction');

var Bitcoin = window.Bitcoin;

var VALUE_UINT64_MAX = window.VALUE_UINT64_MAX;

module.exports = AssetsTransaction;

function AssetsTransactionImpl () {
  bitcoin.Transaction.apply(this, arguments);
  this.witness = [];
  this.outWitness = [];
}

AssetsTransactionImpl.prototype = Object.create(bitcoin.Transaction.prototype);
extend(AssetsTransactionImpl.prototype, {
  byteLength: byteLength,
  signedByteLength: signedByteLength,
  clone: clone,
  toBuffer: toBuffer,
  toBufferForSigning: toBufferForSigning,
  hashForSignature: hashForSignature
});

AssetsTransaction.prototype = Object.create(Transaction.prototype);
extend(AssetsTransaction.prototype, {
  build: build,
  _addFeeAndChange: _addFeeAndChange,
  _addFeeAndChangeWithAsset: _addFeeAndChangeWithAsset,
  _addChangeOutput: _addChangeOutput,
  _rebuildCT: _rebuildCT,
  addInput: addInput,
  addOutput: addOutput,
  replaceOutput: replaceOutput,
  toBuffer: function toBuffer (withWitness) {
    return this.tx.toBuffer(withWitness);
  }
});
AssetsTransaction.fromHex = fromHex;

/* C&P from bitcoin.types: */
var typeforce = require('typeforce');

function nBuffer (value, n) {
  typeforce(types.Buffer, value);
  if (value.length !== n) throw new Error('Expected ' + (n * 8) + '-bit Buffer, got ' + (value.length * 8) + '-bit Buffer');
  return true;
}

function Hash160bit (value) { return nBuffer(value, 20); }
function Hash256bit (value) { return nBuffer(value, 32); }
function Buffer256bit (value) { return nBuffer(value, 32); }

var UINT53_MAX = Math.pow(2, 53) - 1;
function UInt2 (value) { return (value & 3) === value; }
function UInt8 (value) { return (value & 0xff) === value; }
function UInt32 (value) { return (value >>> 0) === value; }
function UInt53 (value) {
  return typeforce.Number(value) &&
  value >= 0 &&
  value <= UINT53_MAX &&
  Math.floor(value) === value;
}

// external dependent types
var BigInt = typeforce.quacksLike('BigInteger');
var ECPoint = typeforce.quacksLike('Point');

// exposed, external API
var ECSignature = typeforce.compile({ r: BigInt, s: BigInt });
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
});

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
};

for (var typeName in typeforce) {
  types[typeName] = typeforce[typeName];
}
/* END C&P from bitcoin.types */

function scriptSize (someScript) {
  var length = someScript.length;

  return bufferutils.varIntSize(length) + length;
}

function signedByteLength (signInIndex, withWitness) {
  var forSigning = signInIndex !== -1;

  return (
    8 +
    (!withWitness ? 0 : ((this.witness.length || this.outWitness.length) ? 2 : 0)) + // marker
    bufferutils.varIntSize(this.ins.length) +
    bufferutils.varIntSize(this.outs.length) +
    this.ins.reduce(function (sum, input) {
      return sum + 40 + scriptSize(input.script);
    }, 0) +
    this.outs.reduce(function (sum, output) {
      return sum + scriptSize(output.script) +
        (output.commitment ? 33 : 9) + // value or commitment
        33; // asset tag
    }, 0) + (!withWitness ? 0 :
      (this.witness.length ? bufferutils.varIntSize(this.witness.length) : 0) +
      this.witness.reduce(function (sum, wit) {
        return sum + scriptSize(wit);
      }, 0) +
      this.outWitness.reduce(function (sum, wit) {
        return sum + wit.length;
      }, 0)
    )
  );
}

function byteLength () {
  return this.signedByteLength(-1, true);
}

function clone () {
  var newTx = new AssetsTransactionImpl();
  newTx.version = this.version;
  newTx.locktime = this.locktime;

  newTx.ins = this.ins.map(function (txIn) {
    return {
      hash: txIn.hash,
      index: txIn.index,
      script: txIn.script,
      sequence: txIn.sequence,
      prevValue: txIn.prevValue,
      prevOut: txIn.prevOut,
      prevOutRaw: txIn.prevOutRaw
    };
  });

  newTx.outs = this.outs.map(function (txOut) {
    return {
      value: txOut.value,
      script: txOut.script,
      commitment: txOut.commitment,
      range_proof: txOut.range_proof,
      nonce_commitment: txOut.nonce_commitment,
      assetId: txOut.assetId,
      assetHash: txOut.assetHash
    };
  });

  newTx.outWitness = this.outWitness.map(function (ow) {
    var ret = new Buffer(ow.length);
    ow.copy(ret);
    return ret;
  });

  return newTx;
}

function toBufferForSigning (signInIndex, withWitness) {
  var buffer = new Buffer(this.signedByteLength(signInIndex, withWitness));
  var forSigning = signInIndex !== -1;

  var offset = 0;
  function writeSlice (slice) {
    slice.copy(buffer, offset);
    offset += slice.length;
  }

  function writeUInt32 (i) {
    buffer.writeUInt32LE(i, offset);
    offset += 4;
  }

  function writeUInt64 (i) {
    bufferutils.writeUInt64LE(buffer, i, offset);
    offset += 8;
  }

  function writeVarInt (i) {
    var n = bufferutils.writeVarInt(buffer, i, offset);
    offset += n;
  }

  writeUInt32(this.version);

  if (withWitness) {
    var marker = 0;
    if (this.witness.length) marker += 1;
    if (this.outWitness.length) marker += 2;
    if (marker) {
      new Buffer([0, marker]).copy(buffer, offset);
      offset += 2;
    }
  }

  writeVarInt(this.ins.length);

  this.ins.forEach(function (txIn) {
    writeSlice(txIn.hash);
    writeUInt32(txIn.index);
    writeVarInt(txIn.script.length);
    writeSlice(txIn.script);
    writeUInt32(txIn.sequence);
  });

  writeVarInt(this.outs.length);
  var _this = this;
  this.outs.forEach(function (txOut, idx) {
    writeSlice(txOut.assetHash !== undefined ?
      new Buffer(txOut.assetHash) : (
        txOut.assetId !== undefined ?
          Buffer.concat([new Buffer([1]), new Buffer(txOut.assetId)]) :
          new Buffer('000000000000000000000000000000000000000000000000000000000000000000', 'hex')
      )
    );

    if (txOut.commitment) {
      writeSlice(new Buffer(txOut.commitment));
    } else if (!txOut.valueBuffer) {
      writeSlice(new Buffer([1]));
      var valBuf = new Buffer(8);
      bufferutils.writeUInt64LE(valBuf, txOut.value, 0);
      writeSlice(valBuf.reverse());
    } else {
      writeSlice(txOut.valueBuffer);
    }

    writeVarInt(txOut.script.length);
    writeSlice(txOut.script);
  });

  if (withWitness) {
    this.witness.forEach(function (bufs)  {
      // TODO
    });
    this.outWitness.forEach(function (buf) {
      writeSlice(buf);
    });
  }

  writeUInt32(this.locktime);
  return buffer;
}

function toBuffer (withWitness) {
  return this.toBufferForSigning(-1, withWitness);
}

function fromHexImpl (tx, hex, __noStrict) {
  var buffer = new Buffer(hex, 'hex');

  var offset = 0;
  function readSlice (n) {
    offset += n;
    return buffer.slice(offset - n, offset);
  }

  function readUInt32 () {
    var i = buffer.readUInt32LE(offset);
    offset += 4;
    return i;
  }

  function readUInt64BE () {
    var buf = readSlice(8);
    return bufferutils.readUInt64LE(bufferutils.reverse(buf), 0);
  }


  function readVarInt () {
    var vi = bufferutils.readVarInt(buffer, offset);
    offset += vi.size;
    return vi.number;
  }

  function readScript () {
    return readSlice(readVarInt());
  }

  tx.version = readUInt32();

  var vinLen = readVarInt();
  var marker;
  if (vinLen === 0) {
    marker = readSlice(1)[0];
    vinLen = readVarInt();
  } else {
    marker = 0;
  }
  for (var i = 0; i < vinLen; ++i) {
    tx.ins.push({
      hash: readSlice(32),
      index: readUInt32(),
      script: readScript(),
      sequence: readUInt32()
    });
  }

  tx.fees = [];

  var voutLen = readVarInt();
  for (i = 0; i < voutLen; ++i) {
    var assetTag = readSlice(33), assetId, assetHash;
    if (assetTag[0] === 1) {
      assetId = assetTag.slice(1);
    } else {
      assetHash = assetTag;
    }
    var commitmentFirst = readSlice(1)[0], value = null;
    if (commitmentFirst === 1) {
      value = readUInt64BE();
      commitment = null;
    } else {
      commitment = Buffer.concat([new Buffer([commitmentFirst]), readSlice(32)]);
    }
    tx.outs.push({
      assetId: assetId,
      assetHash: assetHash,
      assetTag: assetTag,
      commitment: commitment,
      value: value,
      script: readScript()
    });
  }

  if (marker & 1) {
    // TODO inwitness
  }
  if (marker & 2) {
    tx.outs.forEach(function () {

    });
    tx.outs.forEach(function (buf, idx) {
      tx.outs[idx].surjectionProof = readScript();
      tx.outs[idx].rangeProof = readScript();
      tx.outs[idx].nonceCommitment = readScript();
    });
  }


  tx.locktime = readUInt32();

  if (__noStrict) return tx;
  if (offset !== buffer.length) throw new Error('Transaction has unexpected data');

  return tx;
}

var EMPTY_SCRIPT = new Buffer(0);
var ONE = new Buffer('0000000000000000000000000000000000000000000000000000000000000001', 'hex');

function hashForSignature (inIndex, prevOutScript, hashType) {
  typeforce(types.tuple(types.UInt32, types.Buffer, /* types.UInt8 */ types.Number), arguments);

  // https://github.com/bitcoin/bitcoin/blob/master/src/test/sighash_tests.cpp#L29
  if (inIndex >= this.ins.length) return ONE;

  var txTmp = this.clone();

  // in case concatenating two scripts ends up with two codeseparators,
  // or an extra one at the end, this prevents all those possible incompatibilities.
  var hashScript = bscript.compile(bscript.decompile(prevOutScript).filter(function (x) {
    return x !== opcodes.OP_CODESEPARATOR;
  }));
  var i;

  // blank out other inputs' signatures
  txTmp.ins.forEach(function (input) { input.script = EMPTY_SCRIPT; });
  txTmp.ins[inIndex].script = hashScript;

  // blank out some of the inputs
  if ((hashType & 0x1f) === Transaction.SIGHASH_NONE) {
    // wildcard payee
    txTmp.outs = [];

    // let the others update at will
    txTmp.ins.forEach(function (input, i) {
      if (i !== inIndex) {
        input.sequence = 0;
      }
    });
  } else if ((hashType & 0x1f) === Transaction.SIGHASH_SINGLE) {
    var nOut = inIndex;

    // only lock-in the txOut payee at same index as txIn
    // https://github.com/bitcoin/bitcoin/blob/master/src/test/sighash_tests.cpp#L60
    if (nOut >= this.outs.length) return ONE;

    txTmp.outs = txTmp.outs.slice(0, nOut + 1);

    // blank all other outputs (clear scriptPubKey, value === -1)
    var stubOut = {
      script: EMPTY_SCRIPT,
      valueBuffer: VALUE_UINT64_MAX
    };

    for (i = 0; i < nOut; i++) {
      txTmp.outs[i] = stubOut;
    }

    // let the others update at will
    txTmp.ins.forEach(function (input, i) {
      if (i !== inIndex) {
        input.sequence = 0;
      }
    });
  }

  // blank out other inputs completely, not recommended for open transactions
  if (hashType & Transaction.SIGHASH_ANYONECANPAY) {
    txTmp.ins[0] = txTmp.ins[inIndex];
    txTmp.ins = txTmp.ins.slice(0, 1);
  }

  // serialize and hash
  var buffer = new Buffer(txTmp.signedByteLength(inIndex) + 4);
  buffer.writeInt32LE(hashType, buffer.length - 4);
  txTmp.toBufferForSigning(inIndex).copy(buffer, 0);

  return bcrypto.hash256(buffer);
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
  ret.assetId = assetId;
  return ret;
}

function replaceOutput (idx, outScript, value, fee, assetId) {
  this.tx.outs[idx].script = outScript;
  this.tx.outs[idx].value = value;
  this.tx.outs[idx].fee = fee;
  this.tx.outs[idx].assetId = assetId;
}

function _rebuildCT () {
  var _this = this;
  var abfs = [], vbfs = [], values = [];
  var bf_i = 0;
  function u64 (n) {
    var val = BigInteger.valueOf(n).toByteArrayUnsigned();
    while (val.length < 8) val.unshift(0);
    return new Uint8Array(val);
  }
  this.tx.outWitness = [];
  this.tx.outs.forEach(function (out, idx) {
    if (!out.valueToBlind) {
      return;
    }
    values.push(u64(out.valueToBlind));
    abfs.push(crypto.randomBytes(32));
    vbfs.push(crypto.randomBytes(32));
  });
  if (!vbfs.length) return Promise.resolve();
  vbfs.pop();
  var nonceCommitment;
  this.tx.outWitness = [];
  var allValues = [], allAbfs = [], allVbfs = [];
  _this.tx.ins.forEach(function (inp) {
    allValues.push(u64(inp.prevOut.value));
    if (inp.prevOut.abf) {
      allAbfs.push(new Buffer(inp.prevOut.abf, 'hex'));
      allVbfs.push(new Buffer(inp.prevOut.vbf, 'hex'));
    } else {
      var ZEROS = new Buffer('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
      allAbfs.push(ZEROS);
      allVbfs.push(ZEROS);
    }
  });

  values.forEach(function (val) { allValues.push(val); });
  abfs.forEach(function (abf) { allAbfs.push(abf); });
  vbfs.forEach(function (vbf) { allVbfs.push(vbf); });
  return wally.wally_asset_final_vbf(
    allValues, this.tx.ins.length, Buffer.concat(allAbfs), Buffer.concat(allVbfs)
  ).then(function (vbf) {
    vbfs.push(vbf);
  }.bind(this)).then(function () {
    return Promise.all(this.tx.outs.map(function (out, idx) {
      if (!out.valueToBlind) {
        this.tx.outWitness[idx] = new Buffer([0, 0, 0]);
        return;
      }

      var abf = abfs[bf_i];
      var vbf = vbfs[bf_i];
      bf_i += 1;
      var commitment;
      var ephemeral_key = bitcoin.ECPair.makeRandom({rng: crypto.randomBytes});
      var ephemeral = ephemeral_key.d.toBuffer();
      nonceCommitment = ephemeral_key.getPublicKeyBuffer();
      var blinding = new bitcoin.ECPair(BigInteger.fromByteArrayUnsigned(new Buffer(
        // TODO: real key
        '0101010101010101010101010101010101010101010101010101010101010101', 'hex'
      )));
      var blindingPub = blinding.getPublicKeyBuffer();
      return wally.wally_asset_generator_from_bytes(
        new Buffer(out.assetId, 'hex'), abf
      ).then(function (assetHash) {
        out.assetHash = assetHash;
        return wally.wally_asset_value_commitment(
          u64(out.valueToBlind), vbf, out.assetHash
        );
      }).then(function (commitment_) {
        out.commitment = commitment = commitment_;
        var inputAssets = [], inputAbfs = [], inputAgs = [];
        _this.tx.ins.forEach(function (inp) {
          if (inp.prevOut.abf) {
            inputAssets.push(new Buffer(inp.prevOut.assetId, 'hex'));
            inputAbfs.push(new Buffer(inp.prevOut.abf, 'hex'));
            inputAgs.push(wally.wally_asset_generator_from_bytes(
              new Buffer(inp.prevOut.assetId, 'hex'),
              new Buffer(inp.prevOut.abf, 'hex')
            ));
          } else {
            var ZEROS = new Buffer('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
            inputAssets.push(new Buffer(inp.prevOutRaw.assetId, 'hex'));
            inputAbfs.push(ZEROS);
            inputAgs.push(wally.wally_asset_generator_from_bytes(
              new Buffer(inp.prevOutRaw.assetId, 'hex'),
              ZEROS
            ));
          }
        });
        return Promise.all(inputAgs).then(function (inputAgs) {
          inputAgs = inputAgs.map(function (ui8a) { return new Buffer(ui8a); });
          return Promise.all([
            wally.wally_asset_rangeproof(
              u64(out.valueToBlind), blindingPub, ephemeral, out.assetId, abf, vbf,
              commitment, out.assetHash),
            wally.wally_asset_surjectionproof(
              new Buffer(out.assetId, 'hex'), abf, out.assetHash,
              crypto.randomBytes(32),
              Buffer.concat(inputAssets),
              Buffer.concat(inputAbfs),
              Buffer.concat(inputAgs)
            )
          ]);
        });
      }.bind()).then(function (results) {
        var rangeproof = new Buffer(results[0]);
        var surjectionproof = new Buffer(results[1]);
        var outwit = new Buffer(
          scriptSize(surjectionproof) +
          scriptSize(rangeproof) +
          scriptSize(nonceCommitment)
        );
        var offset = 0;
        function writePart (slice) {
          var n = bufferutils.writeVarInt(outwit, slice.length, offset);
          offset += n;
          slice.copy(outwit, offset);
          offset += slice.length;
        }
        writePart(surjectionproof);
        writePart(rangeproof);
        writePart(nonceCommitment);
        _this.tx.outWitness[idx] = outwit;
      });
    }.bind(this)));
  }.bind(this));
}

function _addChangeOutput (script, value, assetNetworkId) {
  // 1. Generate random change output index. It is done for privacy reasons,
  //    to avoid easy tracing of coins with constant change index.
  var changeIdx = (
    +BigInteger.fromBuffer(crypto.randomBytes(4))
  ) % (this.getOutputsCount() + 1);

  if (changeIdx === this.getOutputsCount()) {
    // 2. add the output at the index
    var changeOut = this.addOutput(script.outScript, value, 0, assetNetworkId);
    changeOut.pointer = script.pointer;
    changeOut.subaccount = script.subaccount;
  } else {
    var newOutputs = [];
    for (var i = 0; i < this.getOutputsCount(); ++i) {
      if (i === changeIdx) {
        newOutputs.push({
          script: script.outScript, value: value, fee: 0, assetId: assetNetworkId,
          pointer: script.pointer, subaccount: script.subaccount
        });
      }
      newOutputs.push(this.getOutput(i));
    }
    this.clearOutputs();
    newOutputs.forEach(function (out) {
      var newOut = this.addOutput(out.script, out.value, out.fee, out.assetId);

      newOut.pointer = out.pointer;
      newOut.subaccount = out.subaccount;

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
      fee: Math.round(feeEstimate * this.byteLength() / 1000),
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
          feeEstimate * this.byteLength() / 1000
        );

        this.tx.outs[ assetChangeIdx ].valueToBlind = this.tx.outs[ assetChangeIdx ].value;
        this.tx.outs[ assetChangeIdx ].value = null;
        return options.changeAddrFactory.getScanningKeyForScript(
          this.tx.outs[ assetChangeIdx ].script
        ).then(function (k) {
          this.tx.outs[ assetChangeIdx ].scanningPubkey = (
            k.hdnode.keyPair.getPublicKeyBuffer()
          );
          return this._rebuildCT();
        }.bind(this));
      }.bind(this));
    } else if (this.isCT[ options.assetNetworkId.toString('hex') ]) {
      // if CT is enabled for asset, make sure we have at least one CT output
      var anyCTAssetOuts = false;
      for (i = 0; i < this.getOutputsCount(); ++i) {
        if (bufferEquals(
            this.tx.outs[ i ].assetId,
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
              feeEstimate * this.byteLength() / 1000
            )) {
            return Promise.resolve();
          }

          requiredValues.fee = Math.round(
            feeEstimate * this.byteLength() / 1000
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
            changeCache.feeChange.outScript,
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
            return this._rebuildCT();
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
  if (options.withAsset && !bufferEquals(options.feeNetworkId, options.assetNetworkId)) {
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
  var fee = Math.round(feeEstimate * this.byteLength() / 1000);
  var ret = Promise.resolve({changeIdx: -1}); // -1 indicates no change

  return prevoutsValueDeferred.then(function (prevoutsValue) {
    if (options.subtractFeeFromOut) {
      if (this.tx.outs.length > 1) {
        throw new Error('subtractFeeFromOut not supported for multiple outputs');
      }

      if (prevoutsValue < fee) {
        // only the fee is required if we subtract from outputs
        return Promise.resolve([ {asset: fee}, changeCache ]);
      }

      this.replaceOutput(
        0,
        this.tx.outs[0].script,
        prevoutsValue - fee,
        fee,
        options.feeNetworkId
      );

      if (!this.isCT[ options.feeNetworkId.toString('hex') ]) {
        return Promise.resolve();
      }

      if (!this.tx.outs[ 0 ].valueToBlind) {
        throw new Error('Sweeping from CT addresses is supported only to CT destination addresses');
      }

      this.tx.outs[ 0 ].valueToBlind = this.tx.outs[ 0 ].value;
      this.tx.outs[ 0 ].value = 0;

      return this._rebuildCT().then(function () {
        var iterateFee = getIterateFee(0, 0, this.tx.outs[0].script, true);
        // check if CT made the tx large enough to increase the fee
        return iterateFee.bind(this)();
      }.bind(this));
    }

    if (prevoutsValue < requiredValue + fee) {
      // not enough -- return a request to fetch more prevouts
      return Promise.resolve([ {asset: requiredValue + fee}, changeCache ]);
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
      var changeIdx = this._addChangeOutput(
        outScript,
        prevoutsValue - (requiredValue + fee),
        options.feeNetworkId,
        options.changeAddrFactory
      );
      this.addOutput(
        new Buffer([]), fee, 0, options.feeNetworkId
      )
      return this._rebuildCT().then(function () {
        return changeIdx;
      });
    }.bind(this)).then(function (changeIdx) {
      var iterateFee = getIterateFee(requiredValue, changeIdx, changeCache);

      return iterateFee.call(this).then(function (ret) {
        return ret || { changeIdx: changeIdx };
      });
    }.bind(this));

    function getIterateFee (requiredValueForFee, changeIdx, changeScript, doNotChangeScanningKey) {
      return iterateFee;

      function iterateFee () {
        if (fee >= Math.round(
            feeEstimate * this.byteLength() / 1000
          )) {
          return Promise.resolve();
        }

        fee = Math.round(feeEstimate * this.byteLength() / 1000);

        if (prevoutsValue === requiredValueForFee + fee) {
          // After adding the change output or CT data, which made the transaction larger,
          // the prevouts match exactly the fee, but we now have change which
          // cannot be zero.
          // In such case increase the fee to have at least minimum change value.
          fee += 2730;
        }

        if (prevoutsValue < requiredValueForFee + fee) {
          return Promise.resolve([ {asset: requiredValueForFee + fee}, changeCache ]);
        }

        this.replaceOutput(
          changeIdx,
          changeScript.outScript,
          prevoutsValue - (requiredValueForFee + fee),
          fee,
          options.feeNetworkId
        );

        if (!this.isCT[ options.feeNetworkId.toString('hex') ]) {
          return Promise.resolve();
        }

        this.tx.outs[ changeIdx ].valueToBlind = this.tx.outs[ changeIdx ].value;
        this.tx.outs[ changeIdx ].value = null;
        if (doNotChangeScanningKey) {
          return this._rebuildCT().then(function () {
            return iterateFee.bind(this)();
          }.bind(this));
        } else {
          return options.changeAddrFactory.getScanningKeyForScript(
            this.tx.outs[ changeIdx ].script
          ).then(function (k) {
            this.tx.outs[ changeIdx ].scanningPubkey = (
              k.hdnode.keyPair.getPublicKeyBuffer()
            );
            return this._rebuildCT();
          }.bind(this)).then(
            iterateFee.bind(this)
          );
        }
      }
    }
    return ret;
  }.bind(this));
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
    this.tx.ins[ this.tx.ins.length - 1 ].prevOutRaw = prevOut.raw;
    if (prevOut.raw.vbf) {
      this.isCT[ prevOut.raw.assetId ] = true;
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

  return this._rebuildCT().then(function () {
    return this._addFeeAndChange(options);
  }.bind(this));
}
