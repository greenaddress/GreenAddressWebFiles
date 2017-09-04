var bitcoin = require('bitcoinjs-lib');
var bcrypto = bitcoin.crypto;
var bscript = bitcoin.script;
var bufferutils = bitcoin.bufferutils;
var opcodes = bitcoin.opcodes;
var bufferEquals = require('buffer-equals');
var Transaction = bitcoin.Transaction;
var TransactionBuilder = bitcoin.TransactionBuilder;
var Buffer = require('buffer').Buffer;

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
/* END C&P from bitcoin.types: */

var contrib = {};

var AlphaTransaction = function() {
  Transaction.apply(this, arguments);
}


AlphaTransaction.prototype = new Transaction();
AlphaTransaction.prototype.byteLength = function(forSigning) {
  function scriptSize (someScript) {
    var length = someScript.length

    return bufferutils.varIntSize(length) + length
  }

  return (
    8 +
    bufferutils.varIntSize(this.ins.length) +
    bufferutils.varIntSize(this.outs.length) +
    (forSigning ? 0 : 8) +
    this.ins.reduce(function (sum, input) {
      return sum + 40 + scriptSize(input.script) +
        (forSigning ? (33 + (input.prevOut ?
                          scriptSize(input.prevOut.range_proof) +
                          scriptSize(input.prevOut.nonce_commitment) : 2)) : 0)
    }, 0) +
    this.outs.reduce(function (sum, output) {
      return sum + 33 + scriptSize(output.script) +
        (forSigning ? 32 :
          ((output.range_proof ? scriptSize(output.range_proof) : 1) +
           (output.nonce_commitment ? scriptSize(output.nonce_commitment) : 1))
        ) +
        (output.assetHash ? 32 : 0)
      }, 0
    )
  )
}

AlphaTransaction.prototype.clone = function() {
  var newTx = new AlphaTransaction()
  newTx.version = this.version
  newTx.locktime = this.locktime

  newTx.ins = this.ins.map(function (txIn) {
    return {
      hash: txIn.hash,
      index: txIn.index,
      script: txIn.script,
      sequence: txIn.sequence,
      prevValue: txIn.prevValue,
      prevOut: txIn.prevOut
    }
  })

  newTx.outs = this.outs.map(function (txOut) {
    return {
      value: txOut.value,
      script: txOut.script,
      commitment: txOut.commitment,
      range_proof: txOut.range_proof,
      nonce_commitment: txOut.nonce_commitment,
      assetHash: txOut.assetHash
    }
  })

  return newTx
}

var EMPTY_SCRIPT = new Buffer(0)
var ONE = new Buffer('0000000000000000000000000000000000000000000000000000000000000001', 'hex')

AlphaTransaction.prototype.hashForSignature = function (inIndex, prevOutScript, hashType, fee) {
  typeforce(types.tuple(types.UInt32, types.Buffer, /* types.UInt8 */ types.Number, types.Number), arguments)

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
  var buffer = new Buffer(txTmp.byteLength(true) + 4)
  buffer.writeInt32LE(hashType, buffer.length - 4)
  txTmp.toBuffer(fee, true, inIndex).copy(buffer, 0)

  return bcrypto.hash256(buffer)
}

AlphaTransaction.prototype.toBuffer = function (fee, forSigning, signInIndex) {
  var buffer = new Buffer(this.byteLength(forSigning))

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
      if (txIn.prevOut) {
        writeSlice(txIn.prevOut.commitment);
        writeVarInt(txIn.prevOut.range_proof.length);
        writeSlice(txIn.prevOut.range_proof);
        writeVarInt(txIn.prevOut.nonce_commitment.length);
        writeSlice(txIn.prevOut.nonce_commitment);
      } else {
        writeSlice(new Buffer(33-8));
        var valBuf = new Buffer(8);
        bufferutils.writeUInt64LE(valBuf, signIn.prevValue, 0);
        writeSlice(Bitcoin.bitcoin.bufferutils.reverse(valBuf));
        writeVarInt(0);
        writeVarInt(0);
      }
    }
    writeVarInt(txIn.script.length)
    writeSlice(txIn.script)
    writeUInt32(txIn.sequence)
  })

  if (!forSigning) {
    writeUInt64(fee);
  }

  writeVarInt(this.outs.length)
  this.outs.forEach(function (txOut) {
    if (txOut.commitment) {
      writeSlice(txOut.commitment);
    } else if (!txOut.valueBuffer) {
      writeSlice(new Buffer(33-8));
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

    if (txOut.assetHash) writeSlice(txOut.assetHash);

    writeVarInt(txOut.script.length)
    writeSlice(txOut.script)
  })

  writeUInt32(this.locktime)

  return buffer
}

