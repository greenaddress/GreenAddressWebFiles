module.exports = {
  AssetsWallet: require('./assets-wallet'),
  Service: require('./service'),
  UtxoFactory: require('./utxo-factory').GAUtxoFactory,
  Utxo: require('./utxo-factory').GAUtxo
};