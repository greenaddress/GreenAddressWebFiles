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

module.exports = HashSwSigningWallet;

extend(HashSwSigningWallet.prototype, {
  getChallengeArguments: getChallengeArguments,
  signChallenge: signChallenge,
  signTransaction: signTransaction,
  signInput: signInput,
  derivePath: derivePath,
  getChainCode: getChainCode
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

function signChallenge (challenge) {
  var pathBytes = crypto.randomBytes(8);
  var randomPathHex = pathBytes.toString('hex');
  while (randomPathHex.length < 16) {
    randomPathHex = '0' + randomPathHex;
  }
  var challengeBuf = new BigInteger(challenge).toBuffer();
  var key = Promise.resolve(this.keysManager.privHDWallet);
  for (var i = 0; i < 4; i++) {
    key = key.then(function (key) {
      var dk = key.derive(+BigInteger.fromBuffer(pathBytes.slice(0, 2)));
      pathBytes = pathBytes.slice(2);
      return dk;
    });
  }
  return key.then(function (key) {
    return key.signHash(challengeBuf);
  }).then(function (signature) {
    signature = [ signature.r.toString(), signature.s.toString() ];
    return {signature: signature, path: randomPathHex};
  });
}

function signTransaction (tx, options) {
  var ret = Promise.resolve();
  if (options.signingProgressCallback) {
    options.signingProgressCallback(0);
  }
  var _this = this;
  var witness = [];
  for (var i = 0; i < tx.tx.ins.length; ++i) {
    (function (i) {
      ret = ret.then(function () {
        return _this.signInput(tx.tx, i);
      }).then(function (sig) {
        if (options.signingProgressCallback) {
          options.signingProgressCallback(Math.round(
            100 * (i + 1) / tx.tx.ins.length
          ));
        }
        if (sig.witness) {
          witness.push(Buffer.concat(
            // count + length + signature
            [new Buffer([1, sig.witness.length]), sig.witness]
          ));
        } else {
          // count = 0
          witness.push(new Buffer([0]));
        }
        if (sig.witness) {
          tx.tx.witness = witness;
        }
        return sig;
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
        tx.ins[ i ].script = bitcoin.script.pubKeyHashInput(
          sigAndSigHash, // our signature with SIGHASH_ALL
          signingKey.getPublicKeyBuffer()
        );
      } else if (prevOut.raw.branch === branches.EXTERNAL) {
        // priv-der pkhash-spending signature
        return _this.keysManager.getMyPublicKey(
          prevOut.raw.subaccount, prevOut.raw.pointer, branches.EXTERNAL
        ).then(function (pubKey) {
          tx.ins[ i ].script = bitcoin.script.pubKeyHashInput(
            sigAndSigHash, // our signature with SIGHASH_ALL
            pubKey.hdnode.getPublicKeyBuffer()
          );
        });
        return {};
      } else {
        if (prevOut.raw.script_type == scriptTypes.OUT_P2SH_P2WSH) {
          tx.ins[i].script = new Buffer([].concat(
            0x22, 0x00, 0x20, Array.from(bitcoin.crypto.sha256(prevScript))
          ));
          return {witness: sigAndSigHash};
        } else {
          tx.ins[i].script = bitcoin.script.compile([].concat(
            bitcoin.opcodes.OP_0, // OP_0 required for multisig
            new Buffer([0]), // to be replaced by backend with server's sig
            sigAndSigHash, // our signature with SIGHASH_ALL
            prevScript
          ));
          return {};
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
