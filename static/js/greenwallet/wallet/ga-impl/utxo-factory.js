var bitcoin = require('bitcoinjs-lib');
var extend = require('xtend/mutable');
var SchnorrSigningKey = require('../bitcoinup').SchnorrSigningKey;

module.exports = {
  'GAUtxoFactory': GAUtxoFactory,
  'GAUtxo': GAUtxo
};

extend(GAUtxoFactory.prototype, {
  listAllUtxo: listAllUtxo,
  getRawTx: getRawTx,
  getRootHDKey: getRootHDKey,
  createUtxoForPointer: createUtxoForPointer
});

extend(GAUtxo.prototype, {
  getPubKey: utxoGetPubKey,
  getBackupPubKey: utxoGetBackupPubKey,
  getSigningKey: utxoGetSigningKey,
  getPrevScript: utxoGetPrevScript,
  getPrevScriptLength: utxoGetPrevScriptLength,
  getValue: utxoGetValue,
  _getKey: _utxoGetKey
});

function GAUtxoFactory (gaService, options) {
  this.options = options;
  this.gaService = gaService;
  this.UtxoClass = this.options.utxoClass || GAUtxo;

  // optimisation for non-subaccounts subkeys and slow hardware wallets
  // (we don't need the priv-derivation to derive non-subaccount subkeys)
  this.pubHDWallet = options.pubHDWallet;
  this.privHDWallet = options.privHDWallet;
  this.subaccount = options.subaccount;
}

function listAllUtxo () {
  var args =[
    0, /* include 0-confs */
    this.subaccount.pointer || 0,  /* subaccount */
  ];
  if (this.options.asset) {
    args.push(this.options.asset)
  }
  return this.gaService.call(
    'com.greenaddress.txs.get_all_unspent_outputs',
    args
  ).then(function (utxos) {
    return utxos.map(function (utxo) {
      return new this.UtxoClass(
        this.gaService, utxo,
        {pubHDWallet: this.pubHDWallet,
         privHDWallet: this.privHDWallet,
         subaccount: this.subaccount}
      );
    }.bind(this));
  }.bind(this));
}

function createUtxoForPointer (pointer) {
  return new this.UtxoClass(
    this.gaService,
    {pointer: pointer,
     subaccount: this.subaccount.pointer,
     txhash: ''},
    {pubHDWallet: this.pubHDWallet,
     privHDWallet: this.privHDWallet,
     subaccount: this.subaccount}
  );
}

function getRawTx (txhash) {
  return this.gaService.call(
    'com.greenaddress.txs.get_raw_unspent_output',
    [txhash] // include 0-confs
  );
}

function GAUtxo (gaService, utxo, options) {
  if (!gaService) return; // allow subclassing

  this.gaService = gaService;

  this.prevHash = [].reverse.call(new Buffer(utxo.txhash, 'hex'));
  this.ptIdx = utxo.pt_idx;
  this.value = +utxo.value;
  this.raw = utxo;

  this.pubHDWallet = options.pubHDWallet;
  this.privHDWallet = options.privHDWallet;

  this.subaccount = options.subaccount;
  if (this.subaccount.type === '2of3') {
    this.backupHDWallet = new SchnorrSigningKey(new bitcoin.HDNode(
      bitcoin.ECPair.fromPublicKeyBuffer(
        new Buffer(this.subaccount['2of3_backup_pubkey'], 'hex'),
        this.pubHDWallet.hdnode.keyPair.network
      ),
      new Buffer(this.subaccount['2of3_backup_chaincode'], 'hex')
    ));
  }
}

function _getSubaccountHDKey (hdwallet, subaccount) {
  return hdwallet.deriveHardened(3).then(function (hd) {
    return hd.deriveHardened(subaccount);
  });
}

function getRootHDKey () {
  if (this.subaccount.pointer) {
    return _getSubaccountHDKey(this.privHDWallet, this.subaccount.pointer);
  } else {
    return Promise.resolve(this.privHDWallet);
  }
}

function _utxoGetKey (priv, otherOne) {
  var key;
  if (this.raw.subaccount &&
    this.raw.subaccount === this.subaccount.pointer &&
    this.subaccountHdWallet) {
    key = Promise.resolve(this.subaccountHdWallet);
  } else if (this.raw.subaccount) {
    key = _getSubaccountHDKey(priv, this.raw.subaccount);
    // derive subaccount only once and cache it to avoid deriving the same
    // key multiple times
    if (this.raw.subaccount === this.subaccount.pointer) {
      key = key.then(function (hd) {
        this.subaccountHdWallet = hd;
        return hd;
      }.bind(this));
    }
  } else {
    key = Promise.resolve(otherOne);
  }
  return key.then(function (hd) {
    return hd.derive(1);
  }).then(function (hd) {
    return hd.derive(this.raw.pointer);
  }.bind(this));
}

function utxoGetPubKey () {
  // priv only for subaccounts -- avoid involving hw wallets when not necessary
  return this._getKey(this.privHDWallet, this.pubHDWallet);
}

function utxoGetBackupPubKey () {
  if (!this.backupHDWallet) {
    return Promise.resolve();
  }
  return this.backupHDWallet.derive(1).then(function (branch) {
    return branch.derive(this.raw.pointer);
  }.bind(this));
}

function utxoGetSigningKey () {
  // always priv, even when it's not a subaccount
  return this._getKey(this.privHDWallet, this.privHDWallet);
}

function utxoGetPrevScript () {
  var gaNode = this.gaService.getGAHDNode(this.raw.subaccount);
  gaNode = gaNode.derive(this.raw.pointer);
  var myKey = this.getPubKey();
  var backupKey = this.getBackupPubKey();

  return Promise.all([myKey, backupKey]).then(function (keys) {
    var chunks = [
      bitcoin.opcodes.OP_2,
      gaNode.getPublicKeyBuffer(),
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

function utxoGetValue () {
  return Promise.resolve(this.value);
}

function utxoGetPrevScriptLength () {
  var numKeys = this.backupHDWallet ? 3 : 2;
  return 1 +  // OP_2
         numKeys * 35 +  // keys pushdata
         2;  // OP_[23] OP_CHECKMULTISIG
}