AlphaTransaction.prototype.toHex = function (fee) {
  return this.toBuffer(fee).toString('hex')
}


var alphaTransactionFromHex = function(hex, __noStrict) {
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

  var tx = new AlphaTransaction()
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

  var _fee = readUInt64();

  var voutLen = readVarInt()
  for (i = 0; i < voutLen; ++i) {
    var commitment = readSlice(33);
    var value;
    if (commitment[0] == 0) {
      var valueBuf = new Buffer(commitment.slice(-8));
      value = bufferutils.readUInt64LE(
        bufferutils.reverse(valueBuf),
        0
      );
      commitment = null;
    } else {
      value = 0;
    }
    var range_proof = readScript();
    var nonce_commitment = readScript();
    tx.outs.push({
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


var alphaMultiassetTransactionFromHex = function(hex, __noStrict) {
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

  var tx = new AlphaTransaction()
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

  var feesCount = readVarInt();
  while (feesCount--) {
    readUInt64()
  }

  var voutLen = readVarInt()
  for (i = 0; i < voutLen; ++i) {
    var commitment = readSlice(33);
    var value;
    if (commitment[0] == 0) {
      var valueBuf = new Buffer(commitment.slice(-8));
      value = bufferutils.readUInt64LE(
        Bitcoin.bitcoin.bufferutils.reverse(valueBuf),
        0
      );
      commitment = null;
    } else {
      value = 0;
    }
    var range_proof = readScript();
    var nonce_commitment = readScript();
    var assetHash = readSlice(32);
    tx.outs.push({
      assetHash: assetHash,
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


contrib.transactionFromHex = function(hex) {
  if (cur_net.isAlphaMultiasset) {
    return alphaMultiassetTransactionFromHex(hex);
  } else if (cur_net.isAlpha) {
    return alphaTransactionFromHex(hex);
  } else {
    return Transaction.fromHex(hex);
  }
}


contrib.AlphaTransactionBuilder = function(net) {
  TransactionBuilder.apply(this, [net]);

  this.tx = new AlphaTransaction();
}

contrib.AlphaTransactionBuilder.prototype = new TransactionBuilder();

var canBuildTypes = {
  'multisig': true,
  'pubkey': true,
  'pubkeyhash': true
}

var multisigInput = function(signatures, scriptPubKey) {
  if (scriptPubKey) {
    var chunks = bscript.decompile(scriptPubKey)
    if (!bscript.isMultisigOutput(chunks)) throw new Error('Expected multisig scriptPubKey')

    var mOp = chunks[0]
    var nOp = chunks[chunks.length - 2]
    var OP_INT_BASE = opcodes.OP_RESERVED // OP_1 - 1
    var m = mOp - OP_INT_BASE
    var n = nOp - OP_INT_BASE

    // GA change: allow building tx without one signature
    // if (signatures.length < m) throw new Error('Not enough signatures provided')
    while (signatures.length < m) signatures.unshift(new Buffer([0]));
    if (signatures.length > n) throw new Error('Too many signatures provided')
  }

  return bscript.compile([].concat(opcodes.OP_0, signatures))
}

contrib.AlphaTransactionBuilder.prototype.__build = function (allowIncomplete) {
  if (!allowIncomplete) {
    if (!this.tx.ins.length) throw new Error('Transaction has no inputs')
    if (!this.tx.outs.length) throw new Error('Transaction has no outputs')
  }

  var tx = this.tx.clone()

  // Create script signatures from inputs
  this.inputs.forEach(function (input, index) {
    var scriptType = input.scriptType
    var scriptSig

    if (!allowIncomplete) {
      if (!scriptType) throw new Error('Transaction is not complete')
      if (!canBuildTypes[scriptType]) throw new Error(scriptType + ' not supported')

      // XXX: only relevant to types that need signatures
      if (!input.signatures) throw new Error('Transaction is missing signatures')
    }

    if (input.signatures) {
      switch (scriptType) {
        case 'pubkeyhash':
          var pkhSignature = input.signatures[0].toScriptSignature(input.hashType)
          scriptSig = bscript.pubKeyHashInput(pkhSignature, input.pubKeys[0])
          break

        case 'multisig':
          var msSignatures = input.signatures.map(function (signature) {
            if (!cur_net.isAlpha) {
              signature = signature &&
                              signature.toScriptSignature(input.hashType);
            } else if (signature) {
              var hashTypeBuffer = new Buffer(1)
              hashTypeBuffer.writeUInt8(input.hashType, 0)
              signature = Buffer.concat([new Buffer(signature), hashTypeBuffer])
            }
            return signature;
          })

          // fill in blanks with OP_0
          if (allowIncomplete) {
            for (var i = 0; i < msSignatures.length; ++i) {
              msSignatures[i] = msSignatures[i] || ops.OP_0
            }

          // remove blank signatures
          } else {
            msSignatures = msSignatures.filter(function (x) { return x })
          }

          var redeemScript = allowIncomplete ? undefined : input.redeemScript
          scriptSig = multisigInput(msSignatures, redeemScript)
          break

        case 'pubkey':
          var pkSignature = input.signatures[0].toScriptSignature(input.hashType)
          scriptSig = bscript.pubKeyInput(pkSignature)
          break
      }
    }

    // did we build a scriptSig?
    if (scriptSig) {
      // wrap as scriptHash if necessary
      if (input.prevOutType === 'scripthash') {
        scriptSig = bscript.scriptHashInput(scriptSig, input.redeemScript)
      }

      tx.setInputScript(index, scriptSig)
    }
  })

  return tx
}

contrib.AlphaTransactionBuilder.prototype.sign = function (index, keyPair, redeemScript, fee, hashType) {
  if (keyPair.network !== this.network) throw new Error('Inconsistent network')
  if (!this.inputs[index]) throw new Error('No input at index: ' + index)
  hashType = hashType || Transaction.SIGHASH_ALL

  var input = this.inputs[index]
  var canSign = input.hashType &&
    input.prevOutScript &&
    input.prevOutType &&
    input.pubKeys &&
    input.scriptType &&
    input.signatures &&
    input.signatures.length === input.pubKeys.length

  var kpPubKey = keyPair.getPublicKeyBuffer()

  // are we ready to sign?
  if (canSign) {
    // if redeemScript was provided, enforce consistency
    if (redeemScript) {
      if (!bufferEquals(input.redeemScript, redeemScript)) throw new Error('Inconsistent redeemScript')
    }

    if (input.hashType !== hashType) throw new Error('Inconsistent hashType')

  // no? prepare
  } else {
    // must be pay-to-scriptHash?
    if (redeemScript) {
      // if we have a prevOutScript, enforce scriptHash equality to the redeemScript
      if (input.prevOutScript) {
        if (input.prevOutType !== 'scripthash') throw new Error('PrevOutScript must be P2SH')

        var scriptHash = bscript.decompile(input.prevOutScript)[1]
        if (!bufferEquals(scriptHash, bcrypto.hash160(redeemScript))) throw new Error('RedeemScript does not match ' + scriptHash.toString('hex'))
      }

      var scriptType = bscript.classifyOutput(redeemScript)
      var redeemScriptChunks = bscript.decompile(redeemScript)
      var pubKeys

      switch (scriptType) {
        case 'multisig':
          pubKeys = redeemScriptChunks.slice(1, -2)

          break

        case 'pubkeyhash':
          var pkh1 = redeemScriptChunks[2]
          var pkh2 = bcrypto.hash160(keyPair.getPublicKeyBuffer())

          if (!bufferEquals(pkh1, pkh2)) throw new Error('privateKey cannot sign for this input')
          pubKeys = [kpPubKey]

          break

        case 'pubkey':
          pubKeys = redeemScriptChunks.slice(0, 1)

          break

        default:
          throw new Error('RedeemScript not supported (' + scriptType + ')')
      }

      // if we don't have a prevOutScript, generate a P2SH script
      if (!input.prevOutScript) {
        input.prevOutScript = bscript.scriptHash.output.encode(bcrypto.hash160(redeemScript))
        input.prevOutType = 'scripthash'
      }

      input.pubKeys = pubKeys
      input.redeemScript = redeemScript
      input.scriptType = scriptType
      input.signatures = pubKeys.map(function () { return undefined })
    } else {
      // pay-to-scriptHash is not possible without a redeemScript
      if (input.prevOutType === 'scripthash') throw new Error('PrevOutScript is P2SH, missing redeemScript')

      // if we don't have a scriptType, assume pubKeyHash otherwise
      if (!input.scriptType) {
        input.prevOutScript = bscript.pubKeyHashOutput(bcrypto.hash160(keyPair.getPublicKeyBuffer()))
        input.prevOutType = 'pubkeyhash'
        input.pubKeys = [kpPubKey]
        input.scriptType = input.prevOutType
        input.signatures = [undefined]
      } else {
        // throw if we can't sign with it
        if (!input.pubKeys || !input.signatures) throw new Error(input.scriptType + ' not supported')
      }
    }

    input.hashType = hashType
  }

  // ready to sign?
  var signatureScript = input.redeemScript || input.prevOutScript
  var signatureHash = this.tx.hashForSignature(index, signatureScript, hashType, fee)

  var sigs = [];
  // enforce in order signing of public keys
  var valid = input.pubKeys.some(function (pubKey, i) {
    if (!bufferEquals(kpPubKey, pubKey)) return false
    if (input.signatures[i]) throw new Error('Signature already exists')

    sigs.push(keyPair.sign(signatureHash).then(function(signature) {
      input.signatures[i] = signature
    }));

    return true
  })

  if (!valid) throw new Error('Key pair cannot sign for this input')

  var $q = angular.injector(['ng']).get('$q');
  return $q.all(sigs);
}

contrib.SECP256K1_FLAGS_TYPE_COMPRESSION = (1 << 1);
contrib.SECP256K1_FLAGS_BIT_COMPRESSION = (1 << 8);
contrib.SECP256K1_EC_COMPRESSED = (contrib.SECP256K1_FLAGS_TYPE_COMPRESSION | contrib.SECP256K1_FLAGS_BIT_COMPRESSION);
contrib.SECP256K1_EC_UNCOMPRESSED = contrib.SECP256K1_FLAGS_TYPE_COMPRESSION;

contrib.SECP256K1_FLAGS_BIT_CONTEXT_VERIFY = (1 << 8);
contrib.SECP256K1_FLAGS_BIT_CONTEXT_SIGN = (1 << 9);
contrib.SECP256K1_FLAGS_TYPE_CONTEXT = (1 << 0);
contrib.SECP256K1_CONTEXT_VERIFY = (contrib.SECP256K1_FLAGS_TYPE_CONTEXT | contrib.SECP256K1_FLAGS_BIT_CONTEXT_VERIFY);
contrib.SECP256K1_CONTEXT_SIGN = (contrib.SECP256K1_FLAGS_TYPE_CONTEXT | contrib.SECP256K1_FLAGS_BIT_CONTEXT_SIGN);

contrib.init_secp256k1 = function(Module, isAlpha) {
    Module.secp256k1ctx = Module._secp256k1_context_create(
        contrib.SECP256K1_CONTEXT_VERIFY |
        contrib.SECP256K1_CONTEXT_SIGN
    );
    if (!Module.secp256k1ctx) {
        throw new Error('secp256k1 context create failed');
    }

    no_secp256k1_getPub = bitcoin.ECPair.prototype.getPublicKeyBuffer;
    bitcoin.ECPair.prototype.getPublicKeyBuffer = function() {
        if (self.Module === undefined || !this.d) {
            // in case it's called before module finishes initialisation,
            // or in case of pubkey-only ECPair
            return no_secp256k1_getPub.bind(this)();
        }
        var compressed = this.compressed;

        var out = Module._malloc(128);
        var out_s = Module._malloc(4);
        var secexp = Module._malloc(32);
        var start = this.d.toByteArray().length - 32;
        if (start >= 0) {  // remove excess zeroes
            var slice = this.d.toByteArray().slice(start);
        } else {  // add missing zeroes
            var slice = this.d.toByteArray();
            while (slice.length < 32) slice.unshift(0);
        }
        writeArrayToMemory(slice, secexp);
        setValue(out_s, 128, 'i32');

        var pubkey_opaque = Module._malloc(64);
        if (1 != Module._secp256k1_ec_pubkey_create(
                Module.secp256k1ctx,
                pubkey_opaque,
                secexp)) {
            throw new Error('secp256k1 pubkey create failed');
        }
        if (1 != Module._secp256k1_ec_pubkey_serialize(
                Module.secp256k1ctx,
                out,
                out_s,
                pubkey_opaque,
                compressed ?
                    contrib.SECP256K1_EC_COMPRESSED :
                    contrib.SECP256K1_EC_UNCOMPRESSED)) {
            throw new Error('secp256k1 pubkey serialize failed');
        }

        var ret = [];
        for (var i = 0; i < getValue(out_s, 'i32'); ++i) {
            ret[i] = getValue(out+i, 'i8') & 0xff;
        }

        Module._free(out);
        Module._free(out_s);
        Module._free(secexp);
        Module._free(pubkey_opaque);

        return new Buffer(ret);
    };
}

module.exports = contrib;
