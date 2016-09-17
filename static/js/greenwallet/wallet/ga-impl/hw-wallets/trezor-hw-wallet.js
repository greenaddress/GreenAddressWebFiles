var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
var SchnorrSigningKey = require('../../bitcoinup/schnorr-signing-key');
var window = require('global/window');

var gettext = window.gettext;

var HWWallet = require('./base-hw-wallet');

module.exports = TrezorHWWallet;

TrezorHWWallet.prototype = Object.create(HWWallet.prototype);
extend(TrezorHWWallet.prototype, {
  deviceTypeName: 'TREZOR',
  getChallengeArguments: getChallengeArguments,
  getPublicKey: getPublicKey,
  signMessage: signMessage,
  signTransaction: signTransaction,
  setupSeed: setupSeed,
  _recovery: _recovery
});
TrezorHWWallet.pingDevice = pingDevice;
TrezorHWWallet.checkForDevices = checkForDevices;
TrezorHWWallet.listDevices = listDevices;
TrezorHWWallet.openDevice = openDevice;
TrezorHWWallet.promptPin = promptPin;
TrezorHWWallet.promptPassphrase = promptPassphrase;
TrezorHWWallet.handleButton = handleButton;
TrezorHWWallet.handleError = handleError;
TrezorHWWallet.initDevice = initDevice;
HWWallet.initSubclass(TrezorHWWallet);

function TrezorHWWallet (network) {
  this.network = network;
}

function promptPin () {
  if (HWWallet.guiCallbacks.trezorPINPrompt) {
    HWWallet.guiCallbacks.trezorPINPrompt.apply(null, arguments);
  }
}

function promptPassphrase () {
  if (HWWallet.guiCallbacks.trezorPassphrasePrompt) {
    HWWallet.guiCallbacks.trezorPassphrasePrompt.apply(null, arguments);
  }
}

function handleButton () {
  if (this.buttonCb) this.buttonCb();
}

function handleError () {
  if (this.errorCb) this.errorCb();
}

function _pathToArray (path) {
  var pathArray = [];
  path.split('/').forEach(function (index) {
    if (!index.length) return;
    if (index.indexOf("'") === index.length - 1) {
      pathArray.push((~~index.slice(0, -1)) + 0x80000000);
    } else {
      pathArray.push(~~index);
    }
  });
  return pathArray;
}

function getPublicKey (path) {
  var _this = this;
  return this.getDevice().then(function () {
    var dev = TrezorHWWallet.currentDevice;
    path = path || '';
    var pathArray = _pathToArray(path);
    if (path.length === 0 && _this.rootPublicKey) {
      return Promise.resolve(new SchnorrSigningKey(_this.rootPublicKey));
    } else {
      return dev.getPublicKey(pathArray).then(function (pubkey) {
        var pk = pubkey.message.node.public_key;
        pk = pk.toHex ? pk.toHex() : pk;
        var keyPair = bitcoin.ECPair.fromPublicKeyBuffer(
          new Buffer(pk, 'hex'),
          _this.network
        );
        var cc = pubkey.message.node.chain_code;
        cc = cc.toHex ? cc.toHex() : cc;
        var chainCode = new Buffer(cc, 'hex');
        var hdwallet = new bitcoin.HDNode(keyPair, chainCode);
        if (path.length === 0) {
          _this.rootPublicKey = hdwallet;
        }
        return new SchnorrSigningKey(hdwallet);
      });
    }
  });
}

function signMessage (path, message) {
  var pathArray = _pathToArray(path);
  message = new Buffer(message, 'utf8').toString('hex');
  return this.getDevice().then(function () {
    var dev = TrezorHWWallet.currentDevice;
    return dev._typedCommonCall('SignMessage', 'MessageSignature', {
      'message': message,
      address_n: pathArray
    });
  }).then(function (res) {
    var sig = res.message.signature;
    sig = sig.toHex ? sig.toHex() : sig;
    var signature = bitcoin.ECSignature.parseCompact(new Buffer(sig, 'hex'));
    return {
      r: signature.signature.r,
      s: signature.signature.s,
      i: signature.i
    };
  });
}

