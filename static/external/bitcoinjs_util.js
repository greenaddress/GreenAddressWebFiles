var wally = require('wallyjs')
// Bitcoin utility functions
Bitcoin.Util = {
    /**
     * Parse a Bitcoin value byte array, returning a BigInteger.
     */
    valueToBigInt: function (valueBuffer)
    {
        if (valueBuffer instanceof Bitcoin.BigInteger) return valueBuffer;

        // Prepend zero byte to prevent interpretation as negative integer
        return Bitcoin.BigInteger.fromByteArrayUnsigned(valueBuffer);
    },

    /**
     * Format a Bitcoin value as a string.
     *
     * Takes a BigInteger or byte-array and returns that amount of Bitcoins in a
     * nice standard formatting.
     *
     * Examples:
     * 12.3555
     * 0.1234
     * 900.99998888
     * 34.00
     */
    formatValue: function (valueBuffer) {
        var value = this.valueToBigInt(valueBuffer).toString();

        var integerPart = value.length > 8 ? value.substr(0, value.length-8) : '0';
        var decimalPart = value.length > 8 ? value.substr(value.length-8) : value;

        while (decimalPart.length < 8) decimalPart = "0"+decimalPart;
        decimalPart = decimalPart.replace(/0*$/, '');
        while (decimalPart.length < 2) decimalPart += "0";
        return integerPart+"."+decimalPart;
    },

    /**
     * Parse a floating point string as a Bitcoin value.
     *
     * Keep in mind that parsing user input is messy. You should always display
     * the parsed value back to the user to make sure we understood his input
     * correctly.
     */
    parseValue: function (valueString) {
        if (!valueString) return Bitcoin.BigInteger.ZERO;

        valueString = ''+valueString;

        if (!/^[\d.]+$/.test(valueString)) {
            return Bitcoin.BigInteger.ZERO;
        }

        // TODO: Detect other number formats (e.g. comma as decimal separator)
        var valueComp = valueString.split('.');
        var integralPart = valueComp[0];
        var fractionalPart = valueComp[1] || "0";

        fractionalPart = fractionalPart.length > 8 ? fractionalPart.substr(0, 8) : fractionalPart;

        while (fractionalPart.length < 8) fractionalPart += "0";

        fractionalPart = fractionalPart.replace(/^0+/g, '');
        var value = new Bitcoin.BigInteger(integralPart);
        value = value.multiply(new Bitcoin.BigInteger('100000000'));
        value = value.add(new Bitcoin.BigInteger(fractionalPart));
        return value;
    },

    /**
     * Calculate RIPEMD160(SHA256(data)).
     *
     * Takes an arbitrary byte array as inputs and returns the hash as a byte
     * array.
     */
    sha256ripe160: function (data) {
        return Bitcoin.CryptoJS.RIPEMD160(Bitcoin.CryptoJS.SHA256(data));
    }
};

if (self.angular) {  // not in WebWorkers
    var $q = angular.injector(['ng']).get('$q');
}

(function() {
    var wallyjs = require('wallyjs');

    Bitcoin.bitcoin.HDNode.fromSeedHex = function(seed_hex, network) {
        return wallyjs.bip32_key_from_seed(
            new Bitcoin.Buffer.Buffer(seed_hex, 'hex'),
            network === Bitcoin.bitcoin.networks.testnet ? 0x04358394 : 0x0488ADE4,
            0
        ).then(function (b) {
            return wallyjs.wally_base58_from_bytes(b, 1);
        }).then(function (b58) {
            return Bitcoin.bitcoin.HDNode.fromBase58(b58, network);
        })
    };

    Bitcoin.bitcoin.HDNode.prototype.derive = function(i) {
        var _this = this;
        return wallyjs.wally_base58_to_bytes(this.toBase58(), 1).then(function (b) {
            if (_this.isNeutered()) {
                return wallyjs.bip32_pubkey_from_parent(b, i, 1);
            } else {
                return wallyjs.bip32_privkey_from_parent(b, i, 0);
            }
        }).then(function (b) {
            return wallyjs.wally_base58_from_bytes(b, 1);
        }).then(function (b58) {
            return Bitcoin.bitcoin.HDNode.fromBase58(b58, _this.keyPair.network);
        })
    }

    Bitcoin.bitcoin.ECPair.prototype.sign = function(hash) {
        return wally.wally_ec_sig_from_bytes(
            this.d.toBuffer(32),
            new Buffer(hash),
            1
        ).then(function (compact) {
          return wally.wally_ec_sig_to_der(compact).then(
            bitcoin.ECSignature.fromDER
          );
        });
    }

    Bitcoin.bitcoin.ECPair.prototype.signSchnorr = function(hash) {
        return wally.wally_ec_sig_from_bytes(
            this.d.toBuffer(32),
            new Buffer(hash),
            2
        );
    }
})();

