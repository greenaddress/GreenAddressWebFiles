try { importScripts('typedarray.js'); } catch (e) { }  // Cordova polyfill
importScripts('bitcoinjs.min.js');

try {
    var randArr = new Uint8Array(32);
    window.crypto.getRandomValues(randArr);
    if (!Module._secp256k1_context_randomize(Module.secp256k1ctx, randArr)) {
        throw new Error("Couldn't initialize library, randomized failed");
    }
} catch (e) { }  // firefox doesn't find window nor crypto?

var isPatched = false;
var patchIfNotPatched = function(isAlpha) {
    if (isPatched) return;
    isPatched = true;
    importScripts('secp256k1-alpha/secp256k1-alpha.js');
    Bitcoin.contrib.init_secp256k1(Module);
}
// segnet hack (belongs in bitcoinjs really)
segnet = {pubKeyHash: 30, scriptHash: 50, wif: 158,
          bip32: {public: 0x053587CF, private: 0x05358394},
          messagePrefix: '\x18Bitcoin Signed Message:\n',
          dustThreshold: 546};
funcs = {
	derive: function(data, isAlpha) {
		var wallet = Bitcoin.bitcoin.HDNode.fromBase58(
            data.wallet,
            [Bitcoin.bitcoin.networks.bitcoin,
             Bitcoin.bitcoin.networks.testnet,
             segnet]
        );
		return wallet.derive(data.i).toBase58();
	}
}
onmessage = function(message) {
  patchIfNotPatched(message.data.isAlpha);
	postMessage({
		callId: message.data.callId,
		result: funcs[message.data.func](
        message.data.data,
        message.data.isAlpha,
        message.data.schnorr
    )
	});
}
