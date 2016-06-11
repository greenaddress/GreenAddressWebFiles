var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');

var SchnorrSigningKey = require('../bitcoinup').SchnorrSigningKey;

module.exports = GAScriptFactory;

extend(GAScriptFactory.prototype, {
  _createGAScript: _createGAScript,
  create2of2Script: create2of2Script,
  create2of3Script: create2of3Script,
  createScriptForSubaccountAndPointer: createScriptForSubaccountAndPointer
});

function GAScriptFactory (keysManager) {
  this.keysManager = keysManager;
}

function _createGAScript (subaccountPointer, pointer, backupKey) {
  var gaKey = this.keysManager.getGAPubKey(subaccountPointer, pointer);
  var myKey = this.keysManager.getMyPubKey(subaccountPointer, pointer);

  if (backupKey) {
    backupKey = backupKey.derive(1).then(function (branch) {
      return branch.derive(pointer);
    }.bind(this));
  } else {
    backupKey = Promise.resolve();
  }

  return Promise.all([myKey, backupKey]).then(function (keys) {
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

function create2of3Script (subaccountPointer, pointer, backupKey) {
  if (!backupKey) throw new Error('Missing backup key');
  return this._createGAScript(subaccountPointer, pointer, backupKey);
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