Bitcoin.bitcoin.HDNode.prototype.subpath = function(path_hex) {
    var key = $q.when(this);
    var path_bytes = new Bitcoin.Buffer.Buffer(path_hex, 'hex');
    for (var i = 0; i < 32; i++) {
        key = key.then(function(key) {
            var dk = key.derive(+Bitcoin.BigInteger.fromBuffer(path_bytes.slice(0, 2)));;
            path_bytes = path_bytes.slice(2);
            return dk;
        });
    }
    return key;
}
Bitcoin.bitcoin.HDNode.prototype.subpath_for_login = function(path_hex) {
    // derive private key for signing the challenge, using 8 bytes instead of 64
    var key = $q.when(this);
    if (path_hex.length == 17 && path_hex[0] == '0') {  // new version with leading 0
        path_hex = path_hex.slice(1);
        var path_bytes = new Bitcoin.Buffer.Buffer(path_hex, 'hex');
        for (var i = 0; i < 2; i++) {
            key = key.then(function(key) {
                var dk = key.derive(+Bitcoin.BigInteger.fromBuffer(path_bytes.slice(0, 4)));
                path_bytes = path_bytes.slice(4);
                return dk;
            });
        }
    } else {
        var path_bytes = new Bitcoin.Buffer.Buffer(path_hex, 'hex');
        for (var i = 0; i < 4; i++) {
            key = key.then(function(key) {
                var dk = key.derive(+Bitcoin.BigInteger.fromBuffer(path_bytes.slice(0, 2)));
                path_bytes = path_bytes.slice(2);
                return dk;
            });
        }
    }
    return key;
}

if (self.scrypt_module_factory) {  // WebWorkers only
    var scrypt = scrypt_module_factory();
}

Bitcoin.scrypt = function(passwd, salt, N, r, p, dkLen) {
    if (typeof passwd == 'string') {
        passwd = scrypt.encode_utf8(passwd);
    }
    var ret_arr = scrypt.crypto_scrypt(new Uint8Array(passwd), new Uint8Array(salt), N, r, p, dkLen);
    var ret = [];
    for (var i = 0; i < ret_arr.length; i++) ret.push(ret_arr[i]);
    return new Bitcoin.Buffer.Buffer(ret);
}

var Buffer = Bitcoin.Buffer.Buffer;
var bcrypto = Bitcoin.bitcoin.crypto;
var bufferutils = Bitcoin.bitcoin.bufferutils;
var typeforce = Bitcoin.typeforce;
var types = Bitcoin.types;

var BufferWriter = function(length) {
  typeforce(types.tuple(types.Number), arguments)
  this.buffer = new Buffer(length)
  this.offset = 0
}

BufferWriter.prototype.writeSlice = function (slice) {
  slice.copy(this.buffer, this.offset)
  this.offset += slice.length

  return this
}

BufferWriter.prototype.writeSliceWithVarInt = function (script) {
  this.writeVarInt(script.length)
  this.writeSlice(script)

  return this
}

BufferWriter.prototype.writeScript = BufferWriter.prototype.writeSliceWithVarInt

BufferWriter.prototype.writeInt = function (i) {
  this.buffer.writeUInt8(i, this.offset)
  this.offset += 1

  return this
}

BufferWriter.prototype.writeUInt64 = function (i) {
  bufferutils.writeUInt64LE(this.buffer, i, this.offset)
  this.offset += 8

  return this
}

