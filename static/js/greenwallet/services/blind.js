var window = require('global/window');

module.exports = factory;

factory.dependencies = ['$q', 'branches'];

function factory ($q, branches) {
  var service = {};
  service._unblindOutValue = function ($scope, out, scanning_key) {
    // (these are loaded asynchronously from secp256k1 js in bitcoinjs_util.js)
    var Module = window.Module;
    var setValue = window.setValue;
    var getValue = window.getValue;

    var Bitcoin = window.Bitcoin;
    var secexp_buf = scanning_key.d.toBuffer();
    var secexp = Module._malloc(32);
    var nonce = Module._malloc(33);
    var nonce_res = Module._malloc(32);
    var pubkey_p = Module._malloc(64);
    var p_arr = Array.from(new Bitcoin.BigInteger('' + pubkey_p).toBuffer());
    var i;

    while (p_arr.length < 4) {
      p_arr.unshift(0);
    }
    for (i = 0; i < 32; ++i) {
      setValue(secexp + i, secexp_buf[i], 'i8');
    }
    for (i = 0; i < 33; ++i) {
      setValue(nonce + i, out.nonce_commitment[i], 'i8');
    }
    if (Module._secp256k1_ec_pubkey_parse(
        Module.secp256k1ctx,
        pubkey_p,
        nonce,
        33
      ) !== 1) {
      throw new Error('secp256k1 EC pubkey parse failed');
    }
    if (Module._secp256k1_ecdh(
        Module.secp256k1ctx,
        nonce_res,
        pubkey_p,
        secexp
      ) !== 1) {
      throw new Error('secp256k1 ECDH failed');
    }
    var nonce_buf = new Bitcoin.Buffer.Buffer(32);
    for (i = 0; i < 32; ++i) {
      nonce_buf[i] = getValue(nonce_res + i, 'i8') & 0xff;
    }
    nonce_buf = Bitcoin.bitcoin.crypto.sha256(nonce_buf);
    for (i = 0; i < 32; ++i) {
      setValue(nonce_res + i, nonce_buf[i], 'i8');
    }
    var blinding_factor_out = Module._malloc(32);
    var amount_out = Module._malloc(8);
    var min_value = Module._malloc(8);
    var max_value = Module._malloc(8);
    var msg_out = Module._malloc(4096);
    var msg_size = Module._malloc(4);
    var commitment = Module._malloc(33);
    for (i = 0; i < 33; ++i) {
      setValue(commitment + i, out.commitment[i], 'i8');
    }
    var range_proof = Module._malloc(out.range_proof.length);
    for (i = 0; i < out.range_proof.length; ++i) {
      setValue(range_proof + i, out.range_proof[i], 'i8');
    }
    var rewindRes = Module._secp256k1_rangeproof_rewind(
      Module.secp256k1ctx,
      blinding_factor_out,
      amount_out,
      msg_out,
      msg_size,
      nonce_res,
      min_value,
      max_value,
      commitment,
      range_proof,
      out.range_proof.length
    );
    if (rewindRes !== 1) {
      throw new Error('Invalid transaction.');
    }
    var ret = [];
    for (i = 0; i < 8; ++i) {
      ret[8 - i - 1] = getValue(amount_out + i, 'i8') & 0xff;
    }
    var val = Bitcoin.BigInteger.fromBuffer(
      new Bitcoin.Buffer.Buffer(ret)
    );
    return {
      value: '' + (+val),
      blinding_factor_out: blinding_factor_out
    };
  };
  service.unblindOutValue = function ($scope, out, subaccount, pubkey_pointer) {
    var key = $q.when($scope.wallet.hdwallet);
    if (subaccount) {
      key = key.then(function (key) {
        return key.deriveHardened(branches.SUBACCOUNT);
      }).then(function (key) {
        return key.deriveHardened(subaccount);
      });
    }
    return key.then(function (key) {
      return key.deriveHardened(branches.BLINDED);
    }).then(function (branch) {
      return branch.deriveHardened(pubkey_pointer);
    }).then(function (scanning_node) {
      return service._unblindOutValue(
        $scope, out, scanning_node.keyPair
      );
    });
  };
  return service;
}
