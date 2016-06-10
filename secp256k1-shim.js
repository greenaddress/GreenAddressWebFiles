module.exports = {
    _malloc: function () { return window.Module._malloc.apply(window.Module, arguments); },
    _free: function () { return window.Module._free.apply(window.Module, arguments); },
    writeArrayToMemory: function () { return window.Module.writeArrayToMemory.apply(window.Module, arguments); },
    setValue: function () { return window.Module.setValue.apply(window.Module, arguments); },
    getValue: function () { return window.Module.getValue.apply(window.Module, arguments); },
    _secp256k1_context_create: function () { return window.Module._secp256k1_context_create.apply(window.Module, arguments); },
    _secp256k1_schnorr_sign: function () { return window.Module._secp256k1_schnorr_sign.apply(window.Module, arguments); },
    _secp256k1_pedersen_context_initialize: function () { return window.Module._secp256k1_pedersen_context_initialize.apply(window.Module, arguments); },
    _secp256k1_rangeproof_context_initialize: function () { return window.Module._secp256k1_rangeproof_context_initialize.apply(window.Module, arguments); },
    _secp256k1_pedersen_blind_sum: function () { return window.Module._secp256k1_pedersen_blind_sum.apply(window.Module, arguments); },
    _secp256k1_pedersen_commit: function () { return window.Module._secp256k1_pedersen_commit.apply(window.Module, arguments); },
    _secp256k1_ec_pubkey_parse: function () { return window.Module._secp256k1_ec_pubkey_parse.apply(window.Module, arguments); },
    _secp256k1_ecdh: function () { return window.Module._secp256k1_ecdh.apply(window.Module, arguments); },
    _secp256k1_rangeproof_sign: function () { return window.Module._secp256k1_rangeproof_sign.apply(window.Module, arguments); },
    _secp256k1_rangeproof_rewind: function () { return window.Module._secp256k1_rangeproof_rewind.apply(window.Module, arguments); }
};