BufferWriter.prototype.writeUInt32 = function (i) {
  this.buffer.writeUInt32LE(i, this.offset)
  this.offset += 4

  return this
}

BufferWriter.prototype.writeVarInt = function (i) {
  var n = bufferutils.writeVarInt(this.buffer, i, this.offset)
  this.offset += n

  return this
}

var ADVANCED_TRANSACTION_MARKER = 0;
var ADVANCED_TRANSACTION_FLAG = 1;

/**
 * FROM https://github.com/bitcoinjs/bitcoinjs-lib/pull/520
 * (to be cleaned up / merged with upstream)
 **/
Bitcoin.bitcoin.Transaction.fromBuffer = function (buffer, __noStrict) {
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

  function readInt () {
    var i = buffer.readUInt8(offset)
    offset += 1

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

  console.log('fromBuffer')

  var tx = new Bitcoin.bitcoin.Transaction()
  tx.version = readUInt32()

  tx.marker = readInt()
  tx.flag = readInt()

  // check if transaction is advanced (segwit) format
  if (tx.marker === ADVANCED_TRANSACTION_MARKER && tx.flag === ADVANCED_TRANSACTION_FLAG) {
    // -
  } else {
    // undo the reading of the marker and flag byte
    offset -= 2;
    tx.marker = null;
    tx.flag = null;
  }

  var vinLen = readVarInt()
  for (var i = 0; i < vinLen; ++i) {
    tx.ins.push({
      hash: readSlice(32),
      index: readUInt32(),
      script: readScript(),
      sequence: readUInt32()
    })
  }

  var voutLen = readVarInt()
  for (i = 0; i < voutLen; ++i) {
    tx.outs.push({
      value: readUInt64(),
      script: readScript()
    })
  }

  if (tx.flag === ADVANCED_TRANSACTION_FLAG) {
    for (i = 0; i < vinLen; ++i) {
      tx.ins[i].witness = []
      var witnessLen = readVarInt()
      for (var x = 0; x < witnessLen; ++x) {
        tx.ins[i].witness.push(readScript())
      }
    }
  }

  tx.locktime = readUInt32()

  if (__noStrict) return tx
  if (offset !== buffer.length) throw new Error('Transaction has unexpected data')

  return tx
}

Bitcoin.bitcoin.Transaction.prototype.hashForSignatureV2 = function (inIndex, prevOutScript, amount, hashType) {
  var Buffer = Bitcoin.Buffer.Buffer,
      Transaction = Bitcoin.bitcoin.Transaction,
      bscript = Bitcoin.bitcoin.script;

  var hashPrevouts = new Buffer("00" * 32, 'hex')
  var hashSequence = new Buffer("00" * 32, 'hex')
  var hashOutputs = new Buffer("00" * 32, 'hex')

  function txOutToBuffer(txOut) {
    var bufferWriter = new BufferWriter(8 + bufferutils.varIntSize(txOut.script.length) + txOut.script.length)

    bufferWriter.writeUInt64(txOut.value)
    bufferWriter.writeScript(txOut.script)
    console.log('txOut ' + bufferWriter.buffer.toString('hex'));

    return bufferWriter.buffer
  }

  if (!(hashType & Transaction.SIGHASH_ANYONECANPAY)) {
    hashPrevouts = bcrypto.hash256(Buffer.concat(this.ins.map(function(txIn) {
      var bufferWriter = new BufferWriter(36)

      bufferWriter.writeSlice(txIn.hash)
      bufferWriter.writeUInt32(txIn.index)

      return bufferWriter.buffer
    })))
  }

  if (!(hashType & Transaction.SIGHASH_ANYONECANPAY) && hashType & 0x1f != Transaction.SIGHASH_SINGLE && (hashType & 0x1f) != Transaction.SIGHASH_NONE) {
    hashSequence = bcrypto.hash256(Buffer.concat(this.ins.map(function(txIn) {
      var bufferWriter = new BufferWriter(4)

      bufferWriter.writeUInt32(txIn.sequence)

      return bufferWriter.buffer
    })))
  }

  if ((hashType & 0x1f) != Transaction.SIGHASH_SINGLE && (hashType & 0x1f) != Transaction.SIGHASH_NONE) {
    hashOutputs = bcrypto.hash256(Buffer.concat(this.outs.map(function(txOut) {
      return txOutToBuffer(txOut)
    })))
  } else if ((hashType & 0x1f) == Transaction.SIGHASH_SINGLE && inIndex < this.outs.length) {
    hashOutputs = bcrypto.hash256(txOutToBuffer(this.outs[inIndex]))
  }

  console.log('hashPrevouts', hashPrevouts.toString('hex'))
  console.log('hashSequence', hashSequence.toString('hex'))
  console.log('hashOutputs', hashOutputs.toString('hex'))

  // TODO: cache hashPrevouts, hashSequence and hashOutputs for all signatures in a transaction

  var bufferWriter = new BufferWriter(4 + 32 + 32 + 32 + 4 + bufferutils.varIntSize(prevOutScript.length) + prevOutScript.length + 8 + 4 + 32 + 4 + 4)

  bufferWriter.writeUInt32(this.version)

  bufferWriter.writeSlice(hashPrevouts)
  bufferWriter.writeSlice(hashSequence)

  console.log('prevOutScript', prevOutScript)
  console.log('prevOutScript', bscript.decompile(prevOutScript))

  console.log('amount', amount)

  // The input being signed (replacing the scriptSig with scriptCode + amount)
  // The prevout may already be contained in hashPrevout, and the nSequence
  // may already be contain in hashSequence.
  bufferWriter.writeSlice(this.ins[inIndex].hash)
  bufferWriter.writeUInt32(this.ins[inIndex].index)
  bufferWriter.writeScript(prevOutScript)
  bufferWriter.writeUInt64(amount)
  bufferWriter.writeUInt32(this.ins[inIndex].sequence)

  bufferWriter.writeSlice(hashOutputs)

  bufferWriter.writeUInt32(this.locktime)
  bufferWriter.writeUInt32(hashType)

  console.log('SignatureHashPayload', bufferWriter.buffer.toString('hex'))
  console.log('SignatureHash', bcrypto.hash256(bufferWriter.buffer).toString('hex'))

  return bcrypto.hash256(bufferWriter.buffer)
}

Bitcoin.bitcoin.Transaction.prototype.cloneTransactionForSignature =
  function (connectedScript, inIndex, hashType)
{
  var txTmp = this.clone()

  // In case concatenating two scripts ends up with two codeseparators,
  // or an extra one at the end, this prevents all those possible
  // incompatibilities.
  /*scriptCode = scriptCode.filter(function (val) {
    return val !== OP_CODESEPARATOR
    });*/

  // Blank out other inputs' signatures
  txTmp.ins.forEach(function(txin) {
    txin.script = new Bitcoin.Buffer.Buffer([])
  })

  txTmp.ins[inIndex].script = connectedScript

  // Blank out some of the outputs
  /*if ((hashType & 0x1f) == SIGHASH_NONE) {
    txTmp.outs = []

    // Let the others update at will
    txTmp.ins.forEach(function(txin, i) {
      if (i != inIndex) {
        txTmp.ins[i].sequence = 0
      }
    })

  } else if ((hashType & 0x1f) == SIGHASH_SINGLE) {
    // TODO: Implement
  }

  // Blank out other inputs completely, not recommended for open transactions
  if (hashType & SIGHASH_ANYONECANPAY) {
    txTmp.ins = [txTmp.ins[inIndex]]
  }*/

  return txTmp
}

Bitcoin.bitcoin.Transaction.prototype.serializeOutputs = function () {
  var parts = [];

  parts.push(Bitcoin.bitcoin.bufferutils.varIntBuffer(this.outs.length));

  this.outs.forEach(function(txout) {
    var valueBuf = new Buffer(8);
    Bitcoin.bitcoin.bufferutils.writeUInt64LE(valueBuf, txout.value, 0);
    parts.push(valueBuf);
    parts.push(Bitcoin.bitcoin.bufferutils.varIntBuffer(txout.script.length));
    parts.push(txout.script);
  })

  return Bitcoin.Buffer.Buffer.concat(parts);
}