function signTransaction (tx, options) {
  var _this = this;
  var dev;
  var fromHex;

  var inputs = [];
  tx = tx.tx;

  var fetch_d = fetchUtxo();  // fech in parallel with everything else
  return this.getDevice().then(function () {
    dev = TrezorHWWallet.currentDevice;
    fromHex = window.trezor.ByteBuffer.fromHex;

    var inputs_d = Promise.resolve();
    for (var i = 0; i < tx.ins.length; ++i) {
      (function (i) {
        inputs_d = inputs_d.then(function () {
          return getPubKeys(tx.ins[ i ].prevOut);
        }).then(function (pubKeys) {
          inputs.push({
            address_n: prevoutToPath(tx.ins[ i ].prevOut, false, false),
            prev_hash: fromHex(
              bitcoin.bufferutils.reverse(
                tx.ins[ i ].hash
              ).toString('hex')
            ),
            prev_index: tx.ins[ i ].index,
            script_type: 1,  // SPENDMULTISIG
            multisig: {
              pubkeys: pubKeys,
              m: 2
            },
            sequence: tx.ins[ i ].sequence
          });
        });
      })(i);
    }
    return inputs_d;
  }).then(
    convertOuts
  ).then(function (outs) {
    return fetch_d.then(function () {
      return outs;
    });
  }).then(function (outs) {
    var txs = [];

    for (var i = 0; i < tx.ins.length; ++i) {
      var parsed = bitcoin.Transaction.fromBuffer(tx.ins[ i ].prevOut.data);
      txs.push({
        hash: tx.ins[ i ].prevOut.raw.txhash,
        version: parsed.version,
        lock_time: parsed.locktime,
        bin_outputs: convertOutsBin(parsed.outs),
        inputs: convertIns(parsed.ins)
      });
    }

    return dev.signTx(
      inputs, outs, txs, {
        coin_name: _this.network === bitcoin.networks.bitcoin
          ? 'Bitcoin' : 'Testnet'
      }
    ).then(function (res) {
      res = res.message.serialized;
      var signed = bitcoin.Transaction.fromHex(res.serialized_tx);
      for (var i = 0; i < tx.ins.length; ++i) {
        signed.ins[i].prevOut = tx.ins[i].prevOut;
        var decompiled = bitcoin.script.decompile(signed.ins[i].script);
        signed.ins[i].script = bitcoin.script.compile([].concat(
          bitcoin.opcodes.OP_0, // OP_0 required for multisig
          new Buffer([0]), // to be replaced by backend with server's sig
          new Buffer([].concat(
            Array.prototype.slice.call(
              new Buffer(res.signatures[i].toHex(), 'hex')
            ), [1]
          )), // our signature with SIGHASH_ALL
          decompiled[1]  // prevScript
        ));
      }
      tx.ins = signed.ins;
    });
  });

  function fetchUtxo () {
    if (options.utxoFactory.fetchUtxoDataForTx) {
      return options.utxoFactory.fetchUtxoDataForTx(tx);
    } else {
      return Promise.resolve();
    }
  }

  function prevoutToPath (prevOut, fromSubaccount, privDer) {
    var path = [];
    if (prevOut.subaccount.pointer && !fromSubaccount) {
      path.push(3 + 0x80000000);  // branch=SUBACCOUNT
      path.push(prevOut.subaccount.pointer + 0x80000000);
    }
    if (privDer) {
      path.push(2 + 0x80000000);  // branch=EXTERNAL
      path.push(prevOut.raw.pointer + 0x80000000);
    } else {
      path.push(1);  // branch=REGULAR
      path.push(prevOut.raw.pointer);
    }
    return path;
  }

  function getPubKeys (prevOut) {
    var gahd = options.keysManager.getGASubAccountPubKey(
      prevOut.subaccount.pointer
    );
    var gawallet = {
      depth: 33,
      child_num: 0,
      fingerprint: 0,
      chain_code: fromHex(gahd.chainCode.toString('hex')),
      public_key: fromHex(gahd.keyPair.getPublicKeyBuffer().toString('hex'))
    };
    var myhd_d = options.keysManager.getSubaccountRootKey(
      prevOut.subaccount.pointer
    );
    return myhd_d.then(function (myhd) {
      var mywallet = {
        depth: 0,
        child_num: 0,
        fingerprint: 0,
        chain_code: fromHex(myhd.hdnode.chainCode.toString('hex')),
        public_key: fromHex(myhd.hdnode.keyPair.getPublicKeyBuffer().toString('hex'))
      };
      var ret = [
        {
          node: gawallet,
          address_n: [prevOut.raw.pointer]
        },
        {
          node: mywallet,
          address_n: prevoutToPath(prevOut, true, false)
        }
      ];
      if (prevOut.subaccount.type === '2of3') {
        var recovery_wallet = {
          depth: 0,
          child_num: 0,
          fingerprint: 0,
          chain_code: fromHex(prevOut.subaccount['2of3_backup_chaincode']),
          public_key: fromHex(prevOut.subaccount['2of3_backup_pubkey'])
        };
        ret.push({
          node: recovery_wallet,
          address_n: prevoutToPath(prevOut, true, false)
        });
      }
      return ret;
    });
  }

  var hasChange = false;
  function convertOuts () {
    var d_ret = Promise.resolve();
    var ret = tx.outs.map(function (out) {
      var TYPE_ADDR = 0;
      var TYPE_P2SH = 1;
      var TYPE_MULTISIG = 2;
      var addr = bitcoin.address.fromOutputScript(out.script, _this.network);
      var ret = {
        amount: out.value,
        address: addr,
        script_type: bitcoin.script.isScriptHashOutput(
          out.script
        ) ? TYPE_P2SH : TYPE_ADDR
      };
      if (out.pointer !== undefined && !hasChange) {
        hasChange = true;  // Trezor allows only one change output
        ret.script_type = TYPE_MULTISIG;
        ret.multisig = {
          pubkeys: 'TODO',
          m: 2
        };
        d_ret = d_ret.then(function () {
          return getPubKeys({
            raw: {pointer: out.pointer},
            subaccount: out.subaccount
          });
        }).then(function (pubkeys) {
          ret.multisig.pubkeys = pubkeys;
        });
      }
      return ret;
    });
    d_ret = d_ret.then(function () {
      return ret;
    });
    return d_ret;
  }
  function convertIns (ins) {
    return ins.map(function (inp) {
      return {
        prev_hash: fromHex(
          bitcoin.bufferutils.reverse(
            inp.hash
          ).toString('hex')
        ),
        prev_index: inp.index,
        script_sig: fromHex(inp.script.toString('hex')),
        sequence: inp.sequence
      };
    });
  }
  function convertOutsBin (outs) {
    return outs.map(function (out) {
      return {
        amount: out.value,
        script_pubkey: fromHex(out.script.toString('hex'))
      };
    });
  }
}

