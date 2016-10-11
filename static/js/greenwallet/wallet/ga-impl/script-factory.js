var bitcoin = require('bitcoinjs-lib');
var branches = require('./constants').branches;
var extend = require('xtend/mutable');

var SchnorrSigningKey = require('../bitcoinup').SchnorrSigningKey;

module.exports = GAScriptFactory;

extend(GAScriptFactory.prototype, {
  _createGAScript: _createGAScript,
  create2of2Script: create2of2Script,
  create2of3Script: create2of3Script,
  createScriptForSubaccountAndPointer: createScriptForSubaccountAndPointer,
  getUtxoPrevScript: getUtxoPrevScript
});

function GAScriptFactory (keysManager) {
  this.keysManager = keysManager;
}

function _createGAScript (subaccountPointer, pointer, myRecoveryKey) {
  var gaKey = this.keysManager.getGAPublicKey(subaccountPointer, pointer);
  var myKey = this.keysManager.getMyPublicKey(subaccountPointer, pointer);

  if (myRecoveryKey) {
    myRecoveryKey = myRecoveryKey.derive(1).then(function (branch) {
      return branch.derive(pointer);
    });
  } else {
    myRecoveryKey = Promise.resolve();
  }

  return Promise.all([myKey, myRecoveryKey]).then(function (keys) {
    var chunks = [
      bitcoin.opcodes.OP_2,
      gaKey.getPublicKeyBuffer(),
      keys[0].getPublicKeyBuffer()
    ];
    if (keys[1]) {
      chunks.push(keys[1].getPublicKeyBuffer());
      chunks.push(bitcoin.opcodes.OP_3);
    } else {
      chunks.push(bitcoin.opcodes.OP_2);
    }
    chunks.push(bitcoin.opcodes.OP_CHECKMULTISIG);
    return bitcoin.script.compile(chunks);
  });
}

function create2of2Script (subaccountPointer, pointer) {
  return this._createGAScript(subaccountPointer, pointer, null);
}

function create2of3Script (subaccountPointer, pointer, recoveryKey) {
  if (!recoveryKey) throw new Error('Missing recovery key');
  return this._createGAScript(subaccountPointer, pointer, recoveryKey);
}

function createScriptForSubaccountAndPointer (subaccount, pointer) {
  if (subaccount.type === '2of3') {
    var backupHDWallet = new SchnorrSigningKey(new bitcoin.HDNode(
      bitcoin.ECPair.fromPublicKeyBuffer(
        new Buffer(subaccount['2of3_backup_pubkey'], 'hex'),
        this.keysManager.pubHDWallet.hdnode.keyPair.network
      ),
      new Buffer(subaccount['2of3_backup_chaincode'], 'hex')
    ));
    return this.create2of3Script(
      subaccount.pointer,
      pointer,
      backupHDWallet
    );
  } else {
    return this.create2of2Script(
      subaccount.pointer,
      pointer
    );
  }
}

function getUtxoPrevScript (utxo) {
  if (utxo.script) {
    return Promise.resolve(utxo.script);
  } else if (utxo.raw.branch === branches.EXTERNAL) {
    // priv-derived branch
    return this.keysManager.getMyPublicKey(
      utxo.subaccount.pointer, utxo.raw.pointer, utxo.raw.branch
    ).then(function (pk) {
      return bitcoin.script.pubKeyHashOutput(bitcoin.crypto.hash160(
        pk.getPublicKeyBuffer()
      ));
    });
  } else {
    return this.createScriptForSubaccountAndPointer(
      utxo.subaccount, utxo.raw.pointer
    );
  }
}
