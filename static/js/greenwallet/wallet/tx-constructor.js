var bitcoinup = require('./bitcoinup/index.js');
var extend = require('xtend/mutable');

module.exports = TxConstructor;

extend(TxConstructor.prototype, {
  constructTx: constructTx,
  getBalance: getBalance,
  refreshUtxo: refreshUtxo,
  _getBalance: _getBalance,
  _constructTx: _constructTx,
  _collectOutputs: _collectOutputs,
  _initializeNeededValue: _initializeNeededValue,
  _increaseNeededValue: _increaseNeededValue
});
TxConstructor._makeUtxoFilter = _makeUtxoFilter;

function TxConstructor (dependencies) {
  if (!dependencies) return; // allow inheritance

  this.utxoFactory = dependencies.utxoFactory;
  this.changeAddrFactory = dependencies.changeAddrFactory;
  this.feeEstimatesFactory = dependencies.feeEstimatesFactory;
  this.Transaction = dependencies.transactionClass || bitcoinup.Transaction;
  this.buildOptions = {};
  this.refreshUtxo();
}

function _makeUtxoFilter (assetNetworkId, requiredValue, message, options) {
  return processFiltered;

  function processFiltered (utxos) {
    var collected = [];
    var collectedTotal = Promise.resolve(0);
    for (var i = 0; i < utxos.length; ++i) {
      (function (i) {
        collectedTotal = collectedTotal.then(function (curTotal) {
          if (options.nonCTOnly && !utxos[i].value) {
            return curTotal;
          }
          return utxos[ i ].getValue().then(function (nextValue) {
            if (curTotal >= requiredValue) {
              return curTotal;
            }
            collected.push(utxos[ i ]);
            return curTotal + nextValue;
          });
        });
      })(i);
    }
    return collectedTotal.then(function (total) {
      if (total < requiredValue) {
        throw new Error(message);
      }
      return collected.map(process);
    });
  }
  function process (utxo) {
    utxo.assetNetworkId = assetNetworkId;
    return utxo;
  }
}

function _collectOutputs (requiredValue, options) {
  options = options || {};
  return _makeUtxoFilter(
    this.buildOptions.feeNetworkId, requiredValue, 'not enough money', options
  )(this.utxo);
}

function _initializeNeededValue (outputsWithAmounts) {
  var total = 0;
  outputsWithAmounts.forEach(function (output) {
    total += output.value;
  });
  return total;
}

function _increaseNeededValue (oldVal, newVal) {
  return Math.max(oldVal, newVal);
}

function _constructTx (outputsWithAmounts, options) {
  // 1. get fee estimate
  var feeEstimate = this.feeEstimatesFactory.getFeeEstimate(1)[0];

  // 2. create the transaction, looping until we have enough inputs provided
  var tx = new this.Transaction();
  var builtTxData;
  var oldNeededValue = this._initializeNeededValue(outputsWithAmounts);
  return tx.build(extend({
    outputsWithAmounts: outputsWithAmounts,
    // start with no inputs to get the first estimate of required value which
    // is then processed by `iterate` below:
    prevOutputs: [],
    feeEstimate: feeEstimate,
    getChangeOutScript: this.changeAddrFactory.getNextOutputScript.bind(
      this.changeAddrFactory
    )
  }, this.buildOptions, options)).then(
    iterate.bind(this)
  ).then(
    // 3. sign the transaction
    tx.signAll.bind(tx)
  ).then(function () {
    return extend({
      tx: tx.toBuffer()
    }, builtTxData);
  });

  function iterate (neededValueAndChange) {
    if (Object.prototype.toString.call(neededValueAndChange) ===
        '[object Array]') {
      // (1) collect outputs needed for the missing value
      var neededValue = neededValueAndChange[0];
      // make sure neededValue never decreases:
      neededValue = this._increaseNeededValue(neededValue, oldNeededValue);
      oldNeededValue = neededValue;
      var changeCache = neededValueAndChange[1];
      return this._collectOutputs(neededValue, options).then(function (prevOutputs) {
        // (2) rebuild the tx
        var buildOptions = {
          outputsWithAmounts: outputsWithAmounts,
          prevOutputs: prevOutputs,
          feeEstimate: feeEstimate,
          getChangeOutScript: this.changeAddrFactory.getNextOutputScript.bind(
            this.changeAddrFactory
          ),
          // cache change out between calls, if any was generated, to avoid
          // generating multiple change addresses
          changeCache: changeCache
        };
        return tx.build(
          extend(buildOptions, this.buildOptions, options)
        ).then(
          iterate.bind(this)
        );
      }.bind(this));
    } else {
      builtTxData = neededValueAndChange;
    }
  }
}

function constructTx (outputsWithAmounts, options) {
  return this.utxoDeferred.then(function () {
    return this._constructTx(outputsWithAmounts, options);
  }.bind(this));
}

function _getBalance () {
  return this.utxo.reduce(
    function (prev, cur) {
      return prev.then(function (value) {
        return cur.getValue().then(function (value2) {
          return value + value2;
        });
      });
    },
    Promise.resolve(0)
  );
}

function getBalance () {
  return this.utxoDeferred.then(function () {
    return this._getBalance();
  }.bind(this));
}

function refreshUtxo () {
  this.utxoDeferred = this.utxoFactory.listAllUtxo().then(function (utxo) {
    this.utxo = utxo;
  }.bind(this));
  return this.utxoDeferred;
}