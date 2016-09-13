var extend = require('xtend/mutable');
var HWKeysManager = require('./../keys-managers/hw-keys-manager');
var ScriptFactory = require('./../script-factory');

module.exports = HwSigningWallet;

extend(HwSigningWallet.prototype, {
  getChallengeArguments: getChallengeArguments,
  signChallenge: signChallenge,
  signTransaction: signTransaction,
  derivePath: derivePath,
  getChainCode: getChainCode
});

function HwSigningWallet (options) {
  this.keysManager = new HWKeysManager({
    gaService: options.gaService,
    pubHDWallet: options.hd,
    hw: options.hw
  });
  this.hw = options.hw;
  this.scriptFactory = new ScriptFactory(this.keysManager);
}

function getChallengeArguments () {
  return this.hw.getChallengeArguments();
}

function signChallenge (challenge) {
  // btchip requires 0xB11E to skip HID authentication
  // 0x4741 = 18241 = 256*G + A in ASCII
  var path = [0x4741b11e];

  challenge = 'greenaddress.it      login ' + challenge;
  return this.hw.signMessage(path, challenge).then(function (signature) {
    signature = [ signature.r.toString(), signature.s.toString(), signature.i.toString() ];
    return {signature: signature, path: 'GA'};
  });
}

function signTransaction (tx, options) {
  return this.hw.signTransaction(tx, extend({
    keysManager: this.keysManager
  }, options));
}

function derivePath () {
  throw new Error('not implemented');
}

function getChainCode () {
  return Promise.resolve(this.keysManager.pubHDWallet.getChainCode());
}
