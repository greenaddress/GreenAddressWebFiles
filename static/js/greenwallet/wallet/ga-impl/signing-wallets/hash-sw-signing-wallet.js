var BigInteger = require('bigi');
var bitcoin = require('bitcoinjs-lib');
var branches = require('../constants').branches;
var scriptTypes = require('../constants').scriptTypes;
var sigHash = require('../constants').sigHash;
var crypto = require('crypto');
var hashSegWit = require('../segwit').hashSegWit;
var extend = require('xtend/mutable');
var KeysManager = require('./../keys-managers/sw-keys-manager');
var ScriptFactory = require('./../script-factory');
var wally = require('wallyjs');
var window = require('global/window');

var Bitcoin = window.Bitcoin;

module.exports = HashSwSigningWallet;

extend(HashSwSigningWallet.prototype, {
  deriveNextKey: deriveNextKey,
  derivePath: derivePath,
  derivePrivateKey: derivePrivateKey,
  getChainCode: getChainCode,
  getChallengeArguments: getChallengeArguments,
  pathFromBytes: pathFromBytes,
  pathFromString: pathFromString,
  signChallenge: signChallenge,
  signInput: signInput,
  signMessage: signMessage,
  signTransaction: signTransaction
});

function HashSwSigningWallet (options) {
  this.keysManager = new KeysManager({
    gaService: options.gaService,
    privHDWallet: options.hd,
    pubHDWallet: options.hd
  });
  this.scriptFactory = new ScriptFactory(this.keysManager);
  this.schnorrTx = options.schnorrTx;
  this.mnemonic = options.hd.mnemonic;
}

function getChallengeArguments () {
  return Promise.resolve([
    'com.greenaddress.login.get_challenge',
    this.keysManager.pubHDWallet.getAddress()
  ]);
}

function deriveNextKey (path_elem, key) {
  return key.derive(path_elem);
}

function derivePrivateKey (path) {
  var key = Promise.resolve(this.keysManager.privHDWallet);
  for (var i = 0; i < path.length; i++) {
    var derive = deriveNextKey.bind(this, path[i]);
    key = key.then(derive);
  }
  return key;
}

// Return a path as an array of integers given a '/' separated string
function pathFromString (path) {
  return path.split('/').map(function (elem) { return parseInt(elem, 10); });
}

function signMessage (path, message, options) {
  path = pathFromString(path);
  message = Buffer(message);

  return this.derivePrivateKey(path).then(function (private_key) {
    return wally.wally_format_bitcoin_message(message, wally.BITCOIN_MESSAGE_FLAG_HASH).then(function (hash) {
      return private_key.signHash(hash);
    });
  });
}

function pathFromBytes (pathBytes) {
  var path = [];
  for (var i = 0; i < pathBytes.length; i += 2) {
    path.push(pathBytes.readUInt16BE(i));
  }
  return path;
}

function signChallenge (challenge) {
  // The private key used for signing is derived from a random path of length 8
  var pathBytes = crypto.randomBytes(8);
  var randomPath = pathFromBytes(pathBytes);

  var challengeBuf = new BigInteger(challenge).toBuffer();

  return this.derivePrivateKey(randomPath).then(function (private_key) {
    return private_key.signHash(challengeBuf);
  }).then(function (signature) {
    signature = [ signature.r.toString(), signature.s.toString() ];
    return {signature: signature, path: pathBytes.toString('hex')};
  });
}

function signTransaction (tx, options) {
  var ret = Promise.resolve();
  if (options.signingProgressCallback) {
    options.signingProgressCallback(0);
  }
  var _this = this;
  tx.clearFeeChanges();
  for (var i = 0; i < tx.tx.ins.length; ++i) {
    (function (i) {
      ret = ret.then(function () {
        return _this.signInput(tx.tx, i);
      }).then(function () {
        if (options.signingProgressCallback) {
          options.signingProgressCallback(Math.round(
            100 * (i + 1) / tx.tx.ins.length
          ));
        }
      });
    })(i);
  }
  return ret;
}

function signInput (tx, i) {
  var prevOut = tx.ins[i].prevOut;
  var _this = this;
  return Promise.all(
    [this.scriptFactory.getUtxoPrevScript(prevOut),
     this.keysManager.getUtxoPrivateKey(prevOut)]
  ).then(function (values) {
    var prevScript = values[0];
    var signingKey = values[1];
    var signFunction = (_this.schnorrTx
      ? signingKey.signHashSchnorr
      : signingKey.signHash
    ).bind(signingKey);
    return signFunction(
      prevOut.raw.script_type === scriptTypes.OUT_P2SH_P2WSH
        ? hashSegWit(tx, i, prevScript, prevOut.value, sigHash.ALL)
        : tx.hashForSignature(i, prevScript, sigHash.ALL)
    ).then(function (sig) {
      if (!_this.schnorrTx) {
        sig = sig.toDER();
      }
      var sigAndSigHash = new Buffer([].concat(
        Array.prototype.slice.call(sig), [ sigHash.ALL ]
      ));
      if (prevOut.privkey) {
        // privkey provided means we're signing p2pkh
        tx.ins[ i ].script = Bitcoin.bitcoin.script.pubKeyHashInput(
          sigAndSigHash, // our signature with SIGHASH_ALL
          signingKey.getPublicKeyBuffer()
        );
      } else if (prevOut.raw.branch === branches.EXTERNAL) {
        // priv-der pkhash-spending signature
        return _this.keysManager.getMyPublicKey(
          prevOut.raw.subaccount, prevOut.raw.pointer, branches.EXTERNAL
        ).then(function (pubKey) {
          tx.ins[ i ].script = Bitcoin.bitcoin.script.pubKeyHashInput(
            sigAndSigHash, // our signature with SIGHASH_ALL
            pubKey.hdnode.getPublicKeyBuffer()
          );
        });
      } else {
        if (prevOut.raw.script_type === scriptTypes.OUT_P2SH_P2WSH) {
          tx.ins[i].script = new Buffer([].concat(
            0x22, 0x00, 0x20, Array.from(bitcoin.crypto.sha256(prevScript))
          ));
          tx.ins[i].witness[0] = sigAndSigHash;
        } else {
          tx.ins[i].script = bitcoin.script.compile([].concat(
            bitcoin.opcodes.OP_0, // OP_0 required for multisig
            new Buffer([0]), // to be replaced by backend with server's sig
            sigAndSigHash, // our signature with SIGHASH_ALL
            prevScript
          ));
        }
      }
    });
  });
}

function derivePath () {
  return Promise.resolve(this.keysManager.privHDWallet.derivePath());
}

function getChainCode () {
  return Promise.resolve(this.keysManager.pubHDWallet.getChainCode());
}