function getChallengeArguments () {
  return this.getPublicKey().then(function (hdWallet) {
    return [ 'com.greenaddress.login.get_trezor_challenge', hdWallet.hdnode.keyPair.getAddress(), true ];
  });
}

function pingDevice (device) {
  return device.initialize();
}

function listDevices (network, options) {
  if (!window.trezor) {
    window.trezor = require('../../hw-apis/trezor-hid');
  }
  var trezor_api = window.trezor.load(options.hidImpl);
  return trezor_api.devices();
}

function openDevice (network, options, device) {
  var trezor_api = window.trezor.load(options.hidImpl);
  return trezor_api.open(device).then(function (dev_) {
    return dev_.initialize().then(function (init_res) {
      var outdated = false;
      if (init_res.message.major_version < 1) outdated = true;
      else if (init_res.message.major_version === 1 &&
        init_res.message.minor_version < 3) outdated = true;
      if (outdated) {
        return Promise.reject({
          outdatedFirmware: true,
          message: gettext(
            'Outdated firmware. Please upgrade to at least 1.3.0 at http://mytrezor.com/'
          ),
          recoverable: false
        });
      } else {
        return dev_;
      }
    });
  });
}

function checkForDevices (network, options) {
  options = options || {};

  var isChromeApp = require('has-chrome-storage');
  var nodeHid;
  try {
    nodeHid = require('node-hid');
  } catch (e) { }
  if (!isChromeApp && !(nodeHid && nodeHid.devices)) {
    return Promise.reject('No Trezor support present');
  }

  if (!isChromeApp) {
    options.hidImpl = 'node';
  }

  return HWWallet.checkForDevices(TrezorHWWallet, network, options);
}

function setupSeed (mnemonic) {
  var modal;
  var _this = this;

  return new Promise(function (resolve, reject) {
    var modalOptions = {
      cancel: cancel,
      finalize: finalize,
      reuse: reuse,
      usingMnemonic: !!mnemonic
    };

    return _this.getPublicKey().then(function () {
      modal = HWWallet.guiCallbacks.trezorSetupModal(
        extend({ alreadySetup: true }, modalOptions)
      );
    }, function (err) {
      if (err.code !== 11) { // Failure_NotInitialized
        reject(err);
      } else {
        modal = HWWallet.guiCallbacks.trezorSetupModal(modalOptions);
      }
    });

    function cancel () {
      reject(gettext('Cancelled'));
    }

    function finalize () {
      var store_d;
      if (mnemonic) {
        store_d = _this._recovery(mnemonic);
      } else {
        store_d = TrezorHWWallet.currentDevice.resetDevice({ strength: 256 });
      }
      return store_d.then(function () {
        modal.close();
        resolve();
      }).catch(function (err) {
        modal.close();
        reject(err);
      });
    }

    function reuse () {
      if (mnemonic) {
        reject('Cannot reuse and use mnemonic at the same time!');
        return;
      }
      modal.close();
      resolve();
    }
  });
}

function _recovery (mnemonic) {
  var dev;
  return this.getDevice().then(function () {
    dev = TrezorHWWallet.currentDevice;
    return dev.wipeDevice();
  }).then(function () {
    return dev.loadDevice({mnemonic: mnemonic});
  });
}

function initDevice (device) {
  device.on('pin', TrezorHWWallet.promptPin);
  device.on('passphrase', TrezorHWWallet.promptPassphrase);
  device.on('error', TrezorHWWallet.handleError);
  device.on('button', TrezorHWWallet.handleButton);
}
